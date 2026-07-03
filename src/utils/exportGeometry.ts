import type { DisplayMode } from '@/types/chart'

// Fixed logical cell width for export. Export resolution is derived from chart
// config alone — never from the live DOM/viewport — so the same chart exports at
// the same size on every device (and mobile is no longer downscaled).
//
// Why 180: it keeps a worst-case 10×10 landscape grid within the iOS 3,000,000px²
// budget at 1× (see fitsAt), while still rendering typical grids sharply — at 2×
// a cell is 360 device-px, above what Scryfall's art_crop (~626×457) actually
// resolves, so nothing upscales. It also matches the ~177px cell the old
// 900px-wide desktop grid produced for a 5×5, so desktop exports are unchanged in
// resolution; smaller grids on desktop export a touch smaller than before, and all
// mobile exports get much sharper.
export const EXPORT_CELL_W = 180

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

export interface LayoutParams {
  rows: number
  cols: number
  gap: number
  displayMode: DisplayMode
  hasTitle: boolean
  /** Measured sidebar width, or 0/omitted when name display is not 'sidebar'. */
  sidebarWidth?: number
  /** Logical cell width; defaults to EXPORT_CELL_W. */
  cellW?: number
}

// Pure layout geometry: given chart config (plus a measured sidebar width) returns
// every dimension the canvas draw needs. No DOM, no measurement.
export function computeExportLayout(params: LayoutParams): ExportLayout {
  const { rows, cols, gap, displayMode, hasTitle } = params
  const cellW = params.cellW ?? EXPORT_CELL_W
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
