import { useMemo, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import type { Chart } from '@/types/chart'
import { generateCellMap } from '@/utils/cellMap'
import { getSlot } from '@/utils/chart'
import { moveFocus, type GridNavKey } from '@/utils/gridNav'
import { isMultiFaceLayout } from '@/utils/scryfall'
import { usePointerDrag } from '@/interaction/usePointerDrag'
import type { MoveApi } from '@/interaction/moveApi'
import ContextMenu from '@/components/ContextMenu'
import NameDisplay from '@/components/NameDisplay'
import styles from './Grid.module.css'

interface Props {
  chart: Chart
  onSlotClear: (slotIndex: number) => void
  onFaceToggle: (slotIndex: number) => void
  onOpenPrintings: (slotIndex: number) => void
  selectedSlotIndex: number | null
  onCellSelect: (slotIndex: number | null) => void
  move: MoveApi
  notifications?: ReactNode
}

const NAV_KEYS: readonly GridNavKey[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']

export default function GridArea({
  chart,
  onSlotClear,
  onFaceToggle,
  onOpenPrintings,
  selectedSlotIndex,
  onCellSelect,
  move,
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

  // A completed pointer drag can be followed by a synthetic click; suppress that
  // one click so a drag never also re-selects the source cell. Cleared on a
  // microtask so a drag that ends off-grid (no trailing click) can't leave the
  // flag stuck and swallow the next legitimate click.
  const suppressClickRef = useRef(false)

  const cellPointerDown = usePointerDrag<number>({
    getContext: (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-slot-index]')
      if (!el) return null
      const idx = Number(el.dataset.slotIndex)
      // Only filled cells are drag sources.
      if (!Number.isInteger(idx) || !getSlot(chart, idx)) return null
      return idx
    },
    onStart: (from) => move.beginCellDrag(from),
    onMove: (_from, x, y) => move.dragMove(x, y),
    onEnd: (_from, committed) => {
      move.dragEnd(committed)
      suppressClickRef.current = true
      setTimeout(() => { suppressClickRef.current = false }, 0)
    },
  })

  // When move is armed from the "Move" button (focus on the button, not the
  // grid), pull focus onto the source cell so arrow keys can retarget it.
  useEffect(() => {
    if (
      move.state.kind === 'moveArmed' &&
      gridRef.current &&
      !gridRef.current.contains(document.activeElement)
    ) {
      focusCell(move.state.from)
    }
  }, [move.state, focusCell])

  // Restore focus to the invoking cell when a keyboard-opened menu closes.
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

  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const cellEl = (e.target as HTMLElement).closest<HTMLElement>('[data-slot-index]')
      if (!cellEl) return
      const current = Number(cellEl.dataset.slotIndex)
      const slot = getSlot(chart, current)
      const key = e.key

      // ── Armed move (keyboard grab / "Move" button) ──────────────────────
      if (move.state.kind === 'moveArmed') {
        const armedOver = move.state.over
        if ((NAV_KEYS as readonly string[]).includes(key)) {
          e.preventDefault()
          const dest = moveFocus(cellMap, chart.gridCols, armedOver, key as GridNavKey)
          move.retarget(dest)
          focusCell(dest)
          return
        }
        if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
          e.preventDefault()
          move.commit(armedOver)
          focusCell(armedOver)
          return
        }
        if (key === 'Escape') {
          e.preventDefault()
          const from = move.state.from
          move.cancel()
          focusCell(from)
          return
        }
        return // swallow other keys while armed
      }

      // ── Normal selection/navigation ─────────────────────────────────────
      if ((NAV_KEYS as readonly string[]).includes(key)) {
        e.preventDefault()
        const dest = moveFocus(cellMap, chart.gridCols, current, key as GridNavKey)
        onCellSelect(dest)
        focusCell(dest)
        return
      }

      if (key === 'Enter') {
        e.preventDefault()
        onCellSelect(current)
        return
      }

      if (key === ' ' || key === 'Spacebar') {
        // Filled cell: arm move (grab). Empty cell: select as fill target.
        e.preventDefault()
        if (slot) move.grab(current)
        else onCellSelect(current)
        return
      }

      if (key === 'Delete' || key === 'Backspace') {
        if (slot) {
          e.preventDefault()
          onSlotClear(current)
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
    [cellMap, chart, onCellSelect, onSlotClear, focusCell, move],
  )

  // Focus leaving the grid while a move is armed cancels it (no mutation), e.g.
  // the user tabs or clicks away mid-grab.
  const handleGridBlur = useCallback(
    (e: React.FocusEvent) => {
      if (move.state.kind === 'moveArmed' && !gridRef.current?.contains(e.relatedTarget as Node)) {
        move.cancel()
      }
    },
    [move],
  )

  const handleCellClick = useCallback(
    (slotIndex: number) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }
      if (move.state.kind === 'moveArmed') {
        move.commit(slotIndex)
        focusCell(slotIndex)
        return
      }
      onCellSelect(slotIndex)
    },
    [move, onCellSelect, focusCell],
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

    const isMoveSource =
      (move.state.kind === 'dragging' || move.state.kind === 'moveArmed') &&
      move.state.from === cell.slotIndex
    const isDropTarget =
      (move.state.kind === 'dragging' || move.state.kind === 'moveArmed') &&
      move.state.over === cell.slotIndex &&
      move.state.over !== move.state.from

    const cellClass = [
      styles.cell,
      isSquare ? styles.cellSquare : '',
      isDropTarget ? styles.cellDropTarget : '',
      isMoveSource ? styles.cellMoving : '',
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
        onPointerDown={slot ? cellPointerDown : undefined}
        onContextMenu={slot ? (e) => handleCellContextMenu(e, cell.slotIndex) : undefined}
        onClick={() => handleCellClick(cell.slotIndex)}
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
                draggable={false}
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
                  interactives inside the gridcell. */}
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
            onBlur={handleGridBlur}
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
