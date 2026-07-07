# Mana Chart — Roadmap (Phase 18+)

> **Historical record — superseded July 2026.** Everything below is the plan as
> written before Phases 18–22.5, the UI overhaul (Phases 0–4), and the rename
> shipped. The living status doc is [docs/roadmap.md](docs/roadmap.md); do not
> act on this file. The "currently red" test suite note, the stopgap drawer, and
> the phase plans are all long resolved — see [docs/tech-debt.md](docs/tech-debt.md)
> and [docs/decisions.md](docs/decisions.md) for what is actually live.

This replaces the earlier enhancements handover. It reflects the current state of the repo (shipped through Phase 17, plus a partner-layout fix and a stopgap mobile drawer applied by patch) and sequences the remaining work.

## Working Agreement — Read This First

Do not start building yet.

First, for whichever phase we agree to start with, produce:
1. A short read of the current code paths the phase touches, confirming how they work today.
2. A checkpointed plan, each step small enough to review and commit independently.
3. For the two large/design-first phases (Share-link compaction, Tabbed UI overhaul), an `ARCHITECTURE.md` addendum before any code.

Then stop and wait for approval. Build one phase at a time; after each, summarise changes and decisions and wait for confirmation. Flag ambiguities rather than guessing.

### Constraints (still apply, from CLAUDE.md)
- `npm run build && npm run lint` must pass clean before every commit, and **the test suite must pass** (see Phase 18 — it is currently red on main).
- `tsconfig.app.json` has `noUnusedLocals` / `noUnusedParameters`: do not introduce a symbol until it has a real caller.
- All imports use the `@/` alias.
- Read slots only through `getSlot(chart, slotIndex)`.
- Bump `schemaVersion` and add a migration in `src/utils/schemaVersion.ts` only when adding a **non-optional** persisted field. Optional fields need no bump.
- No `Co-Authored-By` on commits.

---

## Current State

Shipped: Phases 1–17 (scaffold → grid → Scryfall search → remove/resize → style → context menu/printing/DFC face toggle → title/name display → PNG export → persistence/multi-chart → drag-move/undo-redo → square+crop → decklist import → commander/hero layout → sort+shuffle → share links → custom image slots).

Applied by patch (not yet a numbered phase, may already be committed): partner-layout aspect-ratio fix in `Grid/index.tsx`; stopgap mobile drawer (hamburger toggle + off-canvas `ControlPanel`, responsive grid width) across `App.tsx`, `App.css`, `ControlPanel`, `Grid`.

### Explicitly dropped — do not build
- **Supabase / backend / accounts / cloud sync.** localStorage + share links already cover save and share. Out of scope indefinitely.
- **True 300 DPI / print-resolution export.** Not worth the tile-and-stitch complexity for this tool.

### Later / needs design (not scheduled)
- Freeform hero placement (click a cell to promote to hero, drag to resize).
- Card languages via Scryfall `lang:` (low priority).

---

## Phase 18 — Stabilise + discoverability (small bundle)

Small, independent, high-value. Do first.

### 18a — Fix the red test suite
`src/__tests__/useCharts.test.ts` fails (4 tests) because `loadOrInit` reads `window.location.search` and the jsdom environment isn't set up for it. Get the gate green: stub/define `window.location` in the test setup (or guard the read). No production behaviour change.
**Done:** `npx vitest run` passes clean.

### 18b — Make decklist import discoverable
Import works but its trigger is an unlabelled `↑` icon next to the "Search" header. Give it a clear text label ("Import decklist") or an icon+label button. (Final home is the Import/Export tab in Phase 23; this is the interim fix.)
**Done:** a first-time user can find import without hovering for tooltips.

### 18c — Visible DFC face-flip control
Face toggle (`onFaceToggle`) currently lives only in the right-click menu ("Switch Face") and is undiscoverable. Add a visible flip button on the cell — alongside the existing × and ⇄ — shown **only** when the card is multi-face (`isMultiFaceLayout(layout) && imageUris.length > 1`). Reuse the existing `onFaceToggle` handler. No data-model change.
**Done:** double-faced cards show a flip affordance on hover; clicking flips front/back.

### 18d — Reset / clear control
No reset exists today; `deleteChart` removes the whole chart. Add a **"Clear cards"** action on the active chart that empties `slots` but keeps grid size, layout, and style settings. Require a confirm dialog. (Optional, lower priority: a separate "Delete all charts" full-wipe, also confirmed.)
**Done:** Clear cards empties the current chart after confirmation; undo restores it (route through `updateChartWithHistory`).

