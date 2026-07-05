import type { Slot } from '@/types/chart'
import type { MoveState } from './moveMachine'

// The move controller surface App exposes to the grid. The grid is a dumb driver
// of pointer/keyboard events into these; App owns the machine and the mutations.
export interface MoveApi {
  state: MoveState
  beginCellDrag: (from: number) => void
  dragMove: (x: number, y: number) => void
  dragEnd: (committed: boolean, x: number, y: number) => void
  grab: (from: number) => void
  retarget: (over: number) => void
  commit: (to: number | null) => void
  cancel: () => void
}

// The narrower surface the search panel needs to be a drag source.
export interface SearchDragApi {
  beginSearchDrag: (slot: Slot) => void
  dragMove: (x: number, y: number) => void
  dragEnd: (committed: boolean, x: number, y: number) => void
}
