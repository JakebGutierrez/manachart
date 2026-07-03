import type { DisplayMode } from '@/types/chart'

export type ExportScale = 1 | 2

// Target-resolution sizing. The cell size is derived from chart config so the
// exported image's *long edge* lands near BASE_TARGET_LONG_EDGE at base (1×)
// scale — small grids get big cells, large grids get small cells — then the
// user's 1×/2× scale multiplies it. This is fully deterministic (no DOM /
// viewport), so a chart exports identically on every device.
//
// Why these values:
//  - BASE_TARGET_LONG_EDGE = 1400 → at the default 2× scale a typical export is
//    ~2.8k px on its long edge (well above the old DOM-based ~1864px), so small
//    charts are sharp: a 1×1 now exports ~2864px wide vs the fixed-180 regression
//    of ~424px. Desktop never needs the downgrade path (2× stays < 8192).
//  - It is low enough that the *tightest* large case — a 10×10 SQUARE grid with a
//    title and a max-width sidebar — still fits the iOS 3,000,000px² budget at 1×
//    (~2.42M, verified in exportGeometry.test.ts), so ordinary large charts take
//    the graceful 1× downgrade instead of the hard error.
//  - MAX_CELL_W caps the cell (only a 1×1 grid reaches it); MIN_CELL_W is a floor
//    that stays below the cell size the target yields for a 10×10 (~136px), so it
//    never inflates a large grid past budget — it only guards degenerate configs.
export const BASE_TARGET_LONG_EDGE = 1400
export const MIN_CELL_W = 88
export const MAX_CELL_W = 1400

export const TITLE_FONT_SIZE = 18
export const TITLE_LINE_HEIGHT = 1.5
export const TITLE_PADDING_BOTTOM = 12
export const SIDEBAR_GAP = 16
export const SIDEBAR_MIN_WIDTH = 120
export const SIDEBAR_MAX_WIDTH = 200
export const SIDEBAR_PADDING_H = 10
export const SIDEBAR_FONT_SIZE = 12
export const SIDEBAR_LINE_HEIGHT = 1.5

// Canvas pixel budgets. Desktop is a per-side ceiling; iOS is a total-area floor
// conservative across devices.
export const DESKTOP_MAX_SIDE = 8192
export const IOS_MAX_AREA = 3_000_000

export interface ExportLayout {
  cellW: number
  cellH: number
  totalGridW: number
  totalGridH: number
  titleHeight: number
  sidebarSection: number
  innerW: number
  innerH: number
}

export interface CellSizeParams {
  rows: number
  cols: number
  gap: number
  displayMode: DisplayMode
  /** Overrides, mainly for tests; default to the module constants. */
  targetLongEdge?: number
  minCell?: number
  maxCell?: number
}

// Deterministic cell width for target-resolution sizing. Solves for the cellW that
// makes the grid's long edge equal `targetLongEdge`, then clamps to [min, max].
// Both grid dimensions grow linearly with cellW, so the long edge hits the target
// at the smaller of the two candidate widths (the axis with more cells / the taller
// aspect reaches the target first).
export function computeCellWidth(params: CellSizeParams): number {
  const { rows, cols, gap, displayMode } = params
  const target = params.targetLongEdge ?? BASE_TARGET_LONG_EDGE
  const minCell = params.minCell ?? MIN_CELL_W
  const maxCell = params.maxCell ?? MAX_CELL_W
  const k = displayMode === 'square' ? 1 : 3 / 4

  const byWidth = (target - (cols - 1) * gap) / cols
  const byHeight = (target - (rows - 1) * gap) / (rows * k)
  const raw = Math.min(byWidth, byHeight)

  return Math.max(minCell, Math.min(maxCell, raw))
}

export interface LayoutParams {
  rows: number
  cols: number
  gap: number
  displayMode: DisplayMode
  hasTitle: boolean
  /** Measured sidebar width, or 0/omitted when name display is not 'sidebar'. */
  sidebarWidth?: number
  /** Explicit cell width override (tests); otherwise derived via computeCellWidth. */
  cellW?: number
  /** Sizing overrides forwarded to computeCellWidth. */
  targetLongEdge?: number
  minCell?: number
  maxCell?: number
}

