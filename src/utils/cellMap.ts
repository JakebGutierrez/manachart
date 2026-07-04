import type { CellDef, CellMap, HeroConfig } from '@/types/chart'

export function generateCellMap(rows: number, cols: number, heroConfig: HeroConfig = []): CellMap {
  // Resolve overlaps deterministically. sanitizeHeroConfig permits overlapping
  // heroes (crafted/legacy charts), so a hero's origin can fall inside another
  // hero's span. Process origins in row-major order and DROP any hero whose
  // origin is already covered by an accepted (earlier) hero. The result is
  // self-consistent: every covered cell is covered by a real, emitted hero, so
  // its heroSlotIndex back-pointer can never be undefined.
  const heroAtOrigin = new Map<number, HeroConfig[number]>() // originKey → accepted hero
  const coveredToOrigin = new Map<number, number>() // coveredKey → accepted origin key

  const sorted = [...heroConfig].sort(
    (a, b) => a.row * cols + a.col - (b.row * cols + b.col),
  )
  for (const hero of sorted) {
    const originKey = hero.row * cols + hero.col
    // Skip a hero whose origin is covered by an already-accepted hero, or a
    // duplicate origin (same top-left as an accepted hero).
    if (coveredToOrigin.has(originKey) || heroAtOrigin.has(originKey)) continue
    heroAtOrigin.set(originKey, hero)
    for (let dr = 0; dr < hero.rowSpan; dr++) {
      for (let dc = 0; dc < hero.colSpan; dc++) {
        if (dr === 0 && dc === 0) continue
        const r = hero.row + dr
        const c = hero.col + dc
        if (r >= rows || c >= cols) continue
        const key = r * cols + c
        // Never cover an already-accepted hero's origin; let the earliest accepted
        // hero own a shared covered cell.
        if (heroAtOrigin.has(key) || coveredToOrigin.has(key)) continue
        coveredToOrigin.set(key, originKey)
      }
    }
  }

  const cells: CellDef[] = []
  // origin grid key → the slotIndex assigned to that hero. Populated as heroes are
  // emitted; a covered cell's origin is always emitted before it (row-major, the
  // origin is the span's top-left and is guaranteed to survive as a hero), so the
  // lookup below is always resolved — the `?? 0` is unreachable belt-and-braces.
  const originToSlotIndex = new Map<number, number>()
  let slotIndex = 0

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = r * cols + c
      if (coveredToOrigin.has(key)) {
        cells.push({ kind: 'covered', heroSlotIndex: originToSlotIndex.get(coveredToOrigin.get(key)!) ?? 0 })
      } else if (heroAtOrigin.has(key)) {
        const hero = heroAtOrigin.get(key)!
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