### 18e — Custom upload label notice
Custom image labels are auto-derived from the filename (minus extension) and are not editable — keep that for now. Add a short notice in the upload UI explaining the label comes from the filename.
**Done:** upload UI states how the label is derived; no editing added.

---

## Phase 19 — Scryfall attribution (required, small)

Compliance, not optional: because the app displays the cropped `art_crop` (which omits the artist and copyright line), Scryfall's image guidelines require the artist name and copyright to be visible somewhere in the same interface, and prohibit implying Scryfall endorsement.

- Capture `artist` on `ScryfallSlot` at add time and at printing-switch time (Scryfall card objects expose `artist`). Make it **optional** (`artist?: string`) so no schema bump / forced migration is needed; older saved slots simply lack it until re-added (acceptable, or backfill on load).
- Surface per-card artist somewhere accessible — a hover tooltip on the cell, or the selected-card info area.
- Add a small static disclaimer in the UI: card data and images via Scryfall; cards © Wizards of the Coast; not affiliated with or endorsed by Scryfall or Wizards. Do not use Scryfall's logo.
**Done:** artist is viewable per card; the Scryfall/WotC disclaimer is present; nothing implies endorsement.

---

## Phase 20 — Share-link compaction (medium-high, design-first)

**Problem.** `encodeChart` in `src/utils/shareLink.ts` does `btoa(encodeURIComponent(JSON.stringify(chart)))` on the **entire** chart, so every slot drags its full `imageUris` (long `cards.scryfall.io` URLs per face) plus card metadata. Nine cards already make a huge link; a 100-card deck would exceed practical URL limits.

**Goal.** Links that scale to 100+ cards.

**Approach (plan + ARCHITECTURE.md addendum first).**
- Encode only per-slot identity: `scryfallId` + `selectedFaceIndex` + crop values **only when non-default**. Plus chart-level fields (grid dims, layout/heroConfig, display/name modes, title, style). Drop `imageUris`, `cardName`, `setName`, etc. from the payload.
- On load, reconstruct slots by fetching card data by id via Scryfall's **collection batch endpoint** (`/cards/collection`, up to 75 ids per request → a 100-card deck is 2 requests), not N single fetches.
- Compress the payload (e.g. `lz-string` to a URL-safe string) and justify the choice; sanity-check length for a full grid.
- **This makes share-load asynchronous.** `loadOrInit` currently decodes synchronously; reconstruction now needs an async path with a loading state (and graceful failure if Scryfall is unreachable or an id is gone). Keep chart-level migration (`migrateAll`) for the options; slots come from reconstruction.
- Version the URL format independently; unknown/old/malformed payloads show a clear message, never crash.
- Custom (local-image) slots can't be reconstructed from Scryfall — decide behaviour (omit from shared links with a notice, or skip). Document it.
**Done:** a 100-card chart produces a usably short link; opening it in a clean browser reconstructs the chart via batched fetches with a loading state; bad payloads fail gracefully; `ARCHITECTURE.md` documents the format.

---

## Phase 21 — Fill interactions (medium)

Today clicking a search result fills the **first empty** cell (`handleSlotFill` ignores selection), empty cells can't be selected (`onCellSelect` passes `null` for empties), and search results aren't draggable. Build **both** interaction paths.

- **Empty-cell selection + highlight.** Let empty cells be selected and highlighted with the same treatment as occupied cells (`.cellSelected`). Update the cell `onClick` so empties set `selectedSlotIndex` to their index instead of `null`.
- **Select-then-fill.** When a cell is selected, route `handleSlotFill` to that index; only fall back to first-empty when nothing is selected. (Reuses existing `selectedSlotIndex` state.)
- **Drag-result-to-cell.** Make `SearchPanel` results draggable; carry the card identity in `dataTransfer`. In the grid cell `onDrop`, branch: search-origin payload → add to the target slot (reuse the add path); else existing `dragFromRef` grid-to-grid move. Preserve the existing `dragOver` highlight.
**Done:** selecting an empty cell highlights it and the next picked result lands there; dragging a result onto any cell places it; grid reordering still works.

---

## Phase 22 — Fonts (medium) — BLOCKED on font selection

Add a font picker for the chart title (and optionally name display). Use **only SIL OFL fonts**, self-hosted or via Google Fonts, so they're legal to bundle and render in the canvas export (the export already awaits `document.fonts.ready`). Do **not** reference system-only fonts (e.g. Comic Sans) — they won't render in export on machines that lack them; use OFL equivalents (e.g. Comic Neue).

Candidate set (Jakeb to finalise ~4–6): Cinzel (epic title), EB Garamond / Cormorant (serif body), Uncial Antiqua / MedievalSharp (medieval flavour), Inter / Work Sans (clean sans), Comic Neue (casual).

