import type { CellMap } from '@/types/chart'

// Keys this module understands. Anything else returns the origin unchanged.
export type GridNavKey =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Home'
  | 'End'

// Resolve the slotIndex that "owns" a grid position: a covered cell resolves to
// its hero, a hero/slot cell to itself. Out-of-bounds positions return null.
function ownerAt(cellMap: CellMap, cols: number, row: number, col: number): number | null {
  const rows = cellMap.length / cols
  if (row < 0 || col < 0 || row >= rows || col >= cols) return null
  const cell = cellMap[row * cols + col]
  return cell.kind === 'covered' ? cell.heroSlotIndex : cell.slotIndex
}

// Find the canonical (top-left) grid position of a slotIndex: the array index of
// the slot/hero cell carrying it. Returns null if the index isn't present.
function positionOf(cellMap: CellMap, cols: number, slotIndex: number): { row: number; col: number } | null {
  for (let i = 0; i < cellMap.length; i++) {
    const cell = cellMap[i]
    if ((cell.kind === 'slot' || cell.kind === 'hero') && cell.slotIndex === slotIndex) {
      return { row: Math.floor(i / cols), col: i % cols }
    }
  }
  return null
}

/**
 * Pure keyboard navigation over a CellMap.
 *
 * Given the cell currently focused (`fromSlotIndex`) and an arrow/Home/End key,
 * returns the slotIndex to move to. Movement is CellMap-aware: covered cells
 * resolve to their hero (via the back-pointer), so navigation never lands
 * "inside" a hero, and stepping off a hero skips its whole span. Edges do not
 * wrap — hitting a boundary returns the origin unchanged.
 *
 * Home/End are row-scoped (first/last owner in the current row), matching the
 * ARIA grid pattern.
 */
export function moveFocus(
  cellMap: CellMap,
  cols: number,
  fromSlotIndex: number,
  key: GridNavKey,
): number {
  if (cols <= 0 || cellMap.length === 0) return fromSlotIndex
  const pos = positionOf(cellMap, cols, fromSlotIndex)
  if (!pos) return fromSlotIndex
  const { row, col } = pos

  // Step in one direction until we reach a cell owned by a different slotIndex
  // (skipping the origin's own covered span), or fall off the grid.
  const step = (dRow: number, dCol: number): number => {
    let r = row + dRow
    let c = col + dCol
    while (true) {
      const owner = ownerAt(cellMap, cols, r, c)
      if (owner === null) return fromSlotIndex // hit an edge — no move
      if (owner !== fromSlotIndex) return owner
      r += dRow
      c += dCol
    }
  }

  switch (key) {
    case 'ArrowLeft':
      return step(0, -1)
    case 'ArrowRight':
      return step(0, 1)
    case 'ArrowUp':
      return step(-1, 0)
    case 'ArrowDown':
      return step(1, 0)
    case 'Home': {
      // First owner in the row, scanning from the left edge.
      for (let c = 0; c < cols; c++) {
        const owner = ownerAt(cellMap, cols, row, c)
        if (owner !== null) return owner
      }
      return fromSlotIndex
    }
    case 'End': {
      // Last owner in the row, scanning from the right edge.
      for (let c = cols - 1; c >= 0; c--) {
        const owner = ownerAt(cellMap, cols, row, c)
        if (owner !== null) return owner
      }
      return fromSlotIndex
    }
    default:
      return fromSlotIndex
  }
}
