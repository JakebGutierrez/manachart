# Tech Debt & Known Issues Register

Written July 2026 during the handoff audit (post Phase 4 + rename, `main` green at
352 tests). This is a **register, not a work queue** — nothing here blocks anything,
and several entries are deliberate trade-offs that should *not* be "fixed" casually.
Each item: what it is, where it lives, why it's like that, risk if left, rough effort
(S < ½ day, M ½–2 days, L > 2 days).

Deliberate product/architecture decisions (old-brand localStorage keys, the
no-new-runtime-deps ethos, etc.) are **not** debt and live in the decision log
([decisions.md](decisions.md)), not here. Doc drift in `ARCHITECTURE.md`/`CLAUDE.md` is tracked by the audit findings,
not duplicated here.

---

## A. Tracked TODOs

### A1 — OG image artwork still shows old branding
- **What/where:** `public/og-image.png` has "MTG Chart" / mtgchart.com baked into the
  artwork. The only `TODO` marker in the repo ([index.html:23](../index.html#L23)).
  The `og:image`/`twitter:image` meta tags already point at
  `https://manachart.app/og-image.png` — only the artwork is stale, nothing is broken.
- **Why:** the rename phase covered code, copy, and domain; re-rendering a 1200×630
  image is an asset task that didn't fit that PR.
- **Risk:** social embeds show the old brand. No functional risk.
- **Effort:** S — produce the image, drop it in. No code changes.

---

## B. Deferred phase work

### B1 — Motion tokens (Phase 5) never ran; interim reduced-motion sledgehammer in place
- **What/where:** all transition durations are hardcoded per CSS rule (0.1–0.25s
  across modules); the planned `--dur-1`/`--dur-2` tokens (brief §2.e) don't exist.
  Reduced-motion is served by a global
  `* { transition-duration: 0.01ms !important }` sweep
  ([src/index.css:65](../src/index.css#L65)) explicitly labeled interim.
- **Why:** Phase 5 was the lowest-value phase and was never commissioned; the interim
  block shipped early (Phase 0) so `prefers-reduced-motion` users weren't left waiting.
- **Risk:** low. The `!important` sweep also flattens any *future* deliberate motion,
  and the drawer's close animation reads as a ~0.25s hold under reduced motion (noted
  in the device-test script). New motion added without tokens deepens the migration.
- **Effort:** M — mechanical token migration per the brief, then delete the sweep.

### B2 — Phase 3 touch + Phase 4 mobile: built, pending a real-device pass
- **What/where:** touch long-press drag (scroll-vs-drag discrimination) and the
  responsive re-tier (safe areas, drawer, bottom sheet) are implemented and
  jsdom-tested to the extent jsdom allows; **feel and hardware behaviour are not yet
  validated on a device**. Scripts are committed: [phase-4-device-test.md](phase-4-device-test.md)
  (owner session, ~15 min), the Phase 3 touch matrix in PR #6 / commit `24ca4e5`
  ("Real-phone feel pass still required"), and the headless probe `npm run test:layout`
  (needs local Chrome; not part of the gate).
- **Why:** jsdom cannot exercise real touch gestures, Safari toolbars, or notches.
- **Risk:** feel-level issues (accidental drag arms, scroll conflicts, safe-area
  collisions) unknown until hardware. Tunables are staged as named constants:
  `LONG_PRESS_MS`/`TOUCH_SLOP_PX` ([usePointerDrag.ts:46](../src/interaction/usePointerDrag.ts#L46)),
  `LAYOUT_BREAKPOINT_PX` ([useLayoutMode.ts:13](../src/hooks/useLayoutMode.ts#L13)).
- **Effort:** the pass itself is ~30 min; anticipated fixes are one-line constant tweaks.

---

## C. Fragile areas / works-by-reasoning

### C1 — Grid-shrink occupancy guard lives in the UI, not the mutation
- **What/where:** `handleGridResize` ([App.tsx:339](../src/App.tsx#L339)) guards
  range (1–10) and hero bounds but **not occupancy**; the "can't shrink below the
  card count" rule exists only as the Stepper `decrementDisabled` predicates in
  [ControlPanel/index.tsx:488](../src/components/ControlPanel/index.tsx#L488-L510).
- **Why:** the guard grew where the buttons were; shrink itself recompacts cards
  (deliberate — see decision log), so the handler never needed the check while the
  Stepper was its only caller.
- **Risk:** latent. A future caller (keyboard shortcut, command palette) could shrink
  below occupancy → `slots` longer than capacity → trailing cards invisible but
  persisted, then **silently truncated** by `sanitizeChartConfig` on next load
  ([sanitizeChart.ts:73](../src/utils/sanitizeChart.ts#L73)) — real data loss.
- **Effort:** S — enforce occupancy inside `handleGridResize` as well.

### C2 — Undo no-op detection uses the render-time chart
- **What/where:** `updateChartWithHistory` ([App.tsx:89](../src/App.tsx#L89-L104))
  decides whether to push a history snapshot by running the updater against the
  render-time `activeChart`, while the actual mutation re-runs it against the
  freshest `prev` inside the reducer.
- **Why:** detecting no-ops without double-dispatch. The code comment argues the two
  can't diverge today: the only async mutator (`handleSlotImageUpdate`) bypasses
  history and is never batched with user interactions.
- **Risk:** a future async/history-tracked mutation path breaks the assumption →
  missing or spurious undo entries. Correct-by-reasoning, not by construction.
- **Effort:** S–M — fold the no-op check into the same closure that mutates.

### C3 — Import loop isn't bound to chart identity
- **What/where:** `runLoop` in [useImport.ts](../src/hooks/useImport.ts) places cards
  at pre-assigned slot indices and does not cancel on chart changes. Protection is
  environmental: the import modal is modal, and undo/redo is blocked while it's open
  ([App.tsx:255](../src/App.tsx#L255-L262)).
- **Why:** per-run generation counters already handle reset/retry; chart identity
  never changes under the modal *today*.
- **Risk:** any future mutation that can fire during an import (share reconstruction
  settling, multi-window edits) lands cards in wrong slots on the wrong chart.
- **Effort:** M — capture chart id at begin, bail/cancel when it changes.

### C4 — Escape/keyboard precedence is an implicit stack
- **What/where:** four window-level `keydown` listeners coexist: App undo/redo,
  Dialog Escape, drawer Escape ([ControlPanel/index.tsx:401](../src/components/ControlPanel/index.tsx#L401-L410)),
  and the drag-abort Escape in `usePointerDrag` — plus element-scoped Escapes in the
  grid and bottom sheet. The drawer defers to open dialogs by DOM-sniffing
  `document.querySelector('[role="dialog"]')`.
- **Why:** each surface owns its dismissal; there is no central keymap and nothing
  has needed one.
- **Risk:** a new overlay or global shortcut can collide silently (e.g. an overlay
  that isn't `role="dialog"` won't be yielded to). Works today; every listener is
  individually guarded and tested.
- **Effort:** M to centralize; not worth it until a collision actually appears.

### C5 — Post-drag click suppression via zero-timeout flag
- **What/where:** a completed pointer drag can be followed by a synthetic `click`;
  the grid swallows exactly one via `suppressClickRef` cleared on a
  `setTimeout(…, 0)` ([Grid/index.tsx:61](../src/components/Grid/index.tsx#L61-L83)).
- **Why:** `pointerup` → `click` ordering is per-engine; the timeout guarantees an
  off-grid release (no trailing click) can't leave the flag stuck.
- **Risk:** an engine that dispatches the click after the task boundary would leak
  one stray re-select after a drag. None observed.
- **Effort:** leave as-is; revisit only if reported.

### C6 — SegmentedControl's deferred-refocus choreography
- **What/where:** arrow-key changes that open a ConfirmDialog (the Layout control)
  must not strand focus on an unchecked `tabIndex=-1` radio. The fix is a
  `pendingRefocus` ref resolved in a **passive** effect deliberately sequenced after
  Dialog's focus-restore ([ControlPanel/index.tsx:94](../src/components/ControlPanel/index.tsx#L94-L118),
  one of the repo's two `eslint-disable`s, both documented in place).
- **Why:** the alternative (eager focus) breaks when the change is cancelled.
- **Risk:** timing-coupled to Dialog's effect ordering — reordering Dialog internals
  can silently break arrow-key focus here. Test-covered, but the coupling is real.
- **Effort:** awareness item; no change recommended.

### C7 — Hero-layout preview↔export drift (two small geometry gaps)
- **What/where:**
  1. DOM hero cells compute `aspect-ratio` from spans only, **ignoring `cellGap`**
     — acknowledged inline ([Grid/index.tsx:285](../src/components/Grid/index.tsx#L285-L295)).
     The export computes span geometry exactly (`span·cell + (span−1)·gap`), so the
     on-screen hero is short by the gap it spans; divergence grows with the gap.
  2. Sidebar name grouping: the DOM sidebar gives every grid row a uniform track and
     puts a hero's name in its origin row ([NameDisplay/index.tsx:32](../src/components/NameDisplay/index.tsx#L32-L59));
     the export folds hero-spanned rows into one block centered over the span
     ([useExport.ts:354](../src/hooks/useExport.ts#L354-L414)). Same names, different
     vertical rhythm (Phase 22.5 finding B11, adjudicated cosmetic).
- **Why:** CSS `aspect-ratio` can't cheaply include the gap; the sidebar grouping
  divergence was judged not worth the export-side risk to fix at the time.
- **Risk:** "the PNG doesn't quite match the screen" reports for hybrid layouts with
  large gaps or sidebar names. Cosmetic; export itself is correct and deterministic.
- **Effort:** M each (calc()-based hero height; align DOM grouping with the export).

### C8 — Crop repositioning is the one remaining pointer-only capability
- **What/where:** the crop preview drag ([SelectedCard/index.tsx:43](../src/components/SelectedCard/index.tsx#L43))
  is the only way to change `cropX`/`cropY`. The brief (§3.3) planned keyboard
  parity — "arrows nudge crop by 1% (Shift = 5%) via `onCropChange`" — and it was
  never built. Zoom (native range slider) and Reset are keyboard-operable; position
  is not.
- **Why:** dropped somewhere between Phase 0's pointer conversion and Phase 3's
  slice list; nothing tracks it.
- **Risk:** keyboard-only users can zoom but not reframe. It also blocks adopting
  the brief's §3.1 anti-regression invariant ("no capability only behind drag")
  into CLAUDE.md verbatim — as written, crop-position currently violates it.
- **Effort:** S — an `onKeyDown` on the (focusable) preview calling `onCropChange`
  with clamped 1%/5% steps; each nudge is a discrete history entry by design.

---

## D. Duplication due a cleanup

### D1 — `LayoutMode` + `getLayoutMode` defined twice
- **Where:** [App.tsx:24](../src/App.tsx#L24-L36) and
  [ControlPanel/index.tsx:14](../src/components/ControlPanel/index.tsx#L14-L20).
- **Why:** avoiding a module for six lines. Drifts if the commander/partner presets
  ever change shape.
- **Risk:** low; the presets are stable. **Effort:** S.

### D2 — Numeric limits triplicated
- **Where:** `STYLE_LIMITS` ([App.tsx:38](../src/App.tsx#L38-L42)), the Stepper
  `min`/`max` literals in ControlPanel's Style section, and grid bounds again in
  [sanitizeChart.ts:4](../src/utils/sanitizeChart.ts#L4-L5) — three independent
  sources of truth for the same bounds.
- **Risk:** a future bounds change misses a site; the mutation-side clamps make that
  a UX oddity, not corruption. **Effort:** S (shared constants module).

### D3 — Two pointer-drag implementations
- **Where:** the shared engine ([src/interaction/usePointerDrag.ts](../src/interaction/usePointerDrag.ts))
  drives cell and search drags; the crop editor
  ([SelectedCard/index.tsx:28](../src/components/SelectedCard/index.tsx#L28-L98))
  carries its own bespoke pointerdown/window-listener/capture/slop implementation.
  The brief's Phase 3 plan said the Phase 0 crop conversion would be "re-based onto
  `usePointerDrag`"; it never was.
- **Why (reconstructed):** the crop gesture needs **immediate** arming on touch
  (`touch-action: none` on the preview, no long-press — [SelectedCard.module.css:62](../src/components/SelectedCard/SelectedCard.module.css#L62)),
  and `usePointerDrag` has no immediate-arm mode — touch always long-presses.
  Re-basing meant growing the shared engine an option for one consumer; keeping the
  bespoke handler was the smaller diff. Defensible, but it was never written down,
  and the two implementations duplicate capture/teardown/slop subtleties.
- **Risk:** a fix to the engine (e.g. a capture edge case like the F2 residual)
  doesn't automatically reach the crop editor, and vice versa.
- **Effort:** M — add `arm: 'immediate'` to `usePointerDrag` and re-base, per the
  original plan. Pairs naturally with C8 (keyboard nudges) in one crop-editor pass.

---

## E. Oversized files due a split

All cohesive, none urgent — split opportunistically when a phase touches them.
Tests drive behaviour, not file layout, so pure moves are cheap.

| File | Lines | Natural seams |
|---|---|---|
| [src/App.tsx](../src/App.tsx) | 949 | movement orchestration (~lines 543–660), confirm plumbing, notifications JSX |
| [src/components/ControlPanel/index.tsx](../src/components/ControlPanel/index.tsx) | 758 | `SegmentedControl` and `ChartPicker` into their own files |
| [src/hooks/useCharts.ts](../src/hooks/useCharts.ts) | 574 | share-reconstruction block (loadOrInit + effects) from CRUD/persistence |
| [src/hooks/useExport.ts](../src/hooks/useExport.ts) | 523 | canvas draw functions from the pipeline/disposals |
| [src/components/Grid/index.tsx](../src/components/Grid/index.tsx) | 450 | `renderCell` into a `Cell` component |

**Effort:** M each. **Risk of leaving:** review friction only.

---

## F. Platform quirks & workarounds (in place — keep them)

These are correct behaviour that *looks* odd. Each is commented at the call site;
this list exists so nobody "simplifies" one away.

- **F1 — Safari clipboard:** image copy must construct the **promise-form**
  `ClipboardItem` synchronously inside the user gesture; sync throws are converted
  to rejections and the orphaned blob promise gets a no-op catch
  ([useExport.ts:463](../src/hooks/useExport.ts#L463-L486)).
- **F2 — Safari download:** the object-URL revoke is deferred ~1s after `a.click()`
  or Safari intermittently aborts the download ([useExport.ts:93](../src/hooks/useExport.ts#L93-L102)).
- **F3 — Web Share transient activation:** a slow render can outlive the tap's
  activation window → share rejects (`NotAllowedError`) → falls back to a plain
  download rather than failing silently ([useExport.ts:488](../src/hooks/useExport.ts#L488-L509)).
- **F4 — iOS canvas budget + detection:** 3,000,000 px² area cap; iPads are detected
  via `MacIntel` + `maxTouchPoints` UA-sniff ([useExport.ts:136](../src/hooks/useExport.ts#L136-L138)).
  UA sniffing is inherently fragile; budgets are conservative on purpose.
- **F5 — CORS cache-keying invariant:** every art `<img>` (grid, crop preview,
  search results, printing thumbs) carries `crossOrigin="anonymous"` so all paths
  share one CORS-usable HTTP cache entry with the export's `fetch(mode:'cors')`
  ([Grid/index.tsx:311](../src/components/Grid/index.tsx#L311-L315), ARCHITECTURE
  "CORS handling"). Dropping the attribute anywhere reintroduces cold-cache export
  failures. **Not currently test-enforced** — a cheap source-contract test (grep all
  art `<img>` sites) would fence it. Effort: S.
- **F6 — Scoped non-passive `touchmove`:** during an armed touch drag only, a
  document-level non-passive listener `preventDefault()`s scrolling; attached at
  arm, removed on every terminal path ([usePointerDrag.ts:150](../src/interaction/usePointerDrag.ts#L150-L157)).
  This is the one sanctioned break of passive-listener discipline.
- **F7 — jsdom accommodations in prod code:** `useLayoutMode` reads
  `window.matchMedia` per call (so tests can stub it; absent → `docked`)
  ([useLayoutMode.ts:20](../src/hooks/useLayoutMode.ts#L20-L34)); pointer
  capture/release are throw-safe partly for jsdom. Cheap and documented.
- **F8 — CSP dev/prod divergence:** production ([vercel.json](../vercel.json)) pins
  `connect-src`/`img-src` to the two Scryfall hosts and `font-src 'self'` (why the
  title fonts are self-hosted via `@fontsource`). The dev server has **no CSP** — a
  new external resource works locally and silently breaks in prod. Any new origin
  must be added to `vercel.json` in the same PR.
- **F9 — Title font weight matching:** rendered titles ask for weight 600; Cinzel,
  Cormorant Garamond, and Comic Neue ship only 400/700, so the browser
  nearest-matches to 700 ([main.tsx](../src/main.tsx) comment). DOM and canvas
  export agree because both request 600. Awareness only.
- **F10 — Test environment split:** vitest runs in `node` by default
  ([vite.config.ts](../vite.config.ts)); DOM tests opt in per-file via
  `// @vitest-environment jsdom`. `layoutContract.test.ts` reads stylesheets **from
  disk** because vitest's CSS pipeline stubs imports; `node-shim.d.ts` types exactly
  the three node builtins used, because `tsconfig.app.json` deliberately omits
  `@types/node`. Non-obvious, all commented in place.

---

## G. Known limitations (deliberate — check [decisions.md](decisions.md) before "fixing")

- **G1 — `artCrop` is the only rendered/exported image.** Low-res interpolation on
  big cells (1×1, 2×2). `normal` is stored per face for a future manual-framing
  feature but never rendered. Documented in ARCHITECTURE.
- **G2 — Sidebar-mode exports are the one non-deterministic sizing path** —
  `ctx.measureText` feeds `innerW`, and text metrics vary slightly by platform
  ([exportGeometry.ts](../src/utils/exportGeometry.ts) header). Every other chart
  exports pixel-identically per platform.
- **G3 — Sequential, rate-limit-polite network patterns:** export prefetches blobs
  one at a time; import fetches ~1 card/100 ms with one 429 retry + user-facing
  Retry; printings pagination caps at 5 pages ≈ 875 printings with a "truncated"
  notice; reconstruction posts 75-id chunks with bounded Retry-After backoff. A
  100-card import is slow by design.
- **G4 — localStorage envelope:** the two-key write is non-atomic (worst case: wrong
  active chart on crash, never data loss — [useCharts.ts:14](../src/hooks/useCharts.ts#L14-L16));
  writes are debounced 300 ms with `pagehide`/`visibilitychange` flush (a hard crash
  inside the window can lose the last edit); custom images are stored as data URLs
  and can exhaust quota → `safeWrite` degrades to in-memory + a storage banner
  instead of crashing.
- **G5 — Share links cannot carry custom slots** — encoded as `null`, user notified
  at copy time with a count.
- **G6 — Undo is per-chart, session-only, capped at 50** entries; chart deletion is
  the app's only unrecoverable destructive action, which is why it confirms (§7.3a).

---

## H. Historical docs read as open findings

[docs/audit-findings.md](audit-findings.md) and
[docs/phase-22.5-findings.md](phase-22.5-findings.md) are dated session records.
Nearly everything in them has since been **fixed** (CI exists, export geometry is
DOM-free, quota handling, decode sanitization, printings pagination, keyboard grid,
dialog primitive, …), but neither file says so — a cold reader could re-litigate
solved problems or "re-fix" them differently.

- **Risk:** wasted future-session effort; contradictory guidance.
- **Status:** resolved in the same audit — both files now open with a
  historical-record banner pointing back here.
