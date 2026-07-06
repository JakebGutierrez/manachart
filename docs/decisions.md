# Decision Log

Permanent register of deliberate decisions: what was decided, why, what was
rejected, and what a future session must **not** do. Written July 2026 at handoff,
formalizing the deliberate-keeps draft from the audit. Companion docs:
[contracts.md](contracts.md) (the compatibility surfaces these decisions protect),
[tech-debt.md](tech-debt.md) (known debt — some entries here have a debt item
attached), `docs/ui-overhaul-brief.md` (§ references below).

Add an entry whenever a decision's rationale won't be obvious from the code in a
year. Entries are numbered stably — other docs cite them by number; append, don't
renumber.

---

## The deliberate keeps

Things that look wrong, half-done, or "fixable" and are none of those. **Check
here before fixing anything that looks odd.**

### 1. localStorage keys keep the old brand (`mtg-chart:*`)

- **Decided:** `mtg-chart:charts` / `mtg-chart:activeId` survive the Mana Chart
  rename ([useCharts.ts:11-12](../src/hooks/useCharts.ts#L11-L12)).
- **Why:** they are user-data keys. No key migration shipped with the rename, so
  renaming them silently orphans every existing user's saved charts.
- **Rejected:** a read-old/write-new migration — real work and real risk for zero
  user-visible benefit; the strings are invisible to users.
- **Do not:** "finish the rename" here, ever, without a migration *and* a reason.
  See [contracts.md](contracts.md) §1.

### 2. Hand-rolled, no-new-runtime-deps architecture

- **Decided:** everything is hand-rolled on react/react-dom. Exactly **one
  runtime library was ever added**: `lz-string` (see §15). The `@fontsource/*`
  packages are self-hosted font *assets* forced by the CSP's `font-src 'self'`
  (tech-debt F8), not runtime code.
- **Why:** small auditable surface for a static single-page product; no
  framework churn; every behaviour in the repo is debuggable to its source. The
  bugs this app actually hit (quota, CORS caching, Safari clipboard) were all
  solved in ~50-line hand-rolled units.
- **Do not:** add a runtime dependency without explicit owner sign-off. Neither
  lz-string nor `@fontsource` is precedent — one had a written justification,
  the other isn't code.

### 3. `public/og-image.png` still shows the old branding

- **Decided:** shipped the rename without re-rendering the OG artwork; the
  `og:image` meta tags already point at `https://manachart.app/og-image.png`.
- **Why:** producing a 1200×630 image is an asset task that didn't fit the
  rename PR. Tracked as the repo's only TODO (tech-debt A1,
  [index.html:23](../index.html#L23)).
- **Do not:** treat the meta *tags* as stale — they're correct; only the artwork
  needs replacing.

### 4. Phase 3 touch + Phase 4 mobile: built, pending real-device validation

- **Decided:** ship the touch drag and responsive re-tier jsdom-tested, with the
  hardware pass deferred to an owner session (tech-debt B2).
- **Why:** jsdom can't exercise real gestures, Safari toolbars, or notches.
  Scripts are committed ([phase-4-device-test.md](phase-4-device-test.md), the
  Phase 3 matrix in PR #6, `npm run test:layout`), and every feel tunable is a
  named constant: `LONG_PRESS_MS = 400` / `TOUCH_SLOP_PX = 10`
  ([usePointerDrag.ts:46-47](../src/interaction/usePointerDrag.ts#L46-L47)),
  `LAYOUT_BREAKPOINT_PX = 900`
  ([useLayoutMode.ts:13](../src/hooks/useLayoutMode.ts#L13)).
- **Do not:** treat a green suite as device validation, or retune the constants
  without device evidence — they were staged specifically so the owner pass is
  one-line changes.

### 5. Grid shrink recompacts instead of blocking

- **Decided:** shrinking the grid collects all cards in visual order and re-lays
  them into the smaller grid (adjudicated in `phase-22.5-findings.md` bucket D).
- **Why:** recompaction preserves every card; blocking would force users to
  manually clear cells before resizing. Shrink is still prevented when it would
  actually drop cards or orphan a hero.
- **Rejected:** position-preserving shrink that blocks on any occupied
  out-of-bounds cell (an earlier ARCHITECTURE.md described this; it was never
  the shipped behaviour).
- **Do not:** "fix" recompaction back to blocking. Known wrinkle: the occupancy
  half of the guard lives in the Stepper predicates, not the mutation — a new
  caller must add it (tech-debt C1).

### 6. ⚠️ Per-cell overlay buttons (×, ⇄, ↺) are `aria-hidden` + `tabIndex={-1}` — ON PURPOSE

**This is the log's biggest "fix it into a regression" bait.** Any accessibility
audit, linter, or well-meaning session will flag hidden interactive buttons.
**They are correct as-is.**

- **Decided (brief §3.6):** the per-cell overlay buttons are pointer
  *accelerators*, deliberately removed from the tab order and the accessibility
  tree, revealed on `:hover` **and** `.cellSelected`.
- **Why:** the interaction invariant (§3.1, quoted in CLAUDE.md) says every
  capability must be reachable from **selection + a visible control + a keyboard
  path** — and it is: every action the buttons offer exists on the Selected-card
  surface and via keyboard (Delete clears, Space moves, context menu via
  Shift+F10). Putting the buttons in the tab order would create duplicate tab
  stops for capabilities that already have canonical homes and re-create the
  nested-interactive-inside-gridcell problem the overhaul removed.
- **Rejected:** focusable in-cell buttons (pre-overhaul model — invisible to
  touch, nested-interactive a11y hazard); removing the buttons entirely (§7.2
  sub-decision: the owner kept them for one-click speed).
- **Do not:** add `tabIndex={0}`, remove `aria-hidden`, or otherwise "repair"
  them. If an audit flags them, verify the *baseline* paths still work instead —
  that's the invariant that matters. The one real gap in the invariant is crop
  repositioning (tech-debt C8, see §14), not these buttons.

### 7. BottomSheet is deliberately non-modal

- **Decided (§7.1b ergonomics):** the drawer-mode Selected-card sheet has no
  focus trap, no backdrop, no `inert` — the grid stays visible and interactive,
  and selecting another cell retargets the sheet in place.
- **Why:** the sheet is a *companion* to grid interaction, not an interruption;
  select → act → select next is the core loop and must not require dismissal.
  It is the intentional opposite of `Dialog`.
- **Do not:** make BottomSheet a Dialog consumer, add a backdrop/trap, or file
  its non-modality as an a11y bug. It's in the "one modal primitive" rule (§28)
  as the named exception.

### 8. Search→grid drag is a desktop-only accelerator

- **Decided (§7.4):** search results are pointer-drag sources on desktop;
  there is no touch path for dragging a result to a cell. Tap-to-fill with
  select-then-fill targeting is the touch path.
- **Why:** in drawer mode the search panel covers the grid, so a touch drag has
  nowhere visible to land; tap-to-fill already covers targeting completely.
- **Rejected:** retiring search-drag entirely (owner kept the desktop ritual;
  offered as cuttable in §7.4); building a touch search-drag (would need a
  panel-dismissing gesture choreography for marginal value).
- **Do not:** "fix" search-drag on touch. Its absence is the design.

### 9. Supabase and 300 DPI export: dropped — do not build

- **Decided:** no backend/accounts/cloud sync ever (localStorage + share links
  cover save and share); no true print-resolution export (not worth
  tile-and-stitch complexity for a screen-share artifact).
- **Why:** every failure mode the app actually hit was solved client-side; a
  backend converts a zero-maintenance static site into an operated service.
  Re-affirmed by the audit (R6) after reviewing real failure history.
- **Do not:** re-propose either without new evidence. The one sanctioned
  server-side contingency is a single Vercel CORS proxy *if Scryfall tightens
  CORS* (ARCHITECTURE, "CORS & Export Strategy").

### 10. No Scryfall query cache; printings refetch per open

- **Decided:** search results and printings are fetched fresh; the
  PrintingSwitcher refetches on every open, bounded by pagination (5-page cap +
  `truncated` flag, 100ms inter-page delay).
- **Why:** cache invalidation and memory for a rarely-reopened modal isn't worth
  it; the browser HTTP cache already absorbs repeats; the pagination bound keeps
  the worst case polite (tech-debt G3).
- **Do not:** add a cache layer as a drive-by "optimization" — measure a real
  user-felt cost first.

### 11. Sequential, rate-limit-polite network pacing

- **Decided:** import fetches ~1 card/100ms with one 429 retry; reconstruction
  posts 75-id chunks with 100ms gaps and bounded `Retry-After` backoff (3
  retries, 1500ms default); printings pages have 100ms delays and a 5-page cap;
  export prefetches blobs one at a time.
- **Why:** **politeness, not naivety.** Scryfall is a free community API and its
  guidelines ask for it; parallelizing trades goodwill for seconds on rare
  operations. A 100-card import being slow is by design.
- **Do not:** parallelize these paths or strip the delays. Constants live in
  [reconstruct.ts:32-35](../src/utils/reconstruct.ts#L32-L35) and
  `scryfall.ts`/`useImport.ts`.

### 12. Interim reduced-motion `!important` sweep

- **Decided:** a global `* { transition-duration: 0.01ms !important }` block
  under `prefers-reduced-motion` ([src/index.css:65](../src/index.css#L65)),
  explicitly labeled interim.
- **Why:** shipped early (Phase 0) so reduced-motion users weren't waiting on
  Phase 5's motion-token migration — which then never ran (tech-debt B1).
- **Do not:** delete the sweep without doing the token migration, and don't
  clean it up "because it's a sledgehammer" — it is one, knowingly. New motion
  should expect it to exist.

### 13. jsdom accommodations live in prod code on purpose

- **Decided:** `useLayoutMode` reads `window.matchMedia` per call (absent →
  `docked`); pointer capture/release are throw-safe; vitest runs `node` env by
  default with per-file `// @vitest-environment jsdom` pragmas (tech-debt
  F7/F10).
- **Why:** the accommodations cost nothing at runtime and make the harness able
  to stub platform APIs without module mocks. Node-default keeps the pure-logic
  majority of the suite fast.
- **Do not:** cache the `matchMedia` lookup, remove the capture try/catches, or
  flip the default test environment to jsdom. Each is commented at its site.

### 14. Crop editor's bespoke pointer handler — deliberate keep, *weakly held*

- **Decided:** the crop preview drag keeps its own pointerdown/window-listener
  implementation ([SelectedCard/index.tsx:28](../src/components/SelectedCard/index.tsx#L28))
  instead of the shared `usePointerDrag` engine.
- **Why:** the crop gesture needs **immediate** arming on touch
  (`touch-action: none`, no long-press) and the shared engine has no
  immediate-arm mode; growing the engine an option for one consumer was a bigger
  diff than keeping the bespoke handler (tech-debt D3 — rationale reconstructed,
  hence "weakly held").
- **Do not:** touch the crop editor without doing tech-debt **C8 (keyboard
  nudges) + D3 (re-base onto `usePointerDrag` with an `arm: 'immediate'`
  option) together** — C8 is the one standing exception to the §3.1 interaction
  invariant, and fixing either alone leaves the other stranded. Don't add a
  second bespoke pointer handler anywhere.

---

## Architecture decisions and their rejected alternatives

### 15. Share links: compact URL payload + async Scryfall reconstruction

- **Decided (Phase 20):** encode only identity + non-default state
  (`{v, c, s}` with `ShareSlotStub {id, f?, x?, y?, z?}`), lz-string-compressed
  into `?c=`; slots are rebuilt at open time by batching
  `POST /cards/collection`. Full spec: [contracts.md](contracts.md) §2.
- **Why:** links must scale to 100+ cards and live forever in chat logs with no
  server to consult. Everything reconstructable by `scryfallId` is dead weight
  in the URL.
- **Rejected:**
  - *Full-chart base64 JSON* (Phase 16 — shipped, then superseded): nine cards
    already made a multi-KB URL. Survives as the legacy decode path, kept
    forever.
  - *Server-side short links:* needs a backend (§9).
  - *Encoding `imageUris`/card metadata:* refetchable by id; would also freeze
    stale CDN URLs into links.
  - lz-string is the **one runtime library ever added** — MIT, zero transitive
    deps, ~3KB, purpose-built for URL-safe JSON compression (§2).
- **Do not:** change the codec without a `v` bump; the tolerance/validation
  rules are in contracts.md §4.

### 16. Local-first: localStorage, no accounts, no sync

- **Decided:** all user data lives in the browser (`useCharts`), share links are
  the portability mechanism, exports are the artifact.
- **Why:** the product is single-user artifact generation; a backend adds
  operation, auth, and privacy surface for a hobby-scale tool (§9).
- **Rejected:** Supabase (§9); *IndexedDB for custom images* (audit I11) —
  conditional, only if storage-full reports actually occur; the quota banner
  (`safeWrite` degradation) already handles overflow gracefully.
- **Consequences accepted:** ~5MB quota shared with data-URL custom images;
  debounced writes can lose the last 300ms on a hard crash; two-key write is
  non-atomic (tech-debt G4). All adjudicated acceptable.

### 17. Hand-rolled pointer engine; Pointer Events only

- **Decided (overhaul Phase 3):** one shared engine
  ([usePointerDrag.ts](../src/interaction/usePointerDrag.ts)) — slop-arming for
  mouse/pen, ~400ms still-finger long-press for touch (scroll wins if the finger
  moves first), capture at arm, scoped non-passive `touchmove` suppression
  (tech-debt F6), Escape aborts.
- **Why:** the make-or-break mechanic was touch drag-vs-scroll discrimination
  (brief §5, top risk); owning the engine made the discrimination rules and
  tunables exact.
- **Rejected:**
  - *HTML5 drag-and-drop* — shipped in Phase 10, **deleted wholesale**: no touch
    support, engine-styled ghosts, stringly `dataTransfer` payloads.
  - *dnd-kit / any drag library* — runtime dep (§2) and generic abstractions
    where the product needed one very specific gesture policy.
  - *Immediate touch arming* — steals scroll; long-press arming is the
    discrimination mechanism.
- **Do not:** reintroduce any `draggable`/`onDragStart` code path; route new
  gestures through the shared engine (the crop editor is the one tracked
  exception, §14).

### 18. Selection-first interaction grammar

- **Decided (brief §3.1/§3.7):** any input selects a cell; the selection has a
  canonical action surface (SelectedCard sidebar section / BottomSheet); move
  and crop are operations on the selection; hover, right-click, and drag are
  accelerators **over** that baseline, never the baseline. A pure move machine
  (`moveMachine.ts`) unifies keyboard grab, tap-move, and drag, so every commit
  fires the same domain callbacks (one move = one undo entry).
- **Why:** the pre-overhaul model hid core capabilities behind hover and
  right-click — invisible on touch, unreachable by keyboard (audit F9). One
  grammar for three input worlds beats three parallel feature sets.
- **Rejected:** *hover/context-menu as primary affordances* (the old model);
  *modal edit modes*; *drag as the only move path*.
- **Do not:** ship any capability reachable only via hover, right-click, or
  drag. The invariant is in CLAUDE.md verbatim; its one standing exception is
  crop repositioning (C8, §14) — do not add a second.

### 19. One ~900px breakpoint, one constant, test-enforced

- **Decided (§2.a/§7.6):** a single docked↔drawer breakpoint,
  `LAYOUT_BREAKPOINT_PX = 900`, living **only** in `useLayoutMode.ts`; App
  stamps `data-layout` on the root; all mode-dependent CSS selects on it.
  `layoutContract.test.ts` fails any stylesheet width media query and any
  viewport unit / `clamp()` in grid sizing (container-driven `min(100%, 900px)`
  instead).
- **Why:** the pre-overhaul stopgap had per-component 768px media queries that
  drifted independently. One constant + attribute selection means the
  breakpoint is retunable in one line (staged for the device pass, §4). 900
  rather than 768 because a docked 260px sidebar cramps the canvas at
  769–900px; tablet portrait is better served by drawer + full-width canvas.
- **Rejected:** *multiple responsive tiers* (nothing needed a second line);
  *keeping tablets docked with a slimmer ~220px sidebar* (§7.6 alternative —
  owner picked the drawer); *viewport-unit grid sizing* (couples canvas to
  viewport; broke export determinism once already, audit F2).
- **Do not:** add a width media query anywhere (the test will catch you), or a
  second breakpoint constant.

### 20. Drawer-mode IA: split surfaces (owner decision §7.1b)

- **Decided:** in drawer mode, chart-level settings + search live in the drawer;
  the Selected-card surface renders in the non-modal BottomSheet (§7).
- **Why:** acting on a selection must not require opening a drawer *over* the
  thing selected; the sheet is thumb-reachable and keeps the grid visible.
- **Rejected:** §7.1a *one drawer with everything* (cheapest, but select→act
  buries the grid); §7.1c *full bottom-sheet IA* (most native feel, most work,
  drag-handle sheets bring their own gesture conflicts — explicitly out of
  scope).

### 21. Chart deletion confirms via dialog (owner decision §7.3a)

- **Decided:** `deleteChart` fronts with a `ConfirmDialog`, as do clear-cards
  and layout change.
- **Why:** chart deletion is the app's **only unrecoverable destructive action**
  (undo is per-chart and session-only — tech-debt G6), so it gets the app's
  strongest protection.
- **Rejected:** §7.3b *undo-toast* ("Chart deleted — Undo", ~6s) — better feel
  but requires toast infrastructure and holding deleted charts in memory;
  revisit only if a toast surface exists for other reasons. §7.3c *status quo*
  (instant, hover-hidden delete) — rejected outright.
- **Do not:** use `window.confirm` (deleted from the codebase), or make
  deletion instant.

### 22. Undo/redo lives in `App.tsx`, above `useCharts`, session-only

- **Decided:** a per-chart `{past, future}` stack in App wrapping `updateChart`;
  only content mutations push history; bursts of same-field edits coalesce
  (title typing, crop drags = one entry each); 50-entry cap; never persisted.
- **Why:** history is a *session* concept — persisting it would multiply quota
  pressure and create a schema surface for no user demand. Keeping it above
  `useCharts` keeps the store dumb: chart CRUD, image-cache refreshes, and
  reconstruction must not create undo entries, and the wrapper is where that
  distinction is legible.
- **Rejected:** history inside `useCharts` (entangles persistence with history
  policy); persisted history; per-op undo without coalescing (a crop drag would
  be 60 entries).
- **Do not:** route a mutation around the wrapper if users would expect to undo
  it; check tech-debt C2 before adding any *async* history-tracked mutation.

### 23. Selection follows focus in the grid

- **Decided (§2.c):** arrow-key movement selects, exactly as click does; the
  grid is one tab stop (roving tabindex); focus and selection are still two
  *visually distinct* states (`--focus-ring` vs gold selection — §7.5
  constraint).
- **Why:** one mental model — "the cell I'm on is the cell the app is about";
  the crop/action panel retargets as you arrow around, same as tapping around.
- **Rejected:** *focus moves, Space selects* (two-state model pointer users
  don't have). Noted in the brief as cheap to flip (~20 lines, isolated in the
  hook) if retargeting ever feels noisy in practice — that's the sanctioned
  revisit path.

### 24. CellMap is derived at render, never persisted; hero-ness belongs to positions

- **Decided:** `generateCellMap` is the single seam between layout and
  rendering; `covered` cells render `null` and carry a derived `heroSlotIndex`
  back-pointer; nothing derived is persisted (no schema impact). Moving a card
  out of a hero cell moves the card; the *position* stays hero.
- **Why:** persisted derived state can go stale against its inputs; deriving at
  render makes crafted/legacy charts render deterministically
  (last-wins/covered-beats-hero semantics in `cellMap.ts`).
- **Rejected:** hero-ness on slot *contents* (a moved card would drag its
  hero-ness along — wrong model); persisting the cell map.
- **Do not:** let any consumer compute positions itself, or forget to filter
  `kind !== 'covered'` (drop targets, next-empty, capacity, numbering all do).

### 25. `slots` is a sparse, visual-cell-indexed array

- **Decided (MVP-era):** a card's array index *is* its board position;
  `slots: []` default; holes are `null`; out-of-bounds reads are `undefined`,
  hence the `getSlot()` rule.
- **Why:** the product is a collage — position is identity. A dense list +
  position map would be two structures to keep consistent for zero gain.
- **Do not:** read `chart.slots[i]` directly (use `getSlot`), or "normalize" the
  sparseness away. The index semantics are baked into share links (`s` array),
  import placement, sort, and export.

### 26. Export is client-side canvas, geometry from config only

- **Decided:** exports render on a client canvas; every dimension derives from
  chart config through pure functions in `exportGeometry.ts` — never from the
  live DOM/viewport. Target-resolution sizing with per-platform pixel budgets
  (desktop per-side / iOS area cap), graceful 1× downgrade, per-cell skip on
  image failure.
- **Why:** reproducibility — the same chart must export identically on every
  device. The DOM-measured version shipped once and produced 754px phone
  exports vs 1864px desktop from the same chart (audit F2); that class of bug is
  why the geometry is pure and unit-tested.
- **Rejected:** *server-side rendering* (§9); *DOM measurement* (the F2 bug);
  *300 DPI tiling* (§9). Sidebar text measurement is the one accepted
  non-determinism (tech-debt G2).
- **Do not:** feed anything viewport-derived into export sizing; keep preflight
  and allocation flowing through `exportPixelDims` (contracts.md §3).

### 27. `artCrop` is the only rendered and exported image

- **Decided:** every surface renders the landscape art-box crop; `normal` is
  stored per face but never rendered (tech-debt G1).
- **Why:** `normal`/`large` are full portrait cards — cover-crop math on them
  centers on the text box, not the art. Low-res interpolation on big cells is
  the accepted tradeoff.
- **Rejected:** client-side upscaling (audit R3 — bundle bloat to compensate an
  accepted tradeoff). `normal` is retained precisely so a future *manual
  framing* feature needs no schema change — that's the sanctioned quality lever.

### 28. One modal primitive (`Dialog`), with named non-consumers

- **Decided:** every modal goes through `components/Dialog/` (portal, backdrop,
  `inert` on the app root, Escape, focus restore with disabled-opener fallback).
  `ConfirmDialog` fronts all destructive actions. `ContextMenu` is a lighter
  `role=menu` primitive and offers **nothing that isn't on the selection
  surface**; `BottomSheet` is deliberately not modal (§7).
- **Why:** focus containment and restore are exactly the code you don't want
  five slightly-different copies of; hand-rolled per §2 with `inert` doing the
  heavy lifting.
- **Do not:** build an overlay outside these three primitives, or promote
  ContextMenu beyond accelerator status. Escape precedence across them is an
  implicit stack — see tech-debt C4 before adding a global key listener.

### 29. `updateChart` takes an updater function, never a chart object

- **Decided:** `updateChart((prev: Chart) => Chart)`; the updater runs against
  the freshest state inside the reducer; returning the same reference is a
  guaranteed no-op (no re-render, no write).
- **Why:** callers holding a render-time chart snapshot would silently clobber
  concurrent mutations (bursts, reconstruction fills, image-cache refreshes);
  the updater form makes lost-update bugs unrepresentable, and the
  reference-equality bail-out is what no-op guards lean on.
- **Do not:** add a plain-object overload "for convenience", or return a
  mutated `prev` (reference equality is the no-op signal).

### 30. Hand-rolled test harness; node-default environment

- **Decided:** `src/__tests__/harness.tsx` renders App/components and dispatches
  real `KeyboardEvent`/`PointerEvent`s; no testing-library. vitest runs `node`
  env by default; DOM tests opt in per file (§13). `layoutContract.test.ts`
  reads stylesheets from disk (vitest stubs CSS imports).
- **Why:** the suite's bulk is pure logic (geometry, nav, machines, codecs) that
  wants no DOM at all; the behavioural tests assert *domain outcomes* (slots
  moved, history depth), which the thin harness does without a dependency (§2).
- **Do not:** add testing-library, or write DOM tests that assert internal
  structure — assertions may move, never disappear (brief §6 rule).

### 31. Cells are `<img>` with `object-fit: cover`, keyed by `slotIndex`

- **Decided:** grid cells render real `<img>` elements (never CSS
  `background-image`), with `objectPosition`/`transform` carrying the crop
  fields, React keys = `cell.slotIndex`, and `crossOrigin="anonymous"` on every
  Scryfall art image everywhere in the app.
- **Why:** the `<img>` + cover model is the same math the export's
  `coverCropRect` implements — preview↔export parity by construction;
  `slotIndex` keys keep DOM identity stable across data changes;
  `crossOrigin` keeps the whole app sharing one CORS-usable HTTP cache entry
  with the export's `fetch(mode: 'cors')` (tech-debt F5 — load-bearing, not
  test-enforced).
- **Do not:** switch a cell to `background-image`, key by array position, or
  drop `crossOrigin` from any art `<img>` — each silently breaks export
  (cold-cache failures or crop drift).
