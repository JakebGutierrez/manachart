# Phase 4 device-test script (owner session)

What the machine already checked: build/lint/tests green; data-layout
stamping, drawer inert/focus/Escape semantics, sheet-appears-on-selection,
delete-confirm, and the no-768/no-viewport-units source contract are all
test-enforced. The headless-Chrome overflow/flip check is committed as a
one-command probe — `npm run test:layout` (needs a local Chrome; not part of
the `npm test` gate) — asserting no horizontal overflow at
500/768/899/900/901/1280/1920 and the drawer↔docked flip at exactly 900,
against the real app.

What follows is the part only eyes and thumbs can judge. ~15 minutes.

## 1. Viewport walk (desktop browser, responsive mode)

Walk these widths with an empty chart AND a full 5×5 chart:
**320 → 390 → 768 → 899 → 900 → 901 → 1280 → 1920**

- [ ] 320/390: grid fills the width minus small margins; no horizontal
      scrollbar anywhere; cells not absurdly small on a 5-wide chart
      (if they are, that's a product call on max columns for phones — note it)
- [ ] 768 (tablet portrait): drawer mode — full-width canvas, hamburger
      top-left. Judge: does the drawer feel *better* than a squeezed 260px
      sidebar here? (§7.6 said yes; the constant is `LAYOUT_BREAKPOINT_PX`
      in `src/hooks/useLayoutMode.ts` if you want to retune)
- [ ] 899 → 900: single clean flip drawer→docked; nothing jumps twice,
      no flash of both hamburger and sidebar
- [ ] 1280/1920: sidebar docked; canvas centered, capped at 900px wide.
      Note the deliberate change: the 900 cap is now the *canvas* (chart
      background), so the grid inside is 900 minus 2× chart padding
      (868 at default 16). If you want the grid itself at exactly 900,
      say so — it's a one-line change with a small plumbing cost.
- [ ] With Names → Sidebar enabled at ~1000px: name sidebar visible,
      grid narrows to make room, no overflow

## 2. iPhone safe-area / notch (hardware or Xcode simulator)

Load the dev site on an iPhone with a notch/Dynamic Island, portrait AND
landscape:

- [ ] Hamburger button sits below the notch / inside the safe area,
      both orientations
- [ ] Open the drawer: its content isn't clipped by the notch (landscape:
      left inset) or the home indicator (bottom)
- [ ] Select a filled cell: bottom sheet's buttons clear the home indicator
      (padding should visibly exceed the indicator bar)
- [ ] Scroll the grid with the sheet open: page doesn't rubber-band weirdly;
      sheet stays put as Safari's toolbar collapses/expands (dvh check)

## 3. Closed drawer unreachable by Tab (the Phase 4 a11y fix)

Narrow window (drawer mode), drawer CLOSED, external keyboard or desktop:

- [ ] Tab repeatedly from the hamburger: focus goes into the GRID next —
      never into invisible search/settings controls (pre-Phase-4 bug)
- [ ] Open drawer with Enter on the hamburger: focus lands in the panel;
      Tab cycles its controls
- [ ] Escape: drawer closes, focus is back on the hamburger
- [ ] Reopen, click the backdrop: same — closed + focus on hamburger
- [ ] VoiceOver spot-check (optional): with drawer closed, swipe-right from
      the hamburger never announces drawer contents

## 4. Bottom sheet ergonomics (phone, one hand)

- [ ] Tap a filled cell: sheet slides in bottom; Remove / Switch printing /
      crop zoom all comfortably thumb-reachable
- [ ] Grid stays visible above the sheet; tapping another card retargets the
      sheet in place (no flicker/close-reopen)
- [ ] Crop-drag inside the sheet preview: pans the crop, does NOT scroll the
      page (touch-action check)
- [ ] Sheet max-height: on a small phone (SE-class), sheet content scrolls
      internally rather than covering the whole grid
- [ ] ✕ dismisses; selection ring on the cell clears
- [ ] Select-then-fill: tap an EMPTY cell (no sheet — correct), open drawer,
      search, tap a result → it lands in the selected cell

## 5. Delete confirm + touch affordance

- [ ] Phone: chart list shows the × delete button WITHOUT hover (visible
      outright); tapping it opens the confirm dialog; Cancel preserves
- [ ] Desktop: × still appears on row hover and on keyboard focus
- [ ] Confirm deletes; deleting the active chart activates a survivor

## 6. Must-not-regress spot checks

- [ ] Notification banner: trigger one (e.g. open a share link with bad data,
      or export warning) in BOTH modes — banner visible at the top of the
      grid area, dismissable, not hidden behind sheet/drawer
- [ ] Export PNG on a phone and on desktop: pixel output identical to a
      pre-Phase-4 export of the same chart (cell DOM untouched — this is a
      confirmation, not an expectation of change)
- [ ] Reduced motion (OS toggle): drawer/sheet appear without slide; closing
      drawer may hold ~0.25s before vanishing (visibility delay is exempt
      from the interim reduced-motion sweep — Phase 5 tokens will absorb it);
      flag if it reads as jank
- [ ] Desktop 1280: general once-over vs main — nothing else moved
