# Mana Chart — Architecture

*Rewritten July 2026 (handoff audit) to match the shipped code: schema v4, the
UI-interaction overhaul (Phases 0–4 of `docs/ui-overhaul-brief.md`), and the brand
rename. The source is canonical; where this document and the code disagree, the code
wins and the doc is the bug. Compatibility surfaces (storage keys, share-link codec,
schema) are specified in `docs/contracts.md`; decision rationale and rejected
alternatives in `docs/decisions.md`; known debt and platform quirks in
`docs/tech-debt.md` — check those before "fixing" anything that looks odd.*

## Overview

Single-page app: Vite + React + TypeScript, static deploy on Vercel. No backend.

- Persistent state (charts) lives in localStorage via `useCharts`; session state
  (undo/redo history, selection, the interaction machine, layout mode) never persists.
- Production ships a CSP (`vercel.json`) pinning `connect-src`/`img-src` to the two
  Scryfall hosts and `font-src 'self'` — the dev server has no CSP, so a new external
  origin works locally and silently breaks in prod. Any new origin must be added to
  `vercel.json` in the same PR.
- CI (`.github/workflows/ci.yml`) runs `build`/`lint`/`test` on every push/PR to `main`.
- The tree renders inside a top-level `ErrorBoundary` (recoverable fallback + reload).
- Runtime dependencies: react/react-dom, **one library ever** (`lz-string`, rationale in
  the Share-link section), and `@fontsource/*` packages — self-hosted font *assets*
  forced by the CSP's `font-src 'self'`, not runtime code.

---

## Folder Structure

```
src/
  components/
    BottomSheet/        # Non-modal phone surface for the selected card (drawer mode)
    ContextMenu/        # Right-click / Shift+F10 menu — accelerator only
    ControlPanel/       # Sidebar / off-canvas drawer: chart picker + all controls
    Dialog/             # Modal primitive (inert containment) + ConfirmDialog
    DragGhost/          # Portal ghost that follows an active pointer drag
    ErrorBoundary/      # Top-level render-error fallback
    Grid/               # Grid renderer: cells, keyboard map, pointer-drag wiring
    ImportModal/        # Decklist import UI (Dialog consumer)
    NameDisplay/        # Sidebar and overlay name renderers
    PrintingSwitcher/   # Alternate-printing picker (Dialog consumer)
    SearchPanel/        # Scryfall search + custom-image upload; pointer-drag source
    SelectedCard/       # Canonical action surface for the selection + crop editor
    Stepper/            # Numeric stepper control
  hooks/
    useCharts.ts        # Persisted multi-chart store + share-link reconstruction
    useExport.ts        # Export pipeline: geometry, prefetch, canvas draw, disposals
    useImport.ts        # Decklist import machine (overflow/expand/cap/retry)
    useLayoutMode.ts    # docked|drawer shell mode; THE breakpoint constant (900)
    useScryfall.ts      # Debounced search, AbortController, stale-response guard
  interaction/
    moveApi.ts          # MoveApi / SearchDragApi — the surface App exposes to drivers
    moveMachine.ts      # Pure reducer: idle / pressed / dragging / moveArmed
    usePointerDrag.ts   # Pointer engine: slop, long-press, capture, scroll suppression
  types/
    chart.ts            # Chart, Slot union, CellDef/CellMap
  utils/
    cellMap.ts          # CellMap generation (uniform + hero/covered)
    chart.ts            # getSlot, resolveSlotFillTarget
    chartShape.ts       # Structural validation of stored charts / legacy links
    decklistParser.ts   # MTGO/Arena/Moxfield-style list parsing
    defaultChart.ts     # createDefaultChart
    dom.ts              # isEditableEventTarget (undo/redo guard)
    duplicateChart.ts   # Deep clone via structuredClone
    exportGeometry.ts   # Pure export sizing/budget/crop math (heavily unit-tested)
    gridNav.ts          # Pure keyboard navigation over a CellMap
    history.ts          # pushPast cap + edit-burst coalescing decision
    imageBlob.ts        # fetch-as-blob + image decode helpers
    importLayout.ts     # Empty/expansion slot-index math (cellMap-aware)
    reconstruct.ts      # /cards/collection batching with 429 backoff
    sanitizeChart.ts    # Clamp dims, hero config, background; capacity cap
    schemaVersion.ts    # CURRENT_SCHEMA_VERSION + v1→v4 migration chain
    scryfall.ts         # URL builders, normalisation, printings pagination
    shareLink.ts        # Compact codec (v1) + legacy decoder + reconstructSlots
    shareSupport.ts     # Clipboard / Web-Share feature detection (pure)
    sort.ts             # sortSlots / shuffleSlots
  __tests__/            # 369 tests, 36 files (July 2026); hand-rolled harness (harness.tsx),
                        # no testing-library. Node env by default; DOM tests opt in
                        # via `// @vitest-environment jsdom` per file.
