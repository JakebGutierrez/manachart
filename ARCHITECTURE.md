# MTG Chart — Architecture

## Overview

Single-page app: Vite + React + TypeScript, static deploy (Vercel).
No backend. All state in localStorage.

---

## Folder Structure

```
src/
  components/
    ControlPanel/       # Left sidebar — all chart controls
    Grid/               # Grid renderer + cell components
    SearchPanel/        # Scryfall search bar + results
    PrintingSwitcher/   # Modal for alternate printings
    ContextMenu/        # Right-click menu
    NameDisplay/        # Sidebar and overlay name renderers
  hooks/
    useCharts.ts        # Multi-chart CRUD + localStorage sync
    useScryfall.ts      # Debounced search, printings fetch, AbortController
    useExport.ts        # Blob pre-fetch, preflight, canvas export
  types/
    chart.ts            # Chart, Slot, CellMap, and enums
  utils/
    scryfall.ts         # API URL builders, response normalisation, art_crop filter
    imageBlob.ts        # fetch-as-blob + object URL helpers
    cellMap.ts          # CellMap generation (uniform) and traversal utilities
    schemaVersion.ts    # Migration runner (v1 → vN)
```

---

## Data Model (schemaVersion: 1)

```typescript
interface Chart {
  id: string                          // uuid
  name: string
  schemaVersion: number               // integer, currently 1
  gridRows: number
  gridCols: number
  layout: "uniform" | "hybrid"        // only "uniform" built in MVP
  displayMode: "landscape" | "square" // only "landscape" built in MVP
  nameDisplayMode: "none" | "sidebar" | "overlay"
  title: string
  backgroundColor: string             // hex
  cellGap: number                     // px
  padding: number                     // px
  cornerRadius: number                // px
  slots: Array<Slot | null>           // visual-cell-indexed, row-major, sparse
}

interface Slot {
  kind: "scryfall"                    // discriminator; reserved for future "custom"
  scryfallId: string                  // stable identity for re-fetch
  oracleId: string
  cardName: string
  setCode: string
  collectorNumber: string
  layout: string                      // Scryfall layout field (transform, modal_dfc, etc.)
  selectedFaceIndex: 0 | 1           // MVP supports 2-face cards only
  imageUris: Array<{                  // indexed by face; length 1 for single-face cards
    artCrop: string
    normal: string
  }>
  // imageUris is refreshable cache, not permanent identity.
  // imageUris[selectedFaceIndex].artCrop is the rendered and exported image.
  // normal is stored for the post-MVP manual framing feature; unused in MVP.
  // All faces populated at add time and at printing-switch time — face toggle
  // requires no re-fetch.
  // If artCrop 404s during export: re-fetch by scryfallId, update cache, persist.
}
```

### Reserved for post-MVP (non-breaking, bump schemaVersion when added)

Per-slot crop/frame for manual framing and square mode:
```typescript
cropX?: number      // 0–1 normalised horizontal offset, default 0.5
cropY?: number      // 0–1 normalised vertical offset, default 0.5
cropScale?: number  // 1.0 = fit; >1 = zoom in, default 1.0
```

Migration: add `{ cropX: 0.5, cropY: 0.5, cropScale: 1.0 }` to all existing slots —
equivalent to the MVP `object-fit: cover` behaviour.

Custom items:
```typescript
// slot.kind = "custom" + localImageDataUrl?: string
```
`kind` is reserved now so adding "custom" is additive, not a migration.

### schemaVersion migration

On app load: if any stored chart has `schemaVersion < currentSchemaVersion`, run the
migration chain (v1→v2→…→current), filling missing fields with their defaults, then
persist before rendering.

### MVP cell rendering

Cells use `<img>` with `object-fit: cover` and `overflow: hidden` — **not** CSS
`background-image`. This is required so post-MVP crop transforms (CSS translate/scale)
can be applied to the same element without restructuring.

---

## Grid: CellMap Abstraction

The central seam between uniform and hybrid layouts.

