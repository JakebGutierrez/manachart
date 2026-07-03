import type { DisplayMode } from '@/types/chart'

export type ExportScale = 1 | 2

// Target-resolution sizing, capped by the device pixel budget. Two stages, both
// fully deterministic (config only, no DOM), so a chart exports identically on
// every device of a given platform:
//
//  1. Ideal cell (computeCellWidth): solve the cell so the grid's long edge lands
//     near BASE_TARGET_LONG_EDGE, clamped to [MIN_CELL_W, MAX_CELL_W]. Small grids
//     get big cells (a 1×1 reaches the target), large grids get small cells.
//  2. Budget cap (resolveExportSizing): shrink the cell to the largest size for
//     which the *requested* scale still fits the platform budget, and only drop the
//     scale to 1× when even a MIN_CELL_W cell can't fit at 2×.
//
// The cap is what fixes the iOS regression: at 1400 the ideal 2× export of an
// ordinary chart (e.g. a 5×5) overshoots the iOS 3,000,000px² cap and would have
// downgraded to 1×; instead we keep 2× and size the cell so the export lands just
// under the cap (~2000px long edge — sharper than the old fixed-180 output). On
// desktop the 8192²-per-side budget has huge headroom, so the cap almost never
// binds and desktop keeps the full ideal cell.
//
// Constants:
//  - BASE_TARGET_LONG_EDGE = 1400 → desktop exports ~2.8k px long edge at 2×
//    (well above the old DOM-based ~1864px); a 1×1 fixes the fixed-180 ~424px
//    regression. On iOS the budget cap trims this to ~2000px.
//  - MAX_CELL_W caps the cell (only a 1×1 grid reaches it); MIN_CELL_W is the
//    minimum-useful cell — below it we downgrade scale rather than shrink further,
//    and if even MIN can't fit at 1× the export is a hard error.
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

export interface SizingParams {
  rows: number
  cols: number
  gap: number
  padding: number
  displayMode: DisplayMode
  hasTitle: boolean
  sidebarWidth?: number
  requestedScale: ExportScale
  isIOS: boolean
  targetLongEdge?: number
  minCell?: number
  maxCell?: number
}

// Largest cell width for which the export fits the platform budget at `scale`.
// Inverts the budget: the export inner box is
//   W(cell) = cols*cell + Cw,   H(cell) = rows*k*cell + Ch
// (Cw/Ch collect the gaps, sidebar, title and padding that don't scale with cell).
// Desktop is a per-side ceiling → linear solve; iOS is a total-area cap → the
// positive root of a quadratic. Can return a value below MIN (or negative) when
// the fixed overheads alone already blow the budget — the caller treats that as
// "doesn't fit at this scale".
export function maxCellForBudget(
  params: Omit<SizingParams, 'requestedScale'> & { scale: number },
): number {
  const { rows, cols, gap, padding, displayMode, hasTitle, scale, isIOS } = params
  const k = displayMode === 'square' ? 1 : 3 / 4
  const titleHeight = hasTitle ? TITLE_FONT_SIZE * TITLE_LINE_HEIGHT + TITLE_PADDING_BOTTOM : 0
  const sidebarWidth = params.sidebarWidth ?? 0
  const sidebarSection = sidebarWidth > 0 ? SIDEBAR_GAP + sidebarWidth : 0

  const cw = (cols - 1) * gap + sidebarSection + 2 * padding
  const ch = (rows - 1) * gap + titleHeight + 2 * padding

  // Shave a negligible epsilon so a result sitting exactly on the budget boundary
  // stays strictly inside it under floating-point rounding (fitsAt uses <=).
  const SHRINK = 1 - 1e-9

  if (isIOS) {
    const budget = IOS_MAX_AREA / (scale * scale) // (W)(H) <= area / scale²
    const a = cols * rows * k
    const b = cols * ch + rows * k * cw
    const c = cw * ch - budget
    const disc = b * b - 4 * a * c
    if (disc < 0) return 0 // overhead alone exceeds the budget
    return ((-b + Math.sqrt(disc)) / (2 * a)) * SHRINK
  }

  const sideBudget = DESKTOP_MAX_SIDE / scale // each side <= 8192 / scale
  return Math.min((sideBudget - cw) / cols, (sideBudget - ch) / (rows * k)) * SHRINK
}

// Resolve the export cell width AND scale together: keep the requested scale and
// shrink the cell (never below its ideal) so it fits the budget; only fall back to
// 1× when even a MIN_CELL_W cell can't fit at the requested scale; return null when
// it can't fit at 1× either (Task-3 hard error). Pure and unit-testable.
export function resolveExportSizing(
  params: SizingParams,
): { cellW: number; scale: ExportScale; downgraded: boolean } | null {
  const minCell = params.minCell ?? MIN_CELL_W
  const ideal = computeCellWidth(params)

  const tryScale = (scale: ExportScale, downgraded: boolean) => {
    const maxFit = maxCellForBudget({ ...params, scale })
    if (maxFit < minCell) return null
    return { cellW: Math.min(ideal, maxFit), scale, downgraded }
  }

  return (
    tryScale(params.requestedScale, false) ??
    (params.requestedScale !== 1 ? tryScale(1, true) : null)
  )
}

// Below this many filled cells a partial PNG beats a hard error, so the
// >50%-failed "systemic problem" guard only applies at or above it.
export const SYSTEMIC_FAILURE_MIN_CELLS = 6

// Whether a batch of per-cell image failures should abort the export with a hard
// error rather than downloading a partial PNG. Nothing loaded is always fatal; the
// >50% "systemic" rule only applies once there are enough cells for the ratio to be
// meaningful. Pure, so the policy is unit-testable.
export function shouldHardErrorExport(
  totalFilled: number,
  failedCount: number,
  minCellsForSystemic: number = SYSTEMIC_FAILURE_MIN_CELLS,
): boolean {
  if (totalFilled === 0) return false // empty chart: just a background, that's fine
  const allFailed = failedCount >= totalFilled
  const systemic = totalFilled >= minCellsForSystemic && failedCount * 2 > totalFilled
  return allFailed || systemic
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
