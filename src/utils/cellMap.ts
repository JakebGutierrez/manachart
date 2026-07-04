import type { CellDef, CellMap, HeroConfig } from '@/types/chart'

export function generateCellMap(rows: number, cols: number, heroConfig: HeroConfig = []): CellMap {
  const heroOrigins = new Map<number, HeroConfig[number]>()
  // covered position key → the grid key of the hero origin that covers it.
  // Both maps are last-wins (later heroConfig entries overwrite), and the
  // emission loop below lets `covered` beat `hero` — these are the parent's exact
  // semantics for overlapping/duplicate configs, preserved so saved/crafted
  // charts render, export, and reconstruct identically. The ONLY addition here is
  // the covered cell's heroSlotIndex back-pointer.
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

  // Resolve a covered cell's origin to an EMITTED hero's origin. A hero whose own
  // origin is covered (overlap) is emitted as `covered`, not `hero`, so it has no
  // slotIndex; walk the covered→origin chain until we reach an origin that is not
  // itself covered (= actually emitted as a hero). Heroes only cover down-right of
  // their origin, so each step strictly decreases the row-major key — the walk
  // always terminates, and the terminal origin is guaranteed to be emitted before
  // any covered cell that references it (row-major).
  const resolveEmittedOrigin = (originKey: number): number => {
    let o = originKey
    while (coveredToOrigin.has(o)) o = coveredToOrigin.get(o)!
    return o
  }

  const cells: CellDef[] = []
  const originToSlotIndex = new Map<number, number>()
  let slotIndex = 0

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = r * cols + c
      if (coveredToOrigin.has(key)) {
        // `!` (not `?? 0`): resolveEmittedOrigin always returns an origin emitted
        // before this cell, so the lookup is defined. If the invariant were ever
        // violated the value would be undefined — which gridNav's ownerAt treats
        // as "blocked" — rather than silently aliasing real slot 0.
        const emittedOrigin = resolveEmittedOrigin(coveredToOrigin.get(key)!)
        cells.push({ kind: 'covered', heroSlotIndex: originToSlotIndex.get(emittedOrigin)! })
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
