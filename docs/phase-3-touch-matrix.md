> Source: [PR #6](https://github.com/JakebGutierrez/manachart/pull/6) description, `JakebGutierrez/manachart` — preserved in-repo so this survives without GitHub access. The touch slice itself landed as checkpoint 2, commit `24ca4e5` ("Real-phone feel pass still required"), whose detail lives in that commit message.

**Review checkpoint #1 of Phase 3.** This is the de-risked core of pointer-unified movement — the pure state machine, keyboard grab/move, mouse drag, and search→grid pointer drag — with **all HTML5 drag-and-drop deleted**. Per the agreed de-risk order, the **touch gesture (long-press arming + non-passive scroll suppression) is deliberately NOT in this PR** — it's the next slice and needs real-device testing.

## What's here

**Pure state machine** — `src/interaction/moveMachine.ts`: a plain reducer over `idle / pressed / dragging / moveArmed` with no DOM and no side effects. Commits are performed by the caller reading state and firing the **existing** App domain callbacks, then dispatching `RESET`. Exhaustively unit-tested (`moveMachine.test.ts`).

**Pointer engine** — `src/interaction/usePointerDrag.ts`: capture, slop, window listeners, unmount cleanup; a generic per-drag context snapshot taken at pointerdown (React nulls `currentTarget` afterward). **Mouse/pen only in this checkpoint** — touch pointerdowns are ignored so page scroll and tap-to-select are untouched.

**App orchestration** — App owns the machine (it's the shared parent of the grid, the search panel, and the Selected-card *Move* button): drag payload, a portal `DragGhost` positioned imperatively (no per-move render), `elementFromPoint` hit-testing, and `commit / cancel / grab / retarget` wired to `onSlotMove` / `onSlotFillAtIndex`. **One move = one undo entry** (identical callbacks to the old drop path). Move state resets on chart switch/create/duplicate/delete and undo/redo.

**Grid** — all HTML5 DnD (`draggable`, `onDragStart/Over/Leave/Drop/End`, `dataTransfer`, `dragFromRef`) deleted. Cells are pointer-drag sources; source is dimmed, drop target gets a dashed cue. Keyboard: **Space = grab** a filled cell, arrows retarget, **Enter/Space commit**, **Escape cancels**; focus leaving the grid cancels an armed move. Selection/ARIA/roving-tabindex from Phase 2 preserved.

**SearchPanel** — results are pointer-drag sources carrying a typed `Slot` (no `dataTransfer` JSON round-trip); tap-to-fill unchanged.

**ControlPanel** — the Selected-card **Move** action is live (arms move mode; relabels to *Cancel move*; arming from the button pulls focus onto the source cell so arrows work).

## Decisions applied (your calls)
- Long-press arming **400ms** — belongs to the touch slice; not in this PR yet.
- Arming cue **subtle lift/scale** — touch slice.
- **Search→grid drag kept** on desktop (pointer-based).

## Not regressed
Cell `<img>` + `object-fit: cover` + crop styles + `slotIndex` keys + covered→`null` intact; export/share/schema untouched (export builds from geometry). Selection lifecycle and crop history preserved.

## Gate
build ✅ · lint ✅ · **307 tests** ✅ (+ moveMachine unit suite, + gridMove behavioural suite: mouse swap / drop-on-empty / off-grid no-op / sub-slop-is-a-click / ghost lifecycle / keyboard grab→arrow→commit / Escape-cancel / Move-button arm / armed tap-to-commit).

## What a human should verify before I build the touch slice
- **Mouse:** drag cell↔cell (swap) and search→grid; drop off-grid = no-op; a plain click still selects.
- **Keyboard only:** arrow to a card, Space to grab, arrows to a target, Enter to drop; Escape mid-grab cancels; undo after a move = exactly one step.
- The *Move* button arms, focus lands on the card, arrows+Enter complete it.
- Touch is intentionally unchanged here (scroll + tap-to-select/fill still work; no drag yet).

Stopping here for review — **not** starting the touch gesture until this is signed off.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
