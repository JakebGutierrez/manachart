# Mana Chart — Roadmap & Status

One honest status doc, written July 2026 at handoff. Replaces
`Mana_Chart_Roadmap_Phase18plus.md` (now bannered as a historical record). Four
categories: **shipped**, **built pending device validation**, **scoped but not
built** (with the intended approach, so the sketch doesn't die with the session),
and **dropped — do not build**.

Engineering debt is *not* tracked here — that's [tech-debt.md](tech-debt.md).
Rationale for decisions is [decisions.md](decisions.md); compatibility rules are
[contracts.md](contracts.md).

---

## Shipped

| What | Where to look |
|---|---|
| Phases 1–17: scaffold → grid → search → style → export → persistence/multi-chart → undo/redo → square+crop → decklist import → commander/hero layout → sort+shuffle → share links → custom slots | ARCHITECTURE.md "Build-Phase Plans" (historical section) |
| Phase 18 — stabilisation + discoverability (green suite, labelled import, DFC flip, clear-cards) | `useImport.ts`, Grid overlay buttons |
| Phase 19 — Scryfall attribution (artist capture + strip, WotC/Scryfall disclaimer) | `Grid/index.tsx` artist strip, ControlPanel credits |
| Phase 20 — share-link compaction (compact codec + batch reconstruction) | [contracts.md](contracts.md) §2, `shareLink.ts`, `reconstruct.ts` |
| Phase 21 — fill interactions (empty-cell selection, select-then-fill) | `App.tsx` fill routing |
| Phase 22 — title fonts (5 self-hosted `@fontsource` families, allowlisted) | `main.tsx`, `ALLOWED_TITLE_FONTS` in `shareLink.ts` |
| Phase 22.5 — hardening (persistence safety, share resilience, decode hardening, import indexing, undo correctness, printings pagination, parser) | [phase-22.5-findings.md](phase-22.5-findings.md) (historical) |
| Audit remediation — CI, `vercel.json` CSP/headers, OG/meta tags, README, deterministic export geometry (`exportGeometry.ts`), self-hosted fonts | [audit-findings.md](audit-findings.md) (historical), `.github/workflows/ci.yml` |
| Shareability bundle — copy image to clipboard, Web Share, duplicate chart, search-syntax hint | `useExport.ts` disposals, `duplicateChart.ts`, SearchPanel |
| UI overhaul Phases 0–3 — quick wins, Dialog primitive, keyboard/selection spine, pointer-unified movement (HTML5 DnD deleted) | `ui-overhaul-brief.md` §3–§4, [phase-3-touch-matrix.md](phase-3-touch-matrix.md) (PR #6), `src/interaction/` |
| UI overhaul Phase 4 — responsive re-tier (docked/drawer, BottomSheet, safe areas, layout contract test) | [phase-4-pr-notes.md](phase-4-pr-notes.md) (PR #7), `useLayoutMode.ts`, `layoutContract.test.ts` |
| Rename → Mana Chart / manachart.app (code, copy, domain; **not** localStorage keys — [decisions.md](decisions.md) §1) | PR #8 |
| Handoff knowledge capture — tech-debt register, doc sync, decision log, contracts, this file | `docs/` |

## Built, pending real-device validation

Phase 3 touch and Phase 4 mobile are implemented and jsdom-tested; **feel and
hardware behaviour have not been validated on a device** (tech-debt B2,
[decisions.md](decisions.md) §4). The owner pass is ~30 minutes:

- Scripts: [phase-4-device-test.md](phase-4-device-test.md) (viewport walk +
  phone/tablet checklist), the Phase 3 touch matrix in
  [phase-3-touch-matrix.md](phase-3-touch-matrix.md) (PR #6; commit `24ca4e5`,
  "Real-phone feel pass still required"), and the headless probe
  `npm run test:layout` (needs local Chrome; not part of the gate).
- Staged tunables (anticipated fixes are one-line constant tweaks):
  - `LONG_PRESS_MS = 400`, `TOUCH_SLOP_PX = 10` —
    [usePointerDrag.ts:46-47](../src/interaction/usePointerDrag.ts#L46-L47)
  - `LAYOUT_BREAKPOINT_PX = 900` —
    [useLayoutMode.ts:13](../src/hooks/useLayoutMode.ts#L13)

## Scoped but not built

The intended approach is sketched per item — this is the part that isn't written
down anywhere else.

### Phase 5 — motion tokens (the one unbuilt overhaul phase)

Brief §2.e. Introduce `--dur-1`/`--dur-2` (+ an easing token) in `index.css`,
mechanically migrate every hardcoded `transition-duration` across the CSS modules
(0.1–0.25s today), then replace the interim reduced-motion `!important` sweep
([decisions.md](decisions.md) §12) with token zeroing under
`prefers-reduced-motion`, and run a motion audit of drawer/sheet/ghost (the
drawer close currently reads as a ~0.25s hold under reduced motion — noted in the
device script). **Optional, separately costed (§7.7b):** FLIP glide for
sort/shuffle/move — must measure DOM nodes by *card identity* across renders,
because React keys are positional (`slotIndex`) and must stay that way.

### Crop keyboard nudges + crop-editor re-base (tech-debt C8 + D3, one pass)

The one standing exception to the §3.1 interaction invariant. Do both together
([decisions.md](decisions.md) §14):

- **C8:** `onKeyDown` on the (focusable) crop preview — arrows nudge
  `cropX`/`cropY` by 1% (Shift = 5%) via the existing `onCropChange`, clamped to
  0–1; each nudge is a discrete history entry by design (brief §3.3).
- **D3:** add an `arm: 'immediate'` mode to `usePointerDrag` (skip the
  long-press, arm on pointerdown — the crop preview already has
  `touch-action: none`), then re-base the crop drag onto the shared engine and
  delete the bespoke pointerdown/window-listener implementation in
  `SelectedCard`.

### Phase 11 leftovers (planned pre-overhaul, never built)

- **Card count / capacity indicator:** pure derivation — filled = non-null
  `slots` entries, capacity = `chartCapacity(rows, cols, heroConfig)`; render
  "N / M" near the grid header or in the ControlPanel grid section. No schema
  change, no new state.
- **Cell numbering toggle:** a chart-level **optional** boolean (optional ⇒ no
  schema bump, per [contracts.md](contracts.md) §4). Numbering semantics already
  exist: follow `slotIndex` order, skipping covered cells (CLAUDE.md grid
  rules). Decide whether numbers appear in the export — if yes, it's a new
  preview↔export parity surface; draw them in both or neither.

### Freeform hero placement (needs design — from the original "later" list)

Promote/demote a cell to hero via the selection surface (respect the
selection-first grammar — no drag-only path), editing `heroConfig` with
`sanitizeHeroConfig` as the gate. **Precondition:** close tech-debt C1 first
(move the occupancy guard into the mutation) — hero changes alter capacity, and
the current guard only lives in the resize steppers. Decide demote behaviour
(recompact, mirroring shrink — [decisions.md](decisions.md) §5 — is the
consistent choice).

### Card languages (low priority, from the original "later" list)

Scryfall `lang:` in `buildSearchUrl` and the printings query. Only worth doing
if a user actually asks.

### Asset task: re-render `public/og-image.png`

Old branding baked into the artwork; tags already correct (tech-debt A1,
[decisions.md](decisions.md) §3). Produce a 1200×630 image, drop it in — no code.

### Ideas lane (conditional — from the audit, never re-adjudicated)

Act only when the stated condition is met; details in
[audit-findings.md](audit-findings.md) "Ideas & opportunities":

- **I5 paste-image (Cmd+V) for custom slots** — small, unconditional if wanted;
  label derivation ("Pasted image N") is the only design bit.
- **I6 deck-stats export footer** (curve/pips from stored sort fields) — opt-in,
  after design care; new parity surface.
- **I7 named export presets** — only if raw 1×/2× proves confusing.
- **I8 per-share OG images** (`@vercel/og` edge function) — only if share-link
  traffic justifies breaking the static-only stance.
- **I9 Vercel analytics** — owner comfort call.
- **I10 PWA manifest (no service worker)** — only after mobile is
  device-validated.
- **I11 IndexedDB for custom images** — only if storage-full reports actually
  occur.

## Dropped — do not build

| What | Why (one line) |
|---|---|
| Supabase / backend / accounts / cloud sync | Local-first covers save+share; a backend turns a zero-maintenance static site into an operated service ([decisions.md](decisions.md) §9, §16) |
| True 300 DPI / print-resolution export | Tile-and-stitch complexity for a screen-share artifact ([decisions.md](decisions.md) §9) |
| Moxfield/Archidekt URL import (audit R1) | Unofficial, CORS-blocked, ToS-grey APIs; the decklist paste path already accepts their text exports |
| Full offline PWA / service worker (R2) | Cache-invalidation debugging for an app whose core content (Scryfall art) is remote anyway |
| Client-side art upscaling (R3) | Bundle bloat to compensate an accepted tradeoff; `normal` URIs are the sanctioned future quality lever ([decisions.md](decisions.md) §27) |
| Light theme (R4) | Dark canvas is the product identity; per-chart background already covers light *exports* |
| Price / legality overlays (R5) | Rot instantly in a static shared image; fight the art-collage identity |
| HTML5 drag-and-drop, in any form | Deleted wholesale in overhaul Phase 3; Pointer Events only ([decisions.md](decisions.md) §17) |
