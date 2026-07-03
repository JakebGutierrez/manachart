import { describe, it, expect } from 'vitest'
import type { DisplayMode } from '@/types/chart'
import {
  BASE_TARGET_LONG_EDGE,
  MIN_CELL_W,
  MAX_CELL_W,
  TITLE_FONT_SIZE,
  TITLE_LINE_HEIGHT,
  TITLE_PADDING_BOTTOM,
  SIDEBAR_GAP,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  computeCellWidth,
  computeExportLayout,
  fitsAt,
  maxCellForBudget,
  resolveExportSizing,
  shouldHardErrorExport,
  coverCropRect,
  measureSidebarWidth,
  truncateToWidth,
} from '@/utils/exportGeometry'

const TITLE_H = TITLE_FONT_SIZE * TITLE_LINE_HEIGHT + TITLE_PADDING_BOTTOM // 39
const PAD = 16

describe('coverCropRect', () => {
  it('landscape source wider than dest: clips left/right, full height', () => {
    const r = coverCropRect(600, 400, 240, 180)
    expect(r.sh).toBeCloseTo(400)
    expect(r.sw).toBeCloseTo((400 * 240) / 180)
    expect(r.sx).toBeCloseTo((600 - r.sw) * 0.5)
    expect(r.sy).toBeCloseTo(0)
  })

  it('portrait source taller than dest: clips top/bottom, full width', () => {
    const r = coverCropRect(400, 600, 240, 180)
    expect(r.sw).toBeCloseTo(400)
    expect(r.sh).toBeCloseTo(400 / (240 / 180))
    expect(r.sx).toBeCloseTo(0)
    expect(r.sy).toBeCloseTo((600 - r.sh) * 0.5)
  })

  it('cropScale zooms in: source rect shrinks around the crop point', () => {
    const base = coverCropRect(600, 400, 240, 180)
    const zoomed = coverCropRect(600, 400, 240, 180, 0.5, 0.5, 2)
    expect(zoomed.sw).toBeCloseTo(base.sw / 2)
    expect(zoomed.sh).toBeCloseTo(base.sh / 2)
    expect(zoomed.sx).toBeCloseTo((600 - base.sw / 2) * 0.5)
    expect(zoomed.sy).toBeCloseTo((400 - base.sh / 2) * 0.5)
  })

  it('cropX/cropY move the source window without changing its size', () => {
    const centre = coverCropRect(600, 400, 240, 180, 0.5, 0.5, 1)
    const topLeft = coverCropRect(600, 400, 240, 180, 0, 0, 1)
    const bottomRight = coverCropRect(600, 400, 240, 180, 1, 1, 1)
    expect(topLeft.sw).toBeCloseTo(centre.sw)
    expect(topLeft.sx).toBeCloseTo(0)
    expect(topLeft.sy).toBeCloseTo(0)
    expect(bottomRight.sx).toBeCloseTo(600 - centre.sw)
    expect(bottomRight.sy).toBeCloseTo(0)
  })

  it('crop offset and zoom interact: window shrinks then positions by crop point', () => {
    const r = coverCropRect(1000, 1000, 100, 100, 0.25, 0.75, 4)
    expect(r.sw).toBeCloseTo(250)
    expect(r.sh).toBeCloseTo(250)
    expect(r.sx).toBeCloseTo((1000 - 250) * 0.25)
    expect(r.sy).toBeCloseTo((1000 - 250) * 0.75)
  })
})

describe('fitsAt', () => {
  it('desktop: within 8192 per side passes, over fails, boundary passes', () => {
    expect(fitsAt(8000, 8000, 0, 1, false)).toBe(true)
    expect(fitsAt(8192, 8192, 0, 1, false)).toBe(true)
    expect(fitsAt(8193, 100, 0, 1, false)).toBe(false)
    expect(fitsAt(4000, 4000, 96, 2, false)).toBe(false) // (4000+192)*2 = 8384 > 8192
  })

  it('iOS: total area budget of 3,000,000 including the exact boundary', () => {
    expect(fitsAt(1000, 2000, 0, 1, true)).toBe(true) // 2,000,000
    expect(fitsAt(1000, 3000, 0, 1, true)).toBe(true) // exactly 3,000,000
    expect(fitsAt(1000, 3001, 0, 1, true)).toBe(false) // 3,001,000
  })

  it('iOS area uses the scaled dimensions', () => {
    expect(fitsAt(1000, 800, 0, 2, true)).toBe(false) // 2000*1600 = 3,200,000
    expect(fitsAt(1000, 800, 0, 1, true)).toBe(true) // 800,000
  })
})