```typescript
type CellDef =
  | { kind: "slot";    slotIndex: number }
  | { kind: "hero";    slotIndex: number; rowSpan: number; colSpan: number }
  | { kind: "covered" }                   // occupied by adjacent hero; not a drop target

type CellMap = CellDef[]                  // length = rows × cols, row-major
```

The grid renderer consumes a CellMap — it never computes slot positions itself.
In uniform mode (MVP), CellMap is trivially generated: cell `i` → `{ kind: "slot", slotIndex: i }`.

**Hero-ness belongs to board positions, not slot contents.** Dragging a card out of a
hero cell moves the card's Slot data; the hero position stays hero and becomes empty.
Drag operations move card data only — layout roles never change.

`slots` is **visual-cell-indexed**. Covered positions remain `null` in `Chart.slots`.

Derived semantics:
- Valid drop targets: `kind !== "covered"`
- "Next empty slot": first `slotIndex` where `slots[slotIndex] === null` and `kind !== "covered"`
- Capacity: `cellMap.filter(c => c.kind !== "covered").length`
- Numbering: follows `slotIndex` order, skips `"covered"` cells
- CellMap is memoized on `[gridRows, gridCols, heroConfig]`

### Grid resize guard

Shrink is blocked if any occupied slot would be out-of-bounds in the new layout.
For each non-null slot at index `i`:
```
row = floor(i / currentCols)
col = i % currentCols
blocked if row >= newRows OR col >= newCols
```
This catches sparse occupancy (e.g. single card in the bottom-right of a 3×3,
shrinking to 2×2) — not just total card count.

### Post-MVP: Hybrid hero layout

Add `heroConfig?: Array<{ row: number; col: number; rowSpan: number; colSpan: number }>`
to `Chart`. `cellMap.ts` generates the CellMap from this config (marking covered cells,
assigning hero slotIndices, renumbering the rest sequentially). The grid renderer,
export, DnD semantics, and "next empty" logic are all already correct because they
filter on `kind !== "covered"` — no changes needed in those layers.

---

## CORS & Export Strategy

**Choice: client-side blob fetch + canvas 2D API rendering. Pure static deploy.**

Scryfall's image CDN (`cards.scryfall.io`) currently responds with
`Access-Control-Allow-Origin: *`. This is operational behaviour, not a contractual
guarantee. Risk: if Scryfall tightens CORS, a single Vercel serverless proxy function
is the fix — no rewrite required.

### Export flow (`useExport.ts`)

**Step 1 — Deterministic target-resolution geometry + pixel-budget preflight**

Export dimensions are derived from chart config alone — **never** from the live
DOM/viewport — so the same chart exports at the same resolution on every device
(and mobile is no longer downscaled to its narrow viewport). The pure geometry
(cell sizing, layout, cover-crop source rect, `fitsAt`, scale resolution, sidebar
measure, truncation) lives in `src/utils/exportGeometry.ts` and is unit-tested;
the hook is only the caller.

**Determinism caveat:** sizing is config-deterministic for every chart *except*
`nameDisplayMode === 'sidebar'`. Sidebar width is measured from canvas text metrics
(`ctx.measureText` on card names, in the hook), which vary by a few pixels across
browsers/platforms and feed into `innerW` — so a sidebar chart's exact export size
can differ slightly between devices. All non-sidebar charts are fully deterministic.

**Target-resolution cell sizing, capped by the device budget.** Two deterministic
stages (config only, no DOM):

```typescript
// Stage 1 — computeCellWidth(): the IDEAL cell. Solve cellW so the grid long edge ≈
// BASE_TARGET_LONG_EDGE, clamped to [MIN_CELL_W, MAX_CELL_W]. Small grids get big
// cells (a 1×1 hits the target); large grids get small cells.
const k = displayMode === 'square' ? 1 : 3 / 4
const byWidth  = (BASE_TARGET_LONG_EDGE - (cols - 1) * gap) / cols
const byHeight = (BASE_TARGET_LONG_EDGE - (rows - 1) * gap) / (rows * k)
const ideal = clamp(Math.min(byWidth, byHeight), MIN_CELL_W, MAX_CELL_W)

// Stage 2 — resolveExportSizing(): cap the cell so the REQUESTED scale fits the
// platform budget, and only drop the scale when even MIN_CELL_W can't fit.
//   maxFit = maxCellForBudget(cfg, requestedScale)  // largest cell that fits budget
//   if (maxFit >= MIN_CELL_W) → { cellW: min(ideal, maxFit), scale: requested }
//   else if requested === 2 and it fits at 1× → { cellW: min(ideal, maxAt1x), scale: 1, downgraded }
//   else → null (Task-3 hard error)

// BASE_TARGET_LONG_EDGE = 1400, MIN_CELL_W = 88, MAX_CELL_W = 1400.
```

