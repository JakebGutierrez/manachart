import { describe, it, expect } from 'vitest'
import { moveFocus } from '@/utils/gridNav'
import { generateCellMap } from '@/utils/cellMap'

describe('moveFocus — uniform grids', () => {
  // 3×3 uniform grid, slotIndex == position:
  // 0 1 2
  // 3 4 5
  // 6 7 8
  const grid = generateCellMap(3, 3)
  const cols = 3

  it('ArrowRight moves to the next column', () => {
    expect(moveFocus(grid, cols, 4, 'ArrowRight')).toBe(5)
  })

  it('ArrowLeft moves to the previous column', () => {
    expect(moveFocus(grid, cols, 4, 'ArrowLeft')).toBe(3)
  })

  it('ArrowDown moves down one row', () => {
    expect(moveFocus(grid, cols, 4, 'ArrowDown')).toBe(7)
  })

  it('ArrowUp moves up one row', () => {
    expect(moveFocus(grid, cols, 4, 'ArrowUp')).toBe(1)
  })

  it('does not wrap off the right edge', () => {
    expect(moveFocus(grid, cols, 2, 'ArrowRight')).toBe(2)
    expect(moveFocus(grid, cols, 5, 'ArrowRight')).toBe(5)
    expect(moveFocus(grid, cols, 8, 'ArrowRight')).toBe(8)
  })

  it('does not wrap off the left edge', () => {
    expect(moveFocus(grid, cols, 0, 'ArrowLeft')).toBe(0)
    expect(moveFocus(grid, cols, 3, 'ArrowLeft')).toBe(3)
  })

  it('does not wrap off the top edge', () => {
    expect(moveFocus(grid, cols, 1, 'ArrowUp')).toBe(1)
  })

  it('does not wrap off the bottom edge', () => {
    expect(moveFocus(grid, cols, 7, 'ArrowDown')).toBe(7)
  })

  it('corners are stable in their out-of-bounds directions', () => {
    expect(moveFocus(grid, cols, 0, 'ArrowUp')).toBe(0)
    expect(moveFocus(grid, cols, 0, 'ArrowLeft')).toBe(0)
    expect(moveFocus(grid, cols, 8, 'ArrowDown')).toBe(8)
    expect(moveFocus(grid, cols, 8, 'ArrowRight')).toBe(8)
  })

  it('Home moves to the first cell of the current row', () => {
    expect(moveFocus(grid, cols, 5, 'Home')).toBe(3)
    expect(moveFocus(grid, cols, 8, 'Home')).toBe(6)
  })

  it('End moves to the last cell of the current row', () => {
    expect(moveFocus(grid, cols, 3, 'End')).toBe(5)
    expect(moveFocus(grid, cols, 6, 'End')).toBe(8)
  })

  it('Home/End are stable when already at the row edge', () => {
    expect(moveFocus(grid, cols, 3, 'Home')).toBe(3)
    expect(moveFocus(grid, cols, 5, 'End')).toBe(5)
  })

  it('a 1×1 grid never moves', () => {
    const one = generateCellMap(1, 1)
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'] as const) {
      expect(moveFocus(one, 1, 0, key)).toBe(0)
    }
  })

  it('an unknown fromSlotIndex returns unchanged', () => {
    expect(moveFocus(grid, cols, 99, 'ArrowRight')).toBe(99)
  })
})

describe('moveFocus — commander hero (2×2 at origin) in a 4×4 grid', () => {
  // Layout (slotIndex per position; H=hero 0, .=covered by hero 0):
  //  H  .  1  2
  //  .  .  3  4
  //  5  6  7  8
  //  9 10 11 12
  const grid = generateCellMap(4, 4, [{ row: 0, col: 0, rowSpan: 2, colSpan: 2 }])
  const cols = 4

  it('ArrowRight off the hero skips its covered span to the next real cell', () => {
    // hero is slotIndex 0; to its right at col 1 is covered → keep going → col 2 = slot 1
    expect(moveFocus(grid, cols, 0, 'ArrowRight')).toBe(1)
  })

  it('ArrowDown off the hero skips its covered span to the row below it', () => {
    // down from hero: (1,0) covered, (2,0) = slot 5
    expect(moveFocus(grid, cols, 0, 'ArrowDown')).toBe(5)
  })

  it('ArrowLeft into the hero region lands on the hero', () => {
    // slot 1 at (0,2); left → (0,1) covered → resolves to hero 0
    expect(moveFocus(grid, cols, 1, 'ArrowLeft')).toBe(0)
  })

  it('ArrowUp into the hero region lands on the hero', () => {
    // slot 5 at (2,0); up → (1,0) covered → hero 0
    expect(moveFocus(grid, cols, 5, 'ArrowUp')).toBe(0)
  })

  it('ArrowLeft from a covered-neighbour deep column resolves to hero once', () => {
    // slot 3 at (1,2); left → (1,1) covered → hero 0
    expect(moveFocus(grid, cols, 3, 'ArrowLeft')).toBe(0)
  })

  it('Home from a lower row can land on the hero via its covered cell', () => {
    // row 1: (1,0) covered → hero 0 is the first owner in the row
    expect(moveFocus(grid, cols, 3, 'Home')).toBe(0)
  })

  it('Home on the hero row returns the hero itself', () => {
    expect(moveFocus(grid, cols, 1, 'Home')).toBe(0)
  })

  it('End on the hero row is the last real cell', () => {
    expect(moveFocus(grid, cols, 0, 'End')).toBe(2)
  })

  it('the hero never navigates into its own covered span (no self-move)', () => {
    // Right/Down already tested to skip; ensure they never return 0 spuriously.
    expect(moveFocus(grid, cols, 0, 'ArrowRight')).not.toBe(0)
    expect(moveFocus(grid, cols, 0, 'ArrowDown')).not.toBe(0)
  })
})