describe('computeCellWidth (target-resolution sizing)', () => {
  it('a 1×1 grid reaches the target long edge (capped at MAX_CELL_W)', () => {
    const cw = computeCellWidth({ rows: 1, cols: 1, gap: 4, displayMode: 'landscape' })
    expect(cw).toBe(MAX_CELL_W)
    expect(cw).toBe(BASE_TARGET_LONG_EDGE) // MAX == target, so a 1×1 lands on it
  })

  it('small grids get large cells; large grids get small cells', () => {
    const c2 = computeCellWidth({ rows: 2, cols: 2, gap: 4, displayMode: 'landscape' })
    const c5 = computeCellWidth({ rows: 5, cols: 5, gap: 4, displayMode: 'landscape' })
    const c10 = computeCellWidth({ rows: 10, cols: 10, gap: 4, displayMode: 'landscape' })
    expect(c2).toBeGreaterThan(c5)
    expect(c5).toBeGreaterThan(c10)
    // 2×2 solves grid-width == target: (target - gap) / 2
    expect(c2).toBeCloseTo((BASE_TARGET_LONG_EDGE - 4) / 2)
  })

  it('the widest UI grid (10×10) sizes the same in both modes (width-bound) and stays above MIN', () => {
    const land = computeCellWidth({ rows: 10, cols: 10, gap: 4, displayMode: 'landscape' })
    const square = computeCellWidth({ rows: 10, cols: 10, gap: 4, displayMode: 'square' })
    expect(land).toBeCloseTo((BASE_TARGET_LONG_EDGE - 9 * 4) / 10)
    expect(square).toBeCloseTo(land)
    expect(land).toBeGreaterThan(MIN_CELL_W)
  })

  it('clamps to MIN_CELL_W for grids far beyond the UI limit', () => {
    const cw = computeCellWidth({ rows: 50, cols: 50, gap: 4, displayMode: 'landscape' })
    expect(cw).toBe(MIN_CELL_W)
  })

  it('fixes the small-chart regression: a 1×1 export long edge is well above the old ~1864px', () => {
    const l = computeExportLayout({
      rows: 1,
      cols: 1,
      gap: 4,
      displayMode: 'landscape',
      hasTitle: false,
    })
    const longEdgeAt2x = (Math.max(l.innerW, l.innerH) + 2 * PAD) * 2
    expect(longEdgeAt2x).toBeGreaterThan(1864)
  })
})

describe('computeExportLayout', () => {
  it('landscape derives cellH as 3/4 cellW and sums grid + gaps (explicit cellW)', () => {
    const l = computeExportLayout({
      rows: 2,
      cols: 3,
      gap: 4,
      displayMode: 'landscape',
      hasTitle: false,
      cellW: 180,
    })
    expect(l.cellW).toBe(180)
    expect(l.cellH).toBe(135)
    expect(l.totalGridW).toBe(3 * 180 + 2 * 4)
    expect(l.totalGridH).toBe(2 * 135 + 1 * 4)
    expect(l.titleHeight).toBe(0)
    expect(l.sidebarSection).toBe(0)
  })

  it('square mode makes cellH equal cellW', () => {
    const l = computeExportLayout({
      rows: 2,
      cols: 2,
      gap: 4,
      displayMode: 'square',
      hasTitle: false,
      cellW: 180,
    })
    expect(l.cellH).toBe(180)
  })

  it('title adds a fixed band to innerH only; sidebar adds gap+width to innerW only', () => {
    const withTitle = computeExportLayout({
      rows: 1,
      cols: 1,
      gap: 4,
      displayMode: 'landscape',
      hasTitle: true,
      cellW: 180,
    })
    expect(withTitle.titleHeight).toBe(TITLE_H)
    expect(withTitle.innerH).toBe(withTitle.totalGridH + TITLE_H)
    expect(withTitle.innerW).toBe(withTitle.totalGridW)

    const withSidebar = computeExportLayout({
      rows: 1,
      cols: 1,
      gap: 4,
      displayMode: 'landscape',
      hasTitle: false,
      cellW: 180,
      sidebarWidth: 150,
    })
    expect(withSidebar.sidebarSection).toBe(SIDEBAR_GAP + 150)
    expect(withSidebar.innerW).toBe(withSidebar.totalGridW + SIDEBAR_GAP + 150)
  })

  it('derives cellW via target sizing when no explicit cellW is given', () => {
    const l = computeExportLayout({
      rows: 1,
      cols: 1,
      gap: 4,
      displayMode: 'landscape',
      hasTitle: false,
    })
    expect(l.cellW).toBe(MAX_CELL_W)
  })
})

