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
  resolveExportScale,
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

describe('resolveExportScale', () => {
  it('returns the requested scale when it fits', () => {
    expect(resolveExportScale(1000, 1000, PAD, 2, false)).toEqual({ scale: 2, downgraded: false })
  })

  it('downgrades to 1× when 2× overflows but 1× fits', () => {
    // iOS: (1032*2)² ≈ 4.26M > 3M at 2×, 1.065M < 3M at 1×
    expect(resolveExportScale(1000, 1000, PAD, 2, true)).toEqual({ scale: 1, downgraded: true })
  })

  it('returns null (hard error) when even 1× cannot fit', () => {
    expect(resolveExportScale(3000, 3000, 0, 2, true)).toBeNull() // 9M > 3M even at 1×
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
    '10×10 %s title=%s sidebar=%s fits iOS at 1× and desktop at 2× (never the hard error)',
    ({ mode, title, sidebar }) => {
      const l = computeExportLayout({
        rows: 10,
        cols: 10,
        gap: GAP,
        displayMode: mode,
        hasTitle: title,
        sidebarWidth: sidebar ? SIDEBAR_MAX_WIDTH : 0,
      })

      // iOS: always resolvable (never the task-3 hard error). A 10×10 overflows 2×,
      // so it takes the graceful 1× downgrade.
      const ios = resolveExportScale(l.innerW, l.innerH, PAD, 2, true)
      expect(ios).not.toBeNull()
      expect(ios).toEqual({ scale: 1, downgraded: true })
      expect(fitsAt(l.innerW, l.innerH, PAD, 1, true)).toBe(true)

      // Desktop: comfortably within 8192 per side at full 2×.
      expect(resolveExportScale(l.innerW, l.innerH, PAD, 2, false)).toEqual({
        scale: 2,
        downgraded: false,
      })
    },
  )
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
