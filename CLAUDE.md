# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## New to this repo? Read in this order

`contracts.md` is absolute; `decisions.md` is evidence-gated — its Rejected entries are priced alternatives that can be revisited with evidence, not tombstones.

1. `docs/contracts.md` — must-read before touching persistence, share links, or the schema: the surfaces that break user data or saved links if changed.
2. `docs/decisions.md` — check here before "fixing" anything that looks wrong: deliberate keeps and rejected alternatives, cited by §number across the docs.
3. `ARCHITECTURE.md` — how the shipped code actually works; where it and the code disagree, the code wins.
4. `docs/tech-debt.md` — the known-debt and platform-quirk register (a register, not a work queue).
5. `docs/roadmap.md` — shipped / pending device validation / scoped-but-unbuilt / dropped-do-not-build.
6. `docs/ui-overhaul-brief.md` — design rationale for the interaction layer; the §-references the other docs cite.

## Looks wrong, isn't — check `docs/decisions.md` first

- localStorage keys still say `mtg-chart:*` — user-data keys; renaming them orphans every saved chart (§1)
- No runtime deps beyond react + lz-string — hand-rolled on purpose; a new dep needs owner sign-off (§2)
- `public/og-image.png` shows the old branding — the repo's one tracked TODO; the meta tags are already correct (§3)
- Grid shrink recompacts cards instead of blocking — adjudicated behaviour, not a bug (§5)
- Per-cell overlay buttons (×, ⇄, ↺) are `aria-hidden` + `tabIndex={-1}` — pointer accelerators, not an a11y bug; do not "fix" them into the tab order (§6)
- BottomSheet has no focus trap, backdrop, or `inert` — deliberately non-modal (§7)

## Commands

```bash
npm run dev       # start dev server
npm run build     # tsc -b && vite build (must pass clean before every commit)
npm run lint      # eslint (must pass clean before every commit)
npm run test      # vitest run (must pass clean before every commit)
npm run format    # prettier --write .
```

