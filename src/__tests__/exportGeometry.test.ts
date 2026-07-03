import { describe, it, expect } from 'vitest'
import {
  EXPORT_CELL_W,
  TITLE_FONT_SIZE,
  TITLE_LINE_HEIGHT,
  TITLE_PADDING_BOTTOM,
  SIDEBAR_GAP,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  computeExportLayout,
  fitsAt,
  coverCropRect,
  measureSidebarWidth,
  truncateToWidth,
} from '@/utils/exportGeometry'

const TITLE_H = TITLE_FONT_SIZE * TITLE_LINE_HEIGHT + TITLE_PADDING_BOTTOM // 39

describe('coverCropRect', () => {
  it('landscape source wider than dest: clips left/right, full height', () => {
    // 600×400 (aspect 1.5) into 240×180 (aspect 1.333) → sh=full, sw=narrower
    const r = coverCropRect(600, 400, 240, 180)
    expect(r.sh).toBeCloseTo(400)
    expect(r.sw).toBeCloseTo((400 * 240) / 180) // 533.33
    expect(r.sx).toBeCloseTo((600 - r.sw) * 0.5)
    expect(r.sy).toBeCloseTo(0)
  })

  it('portrait source taller than dest: clips top/bottom, full width', () => {
    // 400×600 (aspect 0.667) into 240×180 (aspect 1.333) → sw=full, sh=shorter
    const r = coverCropRect(400, 600, 240, 180)
    expect(r.sw).toBeCloseTo(400)
    expect(r.sh).toBeCloseTo(400 / (240 / 180)) // 300
    expect(r.sx).toBeCloseTo(0)
    expect(r.sy).toBeCloseTo((600 - r.sh) * 0.5) // 150
  })

  it('cropScale zooms in: source rect shrinks around the crop point', () => {
    const base = coverCropRect(600, 400, 240, 180)
    const zoomed = coverCropRect(600, 400, 240, 180, 0.5, 0.5, 2)
    expect(zoomed.sw).toBeCloseTo(base.sw / 2)
    expect(zoomed.sh).toBeCloseTo(base.sh / 2)
    // Centred crop keeps the centre: sx moves right, sy down as the window shrinks
    expect(zoomed.sx).toBeCloseTo((600 - base.sw / 2) * 0.5)
    expect(zoomed.sy).toBeCloseTo((400 - base.sh / 2) * 0.5)
  })

  it('cropX/cropY move the source window without changing its size', () => {
    const centre = coverCropRect(600, 400, 240, 180, 0.5, 0.5, 1)
    const topLeft = coverCropRect(600, 400, 240, 180, 0, 0, 1)
    const bottomRight = coverCropRect(600, 400, 240, 180, 1, 1, 1)
    expect(topLeft.sw).toBeCloseTo(centre.sw)
    expect(topLeft.sh).toBeCloseTo(centre.sh)
    expect(topLeft.sx).toBeCloseTo(0)
    expect(topLeft.sy).toBeCloseTo(0)
    expect(bottomRight.sx).toBeCloseTo(600 - centre.sw)
    expect(bottomRight.sy).toBeCloseTo(0) // full-height source: no vertical room
  })

  it('crop offset and zoom interact: window shrinks then positions by crop point', () => {
    // square source into square dest so both axes have slack under zoom
    const r = coverCropRect(1000, 1000, 100, 100, 0.25, 0.75, 4)
    // cover of equal aspect → sw=sh=1000, /cropScale 4 → 250
    expect(r.sw).toBeCloseTo(250)
    expect(r.sh).toBeCloseTo(250)
    expect(r.sx).toBeCloseTo((1000 - 250) * 0.25) // 187.5
    expect(r.sy).toBeCloseTo((1000 - 250) * 0.75) // 562.5
  })
})

describe('fitsAt', () => {
  it('desktop: within 8192 per side passes, over fails, boundary passes', () => {
    expect(fitsAt(8000, 8000, 0, 1, false)).toBe(true)
    expect(fitsAt(8192, 8192, 0, 1, false)).toBe(true) // exact boundary
    expect(fitsAt(8193, 100, 0, 1, false)).toBe(false)
    // padding and scale factor in
    expect(fitsAt(4000, 4000, 96, 2, false)).toBe(false) // (4000+192)*2 = 8384 > 8192
  })

  it('iOS: total area budget of 3,000,000 including the exact boundary', () => {
    expect(fitsAt(1000, 2000, 0, 1, true)).toBe(true) // 2,000,000
    expect(fitsAt(1000, 3000, 0, 1, true)).toBe(true) // exactly 3,000,000
    expect(fitsAt(1000, 3001, 0, 1, true)).toBe(false) // 3,001,000
  })

  it('iOS area uses the scaled dimensions', () => {
    // (1000)*(800) = 800,000 at 1×, ×4 at 2× = 3,200,000 > budget
    expect(fitsAt(1000, 800, 0, 2, true)).toBe(false)
    expect(fitsAt(1000, 800, 0, 1, true)).toBe(true)
  })
})

