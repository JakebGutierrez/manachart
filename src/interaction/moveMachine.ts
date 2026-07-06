// The pure interaction state machine for card movement (Phase 3 spine).
//
// It is a plain reducer `(state, event) => state` with no DOM and no side
// effects — every *commit* (an actual card move/fill) is performed by the caller
// reading the current state and invoking the existing App domain callbacks, then
// dispatching RESET. Keeping the machine pure makes it exhaustively unit-testable
// and lets keyboard grab, tap-to-move, and pointer drag all share one grammar.
//
// States (from the brief §3.2):
//   idle      — nothing in flight
//   pressed   — a pointer is down on a filled cell but no drag yet (the touch
//               long-press timer lives here; wired in the touch slice)
//   dragging  — an active pointer drag (mouse/pen now; touch later), `over` is
//               the hit-tested destination or null
//   moveArmed — keyboard "grab" or tap-to-move; `over` is the destination cursor

export type MoveSource = 'cell' | 'search'

export type MoveState =
  | { kind: 'idle' }
  | { kind: 'pressed'; slotIndex: number; pointerId: number; startX: number; startY: number }
  | { kind: 'dragging'; from: number; source: MoveSource; over: number | null }
  | { kind: 'moveArmed'; from: number; over: number }

export type MoveEvent =
  // A pointer landed on a filled cell (touch slice uses this to start the
  // long-press timer; mouse/pen skip straight to DRAG_START via the hook's slop).
  | { type: 'POINTER_DOWN'; slotIndex: number; pointerId: number; x: number; y: number }
  // Slop crossed / search drag begun. `from` is the source slot for cell drags,
  // and an unused sentinel for search drags (the payload is held separately).
  | { type: 'DRAG_START'; from: number; source: MoveSource }
  | { type: 'DRAG_OVER'; over: number | null }
  // Keyboard grab or "Move" button / tap-to-move arming.
  | { type: 'GRAB'; from: number }
  | { type: 'RETARGET'; over: number }
  | { type: 'RESET' }

export const IDLE: MoveState = { kind: 'idle' }

export function moveReducer(state: MoveState, event: MoveEvent): MoveState {
  switch (event.type) {
    case 'POINTER_DOWN':
      // Only a fresh press from idle starts a candidate press.
      if (state.kind !== 'idle') return state
      return {
        kind: 'pressed',
        slotIndex: event.slotIndex,
        pointerId: event.pointerId,
        startX: event.x,
        startY: event.y,
      }

    case 'DRAG_START':
      // From idle (mouse/pen: the hook owns pre-slop) or pressed (touch path).
      if (state.kind !== 'idle' && state.kind !== 'pressed') return state
      return { kind: 'dragging', from: event.from, source: event.source, over: null }

    case 'DRAG_OVER':
      if (state.kind !== 'dragging') return state
      if (state.over === event.over) return state
      return { ...state, over: event.over }

    case 'GRAB':
      // Arming is only reachable from rest; over starts on the source cell.
      if (state.kind !== 'idle') return state
      return { kind: 'moveArmed', from: event.from, over: event.from }

    case 'RETARGET':
      if (state.kind !== 'moveArmed') return state
      if (state.over === event.over) return state
      return { ...state, over: event.over }

    case 'RESET':
      return IDLE

    default:
      return state
  }
}