`npm run build && npm run lint && npm run test` is the full correctness gate — all three
must pass clean before every commit, and CI (`.github/workflows/ci.yml`) runs the same
three on every push/PR to `main`. The suite is 369 tests across 36 files in
`src/__tests__/` as of the July 2026 handoff (066de9c) — the gate output, not this
number, is the source of truth. Keeping it green is required (a red suite on `main` is what
motivated a dedicated repair phase once — don't ship past it).

## Working agreement

- Build one phase at a time; summarise decisions after each phase
- Do not start the next phase without explicit user confirmation
- Flag ambiguities not covered by `ARCHITECTURE.md` rather than guessing
- Before "fixing" anything that looks odd, check `docs/decisions.md` (deliberate keeps —
  several things that look like bugs are decisions) and `docs/tech-debt.md` (known debt
  and platform quirks).
- Do not add `Co-Authored-By` to commits

## TypeScript constraints

`tsconfig.app.json` enables `noUnusedLocals` and `noUnusedParameters` in addition to `strict: true`. Unused symbols fail the build — there is no workaround. Do not introduce a symbol until it has a real caller.

All imports use the `@/` alias (maps to `src/`).

## Data model

The central type is `Chart` in `src/types/chart.ts`. Key details:

- `slots: Array<Slot | null>` is **visual-cell-indexed and sparse**. The default is `slots: []`. Out-of-bounds reads return `undefined`, not `null`. Always read slots through `getSlot(chart, slotIndex)` from `src/utils/chart.ts`, never via direct array access.
- `Slot` is a discriminated union on `kind`: `'scryfall'` (card art from Scryfall) and `'custom'` (a user-uploaded image stored as a data URL).
- `heroConfig: HeroConfig` drives the hybrid hero layout; `titleFont?: string` selects the title typeface. Both are on `Chart`.
- Crop fields (`cropX`, `cropY`, `cropScale`) are on every slot and drive framing/square mode — do not remove them.
- Sort fields (`cmc`, `colors`, `typeLine`) are stored on `ScryfallSlot` (nullable) so sort works offline without a re-fetch.
- `CURRENT_SCHEMA_VERSION` is `4` (`src/utils/schemaVersion.ts`), with a migration chain v1→v2→v3→v4. When adding a non-optional field, bump the version and add a migration step that fills existing charts/slots with the new field's default; `migrateAll` runs on load before render.

## Grid rendering

`generateCellMap(rows, cols, heroConfig)` in `src/utils/cellMap.ts` produces the `CellMap` — the grid renderer consumes this and never computes slot positions itself. In uniform mode every cell is `{ kind: 'slot', slotIndex: i }`. The union also has `'hero'` (a spanning cell) and `'covered'` (occupied by an adjacent hero); `covered` cells must render `null` (no DOM node) and carry a `heroSlotIndex` back-pointer so keyboard navigation and drop targeting resolve covered → hero (derived at render, never persisted). All downstream logic (drop targets, "next empty", capacity, numbering) filters on `kind !== 'covered'`.

React keys in the grid must be `cell.slotIndex`, not array index. Cells render `<img>` with `object-fit: cover` (never `background-image`) — the `.cardImg` class in `Grid.module.css`. Every `<img>` that loads Scryfall art (grid, crop preview, search results, printing thumbnails) must carry `crossOrigin="anonymous"` so all paths share one CORS-usable HTTP cache entry with the export's `fetch(mode: 'cors')` — dropping it anywhere reintroduces cold-cache export failures; `src/__tests__/crossOrigin.app.test.tsx` fences every rendered art path.

## Interaction

Card movement flows through a pure state machine (`src/interaction/moveMachine.ts` —
`idle`/`pressed`/`dragging`/`moveArmed`) owned by `App`; the grid and search panel drive it
through `MoveApi`/`SearchDragApi` (`src/interaction/moveApi.ts`) and the low-level pointer
engine `src/interaction/usePointerDrag.ts`. Pointer Events only — HTML5 drag-and-drop was
deleted in Phase 3. Touch arms a drag by ~400ms still-finger long-press; if the finger moves
past slop first, the browser keeps the gesture (scroll wins). Keyboard navigation is pure
math in `src/utils/gridNav.ts` (arrows/Home/End over the CellMap, covered → hero). The grid
is one tab stop (roving tabindex), selection follows focus, Space grabs/commits a move,
Delete clears, Shift+F10 / menu key opens the context menu. Every commit fires the same
typed domain callbacks a click fires — one completed move = one undo entry.

**Interaction invariant (overhaul brief §3.1).** No capability may exist only behind hover,
only behind right-click, or only behind drag: every cell operation must be reachable from
selection + a visible control + a keyboard path. Hover reveals, the context menu, and
pointer gestures are accelerators over that baseline, never the baseline. The per-cell
overlay buttons (×, ⇄, ↺) are deliberately `aria-hidden` + `tabIndex={-1}` for this reason —
they are pointer accelerators, not the baseline; do not "fix" them into the tab order.
**Known exception:** crop *repositioning* is currently pointer-drag-only — the planned
keyboard nudges were never built (`docs/tech-debt.md` C8). Close that gap together with the
crop editor's re-base onto `usePointerDrag` (tech-debt D3), not in isolation, and don't add
a second exception.

## Responsive layout

Two shell modes, `docked` and `drawer`, from `useLayoutMode()`. The docked↔drawer breakpoint
is `LAYOUT_BREAKPOINT_PX = 900` in `src/hooks/useLayoutMode.ts` and lives ONLY there: `App`
stamps `data-layout="docked|drawer"` on the app root, and all mode-dependent CSS selects on
`[data-layout=…]` — never its own media query. This is test-enforced: `layoutContract.test.ts`
fails any stylesheet width media query (capability queries like `prefers-reduced-motion` are
allowed) and any viewport unit or `clamp()` in grid sizing, which must stay container-driven
(`min(100%, 900px)`). In drawer mode the Selected-card surface renders in a `BottomSheet`
(deliberately non-modal — no trap, no backdrop; the grid stays interactive and selecting
another cell retargets the sheet in place); docked mode renders the same `SelectedCard` as a
sidebar section.

## Overlays

`src/components/Dialog/` is the one modal primitive: portal, backdrop, `role="dialog"`,
`inert` on the app root while open, Escape, and focus restore with a disabled-opener
fallback. `ImportModal` and `PrintingSwitcher` are consumers. Destructive actions (delete
chart, clear cards, layout change) confirm through `ConfirmDialog` — never `window.confirm`.
`ContextMenu` is a lighter menu primitive and is an accelerator only; `BottomSheet` is
intentionally not a dialog (see above).

## State

Chart state lives in the `useCharts` hook (`src/hooks/useCharts.ts`): a localStorage-persisted
multi-chart store (`charts[]` + `activeId` under `mtg-chart:charts` / `mtg-chart:activeId` —
these key names keep the pre-rename brand ON PURPOSE: they are user-data keys, and renaming
them would orphan every existing user's saved charts; no migration shipped, so don't "finish
the rename" here) with CRUD (`createChart`, `duplicateChart`, `deleteChart`, `renameChart`,
`setActiveId`, and `updateChart` — which takes an updater `(prev: Chart) => Chart`, never a
plain object) and share-link reconstruction. When the app loads with a `?c=` share payload, `loadOrInit` returns a
placeholder chart plus a `pendingReconstruction` stub list; a `useEffect` batches the stubs
to Scryfall's `/cards/collection` endpoint and fills the real slots, exposing
`isReconstructing` / reconstruction error/warning state. Writes are debounced through a
persist scheduler and degrade gracefully on `QuotaExceededError`.

Undo/redo lives **in `App.tsx`**, above `useCharts`: a per-session `{ past, future }` history
stack (not persisted). `App.tsx` wraps `updateChart` so only content mutations push history
(chart-level ops and image-cache refreshes don't), and coalesces bursts of same-field edits
(e.g. a crop drag or title typing) into a single undo entry. Mutation callbacks passed down as
props are typed domain callbacks — keep mutation logic in `App`/`useCharts`, not in components.

## Styling

CSS Modules per component. Global tokens in `src/index.css`:

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#0b0c0e` | page / chart canvas background |
| `--bg-panel` | `#111317` | control panel |
| `--bg-cell` | `#1a1c21` | empty cell placeholder |
| `--accent` | `#d4a23c` | interactive / active states only |
| `--panel-width` | `260px` | sidebar width |
| `--radius-sm` | `4px` | cells, buttons |
| `--radius-md` | `8px` | canvas container |
| `--focus-ring` | `#e8e8e8` | keyboard focus — deliberately distinct from the gold selection outline; focus and selection are two different states |
| `--danger` | `#c0392b` | destructive actions |

This table is a curated subset — the full token list is the top of `src/index.css`.
Transition durations are still hardcoded per rule: the motion-token migration (overhaul
Phase 5) never ran, and an interim `prefers-reduced-motion` sweep sits in `index.css`
(`docs/tech-debt.md` B1).

Chart style values (`backgroundColor`, `cellGap`, `padding`, `cornerRadius`) are always applied as inline styles — never hardcoded in CSS. Numeric values passed as inline styles get `px` appended automatically by React.

## Scryfall

API base: `https://api.scryfall.com`. Do not set `User-Agent` client-side — browsers block it.

Image rendering always uses `artCrop` (the landscape art-box crop). `normal` is stored in `imageUris` for post-MVP use but never rendered. For multi-face cards (`card.card_faces`), populate `imageUris` for all faces at add time; face toggle requires no re-fetch. Skip any card missing `art_crop` on any image-bearing face.

Beyond search: printings are fetched with pagination (`fetchAllPrintings` in
`src/utils/scryfall.ts`, 5-page cap with a surfaced `truncated` flag); decklist import
resolves cards via `/cards/{set}/{number}` and `/cards/named?exact|fuzzy`; share-link
reconstruction batches `POST /cards/collection` in 75-id chunks (`src/utils/reconstruct.ts`).
All of these are deliberately sequential and rate-limit-polite (inter-request delays,
bounded 429 backoff) — keep them that way.
