# UI Overhaul — Architecture & Design Brief (July 2026)

**Status (July 2026 handoff): Phases 0–4 of this brief shipped (see [roadmap.md](roadmap.md)); Phase 5 (motion tokens) never ran ([tech-debt.md](tech-debt.md) B1). §1's current-state audit describes the pre-overhaul code and is historical; the design rationale — especially the §3 interaction grammar — is live and cited by §number from CLAUDE.md, [decisions.md](decisions.md), and [tech-debt.md](tech-debt.md).** *(Original status: planning document, awaiting owner review.)*

Scope contract for this document, restated from the commissioning brief:

- The engine — deterministic export, share pipeline, schema/migrations, sparse slot model, state/history — is hardened and **must not regress**. This overhaul is the *interaction layer*: responsive layout, touch, keyboard, focus, and the structure of the surfaces.
- **The owner owns the visual identity.** This brief architects the skeleton (layout system, interaction model, focus architecture, primitives) and contains no colour, type, or texture prescriptions. Where a visual/product decision has structural consequences, it appears in §7 as options with tradeoffs, not a prescription.
- Static-only on Vercel. No backend. No new schema migrations are proposed anywhere in this plan — every piece of new state is session-ephemeral.
- Everything proposed is implementable behind the existing `npm run build && npm run lint && npm run test` gate, in the repo's one-phase-at-a-time flow.
- Items tagged **[optional — cuttable]** are nice-to-haves that can be dropped at execution time without unraveling the core phases.

---

## 1. Current-state interaction audit

Every claim below was verified against the code in this session. Line references are to `main` at the time of writing.

### 1.1 The grid ([src/components/Grid/index.tsx](../src/components/Grid/index.tsx), [Grid.module.css](../src/components/Grid/Grid.module.css))