- Add a `titleFont` (and optionally `nameFont`) field to the chart model — optional, defaulting to current font, so no schema bump.
- Load chosen fonts (bundle or Google Fonts link); ensure they're loaded before export draws (extend the existing `fonts.ready` handling to cover the selected font).
- Add the picker to the control panel (final home: Options tab, Phase 23).
**Done:** title font is selectable from the OFL set; selection renders identically on screen and in the exported PNG. **Blocked until the font list is confirmed.**

---

## Phase 22.5 — Pre-overhaul hardening (logic only, no UI redesign)

A dedicated stabilisation phase between Phase 22 and the Phase 23 overhaul, from a two-reviewer audit (`docs/phase-22.5-findings.md`). Closes a cluster of crash, data-loss, and correctness issues independent of the UI surface. Accessibility (A4 grid keyboard, A5 modal focus / `<progress>` label) is deliberately folded into Phase 23; B10/B11 deferred past the overhaul. Each checkpoint pairs its fix with a test and commits with the suite green; no `schemaVersion` bump (no fix adds a non-optional persisted field).

- **CP1 Persistence safety + error boundary** (A1/B2/B12): wrap `persist` in try/catch (storage-full notice, no retry loop), top-level error boundary, debounced writes (trailing edge persists the final crop), guarded custom-image export.
- **CP2 Share-load resilience** (B1/B5): strip `?c=` only after reconstruction succeeds (legacy links strip on synchronous decode); on failure keep a named placeholder + Retry and leave `?c=` intact; the failed placeholder is excluded from persistence so reload yields exactly one; 429 treated as retryable with an inter-chunk delay.
- **CP3 Decode hardening** (A2/B7/B8): clamp grid dims to 1–10 (robust to non-finite/decimal), validate & sanitize `heroConfig` items, cap slot/stub arrays to grid capacity, validate background colour, clamp/guard face indices — on every decode path.
- **CP4 Hybrid import indexing** (B9): derive expansion slot indices from the cellMap, not `rows×cols`, so commander/partner imports don't misplace or drop cards.
- **CP5 Undo correctness** (B3/B4): ignore undo/redo keys inside text fields; coalesce title/colour edit bursts into one snapshot, pushed on the first actual change (no phantom undo entries).
- **CP6 Printing pagination** (A3): follow `has_more`/`next_page` in the printing switcher; if a page cap is hit while more remain, surface a truncation notice rather than silently dropping printings.
- **CP7 Decklist parser** (B6): bare name = quantity 1; accept `3`/`3x`/`3X`; `100 Forest` is a card name at quantity 1 (intentional for a collage tool); surface a "couldn't read N lines" count instead of silently dropping junk.

**Done:** all seven checkpoints landed with build, lint, and tests green; A4/A5 carried into Phase 23.

---

## Phase 23 — Tabbed UI overhaul + full responsive (large, design-first)

Replaces the current single long sidebar (and the stopgap mobile drawer) with a tabbed control surface and a proper responsive layout.

**Tabs (Jakeb's proposed structure):**
- **Add items** — search + custom upload.
- **Options** — grid size, layout (uniform/commander/partner), display/name modes, style (gap/padding/radius/bg), font picker (Phase 22).
- **Import / Export (decklist)** — decklist import (now clearly labelled) and any decklist export.
- **Chart export** — PNG export + scale.
- Plus a small **About / Credits** area for the Scryfall/WotC attribution (Phase 19).

**Responsive:** replace the stopgap drawer with a designed mobile layout — tabs collapse to a bottom bar or full-width drawer, controls are touch-sized, the grid uses the full width. Remove the interim hamburger/`.menuToggle`/`.backdrop` and `panelOpen` drawer CSS once the real layout supersedes them.

**Absorbs:** final homes for the import button (18b), face-flip stays on the cell, credits (Phase 19), font picker (Phase 22), and the fill interactions (Phase 21) on the grid surface.

This is design-first: produce an `ARCHITECTURE.md` addendum for the tab structure and responsive breakpoints, and a wireframe-level plan, before any code.
**Done:** controls are organised into the four tabs + credits; the app is fully usable on a phone without the stopgap drawer; desktop parity maintained.

---

## Suggested order

18 (stabilise + quick wins) → 19 (attribution) → 20 (share links) → 21 (fill interactions) → 22 (fonts, once chosen) → 23 (UI overhaul).

Independent enough to reorder, with two soft rules: keep the test suite green from Phase 18 onward, and treat the UI overhaul (23) as last since it absorbs several earlier pieces.
