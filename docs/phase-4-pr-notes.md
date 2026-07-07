> Source: [PR #7](https://github.com/JakebGutierrez/manachart/pull/7) description, `JakebGutierrez/manachart` — preserved in-repo so this survives without GitHub access. The owner-facing device-test checklist is a separate doc, [phase-4-device-test.md](phase-4-device-test.md).

Implements brief §2.a with the locked owner decisions §7.1(b), §7.3(a), §7.6. Independent of Phase 3 (#6) — branched off main, movement engine untouched.

## What changed

**One breakpoint, one place (§7.6).** `useLayoutMode(): 'docked' | 'drawer'` (`src/hooks/useLayoutMode.ts`) holds `LAYOUT_BREAKPOINT_PX = 900` — the only place the breakpoint exists. One `matchMedia` listener; App stamps `data-layout="docked|drawer"` on the app root. The three 768px media-query sites (App.css, ControlPanel.module.css, Grid.module.css) now select on `[data-layout='drawer']`. Tablet portrait gets the drawer + full-width canvas.

**Container-driven grid sizing.** The canvas column flexes (`width: 100%; max-width: 900px`) and the grid fills it with `width: min(100%, 900px)`. The `70vw`/`92vw` viewport sizing and the 400px floor are gone; vertical scroll for tall charts is kept. Verified in headless Chrome at 500/768/899/900/1280/1920: no horizontal overflow anywhere; drawer→docked flips exactly at 900. *Deliberate delta:* the 900px cap now lands on the chart canvas (grid + chart padding share it), so at wide widths the grid is 900 − 2×padding (868 at default padding) instead of exactly 900 — the canvas still hugs the chart.

**Drawer semantics (behavior fixes).** Closed drawer is `inert` + `visibility: hidden` with `transition: transform .25s, visibility 0s .25s` (slide-out still shows) — its controls finally leave the tab order and AT tree. Escape closes (deferring to any open dialog); focus moves into the panel on open and back to the toggle on close; backdrop click still closes; crossing into docked dissolves the drawer without reopening later.

**Bottom sheet (§7.1b).** The Phase 2 Selected-card surface is extracted to `src/components/SelectedCard/` — the same component, not a fork — and in drawer mode renders inside a fixed, safe-area-padded, non-modal `BottomSheet` (appears on selecting a filled cell, dismissable, grid stays live behind it; `max-height: 60dvh`). The drawer keeps chart settings + search; docked mode keeps the surface in the panel. Select-then-fill on phones is unchanged (empty-cell selection shows no sheet).

**Safe areas.** `viewport-fit=cover` on the viewport meta; `env(safe-area-inset-*)` on the menu toggle, drawer, grid area, and sheet.

**Chart delete confirms (§7.3a).** Reuses the Phase 1 ConfirmDialog (`Delete "Name"? This can't be undone.`); the picker's delete button is no longer hover-only — always visible on `hover: none` devices, plus a `:focus-visible` reveal.

## Testing

Gate green: build + lint + 314 tests (286 existing + 28 new).

New coverage: `useLayoutMode` unit tests (mode, live flip, single listener, jsdom fallback); app-level tests for data-layout stamping, drawer inert/focus/Escape/backdrop, sheet appears-on-selection/dismiss/remove, docked-vs-drawer surface placement, delete confirm/cancel; and a source-level layout contract test (no `768` in any stylesheet, no width media queries outside `prefers-reduced-motion`/`hover: none`, no viewport-derived grid sizing, `viewport-fit=cover` present).

What jsdom can't judge — real notch/safe-area, sheet thumb ergonomics, breakpoint feel on a physical tablet — is in the device-test script handed to the owner.

## Known conflict

Phase 3 (#6) also edits the Selected-card section in `ControlPanel/index.tsx` (the Move button area). Whichever lands second rebases: the section body now lives in `src/components/SelectedCard/index.tsx`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
