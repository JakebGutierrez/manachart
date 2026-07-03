import { useMemo, useState, useCallback, useRef, useEffect, type RefObject, type ReactNode } from 'react'
import type { Chart, Slot } from '@/types/chart'
import { generateCellMap } from '@/utils/cellMap'
import { getSlot } from '@/utils/chart'
import { isMultiFaceLayout } from '@/utils/scryfall'
import ContextMenu from '@/components/ContextMenu'
import PrintingSwitcher from '@/components/PrintingSwitcher'
import NameDisplay from '@/components/NameDisplay'
import styles from './Grid.module.css'

interface Props {
  chart: Chart
  onSlotClear: (slotIndex: number) => void
  onSlotUpdate: (slotIndex: number, updated: Slot) => void
  onSlotMove: (from: number, to: number) => void
  onSlotFillAtIndex: (slotIndex: number, slot: Slot) => void
  onFaceToggle: (slotIndex: number) => void
  selectedSlotIndex: number | null
  onCellSelect: (slotIndex: number | null) => void
  gridRef: RefObject<HTMLDivElement | null>
  notifications?: ReactNode
}

export default function GridArea({
  chart,
  onSlotClear,
  onSlotUpdate,
  onSlotMove,
  onSlotFillAtIndex,
  onFaceToggle,
  selectedSlotIndex,
  onCellSelect,
  gridRef,
  notifications,
}: Props) {
  const cellMap = useMemo(
    () => generateCellMap(chart.gridRows, chart.gridCols, chart.heroConfig),
    [chart.gridRows, chart.gridCols, chart.heroConfig],
  )

  const [contextMenu, setContextMenu] = useState<{
    slotIndex: number
    x: number
    y: number
  } | null>(null)
  const [printingFor, setPrintingFor] = useState<number | null>(null)

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const dragFromRef = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  // Clears the drag-over highlight when any drag ends outside the grid
  // (e.g. Escape-cancel or drop on a non-cell target). Grid-to-grid drags
  // already clear via onDragEnd, so this is a harmless no-op for those.
  useEffect(() => {
    const clear = () => setDragOver(null)
    document.addEventListener('dragend', clear)
    return () => document.removeEventListener('dragend', clear)
  }, [])

  const handleCellContextMenu = useCallback((e: React.MouseEvent, slotIndex: number) => {
    e.preventDefault()
    setContextMenu({ slotIndex, x: e.clientX, y: e.clientY })
  }, [])

  const handleContextRemove = useCallback(() => {
    if (contextMenu === null) return
    onSlotClear(contextMenu.slotIndex)
    setContextMenu(null)
  }, [contextMenu, onSlotClear])

  const handleContextSwitchPrinting = useCallback(() => {
    if (contextMenu === null) return
    setPrintingFor(contextMenu.slotIndex)
    setContextMenu(null)
  }, [contextMenu])

  const handleContextSwitchFace = useCallback(() => {
    if (contextMenu === null) return
    onFaceToggle(contextMenu.slotIndex)
    setContextMenu(null)
  }, [contextMenu, onFaceToggle])

  const handlePrintingSelect = (updated: Slot) => {
    if (printingFor === null) return
    onSlotUpdate(printingFor, updated)
    setPrintingFor(null)
  }

  const contextMenuSlot = contextMenu !== null ? getSlot(chart, contextMenu.slotIndex) : null
  const printingSlot = printingFor !== null ? getSlot(chart, printingFor) : null

  const isSquare = chart.displayMode === 'square'

  return (
    <main className={styles.area} onClick={(e) => { if (e.target === e.currentTarget) onCellSelect(null) }}>
      {notifications}
      <div className={styles.canvasGroup}>
        <div
        className={styles.canvas}
        style={{
          padding: chart.padding,
          background: chart.backgroundColor,
        }}
        onClick={(e) => { if (e.target === e.currentTarget) onCellSelect(null) }}
      >
        {chart.title && (
          <div
            className={styles.chartTitle}
            style={chart.titleFont ? { fontFamily: chart.titleFont } : undefined}
          >
            {chart.title}
          </div>
        )}
        <div
          className={styles.canvasBody}
          style={{ gap: chart.nameDisplayMode === 'sidebar' ? 16 : undefined }}
        >
          <div
            ref={gridRef}
            className={styles.grid}
            onClick={(e) => { if (e.target === e.currentTarget) onCellSelect(null) }}
            style={{
              gridTemplateRows: `repeat(${chart.gridRows}, 1fr)`,
              gridTemplateColumns: `repeat(${chart.gridCols}, 1fr)`,
              gap: chart.cellGap,
            }}
          >
            {cellMap.map((cell) => {
              if (cell.kind === 'covered') return null
              const slot = getSlot(chart, cell.slotIndex)
              const isSelected = cell.slotIndex === selectedSlotIndex

              const cellClass = [
                styles.cell,
                isSquare ? styles.cellSquare : '',
                dragOver === cell.slotIndex ? styles.cellDragOver : '',
                isSelected ? styles.cellSelected : '',
              ]
                .filter(Boolean)
                .join(' ')

              return (
                <div
                  key={cell.slotIndex}
                  className={cellClass}
                  style={{
                    borderRadius: chart.cornerRadius,
                    ...(cell.kind === 'hero' && {
                      gridRow: `span ${cell.rowSpan}`,
                      gridColumn: `span ${cell.colSpan}`,
                      // The base .cell aspect-ratio assumes a 1x1 cell. A hero spans
                      // multiple tracks, so its ratio must scale by span or it collapses
                      // to single-cell height (only commander 2x2 happens to match).
                      // Note: ignores cellGap, so heroes are off by the gap when gap > 0.
                      aspectRatio: isSquare
                        ? `${cell.colSpan} / ${cell.rowSpan}`
                        : `${cell.colSpan * 4} / ${cell.rowSpan * 3}`,
                    }),
                  }}
                  onContextMenu={
                    slot ? (e) => handleCellContextMenu(e, cell.slotIndex) : undefined
                  }
                  draggable={!!slot}
                  onDragStart={slot ? () => { dragFromRef.current = cell.slotIndex } : undefined}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(cell.slotIndex) }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(null)
                    const searchPayload = e.dataTransfer.getData('application/x-mtg-search-result')
                    if (searchPayload) {
                      try {
                        const parsed: unknown = JSON.parse(searchPayload)
                        if (typeof parsed === 'object' && parsed !== null) {
                          const p = parsed as Record<string, unknown>
                          if (
                            p.kind === 'scryfall' &&
                            Array.isArray(p.imageUris) &&
                            p.imageUris.length > 0 &&
                            typeof (p.imageUris[0] as Record<string, unknown>)?.artCrop === 'string'
                          ) {
                            onSlotFillAtIndex(cell.slotIndex, parsed as Slot)
                          }
                        }
                      } catch { /* ignore malformed payload */ }
                      dragFromRef.current = null
                      return
                    }
                    if (dragFromRef.current !== null && dragFromRef.current !== cell.slotIndex) {
                      onSlotMove(dragFromRef.current, cell.slotIndex)
                    }
                    dragFromRef.current = null
                  }}
                  onDragEnd={() => { dragFromRef.current = null; setDragOver(null) }}
                  onClick={() => onCellSelect(cell.slotIndex)}
                >
                  {slot && (() => {
                    const imgSrc = slot.kind === 'scryfall'
                      ? slot.imageUris[slot.selectedFaceIndex].artCrop
                      : slot.localImageDataUrl
                    const displayName = slot.kind === 'scryfall' ? slot.cardName : slot.label
                    return (
                      <>
                        <img
                          className={styles.cardImg}
                          src={imgSrc}
                          // CORS-consistent with the export's fetch(mode:'cors') so both
                          // share one cache entry — the grid load no longer poisons the
                          // cache with an opaque response the export can't reuse. Harmless
                          // on custom data: URLs (treated same-origin).
                          crossOrigin="anonymous"
                          alt={displayName}
                          style={{
                            objectPosition: `${slot.cropX * 100}% ${slot.cropY * 100}%`,
                            ...(slot.cropScale !== 1.0 && {
                              transform: `scale(${slot.cropScale})`,
                              transformOrigin: `${slot.cropX * 100}% ${slot.cropY * 100}%`,
                            }),
                          }}
                        />
                        {slot.kind === 'scryfall' && slot.imageUris[slot.selectedFaceIndex].artist && (
                          <div className={styles.artistStrip}>
                            Art by {slot.imageUris[slot.selectedFaceIndex].artist}
                          </div>
                        )}
                        {chart.nameDisplayMode === 'overlay' && (
                          <NameDisplay mode="overlay" slot={slot} />
                        )}
                        <button
                          className={styles.removeBtn}
                          type="button"
                          aria-label={`Remove ${displayName}`}
                          onClick={(e) => { e.stopPropagation(); onSlotClear(cell.slotIndex) }}
                        >
                          ×
                        </button>
                        {slot.kind === 'scryfall' && (
                          <button
                            className={styles.printingBtn}
                            type="button"
                            aria-label={`Switch printing for ${slot.cardName}`}
                            onClick={(e) => { e.stopPropagation(); setPrintingFor(cell.slotIndex) }}
                          >
                            ⇄
                          </button>
                        )}
                        {slot.kind === 'scryfall' &&
                          isMultiFaceLayout(slot.layout) &&
                          slot.imageUris.length > 1 && (
                          <button
                            className={styles.flipBtn}
                            type="button"
                            aria-label={`Flip ${slot.cardName}`}
                            onClick={(e) => { e.stopPropagation(); onFaceToggle(cell.slotIndex) }}
                          >
                            ↺
                          </button>
                        )}
                      </>
                    )
                  })()}
                </div>
              )
            })}
          </div>
          {chart.nameDisplayMode === 'sidebar' && (
            <NameDisplay mode="sidebar" chart={chart} cellMap={cellMap} />
          )}
        </div>
        </div>
      </div>

      {contextMenu !== null && contextMenuSlot !== null && (
        <ContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onRemove={handleContextRemove}
          onSwitchPrinting={contextMenuSlot.kind === 'scryfall' ? handleContextSwitchPrinting : null}
          onSwitchFace={
            contextMenuSlot.kind === 'scryfall' &&
            isMultiFaceLayout(contextMenuSlot.layout) &&
            contextMenuSlot.imageUris.length > 1
              ? handleContextSwitchFace
              : null
          }
          onClose={closeContextMenu}
        />
      )}

      {printingFor !== null && printingSlot !== null && printingSlot.kind === 'scryfall' && (
        <PrintingSwitcher
          currentSlot={printingSlot}
          onSelect={handlePrintingSelect}
          onClose={() => setPrintingFor(null)}
        />
      )}
    </main>
  )
}
