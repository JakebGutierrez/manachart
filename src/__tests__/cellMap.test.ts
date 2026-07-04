import { describe, it, expect } from 'vitest'
import { generateCellMap } from '@/utils/cellMap'

describe('generateCellMap', () => {
  it('length is always rows × cols', () => {
    expect(generateCellMap(4, 5)).toHaveLength(20)
  })

  it('every cell has kind: slot in uniform mode', () => {
    const cells = generateCellMap(3, 3)
    expect(cells.every((c) => c.kind === 'slot')).toBe(true)
  })

  it('slotIndex values are 0-based, sequential, no gaps', () => {
    const cells = generateCellMap(2, 3)
    cells.forEach((cell, i) => {
      if (cell.kind === 'slot') expect(cell.slotIndex).toBe(i)
    })
  })

  it('a 1×1 grid produces a single cell with slotIndex: 0', () => {
    const cells = generateCellMap(1, 1)
    expect(cells).toHaveLength(1)
    expect(cells[0]).toEqual({ kind: 'slot', slotIndex: 0 })
  })

  it('a 3×2 grid produces 6 cells with correct slot indices', () => {
    const cells = generateCellMap(3, 2)
    expect(cells).toHaveLength(6)
    cells.forEach((cell, i) => {
      expect(cell).toEqual({ kind: 'slot', slotIndex: i })
    })
  })

  describe('hero layout', () => {
    it('commander preset: 2×2 hero at (0,0) in 4×4 grid', () => {
      const cells = generateCellMap(4, 4, [{ row: 0, col: 0, rowSpan: 2, colSpan: 2 }])
      expect(cells).toHaveLength(16)
      // origin is hero
      expect(cells[0]).toEqual({ kind: 'hero', slotIndex: 0, rowSpan: 2, colSpan: 2 })
      // (0,1), (1,0), (1,1) are covered, all pointing back at the hero (slotIndex 0)
      expect(cells[1]).toEqual({ kind: 'covered', heroSlotIndex: 0 })
      expect(cells[4]).toEqual({ kind: 'covered', heroSlotIndex: 0 })
      expect(cells[5]).toEqual({ kind: 'covered', heroSlotIndex: 0 })
      // (0,2) is the next slot
      expect(cells[2]).toEqual({ kind: 'slot', slotIndex: 1 })
    })

    it('slot indices after hero are sequential with no gaps', () => {
      const cells = generateCellMap(3, 4, [{ row: 0, col: 0, rowSpan: 2, colSpan: 2 }])
      const nonCovered = cells.filter((c) => c.kind !== 'covered')
      nonCovered.forEach((cell, i) => {
        if (cell.kind === 'slot' || cell.kind === 'hero') {
          expect(cell.slotIndex).toBe(i)
        }
      })
    })

    it('partner preset: two 2×1 heroes at (0,0) and (0,1) in 4×4 grid', () => {
      const cells = generateCellMap(4, 4, [
        { row: 0, col: 0, rowSpan: 2, colSpan: 1 },
        { row: 0, col: 1, rowSpan: 2, colSpan: 1 },
      ])
      expect(cells).toHaveLength(16)
      expect(cells[0]).toEqual({ kind: 'hero', slotIndex: 0, rowSpan: 2, colSpan: 1 })
      expect(cells[1]).toEqual({ kind: 'hero', slotIndex: 1, rowSpan: 2, colSpan: 1 })
      // (1,0) is covered by the first hero (slotIndex 0), (1,1) by the second (slotIndex 1)
      expect(cells[4]).toEqual({ kind: 'covered', heroSlotIndex: 0 })
      expect(cells[5]).toEqual({ kind: 'covered', heroSlotIndex: 1 })
      // (0,2) is slot slotIndex 2
      expect(cells[2]).toEqual({ kind: 'slot', slotIndex: 2 })
    })

    it('empty heroConfig is identical to no heroConfig argument', () => {
      expect(generateCellMap(3, 3, [])).toEqual(generateCellMap(3, 3))
    })

    it('length is still rows × cols with heroConfig', () => {
      const cells = generateCellMap(4, 4, [{ row: 0, col: 0, rowSpan: 2, colSpan: 2 }])
      expect(cells).toHaveLength(16)
    })
  })

  describe('covered back-pointer (heroSlotIndex)', () => {
    it('every covered cell points at the slotIndex of its covering hero', () => {
      // 3×2 hero (rowSpan 3, colSpan 2) at (0,0) in a 4×4 grid.
      const cells = generateCellMap(4, 4, [{ row: 0, col: 0, rowSpan: 3, colSpan: 2 }])
      // origin at (0,0) is the hero
      expect(cells[0]).toEqual({ kind: 'hero', slotIndex: 0, rowSpan: 3, colSpan: 2 })
      // all covered positions inside the span carry heroSlotIndex 0
      const coveredKeys = [1, 4, 5, 8, 9] // (0,1),(1,0),(1,1),(2,0),(2,1)
      for (const k of coveredKeys) {
        expect(cells[k]).toEqual({ kind: 'covered', heroSlotIndex: 0 })
      }
    })

    it('a hero not anchored at the grid origin still back-points correctly', () => {
      // 2×2 hero at (1,1) in a 4×4 grid. Slot indices run row-major, skipping covered.
      const cells = generateCellMap(4, 4, [{ row: 1, col: 1, rowSpan: 2, colSpan: 2 }])
      // (1,1) is the hero origin — find its slotIndex, then verify covered cells match.
      const heroCell = cells[1 * 4 + 1]
      expect(heroCell.kind).toBe('hero')
      const heroSlotIndex = (heroCell as { slotIndex: number }).slotIndex
      // covered positions: (1,2),(2,1),(2,2)
      for (const [r, c] of [[1, 2], [2, 1], [2, 2]] as const) {
        expect(cells[r * 4 + c]).toEqual({ kind: 'covered', heroSlotIndex })
      }
    })

    it('two heroes: each covered cell points at its own hero', () => {
      // partner preset, two 2×1 heroes side by side
      const cells = generateCellMap(4, 4, [
        { row: 0, col: 0, rowSpan: 2, colSpan: 1 },
        { row: 0, col: 1, rowSpan: 2, colSpan: 1 },
      ])
      expect(cells[4]).toEqual({ kind: 'covered', heroSlotIndex: 0 }) // (1,0) → hero 0
      expect(cells[5]).toEqual({ kind: 'covered', heroSlotIndex: 1 }) // (1,1) → hero 1
    })

    it('no covered cells exist in uniform mode', () => {
      const cells = generateCellMap(4, 4)
      expect(cells.some((c) => c.kind === 'covered')).toBe(false)
    })
  })

  describe('overlapping heroes (crafted / legacy configs)', () => {
    it('drops a hero whose origin is covered, leaving no undefined back-pointer', () => {
      // Two 2×2 heroes: the second origin (1,1) sits inside the first hero's span.
      const cells = generateCellMap(4, 4, [
        { row: 0, col: 0, rowSpan: 2, colSpan: 2 },
        { row: 1, col: 1, rowSpan: 2, colSpan: 2 },
      ])
      // Every covered cell has a valid integer back-pointer — never undefined.
      for (const c of cells) {
        if (c.kind === 'covered') expect(Number.isInteger(c.heroSlotIndex)).toBe(true)
      }
      // Only the first hero survives; the overlapped one is emitted as covered.
      expect(cells.filter((c) => c.kind === 'hero')).toHaveLength(1)
      expect(cells[5]).toEqual({ kind: 'covered', heroSlotIndex: 0 }) // (1,1) → first hero
    })

    it('a duplicate-origin hero is emitted once, no undefined back-pointer', () => {
      const cells = generateCellMap(4, 4, [
        { row: 0, col: 0, rowSpan: 2, colSpan: 2 },
        { row: 0, col: 0, rowSpan: 2, colSpan: 2 },
      ])
      expect(cells.filter((c) => c.kind === 'hero')).toHaveLength(1)
      for (const c of cells) {
        if (c.kind === 'covered') expect(Number.isInteger(c.heroSlotIndex)).toBe(true)
      }
    })

    it('slot indices remain sequential with no gaps after overlap resolution', () => {
      const cells = generateCellMap(4, 4, [
        { row: 0, col: 0, rowSpan: 2, colSpan: 2 },
        { row: 1, col: 1, rowSpan: 2, colSpan: 2 },
      ])
      const owned = cells
        .filter((c) => c.kind !== 'covered')
        .map((c) => (c as { slotIndex: number }).slotIndex)
      expect(owned).toEqual(owned.map((_, i) => i))
    })
  })
})
