import { useMemo, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import type { Chart, Slot } from '@/types/chart'
import { generateCellMap } from '@/utils/cellMap'
import { getSlot } from '@/utils/chart'
import { moveFocus, type GridNavKey } from '@/utils/gridNav'
import { isMultiFaceLayout } from '@/utils/scryfall'
import ContextMenu from '@/components/ContextMenu'
import NameDisplay from '@/components/NameDisplay'
import styles from './Grid.module.css'

interface Props {
  chart: Chart
  onSlotClear: (slotIndex: number) => void
  onSlotMove: (from: number, to: number) => void
  onSlotFillAtIndex: (slotIndex: number, slot: Slot) => void
  onFaceToggle: (slotIndex: number) => void
  onOpenPrintings: (slotIndex: number) => void
  selectedSlotIndex: number | null
  onCellSelect: (slotIndex: number | null) => void
  notifications?: ReactNode
}

const NAV_KEYS: readonly GridNavKey[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']

export default function GridArea({
  chart,
  onSlotClear,
  onSlotMove,
  onSlotFillAtIndex,
  onFaceToggle,
  onOpenPrintings,
  selectedSlotIndex,
  onCellSelect,
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
    viaKeyboard: boolean
  } | null>(null)

  // The grid is one tab stop (roving tabindex). The tab stop is the selected cell
  // when there's a selection (so Tab enters the grid on the selected cell), else
  // the last-focused cell (so Delete/Escape — which clear selection but keep focus
  // — leave the tab stop where the user is). Clamped so a stale index can't leave
  // the grid untabbable after a shrink.
  const [focusIndex, setFocusIndex] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)

  const maxSlotIndex = useMemo(
    () => cellMap.reduce((m, c) => (c.kind !== 'covered' ? Math.max(m, c.slotIndex) : m), 0),
    [cellMap],
  )
  const tabStop = Math.min(selectedSlotIndex ?? focusIndex, maxSlotIndex)

  const focusCell = useCallback((slotIndex: number) => {
    gridRef.current?.querySelector<HTMLElement>(`[data-slot-index="${slotIndex}"]`)?.focus()
  }, [])

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

  // Restore focus to the invoking cell when a keyboard-opened menu closes, so a
  // Shift+F10 → Escape round trip returns the user to where they were.
  const closeContextMenu = useCallback(() => {
    if (contextMenu?.viaKeyboard) focusCell(contextMenu.slotIndex)
    setContextMenu(null)
  }, [contextMenu, focusCell])

  const handleCellContextMenu = useCallback((e: React.MouseEvent, slotIndex: number) => {
    e.preventDefault()
    setContextMenu({ slotIndex, x: e.clientX, y: e.clientY, viaKeyboard: false })
  }, [])

  const handleContextRemove = useCallback(() => {
    if (contextMenu === null) return
    onSlotClear(contextMenu.slotIndex)
    closeContextMenu()
  }, [contextMenu, onSlotClear, closeContextMenu])

  const handleContextSwitchPrinting = useCallback(() => {
    if (contextMenu === null) return
    onOpenPrintings(contextMenu.slotIndex)
    closeContextMenu()
  }, [contextMenu, onOpenPrintings, closeContextMenu])

  const handleContextSwitchFace = useCallback(() => {
    if (contextMenu === null) return
    onFaceToggle(contextMenu.slotIndex)
    closeContextMenu()
  }, [contextMenu, onFaceToggle, closeContextMenu])

  const contextMenuSlot = contextMenu !== null ? getSlot(chart, contextMenu.slotIndex) : null

  // Grid-scoped keyboard model (no global listeners). Selection follows focus:
  // arrow/Home/End move focus AND select, matching what click does for pointers.
  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const cellEl = (e.target as HTMLElement).closest<HTMLElement>('[data-slot-index]')
      if (!cellEl) return
      const current = Number(cellEl.dataset.slotIndex)
      const slot = getSlot(chart, current)
      const key = e.key

      if ((NAV_KEYS as readonly string[]).includes(key)) {
        e.preventDefault()
        const dest = moveFocus(cellMap, chart.gridCols, current, key as GridNavKey)
        onCellSelect(dest)
        focusCell(dest)
        return
      }

      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        // Select as fill target (empty) or select the card (filled). No move-mode
        // in this phase — that's Phase 3.
        e.preventDefault()
        onCellSelect(current)
        return
      }

      if (key === 'Delete' || key === 'Backspace') {
        if (slot) {
          e.preventDefault()
          onSlotClear(current)
          // Focus stays on the now-empty cell (it still renders). Keep it the tab
          // stop even though selection was cleared by the clear.
          setFocusIndex(current)
        }
        return
      }

      if (key === 'Escape') {
        onCellSelect(null)
        setFocusIndex(current)
        return
      }

      if ((e.shiftKey && key === 'F10') || key === 'ContextMenu') {
        if (slot) {
          e.preventDefault()
          const rect = cellEl.getBoundingClientRect()
          setContextMenu({ slotIndex: current, x: rect.left, y: rect.bottom, viaKeyboard: true })
        }
      }
    },
    [cellMap, chart, onCellSelect, onSlotClear, focusCell],
  )

  const isSquare = chart.displayMode === 'square'

  const renderCell = (cell: (typeof cellMap)[number], row: number, col: number): ReactNode => {
    if (cell.kind === 'covered') return null
    const slot = getSlot(chart, cell.slotIndex)
    const isSelected = cell.slotIndex === selectedSlotIndex
    const displayName = slot
      ? slot.kind === 'scryfall'
        ? slot.cardName
        : slot.label
      : null

    const cellClass = [
      styles.cell,
      isSquare ? styles.cellSquare : '',
      dragOver === cell.slotIndex ? styles.cellDragOver : '',
      isSelected ? styles.cellSelected : '',
    ]
      .filter(Boolean)
      .join(' ')

    const heroAria =
      cell.kind === 'hero'
        ? { 'aria-rowspan': cell.rowSpan, 'aria-colspan': cell.colSpan }
        : {}

    return (
      <div
        key={cell.slotIndex}
        className={cellClass}
        role="gridcell"
        aria-selected={isSelected}
        aria-label={`${displayName ?? 'Empty'}, row ${row + 1} column ${col + 1}`}
        tabIndex={cell.slotIndex === tabStop ? 0 : -1}
        data-slot-index={cell.slotIndex}
        onFocus={() => setFocusIndex(cell.slotIndex)}
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
        {...heroAria}
        onContextMenu={slot ? (e) => handleCellContextMenu(e, cell.slotIndex) : undefined}
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
                alt={displayName ?? ''}
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
              {/* Per-cell buttons are pointer accelerators only: aria-hidden and out
                  of the tab order so they aren't duplicate tab stops / nested
                  interactives inside the gridcell. Every action they offer also lives
                  on the Selected-card surface and (filled cells) the context menu. */}
              <button
                className={styles.removeBtn}
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                onClick={(e) => { e.stopPropagation(); onSlotClear(cell.slotIndex) }}
              >
                ×
              </button>
              {slot.kind === 'scryfall' && (
                <button
                  className={styles.printingBtn}
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={(e) => { e.stopPropagation(); onOpenPrintings(cell.slotIndex) }}
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
                  tabIndex={-1}
                  aria-hidden="true"
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
  }

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
            role="grid"
            aria-label="Card grid"
            aria-rowcount={chart.gridRows}
            aria-colcount={chart.gridCols}
            onKeyDown={handleGridKeyDown}
            onClick={(e) => { if (e.target === e.currentTarget) onCellSelect(null) }}
            style={{
              gridTemplateRows: `repeat(${chart.gridRows}, 1fr)`,
              gridTemplateColumns: `repeat(${chart.gridCols}, 1fr)`,
              gap: chart.cellGap,
            }}
          >
            {Array.from({ length: chart.gridRows }, (_, row) => (
              <div key={row} role="row" className={styles.row}>
                {cellMap
                  .slice(row * chart.gridCols, row * chart.gridCols + chart.gridCols)
                  .map((cell, col) => renderCell(cell, row, col))}
              </div>
            ))}
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
          autoFocus={contextMenu.viaKeyboard}
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
    </main>
  )
}