describe('maxCellForBudget', () => {
  it('iOS: largest cell whose 2× export lands on the area budget', () => {
    // 5×5 landscape, no title/sidebar: solved ≈188.8 (area at that cell ≈ 3.0M @2×)
    const c = maxCellForBudget({
      rows: 5,
      cols: 5,
      gap: 4,
      padding: PAD,
      displayMode: 'landscape',
      hasTitle: false,
      scale: 2,
      isIOS: true,
    })
    expect(c).toBeCloseTo(188.8, 0)
    const l = computeExportLayout({ rows: 5, cols: 5, gap: 4, displayMode: 'landscape', hasTitle: false, cellW: c })
    expect(fitsAt(l.innerW, l.innerH, PAD, 2, true)).toBe(true) // fits at the solved cell
  })

  it('desktop: per-side ceiling gives far more room than the ideal cell', () => {
    const c = maxCellForBudget({
      rows: 5,
      cols: 5,
      gap: 4,
      padding: PAD,
      displayMode: 'landscape',
      hasTitle: false,
      scale: 2,
      isIOS: false,
    })
    expect(c).toBeCloseTo((8192 / 2 - (4 * 4 + 2 * PAD)) / 5, 0) // ≈ 809.6
  })
})

describe('resolveExportSizing — ordinary charts stay at 2× on iOS (Task-1 regression)', () => {
  const OLD_FIXED_180 = { landscape5x5: 1896 } // (5*180+4*4 + 2*16) * 2

  const ordinary: Array<{ label: string; rows: number; cols: number; mode: DisplayMode }> = [
    { label: '5×5 landscape', rows: 5, cols: 5, mode: 'landscape' },
    { label: '3×3 landscape', rows: 3, cols: 3, mode: 'landscape' },
    { label: '5×5 square', rows: 5, cols: 5, mode: 'square' },
  ]

  it.each(ordinary)('$label exports at 2× on iOS without downgrading', ({ rows, cols, mode }) => {
    const res = resolveExportSizing({
      rows,
      cols,
      gap: 4,
      padding: PAD,
      displayMode: mode,
      hasTitle: false,
      requestedScale: 2,
      isIOS: true,
    })
    expect(res).not.toBeNull()
    expect(res!.scale).toBe(2)
    expect(res!.downgraded).toBe(false)
    // cell is budget-capped: at or below the ideal, and still above the useful floor
    const ideal = computeCellWidth({ rows, cols, gap: 4, displayMode: mode })
    expect(res!.cellW).toBeLessThanOrEqual(ideal)
    expect(res!.cellW).toBeGreaterThanOrEqual(MIN_CELL_W)
    // the resulting 2× export actually fits the iOS budget
    const l = computeExportLayout({ rows, cols, gap: 4, displayMode: mode, hasTitle: false, cellW: res!.cellW })
    expect(fitsAt(l.innerW, l.innerH, PAD, 2, true)).toBe(true)
  })

  it('the 5×5 landscape iOS 2× export is at least as sharp as the old fixed-180 output', () => {
    const res = resolveExportSizing({
      rows: 5,
      cols: 5,
      gap: 4,
      padding: PAD,
      displayMode: 'landscape',
      hasTitle: false,
      requestedScale: 2,
      isIOS: true,
    })!
    const l = computeExportLayout({ rows: 5, cols: 5, gap: 4, displayMode: 'landscape', hasTitle: false, cellW: res.cellW })
    const longEdge = (Math.max(l.innerW, l.innerH) + 2 * PAD) * res.scale
    expect(longEdge).toBeGreaterThanOrEqual(OLD_FIXED_180.landscape5x5)
  })

  it('desktop keeps the full ideal cell at 2× (budget cap does not bind)', () => {
    const res = resolveExportSizing({
      rows: 5,
      cols: 5,
      gap: 4,
      padding: PAD,
      displayMode: 'landscape',
      hasTitle: false,
      requestedScale: 2,
      isIOS: false,
    })!
    expect(res.scale).toBe(2)
    expect(res.downgraded).toBe(false)
    expect(res.cellW).toBeCloseTo(computeCellWidth({ rows: 5, cols: 5, gap: 4, displayMode: 'landscape' }), 5)
  })

  it('returns null (hard error) only for genuinely impossible configs', () => {
    // Absurd padding blows the budget even at a MIN cell and 1× scale.
    expect(
      resolveExportSizing({
        rows: 10,
        cols: 10,
        gap: 4,
        padding: 1000,
        displayMode: 'square',
        hasTitle: true,
        sidebarWidth: SIDEBAR_MAX_WIDTH,
        requestedScale: 2,
        isIOS: true,
      }),
    ).toBeNull()
  })
})