```

---

## Data Model (schemaVersion: 4)

Live types in `src/types/chart.ts` — summarised here, source canonical.

```typescript
interface Chart {
  id: string                          // uuid
  name: string
  schemaVersion: number               // currently 4
  gridRows: number                    // clamped 1–10
  gridCols: number                    // clamped 1–10
  layout: 'uniform' | 'hybrid'
  heroConfig: HeroConfig              // [] = uniform; commander/partner presets fill it
  displayMode: 'landscape' | 'square'
  nameDisplayMode: 'none' | 'sidebar' | 'overlay'
  title: string
  titleFont?: string                  // optional ⇒ no schema bump; allowlisted
                                      // (ALLOWED_TITLE_FONTS in shareLink.ts)
  backgroundColor: string
  cellGap: number                     // px
  padding: number                     // px
  cornerRadius: number                // px
  slots: Array<Slot | null>           // visual-cell-indexed, row-major, sparse
}

type HeroConfig = Array<{ row: number; col: number; rowSpan: number; colSpan: number }>

type Slot = ScryfallSlot | CustomSlot  // discriminated on `kind`

interface ScryfallSlot {
  kind: 'scryfall'
  scryfallId: string                  // stable identity for re-fetch
  oracleId: string
  cardName: string
  setCode: string
  collectorNumber: string
  layout: string                      // Scryfall layout (transform, modal_dfc, …)
  selectedFaceIndex: 0 | 1
  imageUris: Array<{                  // indexed by face; length 1 for single-face
    artCrop: string                   // the rendered AND exported image
    normal?: string                   // absent on some printings; stored, never rendered
    artist?: string                   // drives the artist strip
  }>
  cropX: number                       // 0–1, default 0.5 ─┐ framing / square mode;
  cropY: number                       // 0–1, default 0.5  ├ on every slot — do not
  cropScale: number                   // 1.0 = fit, >1 zoom ─┘ remove
  cmc: number | null                  // ─┐ sort keys, captured at add/switch time so
  colors: string[] | null             //  ├ sort works offline; null on pre-v4 slots
  typeLine: string | null             // ─┘
}

interface CustomSlot {
  kind: 'custom'
  label: string
  localImageDataUrl: string           // user upload stored as a data URL
  cropX: number; cropY: number; cropScale: number
}
```

`slots` rules (unchanged since MVP): default is `[]`; out-of-bounds reads return
`undefined`, not `null`; **always read through `getSlot(chart, slotIndex)`**
(`src/utils/chart.ts`), never by direct array access. `imageUris` is a refreshable
cache, not identity — on a 404 during export the card is re-fetched by `scryfallId`
and the cache updated in place (not history-tracked).

### Schema migrations (`src/utils/schemaVersion.ts`)

| Step | Added |
|---|---|
| v1 → v2 | `cropX`/`cropY`/`cropScale` on every slot (defaults 0.5/0.5/1.0) |
| v2 → v3 | `heroConfig` on Chart (default `[]`) |
| v3 → v4 | `cmc`/`colors`/`typeLine` on ScryfallSlot (default `null`) |

Policy: bump the version and add a chain step only for **non-optional** persisted
fields; optional fields (`titleFont`) need no bump. `migrateAll` runs on load before
render; a chart with an *unknown future* version is loaded as-is with a console
warning. After migration, every loaded chart also passes `sanitizeChartConfig` (see
Hardening below).

### Cell rendering

Cells render `<img>` (class `.cardImg`) with `object-fit: cover` — **not** CSS
`background-image` — so crop transforms apply to the element: `objectPosition` from
`cropX`/`cropY`, plus `transform: scale(cropScale)` with matching `transformOrigin`
when zoomed. Every Scryfall-art `<img>` in the app (grid, crop preview, search
results, printing thumbnails) carries `crossOrigin="anonymous"` — see "CORS handling"
under Export for why this is load-bearing.

---

## Grid: CellMap Abstraction

The central seam between uniform and hybrid layouts.

```typescript
type CellDef =
  | { kind: 'slot';    slotIndex: number }
  | { kind: 'hero';    slotIndex: number; rowSpan: number; colSpan: number }
  | { kind: 'covered'; heroSlotIndex: number }   // occupied by an adjacent hero;
                                                 // back-pointer lets keyboard nav and
                                                 // drop targeting resolve covered→hero