- Cells are plain `<div>`s ([Grid/index.tsx:144-199](../src/components/Grid/index.tsx#L144-L199)): `onClick` selects, `onContextMenu` opens the context menu, `draggable` + four HTML5 DnD handlers move cards. **No `tabIndex`, no `role`, no key handlers** — a keyboard user cannot reach, select, or move a cell. React keys are correctly `cell.slotIndex`; covered cells correctly render `null`.
- Per-cell actions (remove ×, switch-printing ⇄, flip ↺) are 20px buttons at `opacity: 0`, revealed only by `.cell:hover` or `:focus-visible` ([Grid.module.css:93-96](../src/components/Grid/Grid.module.css#L93-L96), [:123-126](../src/components/Grid/Grid.module.css#L123-L126), [:153-156](../src/components/Grid/Grid.module.css#L153-L156)). Two distinct failures:
  - **Touch:** no hover exists, so the buttons are invisible — but still present as tap targets. A tap in a cell's top-right corner hits the *invisible remove button* and deletes the card. This is not just a discoverability gap; it is a destructive misfire hazard.
  - **Keyboard:** the buttons are the *only* focusable things in the grid. A keyboard user can blind-tab through up to `3 × filledCells` stops (each revealing itself on focus) and can technically remove/flip/switch — but cannot select a cell, so cannot crop or set a fill target, and cannot move anything.
- The selection state that *should* anchor all of this already exists: `.cellSelected` reveals the artist strip ([Grid.module.css:188-191](../src/components/Grid/Grid.module.css#L188-L191)) but not the action buttons.
- Hero cells: rendered from the CellMap with span styles; interaction semantics identical to normal cells. Note for later: `CellDef`'s `'covered'` variant carries **no back-pointer to its hero** ([src/types/chart.ts:59-63](../src/types/chart.ts#L59-L63)) — keyboard navigation across hybrid layouts will need one (§3.4).

### 1.2 Selection (the seed of the new model) ([src/App.tsx](../src/App.tsx))

`selectedSlotIndex` lives in App ([App.tsx:103](../src/App.tsx#L103)) and already drives three things: the crop editor's target ([App.tsx:484-485](../src/App.tsx#L484-L485)), select-then-fill targeting (`resolveSlotFillTarget`, [src/utils/chart.ts:11-28](../src/utils/chart.ts#L11-L28)), and the artist-strip reveal. Its lifecycle discipline is already correct: cleared on chart switch/create/duplicate/delete, undo/redo, shrink, and clear-cards; it *follows the card* on move ([App.tsx:239-253](../src/App.tsx#L239-L253)). **The overhaul's central move is to promote this existing state from "crop side-channel" to the pivot of all cell interaction** — not to invent a new model.

### 1.3 Card movement and search-to-grid transfer

- Cell↔cell reordering is HTML5 drag-and-drop ([Grid/index.tsx:165-198](../src/components/Grid/index.tsx#L165-L198)): `dragFromRef` + `onDrop` → `onSlotMove`. **Dead on touch** (HTML5 DnD does not fire from touch input). No keyboard path.
- Search results are draggable `<li>`s carrying a JSON payload under `application/x-mtg-search-result` ([SearchPanel/index.tsx:94-102](../src/components/SearchPanel/index.tsx#L94-L102)), parsed and shape-checked at the drop site ([Grid/index.tsx:174-192](../src/components/Grid/index.tsx#L174-L192)). Also dead on touch — mitigated by the click/tap-to-fill button path, which works everywhere and respects the selected cell as fill target.

### 1.4 The crop editor ([src/components/ControlPanel/index.tsx:179-296](../src/components/ControlPanel/index.tsx#L179-L296))

Wired to `onMouseDown` + window `mousemove`/`mouseup` only — **crop repositioning is impossible on touch**; only the zoom slider (a native `<input type=range>`, keyboard-operable) works. No keyboard path for position. The *history* design, however, is exactly right and transfers unchanged to any input: `onCropDragBegin` pushes one undo snapshot on first actual movement, `onCropLive` streams history-free updates, `onCropChange` handles discrete edits ([App.tsx:404-439](../src/App.tsx#L404-L439)).

### 1.5 Context menu ([src/components/ContextMenu/index.tsx](../src/components/ContextMenu/index.tsx))

Right-click only. iOS Safari never fires `contextmenu` for touch, so the menu is unreachable on iPhones; there is no keyboard trigger (Shift+F10/menu key do nothing). On open, focus is not moved into the menu; there is no arrow-key navigation (items are buttons, so Tab works if you can get there — you can't, by keyboard, because the trigger is mouse-only). Dismissal (Escape, outside-mousedown, scroll) is solid.

### 1.6 Dialogs

Three different foundations for three overlays:

| Surface | Render | `role="dialog"` / `aria-modal` | Focus in | Trap | Restore | Escape |
|---|---|---|---|---|---|---|
| ImportModal ([index.tsx:64](../src/components/ImportModal/index.tsx#L64)) | inline in `.app` | yes / yes | textarea autofocus | **no** | **no** | yes |
| PrintingSwitcher ([index.tsx:69-76](../src/components/PrintingSwitcher/index.tsx#L69-L76)) | portal to body | **none** | **no** — focus stays behind the overlay | **no** | **no** | yes |
| ContextMenu | portal to body | (menu, not dialog) | **no** | **no** | **no** | yes |

Plus two blocking `window.confirm` calls in App (layout change [App.tsx:342](../src/App.tsx#L342), clear cards [App.tsx:364](../src/App.tsx#L364)). The import `<progress>` has no accessible name ([ImportModal/index.tsx:116-120](../src/components/ImportModal/index.tsx#L116-L120)). Tab inside any open overlay walks out into the background page.

### 1.7 Chart picker ([ControlPanel/index.tsx:68-177](../src/components/ControlPanel/index.tsx#L68-L177))

- Per-chart delete is an 18px button at `opacity: 0` revealed by row hover ([ControlPanel.module.css:187-207](../src/components/ControlPanel/ControlPanel.module.css#L187-L207)) — invisible on touch.
- Deletion is **instant and not undoable**: undo history is per-chart, session-only, and reset on every chart switch; `deleteChart` is not history-tracked. A mis-tap destroys a chart with no recovery. (§7.3 puts the protection choice to the owner.)
- Rename is "click the active chart's name" — functional, but invisible affordance (title tooltip only).

### 1.8 Mobile layout today ([App.css](../src/App.css), [ControlPanel.module.css:12-28](../src/components/ControlPanel/ControlPanel.module.css#L12-L28))

One breakpoint (768px). Below it: a fixed hamburger (top-left, z-60), a backdrop (z-40), and the entire 260px sidebar becomes an off-canvas drawer (`translateX(-100%)` → 0, 0.25s ease, `min(85vw, 320px)` wide, z-50). Everything lives in the drawer: search, crop, all settings, undo/redo, share, export. Notable defects:

- The **closed drawer is neither `inert` nor `visibility: hidden`** — all its controls remain in the tab order while off-screen; a keyboard/AT user tabs through an invisible panel.
- No Escape-to-close; no focus move-in on open or restore on close; background not inert while open (backdrop click does close it; `aria-expanded` on the toggle is correctly maintained).
- Grid width is **viewport-derived** (`clamp(400px, 70vw, 900px)`; `min(92vw, 900px)` under 768px) rather than container-derived — `70vw` embeds an assumption about the sidebar's share of the viewport instead of measuring the space the grid actually has.
- The viewport meta ([index.html:7](../index.html#L7)) lacks `viewport-fit=cover`; no `env(safe-area-inset-*)` anywhere — fixed chrome (hamburger, future bottom surfaces) will collide with notches/home-indicator on modern phones.
- 768–1023px (tablet portrait, small laptops): full desktop layout with the 260px sidebar squeezing the canvas.

### 1.9 Keyboard & focus, app-wide

Works today: sidebar controls are real `<button>`/`<input>`/`<select>` elements in sensible DOM order; global undo/redo shortcuts with correct editable-target and import-modal guards ([App.tsx:174-195](../src/App.tsx#L174-L195), [src/utils/dom.ts](../src/utils/dom.ts)); Escape closes all three overlays; 47 aria/role/alt attributes, mostly well-placed.

Missing: any way to select/move/crop a cell; any keyboard route to the context menu; focus containment or restore for any overlay; arrow-key behaviour on the three `role="radiogroup"` segmented controls (each radio is its own tab stop — operable but non-standard); `prefers-reduced-motion` handling (zero instances in `src/**/*.css`).

### 1.10 Motion inventory

The only real motion is the drawer transform (0.25s). Everything else is 0.1–0.15s colour/opacity/border fades and a 0.1s progress-bar width. All durations are hardcoded per-rule; there are no motion tokens.

### 1.11 Dead weight

`gridRef` ([App.tsx:487](../src/App.tsx#L487) → Grid prop → attached at [Grid/index.tsx:121](../src/components/Grid/index.tsx#L121)) has **zero consumers** — it is a leftover from the pre-deterministic export that measured the DOM. It can be deleted (`noUnusedParameters` will enforce cleanup through the prop chain).

### 1.12 Three users, one app

- **Desktop mouse:** everything works. Hover reveals, right-click menus, drag everywhere.
- **Phone touch:** can search, tap-to-fill, select cells, zoom crop, export/share. Cannot: see per-cell actions (and can *misfire* the invisible remove), reposition crop, move cards at all, open the context menu (iOS), delete or discover-rename charts.
- **Keyboard only:** can operate the whole sidebar, undo/redo, Escape overlays. Cannot: select a cell, move a card, reposition crop, open the context menu; can blind-remove via invisible buttons; focus leaks behind every overlay.

The engine underneath all three is identical and sound. This is precisely an interaction-layer problem.

---

## 2. Target architecture overview

Six areas. Area (b) is the spine and gets the deep spec in §3.

### 2.a Responsive layout system

**Two layout modes, one source of truth.**

- Modes: `docked` (persistent sidebar + canvas) and `drawer` (off-canvas sidebar + full-bleed canvas). Deliberately *not* three — a third "rail" tier is over-engineering for this app's surface count.
- A single `useLayoutMode(): 'docked' | 'drawer'` hook (one `matchMedia` listener) stamps `data-layout="docked|drawer"` on the app root. **All mode-dependent CSS keys off `[data-layout=…]` selectors instead of media queries.** This kills the current duplication (the 768px constant appears in three files) and — because CSS media queries cannot read custom properties — is the only clean way to give JS and CSS the same breakpoint. It also makes layout mode trivially testable: tests set the attribute.
- Breakpoint raised from 768px to **~900px** (a single constant in `useLayoutMode.ts`, documented as the one place it lives; exact value is an owner tunable, §7.6). Rationale: at 769–900px the docked 260px sidebar leaves a cramped canvas; tablet-portrait is better served by the drawer + full-width canvas.
- **Grid sizing becomes container-driven:** the grid gets `width: min(100%, 900px)` inside the canvas column (the column itself flexes), replacing `70vw`/`92vw`. The vertical-scroll model for tall charts is kept — no zoom/pan canvas machinery (out of scope; a product decision for another day). The 400px floor is dropped (it's already dropped on mobile; it serves nothing).
- **Safe areas:** add `viewport-fit=cover` to the viewport meta; pad fixed chrome (menu toggle, drawer, any bottom surface) with `env(safe-area-inset-*)`. Bottom-anchored surfaces size against `dvh` where needed.
- **Drawer semantics fixed** (this is behaviour, not aesthetics): when closed in drawer mode the panel is `inert` + `visibility: hidden` (with `transition: transform …, visibility 0s 0.25s` so the slide-out still shows); Escape closes; on open, focus moves to the panel; on close, focus returns to the toggle. Backdrop click keeps working.
- What the drawer *contains* on phones — one drawer with everything (status quo) versus splitting selection/search into a bottom surface — is an information-architecture decision with real structural consequences and belongs to the owner: §7.1. The architecture below is compatible with either.

### 2.b Unified interaction model — see §3 (the spine)

### 2.c Keyboard navigation + focus architecture

- **Grid = one tab stop** via roving tabindex: the active cell has `tabIndex=0`, all others `-1`; arrow keys move the active cell. Entering the grid by Tab lands on the last-active (= selected) cell, so tabbing *through* the app never mutates selection.
- **Selection follows focus** (arrow movement selects, exactly as click does for pointer users). This gives one mental model — "the cell I'm on is the cell the app is about" — and means the crop panel retargets as you arrow around. The alternative (focus moves, Space selects) is more conservative but introduces a two-state model pointer users don't have; the choice is isolated inside the interaction hook and cheap to flip if the retargeting feels noisy in practice (risk noted in §5).
- **Semantics:** `role="grid"` on the container, cells as `role="gridcell"` with `aria-selected`, rows expressed as `display: contents` wrappers with `role="row"`, heroes carrying `aria-rowspan`/`aria-colspan`. Cell accessible names come from the slot (`"Lightning Bolt"` / `"Empty"` + position). Fallback if `display:contents` row semantics prove unreliable in target ATs: a flat composite (`role="group"` + roving tabindex + positional labels like "row 2 column 3") — functionally identical keyboard behaviour, honest if less rich semantics. Decide by testing at phase start (§5).
- **Key map (grid-scoped, on the grid container — no new global listeners):**

| Key | Empty cell | Filled cell |
|---|---|---|
| Arrows / Home / End | move focus+selection (CellMap-aware; covered → its hero) | same |
| Enter / Space | select as fill target; **[optional — cuttable]** Enter also moves focus to the search input | Enter: select; Space: arm/commit **move mode** |
| Delete / Backspace | — | clear slot (focus stays on the now-empty cell) |
| Escape | clear selection | cancel move mode, else clear selection |
| Shift+F10 / Menu key | — | open context menu anchored to the cell |
| `f` / `p` — flip / printings | — | **[optional — cuttable]** letter accelerators; ship only if the owner wants a power-user tier |

- Navigation logic is a **pure function** in a new `src/utils/gridNav.ts` (`moveFocus(cellMap, cols, from, key) → slotIndex`), unit-tested like `exportGeometry` — including hero/covered traversal. This needs the covered back-pointer (§3.4).
- **App-wide tab order** stays DOM order: menu toggle (drawer mode) → sidebar → notifications → grid → selected-card action surface. No `tabindex` ordering hacks anywhere. A "skip to grid" link is **[optional — cuttable]**.
- **Focus visibility:** a shared `--focus-ring` token applied via `:focus-visible` on every interactive element, and the constraint that *focus* and *selection* must be visually distinguishable (today both would be gold-on-gold; the actual treatment is the owner's, §7.5).
- **Focus continuity rules** (spec'd per operation): closing any overlay restores its invoker; removing a card keeps focus on the emptied cell; deleting a chart focuses the next active chart's row; grid shrink clamps the focused index the same way selection is already cleared/clamped.
- The segmented controls (`role="radiogroup"`) get standard arrow-key roving within the group. Small, self-contained fix.

### 2.d Dialog architecture

One hand-rolled primitive, `src/components/Dialog/` (~100 lines), applied uniformly:

```tsx
<Dialog label="Import decklist" onClose={…} initialFocus={ref?} closeOnBackdrop>
  {children}
</Dialog>
```

- Portals to a `#dialog-root` under `document.body`; renders backdrop + panel; sets `role="dialog"`, `aria-modal="true"`, `aria-label`/`aria-labelledby`.
- **Containment via `inert`:** while open, the app root gets the `inert` attribute (Safari ≥15.5, Chrome ≥102, Firefox ≥112 — fine for this product), which is stronger and simpler than sentinel-based traps; a Tab-cycle fallback inside the panel is a ~15-line belt-and-braces addition.
- Initial focus: explicit `initialFocus` ref, else first focusable, else the panel itself.
- Escape closes (single listener owned by the primitive — removes the three hand-rolled copies); focus restores to the element focused at open.
- Consumers: **ImportModal** (moves from inline render to the portal; keeps its phase machine and Escape-cancels-import semantics untouched), **PrintingSwitcher** (gains the role/label/trap/restore it entirely lacks), and a new **ConfirmDialog** (`message`, `confirmLabel`, `danger?`) replacing both `window.confirm` calls — App holds a small `confirm: {…} | null` state; no promise machinery needed.
- **ContextMenu stays a separate, lighter primitive** (it's a menu, not a dialog): keeps portal + dismissal, gains a keyboard trigger (anchored to the cell rect instead of mouse coords when keyboard-invoked), focus-into-first-item on keyboard open, arrow/Home/End item navigation, `role="menu"`/`menuitem`, and focus restore. Crucially it is demoted to an **accelerator**: every action it offers also exists on the selection surface, so no capability is right-click-only (the §3 invariant).
- The `<progress>` gets `aria-label="Import progress"` — one line, folded in.

### 2.e Motion & reduced-motion strategy

- **Motion tokens** in `:root`: `--dur-1: 100ms` (micro: fades, reveals), `--dur-2: 200ms` (surfaces: drawer, sheet, dialog), `--ease-standard`. All transitions migrate to the tokens (mechanical, opportunistic per file touched).
- **One global block:** `@media (prefers-reduced-motion: reduce) { :root { --dur-1: 0.01ms; --dur-2: 0.01ms } }`. Because everything routes through tokens, no `!important` sledgehammer is needed; until migration completes, an interim `transition-duration: 0.01ms !important` block covers stragglers.
- Rules for new motion introduced by this overhaul: transform/opacity only (compositor-friendly), ≤ 250ms, token-driven. The drag ghost tracks the pointer by direct position updates — that is *user-driven manipulation, not animation*, and is explicitly exempt from reduced-motion (the spec states this so nobody "fixes" it into unusability).
- **[optional — cuttable]** FLIP animations for sort/shuffle/move (cards gliding to their new cells). Genuinely charming for this product, but real work: React keys are positional (`slotIndex`, mandated by CLAUDE.md), so FLIP must measure DOM nodes by *card identity* across renders rather than re-keying. Costed as its own slice in Phase 5; the owner decides if the personality is worth it (§7.7).

### 2.f Mapping onto the component tree and state

**New (all hand-rolled — see dependency note below):**

| Piece | Location | Role |
|---|---|---|
| `usePointerDrag` | `src/interaction/usePointerDrag.ts` | low-level pointer capture / slop / long-press engine, shared by cell drag, search drag, crop drag |
| `useGridInteraction` | `src/interaction/useGridInteraction.ts` | the spine controller (§3): selection+focus+move machine → existing domain callbacks |
| `gridNav` | `src/utils/gridNav.ts` | pure keyboard-navigation math (unit-tested) |
| `Dialog`, `ConfirmDialog` | `src/components/Dialog/` | §2.d |
| `useLayoutMode` | `src/hooks/useLayoutMode.ts` | §2.a; stamps `data-layout` |

**Restructured:** `Grid` (consumes `getCellProps()`/`getGridProps()`; all HTML5 DnD attributes deleted; per-cell buttons demoted per §3.6); `ControlPanel`'s crop section grows into a **"Selected card" section** — name, Remove / Flip / Switch printing / Move actions, then the crop editor — which *is* the canonical action surface; the crop editor itself moves onto `usePointerDrag` + keyboard nudges; `SearchPanel` results become pointer-drag sources (desktop accelerator) instead of `draggable`; `ContextMenu` per §2.d; `App` sheds `gridRef` and the two `window.confirm`s.

**Explicitly untouched:** `useCharts`, `useExport`, `useImport`, `useScryfall`, every util except the additive `cellMap` change (§3.4) and new `gridNav`; the schema (no version bump — nothing new persists); `shareLink`/reconstruction; export geometry and pipeline; cell rendering keeps `<img>` + `object-fit: cover` + `objectPosition`/`transform` cropping and `slotIndex` keys (the export-parity contract).

**State model unchanged.** The interaction layer is a *compiler from input events to the existing typed domain callbacks* (`onCellSelect`, `onSlotMove`, `onSlotClear`, `onSlotFillAtIndex`, `onFaceToggle`, crop begin/live/change). Mutation logic stays in `App`/`useCharts` per CLAUDE.md; history semantics (one entry per move, crop-drag coalescing, edit bursts) are preserved because the same callbacks fire in the same patterns. Move-mode/pressed/drag state is session-ephemeral inside the hook, exactly as `contextMenu`/`dragOver` state is inside `Grid` today.

**Dependency policy: hand-rolled, no new runtime dependencies.** The repo's ethos is explicit (one production dependency ever added, with documented rationale; a hand-rolled test harness instead of testing-library). react-aria / Radix / dnd-kit would each import more code than this app contains to solve a bounded problem: one grid, one drag semantic, three dialogs. The primitives above are collectively a few hundred lines, fully owned and fully testable in the existing harness. *Owner override:* if he'd rather buy than build for the dialog/drag layer, `@dnd-kit/core` and a headless dialog are the defensible picks — the phase structure below doesn't change, only Phase 1/3 internals.

---

## 3. The structural spine: a selection-first, pointer-unified interaction model

This is the single highest-leverage piece. The current app has three diverging input forks (hover+right-click+HTML5-DnD for mouse; a partial tap path for touch; almost nothing for keyboard), and every future feature — freeform hero placement is already on the roadmap — multiplies the forks. The spine collapses them into one grammar with per-input *accelerators* instead of per-input *models*. Get this right and the responsive, keyboard, and dialog work all hang off it; get it wrong and the overhaul re-forks within two phases.

### 3.1 The grammar

1. **Any input selects a cell.** Click, tap, or arrow-to — all set the same `selectedSlotIndex` that already exists in App.
2. **Selection exposes actions.** The selected cell's operations (remove, flip, switch printing, move, crop) are *visibly available* on a canonical surface — never hover-gated.
3. **Move and crop are operations on the selection**, each reachable by pointer gesture *and* explicit control *and* keyboard.
4. **Hover and right-click are accelerators only.** The codified invariant, to be written into `CLAUDE.md` at the end of the overhaul:

> **No capability may exist only behind hover, only behind right-click, or only behind drag.** Every cell operation must be reachable from selection + a visible control + a keyboard path. Pointer gestures and hover reveals are accelerators over that baseline, never the baseline.

That one sentence is the anti-regression rule that keeps the model unified after the overhaul ships.

### 3.2 The interaction state machine

Owned by `useGridInteraction`, session-only, a discriminated union:

```
type MoveState =
  | { kind: 'idle' }
  | { kind: 'pressed';  slotIndex: number; pointerId: number; startX: number; startY: number }
  | { kind: 'dragging'; from: number; source: 'cell' | 'search'; over: number | null }
  | { kind: 'moveArmed'; from: number; over: number }        // keyboard grab & tap-to-move share this
```

Transitions (all commits emit **existing** App callbacks; nothing new is mutated):

| From | Event | To / effect |
|---|---|---|
| idle | pointerdown on filled cell | pressed (start long-press timer if touch) |
| pressed | pointermove > slop (mouse ~4px) | dragging |
| pressed | long-press timer fires (touch, ~400ms, finger still) | dragging (arming cue shown) |
| pressed | pointermove > slop before timer (touch) | idle — it's a scroll; the browser takes the gesture (`pointercancel`) |
| pressed | pointerup (no drag) | idle + `onCellSelect(slotIndex)` — this *is* click |
| dragging | pointermove | update `over` via hit test |
| dragging | pointerup over valid cell | idle + `onSlotMove(from, over)` (or `onSlotFillAtIndex(over, slot)` when `source: 'search'`) |
| dragging | pointerup elsewhere / Escape / pointercancel | idle (no mutation) |
| idle (selected, filled) | Space / "Move" action tap | moveArmed (`over` starts at `from`) |
| moveArmed | arrows | retarget `over` (gridNav) |
| moveArmed | Space / Enter / tap on a cell | idle + `onSlotMove(from, over)` |
| moveArmed | Escape / tap on source / focus loss | idle (no mutation) |

Properties worth stating: the machine is a pure reducer (`(state, event) → state`), unit-testable without DOM; keyboard grab and touch tap-to-move are the *same state* with different bindings — the F9-anticipated "tap-to-swap mode" falls out for free; one completed move = one history entry, because it fires the same `onSlotMove` the drop handler fires today; selection continuity on move is already handled in App ([App.tsx:239-253](../src/App.tsx#L239-L253)).

### 3.3 Pointer mechanics, precisely

These details are where naive implementations die; they are specified here so the implementing phase doesn't rediscover them.

- **Pointer Events only** (`pointerdown/move/up/cancel`) — one code path for mouse, touch, and pen. All HTML5 DnD code is deleted.
- **Capture:** `setPointerCapture(pointerId)` on drag start so moves keep flowing outside the cell. Wrapped in a throw-safe helper (`capturePointer(el, id)` with try/catch) — capture legitimately throws if the pointer is already up, and jsdom's implementation is incomplete; the helper serves both.
- **The touch drag-vs-scroll problem** (the crux of touch): the grid lives in a scrollable area, so cells must *not* set `touch-action: none` — that would kill page panning for any swipe starting on a cell. Correct mechanics:
  1. Cells keep default `touch-action`. On touch `pointerdown`, start the long-press timer.
  2. If the finger moves past slop before the timer fires → the browser begins scrolling and fires `pointercancel` → machine returns to idle. Scroll wins. Nothing to suppress.
  3. If the timer fires first (finger still) → arm the drag, show the arming cue. From here scrolling must be suppressed for the gesture's remainder: attach a **document-level non-passive `touchmove` listener that calls `preventDefault()`** only while `dragging`. This is the one place passive-listener discipline must be deliberately broken, and it is scoped to an active drag. (This is the same mechanism dnd-kit's TouchSensor uses; it is the honest way to do post-hoc scroll suppression.)
  4. `pointerup` → commit/cancel; remove the listener; clear capture.
- **Drop targeting:** a portal-rendered **drag ghost** follows the pointer (transform-positioned, aria-hidden); the cell under the pointer is found by `document.elementFromPoint(x, y)?.closest('[data-slot-index]')`. This survives drags across scroll containers (sidebar search → grid) with zero rect-caching invalidation problems. Covered cells resolve to their hero (§3.4). The `dragOver` highlight state moves from Grid-local DnD state into the machine's `over`.
- **Search-to-grid:** search results become `usePointerDrag` sources with `source: 'search'` and the `Slot` payload held in React state (typed, no JSON round-trip through `dataTransfer`). Desktop-only in practice (in drawer mode the panel covers the grid), which is fine — tap-to-fill with select-then-fill targeting is the touch path and already works. **[optional — cuttable]** Retiring search-drag entirely (keeping only click/tap-to-fill) is a legitimate simplification the owner may prefer: §7.4.
- **Crop editor on the same engine:** `usePointerDrag` with `arm: 'immediate'` (no long-press — the preview is not scrollable content), `touch-action: none` on the preview only, pointer capture, and the existing begin/live/change history contract. Keyboard parity: arrows nudge `cropX/cropY` by 1% (Shift = 5%) via `onCropChange`. The preview sits inside the scrollable panel, so `touch-action: none` on it eats pans that start there — acceptable for a deliberate, small, purpose-built surface; noted as a tradeoff.

### 3.4 One additive type change: `covered` learns its hero

Keyboard navigation and drop-target resolution both need "which hero covers this position?". `CellDef`'s `'covered'` variant becomes:

```ts
| { kind: 'covered'; heroSlotIndex: number }
```

`generateCellMap` already knows the hero when it marks coverage — the field is free to populate. Every existing consumer filters `kind !== 'covered'`, so nothing downstream changes behaviour; `cellMap.test.ts` gains assertions for the back-pointer. **No schema impact** (CellMap is derived at render, never persisted). This is the only shared-type change in the whole overhaul and is flagged for extra review because `cellMap` sits near the export/import path — the change is additive and the existing tests plus new ones fence it.

### 3.5 The hook interface

```ts
// src/interaction/useGridInteraction.ts
function useGridInteraction(args: {
  cellMap: CellMap
  cols: number
  chart: Chart
  selectedSlotIndex: number | null
  onCellSelect(i: number | null): void
  onSlotMove(from: number, to: number): void
  onSlotClear(i: number): void
  onSlotFillAtIndex(i: number, slot: Slot): void
  onFaceToggle(i: number): void
  openPrintings(i: number): void
  openContextMenu(i: number, anchor: DOMRect | { x: number; y: number }): void
}): {
  focusIndex: number
  moveState: MoveState                       // for ghost / target-cue rendering
  getGridProps(): GridContainerProps          // role, aria-label, onKeyDown
  getCellProps(cell: SlotCell): CellProps     // tabIndex, role, aria-*, pointer handlers, data-slot-index
  registerSearchDragSource(slot: Slot): PointerHandlers   // SearchPanel accelerator
}
```

Grid stays a dumb renderer of `CellMap × getCellProps`; App keeps owning selection and all mutations. The machine reducer and `gridNav` are exported pure functions for direct unit testing (the `exportGeometry` precedent).

### 3.6 What happens to the current affordances

- **Per-cell overlay buttons** (×, ⇄, ↺): once the Selected-card surface and keyboard paths exist, they are demoted to pointer accelerators — `tabIndex={-1}`, `aria-hidden` (they'd otherwise be duplicate tab stops and re-create the nested-interactive-inside-gridcell problem), revealed on `:hover` **and** `.cellSelected` (killing both the touch-invisibility and the blind-tap hazard, since on touch they now appear only after a selecting tap). Whether they survive at all as visual elements is the owner's call (§7.2).
- **Context menu:** accelerator status per §2.d — same actions as the Selected-card surface, plus keyboard trigger.
- **Artist strip:** unchanged (already reveals on hover *or* selection — it was the pattern the buttons should have followed).
- **Empty-cell click/tap/Enter:** selects as fill target (exactly today's select-then-fill), now also keyboard-reachable.

### 3.7 Why selection-first (and not the alternatives)

- *Drag-first* (make drag great everywhere, keep hover menus): leaves keyboard as a bolted-on third fork forever, and touch drag alone can't reach remove/flip/printing.
- *Mode-first* (explicit edit/move/crop app modes): heavier mental model than this app warrants; selection-first gets modality only where it pays (armed move), scoped and escapable.
- *Selection-first* matches what the codebase already half-built (`selectedSlotIndex`, select-then-fill, `.cellSelected` reveals, the crop panel keying off selection). The overhaul finishes a thought the app already had — smallest distance, no new state model, no migration.

### 3.8 Spine risks (mitigations in §5)

Touch drag/scroll discrimination is the riskiest mechanic; `role=grid` + `display:contents` AT behaviour needs an early spike; selection-follows-focus may feel noisy with the crop panel retargeting; jsdom's Pointer Events support has gaps. None are architecture-threatening; all have fallbacks that keep the grammar intact.

---

## 4. Phased migration

Sequenced for the repo's one-phase-at-a-time flow: spine first, each phase independently shippable behind `build + lint + test`, no big bang. **No phase touches export math, the share pipeline, or the schema.** Phases 2–3 touch the grid's DOM and are flagged for the export-parity checklist: cell `<img>` structure, `objectPosition`/`transform` crop styles, `slotIndex` keys, covered cells render `null`.

### Phase 0 — Interaction quick wins (all S; audit-sanctioned)
Ship-any-time slice, mostly straight from F9/F11: reveal cell buttons on `.cellSelected` (kills the touch invisibility/blind-tap hazard now); `role="dialog" aria-modal aria-label` on PrintingSwitcher; `aria-label="Import progress"` on the `<progress>`; interim `prefers-reduced-motion` block (drawer + fades); convert the crop editor to Pointer Events (the F9 slice — mechanical `onPointerDown`/capture/`touch-action: none`, later re-based onto `usePointerDrag`); delete vestigial `gridRef` end-to-end.
**Must not regress:** crop history coalescing (one undo per drag — `editBurst` tests); crop preview/export parity (unchanged math).
**Verify:** on a phone — tap a card, see its buttons, reposition a crop; on desktop — everything identical; suite green.

### Phase 1 — Dialog primitive
Build `Dialog` (portal, backdrop, roles, `inert` containment, initial focus, Escape, restore) + `ConfirmDialog`; migrate ImportModal and PrintingSwitcher; replace both `window.confirm`s. ContextMenu keyboard/focus upgrades can ride along or slip to Phase 2.
**Must not regress:** import phase machine and Escape-cancel semantics; undo-blocked-while-importing guard; printing-switch crop preservation; all existing modal-driving tests.
**Verify:** keyboard-only round trip of both modals (open → trapped → Escape → focus restored); import a decklist end-to-end; confirm dialogs appear for layout-change and clear-cards.

### Phase 2 — Spine A: selectable, focusable grid (keyboard + semantics)
`gridNav` + covered back-pointer in `cellMap.ts` (+tests); roving tabindex; grid ARIA (with the `display:contents` spike up front); selection-follows-focus; Delete/Enter/Space/Escape; the **Selected-card action surface** in the sidebar (actions + crop); per-cell buttons demoted (accelerators, out of tab order); ContextMenu keyboard trigger + menu navigation; segmented-control arrow keys.
**Must not regress:** `resolveSlotFillTarget` behaviour; selection lifecycle rules (clear on chart ops/undo/shrink, follow on move); hero rendering; export preview parity checklist; existing Grid-driving tests (update selectors alongside, never delete assertions).
**Verify:** unplug the mouse — build, rearrange-by-Delete/refill, flip, switch printing, crop-nudge, export, entirely by keyboard; screen-reader smoke pass (VoiceOver: cell names/positions announced).

### Phase 3 — Spine B: pointer-unified movement (delete HTML5 DnD)
`usePointerDrag`; machine states pressed/dragging; drag ghost + `elementFromPoint` targeting; long-press arming + non-passive scroll suppression; `moveArmed` (keyboard grab + Move action + tap-to-move); search results as pointer sources; **delete every HTML5 DnD attribute and handler**; re-base Phase 0's crop conversion onto `usePointerDrag`. De-risk order inside the phase: keyboard/tap move first (pure machine), mouse drag second, touch gesture last.
**Must not regress:** one history entry per move; selection-follows-card; search tap-to-fill; grid scrolling on touch (the discrimination test); drop-target semantics (`kind !== 'covered'`, covered→hero).
**Verify (full input matrix):** mouse drag cell↔cell and search→grid; touch: tap selects, swipe scrolls, long-press+drag moves, Move-button + tap moves; keyboard: Space-grab → arrows → Space-drop, Escape cancels; undo after each = exactly one step back. An aria-live announcement for grab/drop **[optional — cuttable]**.

### Phase 4 — Responsive re-tier *(blocked on owner decision §7.1)*
`useLayoutMode` + `data-layout` contract (convert the three media-query sites); breakpoint to ~900px; container-driven grid sizing (drop `70vw`); drawer semantics (inert/visibility/Escape/focus); `viewport-fit=cover` + safe-area padding; implement the owner's chosen mobile IA for the Selected-card surface (drawer section vs bottom sheet) and search placement.
**Must not regress:** notification banner visibility in both modes; desktop layout at common widths; drawer open/close under keyboard and touch; select-then-fill flow on phones.
**Verify:** walk 320 / 390 / 768 / 900±1 / 1280 / 1920px widths; iPhone safe-area check (hardware or simulator); closed drawer unreachable by Tab; Escape closes; focus restores to toggle.

### Phase 5 — Motion tokens + polish
Token migration (`--dur-1/2`, easing) across all CSS modules; reduced-motion via token zeroing (replacing the interim block); motion audit of drawer/sheet/ghost. **[optional — cuttable]** FLIP reflow animation for sort/shuffle/move as a separately costed slice, only if the owner opts in (§7.7).
**Must not regress:** nothing behavioural — this phase is presentation-only; reduced-motion verified by OS toggle.

Dependency notes: 0 and 1 are independent and can land in either order; 2 precedes 3 (the machine needs focus/selection substrate); 4 is independent of 2–3 *except* the mobile action-surface placement, which wants the surface (Phase 2) to exist; 5 floats. If pressure demands, Phase 4's drawer-semantics fixes (inert/Escape/focus) could ship early as a standalone S slice — they don't depend on the IA decision.

---

## 5. Risks and interlocking dependencies

| Risk | Phase | Severity | Mitigation |
|---|---|---|---|
| Touch drag vs scroll discrimination feels wrong (accidental drags, or scroll eating intended drags) | 3 | High — the one make-or-break mechanic | Long-press arming with visible cue; tunable delay/slop constants; ship keyboard/tap move first inside the phase so touch gesture is an increment, not the foundation; worst-case fallback = touch uses Move-mode only (grammar intact, gesture dropped) |
| `role="grid"` + `display:contents` row semantics flaky in some AT/browser combos | 2 | Medium | Spike at phase start with VoiceOver+Safari (the demanding combo); documented flat-composite fallback with identical key handling |
| Selection-follows-focus makes the crop panel retarget noisily while arrowing | 2 | Low-medium | Isolated in the hook; flip to explicit-select (Space) is a ~20-line change; decide after hands-on use |
| jsdom Pointer Events gaps (`setPointerCapture`, event constructors) break the test approach | 2–3 | Medium | Machine + gridNav are pure and DOM-free (bulk of coverage); throw-safe capture helper; tiny PointerEvent polyfill in test setup if needed — harness already dispatches synthetic events |
| `cellMap` change ripples (shared type near export/import) | 2 | Low | Additive field; all consumers filter `covered`; existing + new tests fence it; flagged for focused review |
| Grid DOM changes silently break preview/export parity | 2–3 | Medium if missed | The parity checklist (img structure, crop styles, keys, covered=null) run per phase; export tests unaffected (geometry never reads DOM) |
| Existing tests select Grid DOM by structure and churn during 2–3 | 2–3 | Low | Update selectors alongside; rule: assertions may move, never disappear |
| Drawer `inert` unsupported on very old Safari | 4 | Low | `inert` is baseline 2023; `visibility: hidden` when closed covers tab order regardless |
| Phase 4 stalls on the owner IA decision | 4 | Schedule-only | Decision needed before Phase 4 only; drawer-semantics slice can ship independently meanwhile |
| Scope creep into visual redesign mid-overhaul | all | Medium | This brief's contract: structure ships on tokens/roles the owner reskins; any visual change routes through §7 |

---

## 6. Testing & verification approach (cross-phase)

- **Pure cores get unit tests:** `gridNav`, the interaction reducer, dialog focus-order helpers — same pattern as `exportGeometry`/`history`.
- **Behavioural tests use the existing harness** (`src/__tests__/harness.tsx`): render App or Grid, dispatch real `KeyboardEvent`/`PointerEvent`s, assert domain outcomes (slots moved, history depth, focus target). Add `pressKey`/`pointer` helpers to the harness as needed.
- **Human verification scripts** per phase (listed above) cover what jsdom can't: real touch feel, AT announcements, safe areas.
- The suite must stay green through every phase — the 215 tests are the regression fence for the engine this overhaul is forbidden to break.

---

## 7. Owner decisions — options and tradeoffs

Structure below is ready for any of these choices; none block Phases 0–3 except where noted. Recommendations are marked, but these are yours.

### 7.1 Mobile information architecture *(blocks Phase 4)*
- **(a) One drawer, improved (recommended as baseline):** everything stays in the drawer; the Selected-card section lives inside it. Cheapest; ergonomics cost: selecting a cell then acting requires opening the drawer over the grid.
- **(b) Split surfaces:** a bottom sheet for the Selected-card surface (appears on selection, thumb-reachable, grid stays visible) + drawer for chart-level settings; search either in the sheet or drawer. Best touch ergonomics; adds one new surface to build and style. The sheet is where your aesthetic will live on phones — structurally it's a fixed bottom container with safe-area padding and the same section component rendered into it.
- **(c) Full bottom-sheet IA** (search + actions + settings all in a draggable sheet): most "native app" feel, most work, and drag-handle sheets bring their own gesture conflicts. **[optional — cuttable]** — not recommended for this overhaul's scope.

### 7.2 Desktop action surface presentation
- **(a) Sidebar "Selected card" section (recommended):** grows the existing crop section; zero new surfaces; actions sit next to crop where selection already has a home.
- **(b) Floating action bar near the selected cell:** slicker, keeps eyes on the canvas; needs anchoring/collision logic and is a new visual element you'd want to design.
- **Sub-decision:** do the in-cell hover buttons survive as accelerators (habit, one-click speed; visual noise on hover) or die entirely (cleaner canvas — closer to a wabi-sabi read; two clicks for remove)? Structurally free either way.

### 7.3 Chart-deletion protection
- **(a) ConfirmDialog on delete (recommended — one consumer of the Phase 1 primitive):** simple, predictable; one more click for intentional deletes.
- **(b) Undo-toast ("Chart deleted — Undo", ~6s):** zero-friction, modern feel; requires holding the deleted chart in memory briefly and a toast surface that doesn't otherwise exist yet.
- **(c) Status quo** (instant, hover-hidden): consistent with a minimal aesthetic but it's the app's only unrecoverable destructive action.
- Independent cheap fix regardless: the delete control stops being hover-only (the §3.1 invariant applies to the picker too).

### 7.4 Touch drag feel *(Phase 3 tunables)*
- Long-press arming delay: ~350ms (eager, more accidental arms) vs ~500ms (deliberate, feels slower). Recommend 400ms start, tune on device.
- Arming cue: scale/lift on the cell, outline pulse, or none — visual language is yours; *some* cue is required so users know scroll is suspended.
- **[optional — cuttable]** Whether search→grid drag survives at all: tap-to-fill + select-then-fill already covers targeting; retiring the drag deletes a code path and simplifies Phase 3. Keep it if the desktop drag ritual matters to you.

### 7.5 Focus vs selection visual language *(constraint, not a choice)*
Two states must be visually distinguishable and both visible in your palette: keyboard **focus** (transient, follows arrows) and **selection** (the cell the app is about). Today both would render as the same gold outline. The treatment (ring vs corner marks vs glow — whatever fits the sumi-e direction) is yours; the *existence of two distinct treatments* is load-bearing for the keyboard model.

### 7.6 Breakpoint value and tablet posture
~900px is the recommended docked↔drawer line (tablet-portrait gets the drawer + full canvas). If you'd rather keep tablets docked, the sidebar wants to slim toward ~220px below ~1024px. One constant either way; pick by feel on an iPad.

### 7.7 Motion personality **[optional — cuttable]**
- **(a) Minimal (recommended baseline):** token-driven fades + drawer/sheet slides only. Quiet, cheap, fits restraint.
- **(b) FLIP reflow** for sort/shuffle/move: cards glide to their new cells. Distinctive and delightful for a collage tool; costs identity-based DOM measurement over positional keys (~a day of careful work + reduced-motion handling). Can be added any time after Phase 3 without structural change.
- Non-negotiable regardless: `prefers-reduced-motion` support ships (Phase 0 interim, Phase 5 final).

### 7.8 Keyboard shortcut ambition **[optional — cuttable]**
Core set (arrows/Enter/Space/Delete/Escape/Shift+F10) ships with Phase 2. Letter accelerators (`f` flip, `p` printings) and a shortcut-hint overlay are a power-user tier you can add later or skip; they cost little but grow the documented surface.

---

## 8. Recommendations ranked by value-for-effort

1. **Phase 0 quick wins** — hours of work; removes a destructive touch hazard and the worst crop gap today. Do this regardless of everything else.
2. **Phase 1 dialog primitive** — small, self-contained, pays rent immediately (three consumers) and forever (every future overlay).
3. **Phase 2 keyboard/selection spine** — the architectural core; unlocks keyboard users and creates the action surface touch needs.
4. **Phase 3 pointer movement** — the biggest single capability gain (touch reordering) and the riskiest; de-risked by landing after 2 and by its internal ordering.
5. **Phase 4 responsive re-tier** — high user value on phones/tablets; medium effort; wants your §7.1 decision.
6. **Phase 5 motion** — cheap polish; FLIP only if §7.7(b) appeals.

---

*End of brief. This is a planning document — no code was written, no files besides this one were created, and nothing was scaffolded. Awaiting your review: the §7 decisions (7.1 is the only phase-blocker), any red-pen on the spine spec (§3), and a go/no-go on Phase 0.*