// Pure layout geometry: given chart config (plus a measured sidebar width) returns
// every dimension the canvas draw needs. No DOM, no measurement.
export function computeExportLayout(params: LayoutParams): ExportLayout {
  const { rows, cols, gap, displayMode, hasTitle } = params
  const cellW = params.cellW ?? computeCellWidth(params)
  const cellH = displayMode === 'square' ? cellW : cellW * (3 / 4)

  const totalGridW = cols * cellW + (cols - 1) * gap
  const totalGridH = rows * cellH + (rows - 1) * gap
  const titleHeight = hasTitle ? TITLE_FONT_SIZE * TITLE_LINE_HEIGHT + TITLE_PADDING_BOTTOM : 0

  const sidebarWidth = params.sidebarWidth ?? 0
  const sidebarSection = sidebarWidth > 0 ? SIDEBAR_GAP + sidebarWidth : 0

  const innerW = totalGridW + sidebarSection
  const innerH = totalGridH + titleHeight

  return { cellW, cellH, totalGridW, totalGridH, titleHeight, sidebarSection, innerW, innerH }
}

// Whether the export fits the platform pixel budget at the given scale.
export function fitsAt(
  innerW: number,
  innerH: number,
  padding: number,
  scale: number,
  isIOS: boolean,
): boolean {
  const w = (innerW + 2 * padding) * scale
  const h = (innerH + 2 * padding) * scale
  return isIOS ? w * h <= IOS_MAX_AREA : w <= DESKTOP_MAX_SIDE && h <= DESKTOP_MAX_SIDE
}

// Pick the export scale: the requested scale if it fits, else 1× (a downgrade),
// else null — the chart is too large to export at all on this platform (Task-3
// hard error). Pure, so the too-large decision is unit-testable.
export function resolveExportScale(
  innerW: number,
  innerH: number,
  padding: number,
  requested: ExportScale,
  isIOS: boolean,
): { scale: ExportScale; downgraded: boolean } | null {
  if (fitsAt(innerW, innerH, padding, requested, isIOS)) {
    return { scale: requested, downgraded: false }
  }
  if (requested !== 1 && fitsAt(innerW, innerH, padding, 1, isIOS)) {
    return { scale: 1, downgraded: true }
  }
  return null
}

export interface SourceRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

// Source rectangle for an `object-fit: cover` draw with optional crop offset/zoom.
// Equivalent to CSS cover + object-position + scale transform. The ctx.drawImage
// call itself stays in the hook; this is just the arithmetic.
export function coverCropRect(
  natW: number,
  natH: number,
  dw: number,
  dh: number,
  cropX = 0.5,
  cropY = 0.5,
  cropScale = 1.0,
): SourceRect {
  const srcAspect = natW / natH
  const dstAspect = dw / dh
  let sw: number
  let sh: number
  if (srcAspect > dstAspect) {
    sh = natH
    sw = natH * dstAspect
  } else {
    sw = natW
    sh = natW / dstAspect
  }
  sw /= cropScale
  sh /= cropScale
  const sx = (natW - sw) * cropX
  const sy = (natH - sh) * cropY
  return { sx, sy, sw, sh }
}

// Sidebar width clamped to [MIN, MAX] around the widest name. `measure` is injected
// so this stays pure and testable (the hook supplies a canvas-backed measurer).
export function measureSidebarWidth(
  names: string[],
  measure: (text: string) => number,
): number {
  const maxText = names.reduce((max, n) => Math.max(max, measure(n)), 0)
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, maxText + SIDEBAR_PADDING_H * 2))
}

// Truncate `text` with a trailing ellipsis so it fits `maxWidth`. Returns the text
// unchanged when it already fits. `measure` is injected for testability.
export function truncateToWidth(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string {
  if (measure(text) <= maxWidth) return text
  let t = text
  while (t.length > 0 && measure(t + '…') > maxWidth) {
    t = t.slice(0, -1)
  }
  return t + '…'
}