type CellMap = CellDef[]                         // length = rows × cols, row-major
```

`generateCellMap(rows, cols, heroConfig)` produces it; the grid renderer consumes it
and never computes slot positions itself. The CellMap is derived at render (memoized
on `[gridRows, gridCols, heroConfig]`), **never persisted** — the back-pointer has no
schema impact. Overlapping/duplicate hero configs keep last-wins/covered-beats-hero
semantics (commented in `cellMap.ts`) so crafted or legacy charts render identically.

**Hero-ness belongs to board positions, not slot contents.** Moving a card out of a
hero cell moves the card's Slot data; the hero position stays hero and becomes empty.
Move operations touch card data only — layout roles never change.

Derived semantics (all consumers follow these):
- Valid drop targets: `kind !== 'covered'`; a hit on a covered position resolves to
  its hero (covered cells render no DOM node, so pointer hit-testing gets this free).
- "Next empty slot": first `slotIndex` where the slot is `null` and `kind !== 'covered'`.
- Capacity: `cellMap.filter(c => c.kind !== 'covered').length` (`chartCapacity`).
- Numbering follows `slotIndex` order, skipping covered cells.

### Grid resize semantics

Grow is unconditional (within 1–10). **Shrink recompacts**: all cards are collected
in visual order and re-laid into the smaller grid's dense slot array
(`App.handleGridResize` — deliberate UX, adjudicated in
`docs/phase-22.5-findings.md` bucket D; an earlier version of this document described
a position-based *block* instead, which is obsolete). Shrink is prevented when it
would drop cards or orphan a hero — but note the occupancy half of that guard
currently lives in the ControlPanel stepper `disabled` predicates, not in the
mutation handler itself (`docs/tech-debt.md` C1).

Layout presets: `uniform` (no heroes), `commander` (one 2×2 hero at 0,0), `partner`
(two 2×1 heroes). Switching layout mode clears placed cards behind a ConfirmDialog.

---

## Interaction Layer (overhaul Phases 2–3)

Full spec: `docs/ui-overhaul-brief.md` §3. The short version:

- **Selection-first grammar.** Any input (click, tap, arrow) selects a cell; the
  selection exposes actions on a canonical surface (`SelectedCard` — sidebar section
  when docked, `BottomSheet` in drawer mode); move and crop are operations on the
  selection. Hover reveals, the context menu, and drag are accelerators, never the
  only path. (Invariant + its one known exception: see CLAUDE.md "Interaction".)
- **Pure move machine** (`interaction/moveMachine.ts`): `idle / pressed / dragging /
  moveArmed`, a side-effect-free reducer owned by App. Keyboard grab, tap-to-move,
  and pointer drag share the `moveArmed`/`dragging` states; every commit fires the
  same typed domain callbacks a click fires, so one move = one undo entry.
- **Pointer engine** (`interaction/usePointerDrag.ts`), shared by cell drag and
  search-result drag: Pointer Events only (all HTML5 DnD was deleted). Mouse/pen arm
  on ~4px slop; touch arms on a ~400ms still-finger long-press — if the finger moves
  past slop first, the browser keeps the gesture (scroll wins, `pointercancel`
  resets). While a touch drag is live, a document-level **non-passive** `touchmove`
  listener suppresses scrolling; it is attached at arm and removed on every terminal
  path. Capture is taken at arm (throw-safe), released on every exit.
- **Drop targeting** by `document.elementFromPoint(x, y).closest('[data-slot-index]')`
  at the *release* coordinates; a portal `DragGhost` tracks the pointer via direct
  transform writes (no React render per move).
- **Keyboard**: grid is one tab stop (roving tabindex; the selected cell is the
  stop). `gridNav.moveFocus` is pure CellMap math (arrows/Home/End, covered→hero,
  edges don't wrap). Enter selects; Space grabs a filled cell / selects an empty one;
  arrows retarget an armed move; Enter/Space commits; Escape cancels; Delete clears;
  Shift+F10 / menu key opens the context menu anchored to the cell.

## Responsive Shell (overhaul Phase 4)

- `useLayoutMode()` returns `docked | drawer` from one `matchMedia` listener;
  `LAYOUT_BREAKPOINT_PX = 900` in `useLayoutMode.ts` is the **only** place the
  breakpoint exists. App stamps `data-layout` on the root; all mode-dependent CSS
  selects on `[data-layout=…]`. `layoutContract.test.ts` enforces this at source
  level: no width media queries in stylesheets, no viewport units / `clamp()` in grid
  sizing (container-driven `min(100%, 900px)`).
- Drawer semantics: closed drawer is `inert` + `visibility: hidden` (out of the tab
  order and the AT tree); Escape closes (yielding to any open dialog); focus moves
  into the panel on open and back to the toggle on close; backdrop click closes.
- Safe areas: `viewport-fit=cover` + `env(safe-area-inset-*)` on fixed chrome.
- Drawer-mode IA (owner decision §7.1b): the drawer keeps chart-level settings +
  search; the Selected-card surface appears in a **non-modal** `BottomSheet` so the
  grid stays visible and interactive behind it.

## Overlays

One modal primitive, `components/Dialog/`: portal to a shared `#dialog-root`,
backdrop (mousedown, not click, so text-selection drags don't dismiss), `role=dialog`
+ `aria-modal` + label, **`inert` on the app root** while open (with an open-counter
for stacking), Escape, initial focus (explicit ref → first focusable → panel), focus
restore with a disabled/detached-opener fallback, and a Tab-cycle belt-and-braces.
Consumers: `ImportModal`, `PrintingSwitcher`, and `ConfirmDialog` — which fronts
every destructive action (chart delete §7.3a, clear cards, layout change) via a
`PendingConfirm` discriminated union in App; `window.confirm` is gone. `ContextMenu`
is a lighter `role=menu` primitive (portal + dismissal + arrow-key items + focus
restore on keyboard open) and offers nothing that isn't also on the selection
surface.

---

## Hardening & Sanitization

Everything that enters chart state from outside the app's own handlers is validated:

- `chartShape.isChartShaped` — structural check for stored charts and legacy links
  (slot shape, non-empty `imageUris` with string `artCrop`s, `selectedFaceIndex` in
  range).
- `shareLink.isSharePayloadShaped` — compact-payload check (integer dims ≥ 1, enum
  fields, stub `f ∈ {0,1}`, `titleFont` against the allowlist).
- `sanitizeChart.sanitizeChartConfig` — applied to every loaded/decoded chart: clamps
  grid dims to 1–10, drops hero items with non-integer/out-of-bounds geometry (a
  crafted `1e9` span would otherwise explode `generateCellMap`), accepts only
  hex/rgb() backgrounds (rejects `url(...)` — a crafted link must not fire network
  requests), and caps `slots`/stub arrays to grid capacity.
- `reconstructSlots` clamps a stub's face index into the reconstructed card's actual
  face count (a tampered `f:1` on a single-face card must not crash render/export).

---

## CORS & Export Strategy

**Choice: client-side blob fetch + canvas 2D API rendering. Pure static deploy.**

Scryfall's image CDN (`cards.scryfall.io`) currently responds with
`Access-Control-Allow-Origin: *`. This is operational behaviour, not a contractual
guarantee. Risk: if Scryfall tightens CORS, a single Vercel serverless proxy function
is the fix — no rewrite required.

### Export flow (`useExport.ts`)

The pipeline renders a PNG blob; **disposal** (download / clipboard / share) is
layered on top so all three output modes share identical sizing, budget, and
degradation behaviour (see "Disposals" below).

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
//   else → null (hard error)

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
  iOS/iPadOS is detected by UA plus `MacIntel` + `maxTouchPoints` sniffing (see
  `docs/tech-debt.md` F4).
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
Custom slots load their data URL directly (guarded — a corrupt data URL fails only
  that cell, not the export).
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
`crossOrigin="anonymous"` — the grid, the crop preview (`SelectedCard`), the search
results (`SearchPanel`), and the printing thumbnails (`PrintingSwitcher`). This is
because the browser HTTP cache is keyed by CORS mode: a no-cors `<img>` load caches
an *opaque* response the export's `fetch(mode:'cors')` cannot reuse, forcing a fresh
request that can fail on a cold-cache origin. Loading every path anonymously means
all art shares one CORS-usable cache entry and no path can poison it. Safe because
`cards.scryfall.io` serves `Access-Control-Allow-Origin: *`; data-URL custom slots
are unaffected. (Not test-enforced — `docs/tech-debt.md` F5.)

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

// If chart.titleFont is set, additionally await document.fonts.load(...) for it:
// fonts.ready is NOT sufficient when no DOM element has rendered the face yet —
// canvas resolves fonts independently. A font-load failure falls back to the body
// font rather than aborting the export.

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

**Step 6 — Disposal.** `canvas.toBlob('image/png')` (a null blob is the "try 1× or a
smaller grid" error), then one of three thin wrappers over the shared pipeline:

- **Download** (`triggerExport`, the default): anchor + click; the object-URL revoke
  is deferred ~1s because Safari intermittently aborts a download whose URL is
  revoked synchronously after `a.click()`. Filename: `${title || name || 'manachart'}.png`.
- **Copy image** (`copyExport`): Safari requires the *promise-form* `ClipboardItem`
  constructed **synchronously inside the user gesture**, so the wrapper is not
  async — it hands the pending blob promise straight to `ClipboardItem`. Synchronous
  throws are converted to rejections; the orphaned blob promise gets a no-op catch.
- **Share image** (`shareExport`, mobile): `navigator.share` needs the real `File`,
  so it renders first; a slow render can outlive the tap's transient activation and
  reject (`NotAllowedError`) — that falls back to a plain download. Only a genuine
  user dismissal (`AbortError`) is swallowed.

The Copy/Share buttons render only where `shareSupport.ts` feature-detection passes
(pure functions over injected env objects, unit-testable in jsdom).

### Export image source: `artCrop`

`artCrop` is the only Scryfall image that shows the correct landscape art-box crop.
`normal` and `large` are full portrait cards — cover-crop math on them would crop to
the vertical midpoint of the card (the text box area), not the art.

Known limitation: `artCrop` is lower resolution than `normal`/`large`. Large cells on
small grids (e.g. 2×2) will show interpolation. This is the accepted tradeoff.
`normal` is stored in `imageUris` so a future manual-framing path has it available
without a schema change.

### Export defaults

| Setting       | Default                               |
|---------------|---------------------------------------|
| Scale         | 2× (1× offered if over pixel budget)  |
| Image source  | `artCrop` for all tiles               |
| Background    | `chart.backgroundColor` (`#0b0c0e`)  |
| Padding       | `chart.padding` (default 16px)        |
| Title         | Rendered above grid if non-empty, in `titleFont` when set |
| Name display  | Matches active `nameDisplayMode`      |
| Control UI    | Not included in export                |

---

## Scryfall API

Endpoints in use (`src/utils/scryfall.ts`, `src/utils/reconstruct.ts`):
```
Search:       GET  /cards/search?q={query}+lang:en+-is:digital+-t:token+-t:emblem
Printings:    GET  /cards/search?q=oracleId:{id}+lang:en+-is:digital&unique=prints
              (paginated via has_more/next_page — fetchAllPrintings, 5-page cap,
               100ms inter-page delay; a hit cap surfaces `truncated` to the UI;
               429 throws PrintingsRateLimitError for a specific message)
Import:       GET  /cards/{set}/{collectorNumber}          (set + number lines)
              GET  /cards/named?exact={name}&set={set}     (name + set)
              GET  /cards/named?fuzzy={name}               (bare name)
Re-fetch:     GET  /cards/{scryfallId}                     (404 artCrop during export)
Reconstruct:  POST /cards/collection                       (share links; 75-id chunks)
```

All search requests:
- `AbortController`: cancel in-flight request when a new query fires
- Stale-response guard: discard results if query no longer matches current input
- 429: show "Too many requests — please wait." No auto-retry for interactive search
- 300ms debounce
- Filter: skip any card/printing missing `art_crop` for **any** image-bearing face —
  and reject multi-face cards whose face/image indexing would misalign; adventure/
  split cards (faces without per-face `image_uris`) fall through to the root image.
  Sort fields (`cmc`, `colors`, `typeLine`) are captured at normalise time.

Import lookups verify the returned card's name against the requested name (diacritic-
insensitive, accepts full `A // B` names or any single face) so a set+number typo
fails visibly instead of importing the wrong card. Import fetches are sequential with
a 100ms gap and one 1.5s retry on 429; rate-limited failures are retryable from the
done screen. Printing switch: selecting a printing extracts `imageUris` for all faces
from the already-fetched result set — no second fetch.

---

## Build-Phase Plans (historical)

> **Historical record.** Everything below is the *plan as originally written*.
> Phases 9, 10, 12–17 shipped (some mechanisms differ — noted per phase); Phase 11
> landed differently or not at all. Where this section conflicts with the sections
> above or the code, those win. Kept because the reasoning is still useful context.

### Phase 9 — Persistence + Multiple Charts — **shipped**
As planned, with one drift: `updateChart` takes an updater `(prev: Chart) => Chart`,
not a modified-chart object.
- `useCharts` hook: `charts[]` + `activeId` in localStorage under `mtg-chart:charts` /
  `mtg-chart:activeId`. CRUD: `createChart`, `deleteChart`, `updateChart`, `setActiveId`.
- `schemaVersion.ts` migration runner: `migrate(chart)` chain, `migrateAll(charts[])`.
- Chart picker UI in `ControlPanel` above Search: list of chart names, active highlighted,
  `+` to create, `×` to delete (hidden if only one), inline name edit on active chart.

### Phase 10 — Drag-to-move + Undo/Redo — **shipped, then superseded**
Drag shipped as HTML5 DnD and was later **replaced wholesale by the Pointer Events
spine** (overhaul Phase 3, see Interaction Layer). Undo/redo shipped **in `App.tsx`
wrapping `updateChart`** — not as a reducer inside `useCharts` as planned — with a
50-entry cap, session-only, per-chart, plus edit-burst coalescing and crop-drag
single-snapshot semantics the plan didn't anticipate.

### Phase 11 — UI Polish — **not shipped as written**
- Card count / capacity indicator: never built.
- Keyboard navigation: arrived via overhaul Phase 2 with different semantics
  (roving tabindex, Shift+F10/menu key for the context menu — not Enter).
- Cell numbering toggle: never built.

### Phase 12 — Square Mode + Manual Crop Framing — **shipped**
One drift: the plan said square-mode export would use the `normal` image URI;
in reality **export always uses `artCrop`** for every mode (see Export section).

### Phase 13 — Decklist Import — **shipped**
As a dedicated modal with an overflow/expand/cap machine, per-card name verification,
and rate-limited retry (see `useImport.ts`) — richer than the sketch below.
- Parse MTGO format (`4x Lightning Bolt (M20)`); batch Scryfall lookups by set code +
  collector number. Rate-limit awareness (respect 429, queue with delay).

### Phase 14 — Commander Mode + Hybrid Hero Layout — **shipped**
`heroConfig` on `Chart` (v3 migration), commander (2×2) and partner (two 2×1)
presets, `generateCellMap` producing `hero`/`covered`. Freeform hero placement
remains future work (see roadmap).

### Phase 15 — Sort + Shuffle — **shipped**
Sort keys: type (creature → instant → sorcery → enchantment → artifact →
planeswalker → land), CMC asc/desc, colour (WUBRG → multi → colourless); custom
slots sort last; filled slots compact to the front. Sort fields stored on
`ScryfallSlot` (v4 migration). Fisher-Yates shuffle.

### Phase 16 — Share Links — **shipped, then superseded by Phase 20**
The Phase 16 base64-JSON format survives only as the legacy decode path.

### Phase 17 — Custom Items — **shipped**
`kind: 'custom'` slots with `label` + `localImageDataUrl` (JPEG/PNG upload in
SearchPanel), crop fields included.

### Formerly "needs design" — resolved
- **Font selection** — shipped: five self-hosted `@fontsource` families (CSP forces
  self-hosting), `ALLOWED_TITLE_FONTS` allowlist shared by the picker and the share
  codec, explicit `document.fonts.load` before canvas title draw.
- **True print-resolution export** — **dropped** (`docs/roadmap.md`:
  do not build).
- **Supabase backend** — **dropped** (same roadmap: localStorage + share links cover
  save/share; out of scope indefinitely).

---

## Phase 20 — Share-link Compaction

### Problem

The Phase 16 implementation (`encodeChart`) serialised the full `Chart` object as
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
    titleFont?: string            // only when set AND in ALLOWED_TITLE_FONTS
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

Decoded payloads are **validated and sanitized** before reaching state:
`isSharePayloadShaped` (structure/enums/face-index/allowlisted font), then
`sanitizeChartConfig` (dims clamped 1–10, bad hero items dropped, safe background,
stub array capped to grid capacity), and `reconstructSlots` clamps each stub's face
index into the actual reconstructed card. See Hardening above.

### Compression

`lz-string` (`compressToEncodedURIComponent` / `decompressFromEncodedURIComponent`)
is the **one runtime library ever added**. Rationale: MIT licence, zero further
dependencies, ~3 KB gzipped, specifically designed for URL-safe string compression
of JSON-like data. (The `@fontsource/*` packages are self-hosted font assets forced
by the CSP's `font-src 'self'`, not runtime code.)

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
- Decodes chart-level fields, constructs a sanitized placeholder `Chart` with
  `slots: []`, appended to the user's existing charts.
- Returns `{ charts, activeId, pendingReconstruction, isReconstructing: true,
  unreconstructedPlaceholderId }`.

A `useEffect` in `useCharts` fires once on mount when `pendingReconstruction` is
set. It:
1. Batches stubs into chunks of 75, POSTs each to
   `POST https://api.scryfall.com/cards/collection`
   with body `{ identifiers: [{ id }, ...] }` — 100ms between chunks, and 429s are
   retried up to 3 times honouring `Retry-After` (default 1.5s backoff) before
   surfacing a retryable error.
2. Matches response cards back to stubs by `id` (response order is not guaranteed).
3. Calls `normaliseCard` on each matched card to produce a `ScryfallSlot`, merging
   in the stub's `f`, `x`, `y`, `z` overrides (face index clamped).
4. Rebuilds the full `slots` array (in visual-cell order) and fills the placeholder.
5. Clears the loading flag and sets any partial-failure warning.

Failure handling is retry-first: on a transient failure the placeholder chart is
**kept** (empty grid), the stubs are retained, and `?c=` stays in the URL — so both
the in-app **Retry** button and a plain reload re-attempt the load. While
un-reconstructed, the placeholder is **excluded from persistence**
(`unreconstructedPlaceholderId`) so reloads re-derive exactly one placeholder
instead of accumulating duplicates; the exclusion lifts when reconstruction
succeeds, or when the user claims the chart by editing it. `?c=` is stripped only
on success/claim (legacy links strip immediately — they never reconstruct).

`ChartsState` carries: `consumedShareParam`, `pendingReconstruction`,
`isReconstructing`, `reconstructionError`, `reconstructionWarning`,
`unreconstructedPlaceholderId`, plus `storageError` from the persistence layer.

### Error states

| Condition | Behaviour |
|---|---|
| Decompression / parse / shape failure | Error banner: "Invalid or expired link." Stored charts (or default) loaded; URL left intact. |
| Unknown `v` version | Error banner: "Link format not supported — ask sender to regenerate." |
| Scryfall unreachable / rate-limited out | Error banner: "Couldn't load cards from the shared link — check your connection or Scryfall's status, then Retry." Placeholder kept, Retry offered, reload also works. |
| Some IDs not found / un-normalisable | Warning banner: "N card(s) from the shared link could not be found or loaded." |
| Custom slots omitted at encode time | Notice shown at copy time: "X custom image(s) not included in link." |

---

## Later / Dropped (reference)

Still future (see `docs/roadmap.md`):
1. **Freeform hero placement** — click to promote a cell to hero, drag to resize.
2. **Card languages** via Scryfall `lang:` (low priority).

Explicitly dropped — do not build:
3. **Supabase / backend / accounts / cloud sync** — localStorage + share links
   already cover save and share.
4. **True print-resolution (300 DPI) export** — not worth the tile-and-stitch
   complexity for this tool.