describe('moveFocus — partner heroes (two 2×1) in a 4×4 grid', () => {
  //  H0 H1  2  3
  //  .  .   4  5
  //  6  7   8  9
  // 10 11  12 13
  const grid = generateCellMap(4, 4, [
    { row: 0, col: 0, rowSpan: 2, colSpan: 1 },
    { row: 0, col: 1, rowSpan: 2, colSpan: 1 },
  ])
  const cols = 4

  it('ArrowRight from hero 0 lands on adjacent hero 1', () => {
    expect(moveFocus(grid, cols, 0, 'ArrowRight')).toBe(1)
  })

  it('ArrowDown from hero 0 skips its covered cell to the row below', () => {
    // (1,0) covered by hero 0 → (2,0) = slot 6
    expect(moveFocus(grid, cols, 0, 'ArrowDown')).toBe(6)
  })

  it('ArrowDown from hero 1 skips its covered cell to the row below', () => {
    // (1,1) covered by hero 1 → (2,1) = slot 7
    expect(moveFocus(grid, cols, 1, 'ArrowDown')).toBe(7)
  })

  it('ArrowUp from slot 7 lands on hero 1 (its covering hero)', () => {
    expect(moveFocus(grid, cols, 7, 'ArrowUp')).toBe(1)
  })
})

describe('moveFocus — overlapping hero config (degenerate map robustness)', () => {
  // Second hero's origin is covered by the first, so it is dropped; nav must stay
  // fully functional and never return a non-number.
  const grid = generateCellMap(4, 4, [
    { row: 0, col: 0, rowSpan: 2, colSpan: 2 },
    { row: 1, col: 1, rowSpan: 2, colSpan: 2 },
  ])
  const cols = 4

  it('every move from every owned cell returns an integer slotIndex', () => {
    const slots = grid.filter((c) => c.kind !== 'covered').map((c) => (c as { slotIndex: number }).slotIndex)
    for (const from of slots) {
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'] as const) {
        expect(Number.isInteger(moveFocus(grid, cols, from, key))).toBe(true)
      }
    }
  })

  it('keyboard nav off the surviving hero still skips its covered span', () => {
    expect(moveFocus(grid, cols, 0, 'ArrowRight')).toBe(1) // hero 0 → (0,2) slot 1
    expect(moveFocus(grid, cols, 0, 'ArrowDown')).toBe(4) // skip covered (1,0) → (2,0) slot 4
  })
})

it('moveFocus never returns undefined on a hand-built covered cell missing its back-pointer', () => {
  // A malformed map (e.g. from a future/hand-edited source) must not break nav.
  const bad = [
    { kind: 'slot', slotIndex: 0 },
    { kind: 'covered' } as unknown as { kind: 'covered'; heroSlotIndex: number },
  ]
  // Moving right into the malformed covered cell stays put instead of returning undefined.
  expect(moveFocus(bad as never, 2, 0, 'ArrowRight')).toBe(0)
})

describe('moveFocus — tall hero (rowSpan 3) traversal', () => {
  //  H  1  2
  //  .  3  4
  //  .  5  6
  //  7  8  9
  const grid = generateCellMap(4, 3, [{ row: 0, col: 0, rowSpan: 3, colSpan: 1 }])
  const cols = 3

  it('ArrowDown off the hero skips all covered rows to the first real cell below', () => {
    // (1,0) and (2,0) covered → (3,0) = slot 7
    expect(moveFocus(grid, cols, 0, 'ArrowDown')).toBe(7)
  })

  it('ArrowUp from the cell below the hero lands on the hero', () => {
    expect(moveFocus(grid, cols, 7, 'ArrowUp')).toBe(0)
  })
})