describe('computeExportLayout', () => {
  it('landscape derives cellH as 3/4 cellW and sums grid + gaps', () => {
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
    expect(l.totalGridW).toBe(3 * 180 + 2 * 4) // 548
    expect(l.totalGridH).toBe(2 * 135 + 1 * 4) // 274
    expect(l.titleHeight).toBe(0)
    expect(l.sidebarSection).toBe(0)
    expect(l.innerW).toBe(548)
    expect(l.innerH).toBe(274)
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
    expect(l.totalGridH).toBe(2 * 180 + 4)
  })

  it('title adds a fixed title band to innerH only', () => {
    const l = computeExportLayout({
      rows: 1,
      cols: 1,
      gap: 4,
      displayMode: 'landscape',
      hasTitle: true,
      cellW: 180,
    })
    expect(l.titleHeight).toBe(TITLE_H)
    expect(l.innerH).toBe(l.totalGridH + TITLE_H)
    expect(l.innerW).toBe(l.totalGridW)
  })

  it('sidebar adds gap + measured width to innerW only', () => {
    const l = computeExportLayout({
      rows: 1,
      cols: 1,
      gap: 4,
      displayMode: 'landscape',
      hasTitle: false,
      cellW: 180,
      sidebarWidth: 150,
    })
    expect(l.sidebarSection).toBe(SIDEBAR_GAP + 150)
    expect(l.innerW).toBe(l.totalGridW + SIDEBAR_GAP + 150)
  })

  it('defaults cellW to EXPORT_CELL_W when omitted', () => {
    const l = computeExportLayout({
      rows: 1,
      cols: 1,
      gap: 4,
      displayMode: 'landscape',
      hasTitle: false,
    })
    expect(l.cellW).toBe(EXPORT_CELL_W)
  })

  it('budget: a 10×10 landscape grid fits iOS at 1× but not 2×, and desktop at 2×', () => {
    const l = computeExportLayout({
      rows: 10,
      cols: 10,
      gap: 4,
      displayMode: 'landscape',
      hasTitle: true, // stricter: include a title band
    })
    const padding = 16
    expect(fitsAt(l.innerW, l.innerH, padding, 1, true)).toBe(true) // downgrade target fits
    expect(fitsAt(l.innerW, l.innerH, padding, 2, true)).toBe(false) // 2× overflows iOS
    expect(fitsAt(l.innerW, l.innerH, padding, 2, false)).toBe(true) // desktop is fine at 2×
  })
})

describe('measureSidebarWidth', () => {
  const measure = (t: string) => t.length * 10 // 10px per char

  it('clamps to the minimum for short names', () => {
    expect(measureSidebarWidth(['AB'], measure)).toBe(SIDEBAR_MIN_WIDTH)
    expect(measureSidebarWidth([], measure)).toBe(SIDEBAR_MIN_WIDTH)
  })

  it('clamps to the maximum for very long names', () => {
    expect(measureSidebarWidth(['A'.repeat(40)], measure)).toBe(SIDEBAR_MAX_WIDTH)
  })

  it('uses the widest name plus horizontal padding when in range', () => {
    // longest = 15 chars → 150 + 2*10 padding = 170, within [120, 200]
    expect(measureSidebarWidth(['short', 'A'.repeat(15)], measure)).toBe(170)
  })
})

describe('truncateToWidth', () => {
  const measure = (t: string) => t.length * 10

  it('returns the text unchanged when it already fits', () => {
    expect(truncateToWidth('ABCDEF', 100, measure)).toBe('ABCDEF')
  })

  it('truncates with a trailing ellipsis to fit', () => {
    // 20 chars = 200px > 100; ellipsis counts as one char (10px), so 9 chars + …
    const out = truncateToWidth('A'.repeat(20), 100, measure)
    expect(out).toBe('A'.repeat(9) + '…')
    expect(measure(out)).toBeLessThanOrEqual(100)
  })
})
