import { useState, useRef, useCallback } from 'react'
import type { Chart, ScryfallSlot } from '@/types/chart'
import { getSlot } from '@/utils/chart'
import { generateCellMap } from '@/utils/cellMap'
import { fetchAsBlob, loadImage, FetchError } from '@/utils/imageBlob'
import { fetchCardById } from '@/utils/scryfall'
import {
  supportsClipboardImage,
  supportsFileShare,
  realClipboardEnv,
  realShareEnv,
} from '@/utils/shareSupport'
import {
  computeExportLayout,
  coverCropRect,
  exportPixelDims,
  resolveExportSizing,
  shouldHardErrorExport,
  measureSidebarWidth,
  truncateToWidth,
  TITLE_FONT_SIZE,
  SIDEBAR_GAP,
  SIDEBAR_PADDING_H,
  SIDEBAR_FONT_SIZE,
  SIDEBAR_LINE_HEIGHT,
  type ExportScale,
} from '@/utils/exportGeometry'

export type { ExportScale }

export interface UseExportResult {
  exporting: boolean
  error: string | null
  warning: string | null
  scale: ExportScale
  setScale: (s: ExportScale) => void
  dismissError: () => void
  dismissWarning: () => void
  /** Render the PNG and trigger a file download (the default disposal). */
  triggerExport: () => void
  /** Render the PNG and write it to the clipboard. Resolves on success, rejects on
   *  failure so the caller can show transient copied/failed feedback. */
  copyExport: () => Promise<void>
  /** Render the PNG and hand it to the native share sheet. Resolves quietly (incl.
   *  when the user dismisses the sheet); only unexpected errors reject. */
  shareExport: () => Promise<void>
}

const OVERLAY_FONT_SIZE = 11
const TEXT_PRIMARY = '#e8e8e8'
const OVERLAY_BG = 'rgba(0,0,0,0.65)'
const BG_CELL = '#1a1c21'
const BORDER_CELL = '#2a2c32'
const BODY_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

function fillTextTruncated(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  ctx.fillText(truncateToWidth(text, maxWidth, (t) => ctx.measureText(t).width), x, y)
}

function drawCoverCrop(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  cropX = 0.5,
  cropY = 0.5,
  cropScale = 1.0,
) {
  const { sx, sy, sw, sh } = coverCropRect(
    img.naturalWidth,
    img.naturalHeight,
    dw,
    dh,
    cropX,
    cropY,
    cropScale,
  )
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
}

function exportFilename(chart: Pick<Chart, 'title' | 'name'>): string {
  return `${chart.title || chart.name || 'manachart'}.png`
}