`maxCellForBudget` inverts the pixel budget for the cell: the export inner box is
`W(cell) = cols·cell + Cw`, `H(cell) = rows·k·cell + Ch` (Cw/Ch collect gaps,
sidebar, title, padding). Desktop is a per-side ceiling (linear solve); iOS is a
total-area cap (positive root of a quadratic).

**Budgets are checked on the ROUNDED, allocated pixel count, not the float layout.**
The canvas allocates `w = round((innerW+2·padding)·scale)` and
`h = round((innerH+2·padding)·scale)` — each side rounded *independently*, which can
push the real area above a cap that the float value cleared. So a single helper,
`exportPixelDims`, produces those integers and is used by **both** `fitsAt`
(preflight) and the `canvas.width/height` allocation — they can never disagree.
`maxCellForBudget` accounts for the rounding up front: because `round(x) ≤ x + 0.5`,
it bounds `(Ws + 0.5)(Hs + 0.5) ≤ budget` (Ws/Hs the scaled sides), which guarantees
`round(Ws)·round(Hs) ≤ budget`. Without this, a 3×3 landscape at iOS 2× passed the
float check but allocated 1987×1510 = 3,000,370 px, over the 3,000,000 cap; it now
sizes to 1986×1510 = 2,998,860, still at 2×.

The budget cap is what keeps quality high **per platform**:

- **Desktop** (8192²-per-side) has huge headroom, so the cap almost never binds and
  desktop keeps the full ideal cell — e.g. a 5×5 exports ~2864px long edge at 2×, a
  1×1 ~2864px (vs the old fixed-180's ~424px).
- **iOS** (3,000,000px²) caps the cell so the requested 2× lands just under budget
  instead of overshooting and downgrading: an ordinary 5×5 landscape exports at 2×
  with a ~189px cell → ~1984px long edge (sharper than the old ~1896px, and *no*
  downgrade). Only genuinely large charts — a 10×10 square, or a 10×10 with a
  sidebar — can't fit even a MIN cell at 2× and take the graceful 1× downgrade,
  surfaced as a soft "Exported at 1× — 2× exceeds this device's canvas limit".
- `null` (hard error) is reserved for configs that can't fit even a MIN cell at 1×
  (e.g. absurd padding); every ordinary 10×10 still exports.

```typescript
// exportPixelDims() — the exact integers allocated, shared with the preflight:
const exportWidth  = Math.round((innerW + 2 * padding) * scale) // scale from resolveExportSizing
const exportHeight = Math.round((innerH + 2 * padding) * scale)
```

**Step 2 — Pre-fetch images as blobs (graceful per-cell degradation)**
```
fetch(artCropUrl, { mode: 'cors' }) → Blob → URL.createObjectURL()
On 404: re-fetch card by scryfallId → re-derive artCrop → update Slot.imageUris, persist
If an image still can't be loaded: DO NOT abort. Skip that cell (it renders as the
  normal empty-cell placeholder) and collect the card name.
After a successful export, surface any skipped cells via the warning state:
  "Exported, but couldn't load art for: X, Y." A scale downgrade is folded into the
  same warning.
shouldHardErrorExport() decides whether to abort: a fully empty result (cards
  present but none loaded) is ALWAYS a hard error; the ">50% failed = systemic
  problem" rule only applies at/above SYSTEMIC_FAILURE_MIN_CELLS (6) filled cells,
  so a small chart (e.g. 3 filled, 2 failed) still downloads a usable partial PNG
  with the warning rather than erroring on a mostly-usable export.
```

**CORS handling.** *Every* `<img>` that loads a Scryfall art URL carries
`crossOrigin="anonymous"` — the grid, the crop preview (`ControlPanel`), the search
results (`SearchPanel`), and the printing thumbnails (`PrintingSwitcher`). This is
because the browser HTTP cache is keyed by CORS mode: a no-cors `<img>` load caches
an *opaque* response the export's `fetch(mode:'cors')` cannot reuse, forcing a fresh
request that can fail on a cold-cache origin. Loading every path anonymously means
all art shares one CORS-usable cache entry and no path can poison it. Safe because
`cards.scryfall.io` serves `Access-Control-Allow-Origin: *`; data-URL custom slots
are unaffected.

**Step 3 — Load images**
```
Create HTMLImageElement per blob URL.
Await img.decode() for all.
```

**Step 4 — Draw to canvas**
```typescript
const canvas = document.createElement('canvas')
canvas.width = exportWidth
canvas.height = exportHeight
const ctx = canvas.getContext('2d')
if (!ctx) throw new Error('Canvas unavailable — device may be low on memory.')
ctx.scale(scale, scale)   // all subsequent drawing uses CSS pixel coordinates

await document.fonts.ready

// Draw: background, cells (cover-crop drawImage with roundRect clip), title, name display
```

Cover-crop math — `coverCropRect()` in `exportGeometry.ts`, equivalent to
`object-fit: cover` plus `object-position` (cropX/cropY) and a zoom (cropScale):
```
if srcAspect > dstAspect:  sh=imgH, sw=imgH*dstAspect
else:                       sw=imgW, sh=imgW/dstAspect
sw /= cropScale; sh /= cropScale            // zoom shrinks the source window
sx = (imgW - sw) * cropX                     // cropX/cropY = 0.5 → centred (default)
sy = (imgH - sh) * cropY
ctx.drawImage(img, sx, sy, sw, sh, cellX, cellY, cellW, cellH)
```

**Step 5 — Cleanup (always)**
```typescript
finally { blobUrls.forEach(url => URL.revokeObjectURL(url)) }
```

**Step 6 — Download**
```typescript
canvas.toBlob((blob) => {
  if (!blob) {
    showExportError('Export failed — try 1× scale or a smaller grid.')
    return
  }
  triggerDownload(blob)
  // Defer the download blob's revoke (~1s) — Safari intermittently aborts a
  // download whose object URL is revoked synchronously right after a.click().
}, 'image/png')
```

### Export image source: `artCrop`

`artCrop` is the only Scryfall image that shows the correct landscape art-box crop.
`normal` and `large` are full portrait cards — cover-crop math on them would crop to
the vertical midpoint of the card (the text box area), not the art.

Known limitation: `artCrop` is lower resolution than `normal`/`large`. Large cells on
small grids (e.g. 2×2) will show interpolation. This is the correct tradeoff for MVP.
`normal` is stored in `imageUris` now so the post-MVP manual framing path has it
available without a schema change.

### Export defaults

| Setting       | Default                               |
|---------------|---------------------------------------|
| Scale         | 2× (1× offered if over pixel budget)  |
| Image source  | `artCrop` for all tiles               |
| Background    | `chart.backgroundColor` (`#0b0c0e`)  |
| Padding       | `chart.padding` (default 16px)        |
| Title         | Rendered above grid if non-empty      |
| Name display  | Matches active `nameDisplayMode`      |
| Control UI    | Not included in export                |

**True print-resolution export (post-MVP).** 300 DPI for large grids would exceed
canvas area limits on iOS and be very slow on mobile. The print path would need to
tile the canvas and stitch. Do not attempt as default.

---

## Scryfall API

Endpoints:
```
Search:     GET /cards/search?q={query}+lang:en+-is:digital+-t:token+-t:emblem
Printings:  GET /cards/search?q=oracleId:{id}+lang:en+-is:digital&unique=prints
Re-fetch:   GET /cards/{scryfallId}   (on 404 artCrop during export only)
```

All search requests:
- `AbortController`: cancel in-flight request when a new query fires
- Stale-response guard: discard results if query no longer matches current input
- 429: show "Too many requests — please wait." No auto-retry in MVP
- 300ms debounce
- Filter: skip any card/printing missing `art_crop` for **any** image-bearing face
  (check all entries in `card_faces`, not just face 0)

Printing switch: when a user selects a new printing from the modal, the card data for
that printing is already in the modal's result set — extract `imageUris` for all faces
from it directly. No second fetch needed.

---

## Planned Phases (post-MVP)

### Phase 9 — Persistence + Multiple Charts
Fully scoped. No planning gaps.
- `useCharts` hook: `charts[]` + `activeId` in localStorage under `mtg-chart:charts` /
  `mtg-chart:activeId`. CRUD: `createChart`, `deleteChart`, `updateChart`, `setActiveId`.
- `schemaVersion.ts` migration runner: `migrate(chart)` chain, `migrateAll(charts[])`.
  No-op at v1; infrastructure must exist for future bumps.
- Chart picker UI in `ControlPanel` above Search: list of chart names, active highlighted,
  `+` to create, `×` to delete (hidden if only one), inline name edit on active chart.
- `App.tsx`: replace `useState<Chart>` with `useCharts`; all mutation callbacks call
  `updateChart(modifiedChart)` instead of `setChart`.

### Phase 10 — Drag-to-move + Undo/Redo
Drag fully scoped. Undo needs one decision: history depth (suggest cap at 50 steps).
- **Drag-to-move**: `draggable` on filled cells, `onDrop` on any cell.
  `handleSlotSwap(from, to)` in `App.tsx`: move if target empty, swap if filled.
  CellMap semantics already correct — drag moves card data only, layout roles unchanged.
  ~30–40 lines, no animation required.
- **Undo/redo**: replace `useState<Chart>` (or `useCharts`) with `useReducer` + history
  stack. Keyboard shortcut Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z. Undo/Redo buttons in sidebar.

### Phase 11 — UI Polish
All additive, zero model changes. No planning needed.
- Card count / capacity indicator (e.g. "12 / 25 filled") in sidebar or canvas header.
- Keyboard navigation: arrow keys move focus between cells, Delete clears focused cell,
  Enter opens context menu.
- Cell numbering toggle: show slot index on each cell (additive UI control, no model
  change — `schemaVersion` bump not required).

### Phase 12 — Square Mode + Manual Crop Framing
Needs planning: crop UI design (drag-handle overlay vs. separate modal).
- `displayMode: 'square'` rendering: cells use `aspect-ratio: 1/1`.
- `cropX` / `cropY` / `cropScale` on `Slot` already defined; activate them.
  Export uses `large` image URI (already stored) for the transform draw call.
- Schema version bump + migration: add `{ cropX: 0.5, cropY: 0.5, cropScale: 1.0 }` to
  all existing slots (equivalent to current `object-fit: cover` behaviour).

### Phase 13 — Decklist Import
Minimal planning needed: partial-failure handling strategy.
- Parse MTGO format (`4x Lightning Bolt (M20)`); batch Scryfall lookups by set code +
  collector number. Rate-limit awareness (respect 429, queue with delay).
- UI: textarea in SearchPanel or a dedicated import modal.

### Phase 14 — Commander Mode + Hybrid Hero Layout
Needs planning: hero cell size presets and freeform config UI.
- `heroConfig?: Array<{ row: number; col: number; rowSpan: number; colSpan: number }>`
  added to `Chart`; schema version bump + migration (default: empty array = uniform).
- `generateCellMap` updated to produce `'hero'` + `'covered'` cells from `heroConfig`.
  Grid renderer already handles both kinds correctly — no changes needed there.
- **Commander preset**: UI toggle in sidebar sets one hero cell at `(0, 0)` with
  `rowSpan: 2, colSpan: 2` (or similar). Covers the partner mechanic — max 2 commanders,
  modelled as two adjacent hero cells e.g. `(0,0)` and `(0,2)` each `2×1`, or a single
  `2×2` hero for a solo commander.
- Freeform hero placement (click to promote a cell to hero, drag to resize) is post-
  commander scope — note it here for later.

### Phase 15 — Sort + Shuffle
Fully scoped. Pure slot reordering — no model change, no schema bump.
- **Sort**: reorder filled slots in row-major order by a chosen key, empty slots stay
  empty (append to end or preserve position — needs one UI decision).
  Sort keys: card type (creature → instant → sorcery → enchantment → artifact → land),
  CMC (numeric, low→high or high→low), colour (WUBRG order + multicolour + colourless).
  Requires storing `cmc`, `colors`, and `type_line` on `Slot` at add/switch time
  (currently not stored — schema version bump + migration required, default null).
- **Shuffle**: Fisher-Yates on filled slot indices, empties stay empty.
- UI: Sort dropdown + Shuffle button in a new "Arrange" section in `ControlPanel`.

### Phase 16 — Share Links
Fully scoped. Self-contained, no dependencies.
- Serialise `Chart` to base64 JSON → URL query param `?c=…`.
- Decode on load (takes precedence over localStorage if present).
- Copy link button in sidebar footer.

### Phase 17 — Custom Items
Minimal planning needed: upload UI placement (search panel tab vs. context menu).
- `slot.kind = 'custom'` + `localImageDataUrl` field on `Slot`.
- `kind` discriminator already in place — additive, no migration required.
- File input accepts JPEG/PNG; store as data URL in slot.

### Needs design before starting
- **Font selection** — what fonts to offer, how to bundle/load them, canvas rendering
  implications. `await document.fonts.ready` hook already in export flow.
- **True print-resolution export** — canvas tile-and-stitch for 300 DPI output.
  Significant architectural work; tiling strategy needs its own design session.
- **Supabase backend** — auth, schema, migration from localStorage. Post-everything-else.

---

## Phase 20 — Share-link Compaction

### Problem

The Phase 16 implementation (`encodeChart`) serialises the full `Chart` object as
`btoa(encodeURIComponent(JSON.stringify(chart)))`. A `ScryfallSlot` carries
`imageUris` (two long `cards.scryfall.io` URLs per face), `cardName`, `typeLine`,
`colors`, plus all crop fields. Nine cards already produces a URL several kilobytes
long; a 100-card deck exceeds practical share-link limits.

### Compact payload format (URL version 1)

Only identity and non-default state are encoded. `imageUris`, `cardName`,
`oracleId`, `setCode`, `collectorNumber`, `layout`, `cmc`, `colors`, `typeLine`,
and `artist` are all reconstructed from Scryfall on load.

```typescript
interface ShareSlotStub {
  id: string        // scryfallId (UUID)
  f?: 0 | 1        // selectedFaceIndex — omit when 0 (default)
  x?: number       // cropX   — omit when 0.5 (default)
  y?: number       // cropY   — omit when 0.5 (default)
  z?: number       // cropScale — omit when 1.0 (default)
}

interface SharePayload {
  v: 1                            // format version
  c: {                            // chart-level fields (no id, schemaVersion, slots)
    name: string
    gridRows: number
    gridCols: number
    layout: Layout
    heroConfig: HeroConfig
    displayMode: DisplayMode
    nameDisplayMode: NameDisplayMode
    title: string
    backgroundColor: string
    cellGap: number
    padding: number
    cornerRadius: number
  }
  s: Array<ShareSlotStub | null>  // visual-cell-indexed, same length as gridRows×gridCols
}
```

Custom (`kind: 'custom'`) slots cannot be reconstructed from Scryfall — they are
encoded as `null` (treated as empty on the receiving end). If any custom slots are
present when encoding, `encodeShareLink` returns them alongside the URL so the
caller can show a notice.

### Compression

`lz-string` (`compressToEncodedURIComponent` / `decompressFromEncodedURIComponent`)
is used as the sole production dependency. Rationale: MIT licence, zero further
dependencies, ~3 KB gzipped, specifically designed for URL-safe string compression
of JSON-like data.

Size estimate for a full 10×10 grid (100 scryfall slots, no crop):
- JSON payload ≈ 5 000–5 500 chars
- After lz-string compression ≈ 1 800–2 500 chars
- Final URL `?c=<compressed>` ≈ 1 850–2 550 chars — within all major platforms

### Backwards compatibility

Old links (Phase 16, base64+JSON full chart) must continue to work until
regenerated. Detection strategy in `decodeSharePayload`:

1. Try `decompressFromEncodedURIComponent(raw)` → parse JSON → check for `v` field.
2. If `v` is present and known → new-format path.
3. If `v` is unknown → "link created by a newer version" error (never crash).
4. If step 1 fails entirely (decompression error or no `v`) → fall through to legacy
   path: `decodeURIComponent(atob(raw))` → `isChartShaped` check → `migrateAll`.

### Async reconstruction flow

`loadOrInit` remains **synchronous** (required for `useState` initialiser). When it
detects a compact `?c=` payload it:
- Decodes chart-level fields, constructs a placeholder `Chart` with `slots: []`.
- Returns `{ charts: [placeholder], activeId, pendingReconstruction: ShareSlotStub[] }`.

A `useEffect` in `useCharts` fires once on mount when `pendingReconstruction` is
set. It:
1. Batches stubs into chunks of 75, POSTs each to
   `POST https://api.scryfall.com/cards/collection`
   with body `{ identifiers: [{ id }, ...] }`.
2. Matches response cards back to stubs by `id` (response order is not guaranteed).
3. Calls `normaliseCard` on each matched card to produce a `ScryfallSlot`, merging
   in the stub's `f`, `x`, `y`, `z` overrides.
4. Rebuilds the full `slots` array (in visual-cell order) and calls
   `updateChart(prev => ({ ...prev, slots }))`.
5. Clears the loading flag and sets any partial-failure warning.

`ChartsState` gains:
```typescript
pendingReconstruction?: ShareSlotStub[]
isReconstructing?: boolean
reconstructionError?: string   // fatal — Scryfall unreachable
reconstructionWarning?: string // partial — some IDs not found
```

### Error states

| Condition | Behaviour |
|---|---|
| Decompression / parse failure | Error banner: "Invalid or expired link." Default chart loaded. |
| Unknown `v` version | Error banner: "Link format not supported — ask sender to regenerate." |
| Scryfall unreachable | Error banner: "Could not load cards from Scryfall. Check your connection." Chart config is correct; slots remain empty. |
| Some IDs not found | Warning banner: "N card(s) from the shared link could not be found on Scryfall." |
| Custom slots omitted at encode time | Notice shown at copy time: "X custom image(s) were not included in the link." |

### Files touched

| File | Change |
|---|---|
| `src/utils/shareLink.ts` | Replace with compact encoder/decoder; legacy fallback in decoder |
| `src/hooks/useCharts.ts` | `loadOrInit` calls compact decoder; reconstruction `useEffect`; expose `isReconstructing` / error / warning |
| `src/App.tsx` | Pass loading/error state to Grid; show custom-slot notice at copy time |
| `src/components/Grid/index.tsx` | Reconstruction loading overlay / banner |
| `src/__tests__/shareLink.test.ts` | New: round-trip, legacy compat, partial failure, unknown version |

---

## Post-MVP Integration Points (reference)

1. **Hybrid hero layout / Commander mode** — see Phase 14 above.

2. **Drag-to-move / swap cells** — see Phase 10 above.

3. **Manual drag-to-frame + square mode** — see Phase 12 above.

4. **Decklist import** — see Phase 13 above.

5. **Sort + Shuffle** — see Phase 15 above.

6. **URL-encoded share links** — see Phase 16 above.

7. **Custom items** — see Phase 17 above.

7. **Supabase backend** — swap `useCharts` localStorage calls for API calls; schema is
   self-contained and portable.

8. **Font selection** — requires `@font-face` data URLs available before canvas draw;
   `await document.fonts.ready` hook already in export flow.

9. **Standalone numbering toggle** — see Phase 11 above.

10. **True print-resolution export** — canvas tile-and-stitch; significant new code.