describe('shouldHardErrorExport', () => {
  it('an empty chart (no filled cells) is fine', () => {
    expect(shouldHardErrorExport(0, 0)).toBe(false)
  })

  it('all cells failed is always a hard error, regardless of size', () => {
    expect(shouldHardErrorExport(2, 2)).toBe(true)
    expect(shouldHardErrorExport(10, 10)).toBe(true)
  })

  it('a small chart with a partial failure degrades (no hard error)', () => {
    expect(shouldHardErrorExport(3, 2)).toBe(false) // 2/3 failed but below the threshold
    expect(shouldHardErrorExport(5, 3)).toBe(false)
  })

  it('a larger chart with >50% failures hard-errors', () => {
    expect(shouldHardErrorExport(8, 5)).toBe(true)
    expect(shouldHardErrorExport(6, 4)).toBe(true)
  })

  it('exactly half failed is not "systemic" (still degrades)', () => {
    expect(shouldHardErrorExport(8, 4)).toBe(false)
    expect(shouldHardErrorExport(6, 3)).toBe(false)
  })
})

describe('exhaustive budget: 10×10 across every display/title/sidebar variant', () => {
  // Default chart spacing.
  const GAP = 4
  const cases: Array<{ mode: DisplayMode; title: boolean; sidebar: boolean }> = []
  for (const mode of ['landscape', 'square'] as DisplayMode[]) {
    for (const title of [false, true]) {
      for (const sidebar of [false, true]) {
        cases.push({ mode, title, sidebar })
      }
    }
  }

  it.each(cases)(
    '10×10 %s title=%s sidebar=%s is always exportable (never the hard error) and fits its chosen scale',
    ({ mode, title, sidebar }) => {
      const params = {
        rows: 10,
        cols: 10,
        gap: GAP,
        padding: PAD,
        displayMode: mode,
        hasTitle: title,
        sidebarWidth: sidebar ? SIDEBAR_MAX_WIDTH : 0,
        requestedScale: 2 as const,
      }

      // iOS: never the hard error. Whatever scale it picks (heavier variants take the
      // 1× downgrade; lighter ones fit 2× with a budget-capped cell), the result fits
      // the budget and stays above the useful cell floor.
      const ios = resolveExportSizing({ ...params, isIOS: true })
      expect(ios).not.toBeNull()
      expect(ios!.cellW).toBeGreaterThanOrEqual(MIN_CELL_W)
      const iosLayout = computeExportLayout({ ...params, cellW: ios!.cellW })
      expect(fitsAt(iosLayout.innerW, iosLayout.innerH, PAD, ios!.scale, true)).toBe(true)

      // Desktop: comfortably within 8192 per side at full 2× (no downgrade).
      const desktop = resolveExportSizing({ ...params, isIOS: false })
      expect(desktop!.scale).toBe(2)
      expect(desktop!.downgraded).toBe(false)
      const deskLayout = computeExportLayout({ ...params, cellW: desktop!.cellW })
      expect(fitsAt(deskLayout.innerW, deskLayout.innerH, PAD, 2, false)).toBe(true)
    },
  )

  it('the tightest 10×10 (square + title + max sidebar) takes the 1× downgrade on iOS', () => {
    const res = resolveExportSizing({
      rows: 10,
      cols: 10,
      gap: GAP,
      padding: PAD,
      displayMode: 'square',
      hasTitle: true,
      sidebarWidth: SIDEBAR_MAX_WIDTH,
      requestedScale: 2,
      isIOS: true,
    })
    expect(res).not.toBeNull()
    expect(res!.scale).toBe(1)
    expect(res!.downgraded).toBe(true)
  })
})

describe('measureSidebarWidth', () => {
  const measure = (t: string) => t.length * 10

  it('clamps to the minimum for short names', () => {
    expect(measureSidebarWidth(['AB'], measure)).toBe(SIDEBAR_MIN_WIDTH)
    expect(measureSidebarWidth([], measure)).toBe(SIDEBAR_MIN_WIDTH)
  })

  it('clamps to the maximum for very long names', () => {
    expect(measureSidebarWidth(['A'.repeat(40)], measure)).toBe(SIDEBAR_MAX_WIDTH)
  })

  it('uses the widest name plus horizontal padding when in range', () => {
    expect(measureSidebarWidth(['short', 'A'.repeat(15)], measure)).toBe(170)
  })
})

describe('truncateToWidth', () => {
  const measure = (t: string) => t.length * 10

  it('returns the text unchanged when it already fits', () => {
    expect(truncateToWidth('ABCDEF', 100, measure)).toBe('ABCDEF')
  })

  it('truncates with a trailing ellipsis to fit', () => {
    const out = truncateToWidth('A'.repeat(20), 100, measure)
    expect(out).toBe('A'.repeat(9) + '…')
    expect(measure(out)).toBeLessThanOrEqual(100)
  })
})