// Disposal for the download path: anchor + click, with a deferred revoke (Safari
// intermittently aborts a download whose blob URL is revoked synchronously).
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function useExport(
  chart: Chart,
  onSlotImageUpdate: (slotIndex: number, imageUris: ScryfallSlot['imageUris']) => void,
): UseExportResult {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [scale, setScale] = useState<ExportScale>(2)
  const exportingRef = useRef(false)

  const dismissError = useCallback(() => {
    setError(null)
    setWarning(null)
  }, [])
  const dismissWarning = useCallback(() => setWarning(null), [])

  // Renders the chart to a PNG blob and returns it (or null on a handled failure,
  // with error/warning state already set). Disposal — download, clipboard, share —
  // is layered on top by the thin wrappers below, so every output mode goes through
  // the identical sizing/budget/degradation pipeline instead of duplicating it.
  const runExport = useCallback(async (): Promise<Blob | null> => {
    if (exportingRef.current) return null
    exportingRef.current = true
    setExporting(true)
    setError(null)
    setWarning(null)

    const blobUrls: string[] = []

    try {
      await document.fonts.ready

      const isIOS =
        /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

      const cols = chart.gridCols
      const rows = chart.gridRows
      const gap = chart.cellGap
      const padding = chart.padding

      const cellMap = generateCellMap(rows, cols, chart.heroConfig)

      // Sidebar width measured before layout so innerW is accurate. NOTE: this
      // canvas text measurement is the one part of sizing that is not purely
      // config-derived — metrics vary slightly by browser, so sidebar-mode exports
      // can differ by a few px across platforms (see exportGeometry header).
      let sidebarWidth = 0
      if (chart.nameDisplayMode === 'sidebar') {
        const names = cellMap
          .filter((c) => c.kind !== 'covered')
          .flatMap((c) => {
            const s = getSlot(chart, c.slotIndex)
            return s ? [s.kind === 'scryfall' ? s.cardName : s.label] : []
          })
        const scratch = document.createElement('canvas')
        const scratchCtx = scratch.getContext('2d')!
        scratchCtx.font = `${SIDEBAR_FONT_SIZE}px ${BODY_FONT}`
        sidebarWidth = measureSidebarWidth(names, (t) => scratchCtx.measureText(t).width)
      }

      // Deterministic geometry: target-resolution cell sizing from chart config
      // alone (no DOM), capped by the device budget so the requested scale fits at
      // the sharpest cell rather than overshooting and downgrading (Task-1 fix).
      const sizing = resolveExportSizing({
        rows,
        cols,
        gap,
        padding,
        displayMode: chart.displayMode,
        hasTitle: !!chart.title,
        sidebarWidth,
        requestedScale: scale,
        isIOS,
      })
      if (!sizing) {
        setError(
          isIOS
            ? 'This chart is too large to export on iOS — Safari caps the maximum canvas size. Reduce the grid size (fewer rows or columns) and try again.'
            : 'This chart is too large to export on this device. Reduce the grid size (fewer rows or columns) and try again.',
        )
        return null
      }
      const { scale: finalScale, downgraded } = sizing

      const { cellW, cellH, totalGridW, titleHeight, innerW, innerH } = computeExportLayout({
        rows,
        cols,
        gap,
        displayMode: chart.displayMode,
        hasTitle: !!chart.title,
        sidebarWidth,
        cellW: sizing.cellW,
      })

      // Same rounded dimensions the budget preflight checked (exportPixelDims), so a
      // size that passed resolveExportSizing is guaranteed to fit after allocation.
      const { w: exportW, h: exportH } = exportPixelDims(innerW, innerH, padding, finalScale)

      // Pre-fetch blobs with 404 recovery. A single unrecoverable image must not
      // abort the whole export — skip the cell (it renders as an empty placeholder)
      // and collect the name for a post-export warning.
      const filledCells = cellMap.filter(
        (c): c is Exclude<(typeof cellMap)[number], { kind: 'covered' }> =>
          c.kind !== 'covered' && getSlot(chart, c.slotIndex) !== null,
      )

      const imgBySlot = new Map<number, HTMLImageElement>()
      const failedCards: string[] = []

      for (const cell of filledCells) {
        const slot = getSlot(chart, cell.slotIndex)!

        if (slot.kind === 'custom') {
          try {
            imgBySlot.set(cell.slotIndex, await loadImage(slot.localImageDataUrl))
          } catch {
            failedCards.push(slot.label)
          }
          continue
        }

        try {
          const artCropUrl = slot.imageUris[slot.selectedFaceIndex].artCrop

          let blob: Blob
          try {
            blob = await fetchAsBlob(artCropUrl)
          } catch (e) {
            // Only a 404 is recoverable (stale image URL) — re-fetch the card by id.
            if (!(e instanceof FetchError) || e.status !== 404) throw e
            const recovered = await fetchCardById(slot.scryfallId)
            if (!recovered) throw e
            onSlotImageUpdate(cell.slotIndex, recovered.imageUris)
            const newUrl = recovered.imageUris[slot.selectedFaceIndex]?.artCrop
            if (!newUrl) throw e
            blob = await fetchAsBlob(newUrl)
          }

          const blobUrl = URL.createObjectURL(blob)
          blobUrls.push(blobUrl)
          imgBySlot.set(cell.slotIndex, await loadImage(blobUrl))
        } catch {
          failedCards.push(slot.cardName)
        }
      }

      // Failure handling. Nothing loaded → always a hard error (an empty PNG helps
      // no one). The >50% "systemic problem" hard error only applies at/above the
      // cell-count threshold, so a small chart degrades to a usable partial PNG +
      // warning instead (e.g. a 3-card chart with 2 failures still downloads its 1
      // loaded card). See shouldHardErrorExport.
      const totalFilled = filledCells.length
      const allFailed = totalFilled > 0 && imgBySlot.size === 0
      if (shouldHardErrorExport(totalFilled, failedCards.length)) {
        setError(
          allFailed
            ? "Export failed — couldn't load any card art. Check your connection and try again."
            : `Export failed — couldn't load ${failedCards.length} of ${totalFilled} card images (possible rate-limiting or a connection issue). Try again in a moment.`,
        )
        return null
      }

      // Draw
      const canvas = document.createElement('canvas')
      canvas.width = exportW
      canvas.height = exportH
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas unavailable — device may be low on memory.')

      ctx.scale(finalScale, finalScale)

      // Background
      ctx.fillStyle = chart.backgroundColor
      ctx.fillRect(0, 0, innerW + 2 * padding, innerH + 2 * padding)

      // Title
      if (chart.title) {
        // Explicitly load the selected font before drawing. document.fonts.ready
        // is not sufficient when no DOM element has rendered the font yet —
        // canvas uses the FontFace API independently and requires an explicit load.
        // A font-load failure must never abort the whole export: FontFaceSet.load
        // rejects on a network/parse error, so swallow it and let the draw fall
        // back to whatever the browser matches (default font at worst).
        if (chart.titleFont) {
          try {
            await document.fonts.load(`600 ${TITLE_FONT_SIZE}px "${chart.titleFont}"`)
          } catch {
            // fall through and draw the title in the fallback font
          }
        }
        ctx.save()
        const titleFontFamily = chart.titleFont ? `"${chart.titleFont}"` : BODY_FONT
        ctx.font = `600 ${TITLE_FONT_SIZE}px ${titleFontFamily}`
        ctx.fillStyle = TEXT_PRIMARY
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(chart.title, padding + innerW / 2, padding + titleHeight / 2)
        ctx.restore()
      }

      const gridOriginX = padding
      const gridOriginY = padding + titleHeight

      // Cells — cellMap-driven so hero cells span correctly and covered cells are skipped
      cellMap.forEach((cell, idx) => {
        if (cell.kind === 'covered') return
        const mapRow = Math.floor(idx / cols)
        const mapCol = idx % cols
        const cellX = gridOriginX + mapCol * (cellW + gap)
        const cellY = gridOriginY + mapRow * (cellH + gap)
        const dw = cell.kind === 'hero' ? cell.colSpan * cellW + (cell.colSpan - 1) * gap : cellW
        const dh = cell.kind === 'hero' ? cell.rowSpan * cellH + (cell.rowSpan - 1) * gap : cellH
        const slot = getSlot(chart, cell.slotIndex)
        const img = imgBySlot.get(cell.slotIndex)

        ctx.save()
        ctx.beginPath()
        ctx.roundRect(cellX, cellY, dw, dh, chart.cornerRadius)

        if (slot && img) {
          ctx.clip()
          drawCoverCrop(ctx, img, cellX, cellY, dw, dh, slot.cropX, slot.cropY, slot.cropScale)

          if (chart.nameDisplayMode === 'overlay') {
            const overlayH = 20 + OVERLAY_FONT_SIZE * 1.5 + 5
            const gradY = cellY + dh - overlayH
            const grad = ctx.createLinearGradient(0, gradY, 0, cellY + dh)
            grad.addColorStop(0, 'transparent')
            grad.addColorStop(1, OVERLAY_BG)
            ctx.fillStyle = grad
            ctx.fillRect(cellX, gradY, dw, overlayH)

            ctx.font = `${OVERLAY_FONT_SIZE}px ${BODY_FONT}`
            ctx.fillStyle = TEXT_PRIMARY
            ctx.textAlign = 'left'
            ctx.textBaseline = 'bottom'
            fillTextTruncated(ctx, slot.kind === 'scryfall' ? slot.cardName : slot.label, cellX + 6, cellY + dh - 5, dw - 12)
          }
        } else {
          ctx.fillStyle = BG_CELL
          ctx.fill()
          ctx.strokeStyle = BORDER_CELL
          ctx.lineWidth = 1
          ctx.stroke()
        }

        ctx.restore()
      })

      // Sidebar — group by origin row, use hero span height when present
      if (chart.nameDisplayMode === 'sidebar') {
        const sidebarX = gridOriginX + totalGridW + SIDEBAR_GAP
        const lineH = SIDEBAR_FONT_SIZE * SIDEBAR_LINE_HEIGHT

        ctx.font = `${SIDEBAR_FONT_SIZE}px ${BODY_FONT}`
        ctx.fillStyle = TEXT_PRIMARY
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'

        // Hero rows can span multiple grid rows. To avoid overlapping sidebar clip rects,
        // interior spanned rows are folded into the hero-origin row's name block instead
        // of being emitted as separate entries.
        const heroRowSpan = new Map<number, number>()
        cellMap.forEach((cell, idx) => {
          if (cell.kind === 'hero') {
            const mapRow = Math.floor(idx / cols)
            heroRowSpan.set(mapRow, Math.max(heroRowSpan.get(mapRow) ?? 1, cell.rowSpan))
          }
        })

        for (let r = 0; r < rows; r++) {
          const isInterior = [...heroRowSpan.entries()].some(
            ([originRow, span]) => r > originRow && r < originRow + span,
          )
          if (isInterior) continue

          const span = heroRowSpan.get(r) ?? 1
          const spannedRows = new Set(Array.from({ length: span }, (_, i) => r + i))
          const rowClipH = span * cellH + (span - 1) * gap

          const names: string[] = []
          cellMap.forEach((cell, idx) => {
            if (cell.kind === 'covered') return
            if (!spannedRows.has(Math.floor(idx / cols))) return
            const s = getSlot(chart, cell.slotIndex)
            if (s) names.push(s.kind === 'scryfall' ? s.cardName : s.label)
          })
          if (names.length === 0) continue

          const rowY = gridOriginY + r * (cellH + gap)
          const blockH = names.length * lineH
          const blockY = rowY + Math.max(0, (rowClipH - blockH) / 2)

          ctx.save()
          ctx.beginPath()
          ctx.rect(sidebarX, rowY, sidebarWidth, rowClipH)
          ctx.clip()

          names.forEach((name, i) => {
            fillTextTruncated(
              ctx,
              name,
              sidebarX + SIDEBAR_PADDING_H,
              blockY + i * lineH,
              sidebarWidth - SIDEBAR_PADDING_H * 2,
            )
          })

          ctx.restore()
        }
      }

      // Produce the final PNG blob. Disposal (download / clipboard / share) is the
      // caller's job — the pipeline only renders and hands back the blob, so all
      // three output modes share identical geometry and degradation behaviour.
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (!b) {
            reject(new Error('Export failed — try 1× scale or a smaller grid.'))
            return
          }
          resolve(b)
        }, 'image/png')
      })

      // Surface any per-cell failures (and/or the scale downgrade) as a warning —
      // the export still succeeded.
      const warnings: string[] = []
      if (downgraded) {
        warnings.push(
          isIOS
            ? 'Exported at 1× — 2× exceeds this device’s canvas limit.'
            : 'Exported at 1× — 2× exceeds the maximum canvas size.',
        )
      }
      if (failedCards.length > 0) {
        warnings.push(`Exported, but couldn't load art for: ${failedCards.join(', ')}.`)
      }
      if (warnings.length > 0) setWarning(warnings.join(' '))

      return blob
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.')
      return null
    } finally {
      blobUrls.forEach((url) => URL.revokeObjectURL(url))
      setExporting(false)
      exportingRef.current = false
    }
  }, [chart, scale, onSlotImageUpdate])

  // Download disposal (existing default behaviour).
  const triggerExport = useCallback(() => {
    void runExport().then((blob) => {
      if (blob) downloadBlob(blob, exportFilename(chart))
    })
  }, [runExport, chart])

  // Clipboard disposal. Safari requires the *promise-form* ClipboardItem and that
  // navigator.clipboard.write be called synchronously inside the user gesture — so
  // this is NOT async: it kicks off runExport() and hands the pending blob promise
  // straight to ClipboardItem, all within the click's synchronous frame.
  const copyExport = useCallback((): Promise<void> => {
    if (!supportsClipboardImage(realClipboardEnv())) {
      return Promise.reject(new Error('Clipboard image copy is not supported in this browser.'))
    }
    const blobPromise = runExport().then((blob) => {
      if (!blob) throw new Error('Export produced no image to copy.')
      return blob
    })
    try {
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })])
    } catch (err) {
      // ClipboardItem construction / clipboard.write can throw *synchronously*
      // (not just reject) on some engines. Convert that into a rejected promise so
      // the caller's "Copy failed" .catch still fires, and attach a no-op handler
      // to the now-orphaned blob promise so it can't surface as an unhandled
      // rejection when the export later settles.
      blobPromise.catch(() => {})
      return Promise.reject(err instanceof Error ? err : new Error('Copy failed.'))
    }
  }, [runExport])

  // Native share-sheet disposal (mobile). navigator.share needs the real File at
  // call time (no promise form), so we render first, then share. Because rendering
  // is async, a slow export can outlive the tap's transient activation window; the
  // share then rejects (commonly NotAllowedError) and the sheet never opens. Rather
  // than fail silently, fall back to a plain download so the user always gets their
  // image. Only a genuine user dismissal (AbortError) is swallowed as a non-event.
  const shareExport = useCallback(async (): Promise<void> => {
    const blob = await runExport()
    if (!blob) return
    const filename = exportFilename(chart)
    const file = new File([blob], filename, { type: 'image/png' })
    if (!supportsFileShare(file, realShareEnv())) {
      downloadBlob(blob, filename)
      return
    }
    try {
      await navigator.share({ files: [file] })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      downloadBlob(blob, filename)
    }
  }, [runExport, chart])

  return {
    exporting,
    error,
    warning,
    scale,
    setScale,
    dismissError,
    dismissWarning,
    triggerExport,
    copyExport,
    shareExport,
  }
}
