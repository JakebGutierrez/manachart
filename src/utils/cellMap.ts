import type { CellDef, CellMap, HeroConfig } from '@/types/chart'

export function generateCellMap(rows: number, cols: number, heroConfig: HeroConfig = []): CellMap {
  const heroOrigins = new Map<number, HeroConfig[number]>()
  // covered position key → the grid key of the hero origin that covers it.
  const coveredToOrigin = new Map<number, number>()

  for (const hero of heroConfig) {
    const originKey = hero.row * cols + hero.col
    heroOrigins.set(originKey, hero)
    for (let dr = 0; dr < hero.rowSpan; dr++) {
      for (let dc = 0; dc < hero.colSpan; dc++) {
        if (dr === 0 && dc === 0) continue
        const r = hero.row + dr
        const c = hero.col + dc
        if (r < rows && c < cols) coveredToOrigin.set(r * cols + c, originKey)
      }
    }
  }

  const cells: CellDef[] = []
  // origin grid key → the slotIndex assigned to that hero. Populated as heroes are
  // emitted; a covered cell's origin is always emitted before it (row-major, the
  // origin is the span's top-left), so the lookup below is always resolved.
  const originToSlotIndex = new Map<number, number>()
  let slotIndex = 0

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = r * cols + c
      if (coveredToOrigin.has(key)) {
        cells.push({ kind: 'covered', heroSlotIndex: originToSlotIndex.get(coveredToOrigin.get(key)!)! })
      } else if (heroOrigins.has(key)) {
        const hero = heroOrigins.get(key)!
        originToSlotIndex.set(key, slotIndex)
        cells.push({ kind: 'hero', slotIndex, rowSpan: hero.rowSpan, colSpan: hero.colSpan })
        slotIndex++
      } else {
        cells.push({ kind: 'slot', slotIndex })
        slotIndex++
      }
    }
  }

  return cells
}
