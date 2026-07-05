import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import './App.css'
import ControlPanel from '@/components/ControlPanel'
import GridArea from '@/components/Grid'
import ImportModal from '@/components/ImportModal'
import PrintingSwitcher from '@/components/PrintingSwitcher'
import ConfirmDialog from '@/components/Dialog/ConfirmDialog'
import DragGhost from '@/components/DragGhost'
import { moveReducer, IDLE } from '@/interaction/moveMachine'
import { generateCellMap } from '@/utils/cellMap'
import { getSlot, resolveSlotFillTarget } from '@/utils/chart'
import { useExport } from '@/hooks/useExport'
import { useCharts } from '@/hooks/useCharts'
import { sortSlots, shuffleSlots } from '@/utils/sort'
import type { SortKey } from '@/utils/sort'
import { encodeShareLink } from '@/utils/shareLink'
import { isEditableEventTarget } from '@/utils/dom'
import { pushPast, shouldPushSnapshot } from '@/utils/history'
import type { Chart, Slot, ScryfallSlot, CellDef, NumericStyleField, NameDisplayMode, DisplayMode, Layout, HeroConfig } from '@/types/chart'

type LayoutMode = 'uniform' | 'commander' | 'partner'

const COMMANDER_HERO_CONFIG: HeroConfig = [{ row: 0, col: 0, rowSpan: 2, colSpan: 2 }]
const PARTNER_HERO_CONFIG: HeroConfig = [
  { row: 0, col: 0, rowSpan: 2, colSpan: 1 },
  { row: 0, col: 1, rowSpan: 2, colSpan: 1 },
]

function getLayoutMode(heroConfig: HeroConfig): LayoutMode {
  if (heroConfig.length === 0) return 'uniform'
  if (heroConfig.length >= 2) return 'partner'
  return 'commander'
}

const STYLE_LIMITS: Record<NumericStyleField, [min: number, max: number]> = {
  cellGap: [0, 32],
  padding: [0, 64],
  cornerRadius: [0, 32],
}

interface History {
  past: Chart[]
  future: Chart[]
}

type CropValues = { cropX: number; cropY: number; cropScale: number }

// A destructive action awaiting ConfirmDialog resolution. Stored as a
// discriminated action rather than a captured callback so confirming always
// applies through the current handlers against the freshest chart state.
type PendingConfirm =
  | { kind: 'layout-change'; mode: LayoutMode }
  | { kind: 'clear-cards' }

function App() {
  const {
    charts, activeId, activeChart,
    createChart, duplicateChart, deleteChart, updateChart, renameChart, setActiveId,
    isReconstructing, reconstructionError, reconstructionWarning, storageError,
    canRetryReconstruction, retryReconstruction,
    dismissReconstructionError, dismissReconstructionWarning, dismissStorageError,
  } = useCharts()

  // Option B: per-chart undo/redo history lives here in App, above useCharts.
  // History is session-only — not persisted to localStorage.
  // Only content mutations push history; chart-level ops and handleSlotImageUpdate do not.
  const [history, setHistory] = useState<History>({ past: [], future: [] })

  // The field currently being edited as a coalesced burst (title typing / colour
  // dragging), or null. Any non-coalesced history push resets it so the next
  // title/colour edit starts a fresh undo entry (B4).
  const editBurstFieldRef = useRef<'title' | 'bgColor' | null>(null)

  // Clear the burst when the active chart changes, so the first title/colour edit
  // on the newly-active chart starts its own undo snapshot. Without this, a burst
  // carried over from the previous chart (e.g. you were editing chart A's title)
  // would suppress the first edit's snapshot on chart B, leaving it un-undoable.
  useEffect(() => {
    editBurstFieldRef.current = null
  }, [activeId])

  // Wraps updateChart with history push. Runs the updater against activeChart first to
  // detect no-ops (same reference returned) and skip the history push in that case.
  // Known tradeoff: the no-op check runs on render-time activeChart while updateChart
  // runs the updater on the freshest prev inside the reducer. In practice these are
  // always the same — handleSlotImageUpdate (the only other updateChart caller) fires
  // from an async export Promise, a separate event-loop task that is never batched
  // with user interactions in this app.
  const updateChartWithHistory = useCallback(
    (updater: (prev: Chart) => Chart) => {
      editBurstFieldRef.current = null
      if (updater(activeChart) !== activeChart) {
        setHistory((h) => ({ past: pushPast(h.past, activeChart), future: [] }))
      }
      updateChart(updater)
    },
    [updateChart, activeChart],
  )

  // Coalesce a burst of same-field edits into a single history snapshot, pushed on
  // the FIRST actual change (not on focus, so focus-then-blur with no edit adds no
  // undo entry). A different field or any other history push starts a new burst.
  const applyCoalescedEdit = useCallback(
    (field: 'title' | 'bgColor', updater: (prev: Chart) => Chart) => {
      if (shouldPushSnapshot(editBurstFieldRef.current, field) && updater(activeChart) !== activeChart) {
        setHistory((h) => ({ past: pushPast(h.past, activeChart), future: [] }))
      }
      editBurstFieldRef.current = field
      updateChart(updater)
    },
    [updateChart, activeChart],
  )

  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null)
  // Printing-switcher target lives here (not in Grid) so it can be opened from
  // the Grid (per-cell button / context menu) and the Selected-card action
  // surface alike. Cleared alongside selection on chart-level transitions.
  const [printingForIndex, setPrintingForIndex] = useState<number | null>(null)
  // Card-movement machine state (Phase 3). Declared here so chart-level handlers
  // above the movement orchestration can reset it synchronously alongside
  // selection/printing (no reset-in-effect). The rest of the orchestration —
  // refs, commit/drag callbacks — lives further down, after the slot mutators.
  const [moveState, dispatchMove] = useReducer(moveReducer, IDLE)
  const [dragPayload, setDragPayload] = useState<Slot | null>(null)
  const resetMoveState = useCallback(() => {
    dispatchMove({ type: 'RESET' })
    setDragPayload(null)
  }, [])
  const [showImportModal, setShowImportModal] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)

  // History resets synchronously when switching charts so canUndo/canRedo are
  // immediately correct for the newly active chart.
  const handleSelectChart = useCallback(
    (id: string) => {
      setHistory({ past: [], future: [] })
      setSelectedSlotIndex(null)
      setPrintingForIndex(null)
      resetMoveState()
      setActiveId(id)
    },
    [setActiveId, resetMoveState],
  )

  const handleCreateChart = useCallback(() => {
    setHistory({ past: [], future: [] })
    setSelectedSlotIndex(null)
    setPrintingForIndex(null)
    resetMoveState()
    createChart()
  }, [createChart, resetMoveState])

  // Duplicate the active chart. Like create/select, the new chart becomes active so
  // its (fresh) history starts clean and any stale crop selection is cleared.
  const handleDuplicateChart = useCallback(() => {
    setHistory({ past: [], future: [] })
    setSelectedSlotIndex(null)
    setPrintingForIndex(null)
    resetMoveState()
    duplicateChart()
  }, [duplicateChart, resetMoveState])

  const handleDeleteChart = useCallback(
    (id: string) => {
      if (id === activeId) {
        setHistory({ past: [], future: [] })
        setSelectedSlotIndex(null)
        setPrintingForIndex(null)
        resetMoveState()
      }
      deleteChart(id)
    },
    [activeId, deleteChart, resetMoveState],
  )

  const undo = useCallback(() => {
    if (history.past.length === 0) return
    editBurstFieldRef.current = null
    const snapshot = history.past[history.past.length - 1]
    setHistory((h) => ({
      past: h.past.slice(0, -1),
      future: [activeChart, ...h.future.slice(0, 49)],
    }))
    setSelectedSlotIndex(null)
    setPrintingForIndex(null)
    resetMoveState()
    updateChart(() => snapshot)
  }, [history, activeChart, updateChart, resetMoveState])

  const redo = useCallback(() => {
    if (history.future.length === 0) return
    editBurstFieldRef.current = null
    const snapshot = history.future[0]
    setHistory((h) => ({
      past: pushPast(h.past, activeChart),
      future: h.future.slice(1),
    }))
    setSelectedSlotIndex(null)
    setPrintingForIndex(null)
    resetMoveState()
    updateChart(() => snapshot)
  }, [history, activeChart, updateChart, resetMoveState])

  // Stable keyboard listener via ref — avoids re-registering on every history change.
  // useLayoutEffect (not useEffect) closes the window between commit and the native
  // keydown firing, preventing a keystroke from calling a stale closure.
  const undoRedoRef = useRef({ undo, redo, modalBlocked: false })
  useLayoutEffect(() => {
    undoRedoRef.current = {
      undo,
      redo,
      modalBlocked: showImportModal || pendingConfirm !== null,
    }
  })
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Block undo/redo while the import modal is open — runLoop has pre-assigned
      // slot indices and does not cancel on chart changes, so mutating the chart
      // mid-import can cause cards to land in the wrong slots. Also blocked while
      // a confirm dialog is pending: window.confirm used to freeze the page, and
      // undoing under an open confirm would let the confirmed action apply to a
      // different chart than the one the user was shown.
      if (undoRedoRef.current.modalBlocked) return
      // Let the browser's native undo/redo handle Cmd/Ctrl+Z inside text fields
      // instead of hijacking it for chart-level undo (B3).
      if (isEditableEventTarget(e.target)) return
      // Cmd/Ctrl+Z = undo; Cmd/Ctrl+Shift+Z = redo; Ctrl+Y = redo (Windows)
      const isUndo = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z'
      const isRedo =
        ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') ||
        (e.ctrlKey && !e.metaKey && e.key === 'y')
      if (!isUndo && !isRedo) return
      e.preventDefault()
      if (isRedo) undoRedoRef.current.redo()
      else undoRedoRef.current.undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // All handlers use the functional-updater form of updateChartWithHistory so mutations
  // always run against the freshest prev chart, not a potentially stale render-time snapshot.

  const handleSlotFill = useCallback(
    (slot: Slot) => {
      const targetIndex = selectedSlotIndex
      setSelectedSlotIndex(null)
      updateChartWithHistory((prev) => {
        const target = resolveSlotFillTarget(prev, targetIndex)
        if (target === null) return prev
        const slots = [...prev.slots]
        slots[target] = slot
        return { ...prev, slots }
      })
    },
    [updateChartWithHistory, selectedSlotIndex],
  )

  const handleSlotFillAtIndex = useCallback(
    (slotIndex: number, slot: Slot) => {
      if (selectedSlotIndex === slotIndex) setSelectedSlotIndex(null)
      updateChartWithHistory((prev) => {
        const slots = [...prev.slots]
        slots[slotIndex] = slot
        return { ...prev, slots }
      })
    },
    [updateChartWithHistory, selectedSlotIndex],
  )

  const handleSlotClear = useCallback(
    (slotIndex: number) => {
      if (slotIndex === selectedSlotIndex) setSelectedSlotIndex(null)
      if (slotIndex === printingForIndex) setPrintingForIndex(null)
      updateChartWithHistory((prev) => {
        const slots = [...prev.slots]
        slots[slotIndex] = null
        return { ...prev, slots }
      })
    },
    [updateChartWithHistory, selectedSlotIndex, printingForIndex],
  )

  const handleSlotMove = useCallback(
    (from: number, to: number) => {
      // Keep the crop selection tracking the card that moved, not the index it left.
      if (selectedSlotIndex === from) setSelectedSlotIndex(to)
      else if (selectedSlotIndex === to) setSelectedSlotIndex(from)
      updateChartWithHistory((prev) => {
        if (from === to) return prev
        const slots = [...prev.slots]
        slots[to] = getSlot(prev, from) ?? null
        slots[from] = getSlot(prev, to) ?? null
        return { ...prev, slots }
      })
    },
    [updateChartWithHistory, selectedSlotIndex],
  )

  const handleGridResize = useCallback(
    (dimension: 'rows' | 'cols', delta: 1 | -1) => {
      // Shrink recompacts slots into a new dense array, making any selectedSlotIndex
      // stale (it may now point to a different card or out-of-bounds). Clear it.
      if (delta === -1) setSelectedSlotIndex(null)
      updateChartWithHistory((prev) => {
        const newRows = dimension === 'rows' ? prev.gridRows + delta : prev.gridRows
        const newCols = dimension === 'cols' ? prev.gridCols + delta : prev.gridCols
        if (newRows < 1 || newRows > 10 || newCols < 1 || newCols > 10) return prev
        // Block shrink if any hero would extend beyond the new grid dimensions
        if (prev.heroConfig.some((h) => h.row + h.rowSpan > newRows || h.col + h.colSpan > newCols)) return prev
        if (delta === -1) {
          const cellMap = generateCellMap(prev.gridRows, prev.gridCols, prev.heroConfig)
          const cards = cellMap
            .filter((c): c is Exclude<CellDef, { kind: 'covered' }> => c.kind !== 'covered')
            .map((c) => getSlot(prev, c.slotIndex))
            .filter((s): s is Slot => s !== null)
          return { ...prev, gridRows: newRows, gridCols: newCols, slots: cards }
        }
        return { ...prev, gridRows: newRows, gridCols: newCols }
      })
    },
    [updateChartWithHistory],
  )

  const handleBgColorChange = useCallback(
    (value: string) => {
      applyCoalescedEdit('bgColor', (prev) => ({ ...prev, backgroundColor: value }))
    },
    [applyCoalescedEdit],
  )

  const handleStyleStep = useCallback(
    (field: NumericStyleField, delta: number) => {
      updateChartWithHistory((prev) => {
        const [min, max] = STYLE_LIMITS[field]
        const next = (prev[field] as number) + delta
        if (next < min || next > max) return prev
        return { ...prev, [field]: next }
      })
    },
    [updateChartWithHistory],
  )

  const handleSlotUpdate = useCallback(
    (slotIndex: number, updated: Slot) => {
      updateChartWithHistory((prev) => {
        const slots = [...prev.slots]
        slots[slotIndex] = updated
        return { ...prev, slots }
      })
    },
    [updateChartWithHistory],
  )

  const handleTitleChange = useCallback(
    (value: string) => {
      applyCoalescedEdit('title', (prev) => ({ ...prev, title: value }))
    },
    [applyCoalescedEdit],
  )

  const handleTitleFontChange = useCallback(
    (font: string | undefined) => {
      updateChartWithHistory((prev) => ({ ...prev, titleFont: font }))
    },
    [updateChartWithHistory],
  )

  const handleNameDisplayChange = useCallback(
    (mode: NameDisplayMode) => {
      updateChartWithHistory((prev) => ({ ...prev, nameDisplayMode: mode }))
    },
    [updateChartWithHistory],
  )

  const handleDisplayModeChange = useCallback(
    (mode: DisplayMode) => {
      updateChartWithHistory((prev) => ({ ...prev, displayMode: mode }))
    },
    [updateChartWithHistory],
  )

  const applyLayoutMode = useCallback(
    (mode: LayoutMode) => {
      const heroConfig = mode === 'commander' ? COMMANDER_HERO_CONFIG
        : mode === 'partner' ? PARTNER_HERO_CONFIG
        : []
      const layout: Layout = mode === 'uniform' ? 'uniform' : 'hybrid'
      updateChartWithHistory((prev) => ({ ...prev, heroConfig, layout, slots: [] }))
    },
    [updateChartWithHistory],
  )

  const handleLayoutModeChange = useCallback(
    (mode: LayoutMode) => {
      if (getLayoutMode(activeChart.heroConfig) === mode) return
      const hasCards = activeChart.slots.some((s) => s !== null)
      if (hasCards) {
        setPendingConfirm({ kind: 'layout-change', mode })
        return
      }
      applyLayoutMode(mode)
    },
    [activeChart, applyLayoutMode],
  )

  const handleSort = useCallback(
    (key: SortKey) => {
      updateChartWithHistory((prev) => ({ ...prev, slots: sortSlots(prev.slots, key) }))
    },
    [updateChartWithHistory],
  )

  const handleShuffle = useCallback(() => {
    updateChartWithHistory((prev) => ({ ...prev, slots: shuffleSlots(prev.slots) }))
  }, [updateChartWithHistory])

  const applyClearCards = useCallback(() => {
    setSelectedSlotIndex(null)
    updateChartWithHistory((prev) => ({ ...prev, slots: [] }))
  }, [updateChartWithHistory])

  const handleClearCards = useCallback(() => {
    setPendingConfirm({ kind: 'clear-cards' })
  }, [])

  // Confirm resolves through the handlers of the render in which the user clicked
  // Confirm, so the action applies to the freshest chart state.
  const handleConfirmResolve = useCallback(() => {
    if (!pendingConfirm) return
    setPendingConfirm(null)
    if (pendingConfirm.kind === 'layout-change') applyLayoutMode(pendingConfirm.mode)
    else applyClearCards()
  }, [pendingConfirm, applyLayoutMode, applyClearCards])

  const handleConfirmCancel = useCallback(() => setPendingConfirm(null), [])

  const handleCopyLink = useCallback((): Promise<number> => {
    const { encoded, customSlotsOmitted } = encodeShareLink(activeChart)
    const url = `${window.location.origin}${window.location.pathname}?c=${encoded}`
    return navigator.clipboard.writeText(url).then(() => customSlotsOmitted)
  }, [activeChart])

  // Web Share for the link (mobile). Only wired to a control that renders where
  // navigator.share exists; a user-dismissed sheet rejects with AbortError, which
  // the ControlPanel handler swallows.
  const handleShareLink = useCallback((): Promise<void> => {
    const { encoded } = encodeShareLink(activeChart)
    const url = `${window.location.origin}${window.location.pathname}?c=${encoded}`
    return navigator.share({ url })
  }, [activeChart])

  const handleFaceToggle = useCallback(
    (slotIndex: number) => {
      updateChartWithHistory((prev) => {
        const slot = getSlot(prev, slotIndex)
        if (!slot || slot.kind !== 'scryfall' || slot.imageUris.length <= 1) return prev
        const slots = [...prev.slots]
        slots[slotIndex] = {
          ...slot,
          selectedFaceIndex: (slot.selectedFaceIndex === 0 ? 1 : 0) as 0 | 1,
        }
        return { ...prev, slots }
      })
    },
    [updateChartWithHistory],
  )

  const handleCellSelect = useCallback((slotIndex: number | null) => {
    setSelectedSlotIndex(slotIndex)
  }, [])

  // Open the printing switcher for a given slot (Grid button / context menu /
  // Selected-card surface all route here).
  const handleOpenPrintings = useCallback((slotIndex: number) => {
    setPrintingForIndex(slotIndex)
  }, [])

  const handlePrintingSelect = useCallback(
    (updated: Slot) => {
      if (printingForIndex === null) return
      const target = printingForIndex
      setPrintingForIndex(null)
      handleSlotUpdate(target, updated)
    },
    [printingForIndex, handleSlotUpdate],
  )

  // Selected-card action-surface callbacks: each operates on the current
  // selection and reuses an existing domain handler.
  const handleSelectedRemove = useCallback(() => {
    if (selectedSlotIndex !== null) handleSlotClear(selectedSlotIndex)
  }, [selectedSlotIndex, handleSlotClear])

  const handleSelectedFlip = useCallback(() => {
    if (selectedSlotIndex !== null) handleFaceToggle(selectedSlotIndex)
  }, [selectedSlotIndex, handleFaceToggle])

  const handleSelectedOpenPrintings = useCallback(() => {
    if (selectedSlotIndex !== null) handleOpenPrintings(selectedSlotIndex)
  }, [selectedSlotIndex, handleOpenPrintings])

  // ── Card movement (Phase 3 spine) ────────────────────────────────────────
  // The pure machine (state declared above) is driven by the grid, the search
  // panel, and the Selected-card "Move" button — App is their shared parent.
  // Every commit fires the same domain callbacks a click/drop fired before, so
  // history/selection semantics are unchanged — one move = one undo entry.
  //
  // Live refs so a pointer drag's window-listener callbacks (captured at
  // pointerdown) read the freshest state/payload on release.
  const moveStateRef = useRef(moveState)
  const dragPayloadRef = useRef(dragPayload)
  useLayoutEffect(() => { moveStateRef.current = moveState })
  useLayoutEffect(() => { dragPayloadRef.current = dragPayload })

  // Ghost + hit-test tracking, mutated per pointermove without a React render.
  const ghostRef = useRef<HTMLDivElement>(null)
  const pointerPosRef = useRef({ x: 0, y: 0 })
  const dragOverRef = useRef<number | null>(null)

  const beginCellDrag = useCallback((from: number) => {
    dispatchMove({ type: 'DRAG_START', from, source: 'cell' })
  }, [])

  const beginSearchDrag = useCallback((slot: Slot) => {
    setDragPayload(slot)
    dispatchMove({ type: 'DRAG_START', from: -1, source: 'search' })
  }, [])

  const handleDragMove = useCallback((x: number, y: number) => {
    pointerPosRef.current = { x, y }
    if (ghostRef.current) ghostRef.current.style.transform = `translate(${x}px, ${y}px)`
    // Covered cells render no DOM node, so the hit resolves straight to a real
    // slot/hero index — no covered→hero resolution needed at the drop site.
    const el = document.elementFromPoint(x, y)?.closest('[data-slot-index]') as HTMLElement | null
    let over: number | null = null
    if (el) {
      const idx = Number(el.dataset.slotIndex)
      if (Number.isInteger(idx)) over = idx
    }
    dragOverRef.current = over
    dispatchMove({ type: 'DRAG_OVER', over })
  }, [])

  const resetMove = useCallback(() => {
    resetMoveState()
    dragOverRef.current = null
  }, [resetMoveState])

  // Commit a completed drag or armed move via the existing domain callbacks.
  const commitMove = useCallback((to: number | null) => {
    const st = moveStateRef.current
    if (st.kind === 'dragging') {
      if (to !== null) {
        if (st.source === 'search') {
          const payload = dragPayloadRef.current
          if (payload) handleSlotFillAtIndex(to, payload)
        } else if (to !== st.from) {
          handleSlotMove(st.from, to)
        }
      }
    } else if (st.kind === 'moveArmed') {
      if (to !== null && to !== st.from) handleSlotMove(st.from, to)
    }
    resetMove()
  }, [handleSlotMove, handleSlotFillAtIndex, resetMove])

  const handleDragEnd = useCallback((committed: boolean) => {
    commitMove(committed ? dragOverRef.current : null)
  }, [commitMove])

  const grabMove = useCallback((from: number) => {
    dispatchMove({ type: 'GRAB', from })
  }, [])

  const retargetMove = useCallback((over: number) => {
    dispatchMove({ type: 'RETARGET', over })
  }, [])

  // "Move" action on the Selected-card surface: arm move on the selection (or
  // cancel if already armed).
  const armMoveSelected = useCallback(() => {
    if (moveStateRef.current.kind === 'moveArmed') { resetMove(); return }
    if (selectedSlotIndex === null) return
    if (!getSlot(activeChart, selectedSlotIndex)) return
    grabMove(selectedSlotIndex)
  }, [selectedSlotIndex, activeChart, grabMove, resetMove])

  // Stable prop objects (callbacks are all useCallback-stable) so the grid and
  // search panel only re-render when moveState actually changes, not on every
  // unrelated App render (e.g. a crop-drag stream).
  const moveApi = useMemo(
    () => ({
      state: moveState,
      beginCellDrag,
      dragMove: handleDragMove,
      dragEnd: handleDragEnd,
      grab: grabMove,
      retarget: retargetMove,
      commit: commitMove,
      cancel: resetMove,
    }),
    [moveState, beginCellDrag, handleDragMove, handleDragEnd, grabMove, retargetMove, commitMove, resetMove],
  )
  const searchDragApi = useMemo(
    () => ({ beginSearchDrag, dragMove: handleDragMove, dragEnd: handleDragEnd }),
    [beginSearchDrag, handleDragMove, handleDragEnd],
  )

  // Seed the drag ghost's position the moment it appears (before paint), so it
  // starts under the pointer instead of flashing at the top-left corner.
  useLayoutEffect(() => {
    if (moveState.kind === 'dragging' && ghostRef.current) {
      const { x, y } = pointerPosRef.current
      ghostRef.current.style.transform = `translate(${x}px, ${y}px)`
    }
  }, [moveState.kind])

  // Crop drag: push the pre-drag chart to history once on mousedown, then
  // apply live updates without history during the drag. This gives a single
  // undo step that reverts the entire drag, not one step per pixel moved.
  const handleCropDragBegin = useCallback(() => {
    editBurstFieldRef.current = null
    setHistory((h) => ({ past: pushPast(h.past, activeChart), future: [] }))
  }, [activeChart])

  const handleCropLive = useCallback(
    (crop: CropValues) => {
      if (selectedSlotIndex === null) return
      updateChart((prev) => {
        const slot = getSlot(prev, selectedSlotIndex)
        if (!slot) return prev
        const slots = [...prev.slots]
        slots[selectedSlotIndex] = { ...slot, ...crop }
        return { ...prev, slots }
      })
    },
    [updateChart, selectedSlotIndex],
  )

  // Used for discrete crop changes (zoom slider, reset) — each gets its own undo entry.
  const handleCropChange = useCallback(
    (crop: CropValues) => {
      if (selectedSlotIndex === null) return
      updateChartWithHistory((prev) => {
        const slot = getSlot(prev, selectedSlotIndex)
        if (!slot) return prev
        const slots = [...prev.slots]
        slots[selectedSlotIndex] = { ...slot, ...crop }
        return { ...prev, slots }
      })
    },
    [updateChartWithHistory, selectedSlotIndex],
  )

  // Import: push a single undo snapshot before any cards are placed.
  const handleImportBegin = useCallback(() => {
    editBurstFieldRef.current = null
    setHistory((h) => ({ past: pushPast(h.past, activeChart), future: [] }))
  }, [activeChart])

  // Import: place a card at a specific pre-assigned slot index (no history push per card).
  const handleSlotPlace = useCallback(
    (slotIndex: number, slot: Slot) => {
      updateChart((prev) => {
        const slots = [...prev.slots]
        slots[slotIndex] = slot
        return { ...prev, slots }
      })
    },
    [updateChart],
  )

  // Import: expand grid rows to fit imported cards (no history push — covered by handleImportBegin).
  const handleImportExpand = useCallback(
    (newRows: number) => {
      updateChart((prev) => {
        if (newRows <= prev.gridRows || newRows > 10) return prev
        return { ...prev, gridRows: newRows }
      })
    },
    [updateChart],
  )

  // NOT history-tracked: transparent image URI cache refresh on 404 during export.
  const handleSlotImageUpdate = useCallback(
    (slotIndex: number, imageUris: ScryfallSlot['imageUris']) => {
      updateChart((prev) => {
        const slot = getSlot(prev, slotIndex)
        if (!slot || slot.kind !== 'scryfall') return prev
        const slots = [...prev.slots]
        slots[slotIndex] = { ...slot, imageUris }
        return { ...prev, slots }
      })
    },
    [updateChart],
  )

  const selectedSlot =
    selectedSlotIndex !== null ? (getSlot(activeChart, selectedSlotIndex) ?? null) : null

  const printingSlot =
    printingForIndex !== null ? (getSlot(activeChart, printingForIndex) ?? null) : null

  // The card the drag ghost should mirror while a pointer drag is in flight.
  const draggingSlot =
    moveState.kind === 'dragging'
      ? moveState.source === 'search'
        ? dragPayload
        : (getSlot(activeChart, moveState.from) ?? null)
      : null
  const ghostSrc = draggingSlot
    ? draggingSlot.kind === 'scryfall'
      ? draggingSlot.imageUris[draggingSlot.selectedFaceIndex].artCrop
      : draggingSlot.localImageDataUrl
    : null

  const {
    exporting,
    error: exportError,
    warning: exportWarning,
    scale: exportScale,
    setScale: setExportScale,
    dismissError,
    dismissWarning,
    triggerExport,
    copyExport,
    shareExport,
  } = useExport(activeChart, handleSlotImageUpdate)

  const notifications = (
    <>
      {storageError && (
        <div className="notifBanner notifBannerError" role="alert">
          <span>{storageError}</span>
          <button type="button" className="notifDismiss" onClick={dismissStorageError} aria-label="Dismiss">×</button>
        </div>
      )}
      {isReconstructing && (
        <div className="notifBanner notifBannerInfo" role="status" aria-live="polite">
          Loading cards from shared link…
        </div>
      )}
      {reconstructionError && !isReconstructing && (
        <div className="notifBanner notifBannerError" role="alert">
          <span>{reconstructionError}</span>
          {canRetryReconstruction && (
            <button type="button" className="notifAction" onClick={retryReconstruction}>Retry</button>
          )}
          <button type="button" className="notifDismiss" onClick={dismissReconstructionError} aria-label="Dismiss">×</button>
        </div>
      )}
      {reconstructionWarning && !isReconstructing && !reconstructionError && (
        <div className="notifBanner notifBannerWarning" role="status">
          <span>{reconstructionWarning}</span>
          <button type="button" className="notifDismiss" onClick={dismissReconstructionWarning} aria-label="Dismiss">×</button>
        </div>
      )}
      {exportError && (
        <div className="notifBanner notifBannerError" role="alert">
          <span>{exportError}</span>
          <button type="button" className="notifDismiss" onClick={dismissError} aria-label="Dismiss">×</button>
        </div>
      )}
      {exportWarning && !exportError && (
        <div className="notifBanner notifBannerWarning" role="status">
          <span>{exportWarning}</span>
          <button type="button" className="notifDismiss" onClick={dismissWarning} aria-label="Dismiss">×</button>
        </div>
      )}
    </>
  )

  return (
    <div className="app">
      <button
        className="menuToggle"
        type="button"
        aria-label="Toggle controls"
        aria-expanded={mobileMenuOpen}
        onClick={() => setMobileMenuOpen((o) => !o)}
      >
        {mobileMenuOpen ? '✕' : '☰'}
      </button>
      {mobileMenuOpen && (
        <div className="backdrop" onClick={() => setMobileMenuOpen(false)} />
      )}
      <ControlPanel
        chart={activeChart}
        charts={charts}
        activeId={activeId}
        mobileOpen={mobileMenuOpen}
        onSlotFill={handleSlotFill}
        onGridResize={handleGridResize}
        onBgColorChange={handleBgColorChange}
        onStyleStep={handleStyleStep}
        onTitleChange={handleTitleChange}
        onTitleFontChange={handleTitleFontChange}
        onNameDisplayChange={handleNameDisplayChange}
        onDisplayModeChange={handleDisplayModeChange}
        onLayoutModeChange={handleLayoutModeChange}
        onSelectChart={handleSelectChart}
        onCreateChart={handleCreateChart}
        onDuplicateChart={handleDuplicateChart}
        onDeleteChart={handleDeleteChart}
        onRenameChart={renameChart}
        canUndo={history.past.length > 0 && !showImportModal}
        canRedo={history.future.length > 0 && !showImportModal}
        onUndo={undo}
        onRedo={redo}
        exporting={exporting}
        exportScale={exportScale}
        onScaleChange={setExportScale}
        onExport={triggerExport}
        selectedSlot={selectedSlot}
        onSelectedRemove={handleSelectedRemove}
        onSelectedFlip={handleSelectedFlip}
        onSelectedSwitchPrinting={handleSelectedOpenPrintings}
        onArmMove={armMoveSelected}
        moveArmed={moveState.kind === 'moveArmed'}
        searchDrag={searchDragApi}
        onCropDragBegin={handleCropDragBegin}
        onCropLive={handleCropLive}
        onCropChange={handleCropChange}
        onOpenImport={() => setShowImportModal(true)}
        onClearCards={handleClearCards}
        onSort={handleSort}
        onShuffle={handleShuffle}
        onCopyLink={handleCopyLink}
        onCopyImage={copyExport}
        onShareImage={shareExport}
        onShareLink={handleShareLink}
      />
      {showImportModal && (
        <ImportModal
          chart={activeChart}
          onImportBegin={handleImportBegin}
          onSlotPlace={handleSlotPlace}
          onExpandGrid={handleImportExpand}
          onClose={() => setShowImportModal(false)}
        />
      )}
      {pendingConfirm && (
        <ConfirmDialog
          message={
            pendingConfirm.kind === 'layout-change'
              ? 'Changing the layout will clear all placed cards. Continue?'
              : 'Clear all cards from this chart?'
          }
          confirmLabel={pendingConfirm.kind === 'layout-change' ? 'Change layout' : 'Clear cards'}
          danger
          onConfirm={handleConfirmResolve}
          onCancel={handleConfirmCancel}
        />
      )}
      <GridArea
        chart={activeChart}
        onSlotClear={handleSlotClear}
        onFaceToggle={handleFaceToggle}
        onOpenPrintings={handleOpenPrintings}
        selectedSlotIndex={selectedSlotIndex}
        onCellSelect={handleCellSelect}
        move={moveApi}
        notifications={notifications}
      />
      {ghostSrc && <DragGhost ref={ghostRef} src={ghostSrc} />}
      {printingForIndex !== null && printingSlot !== null && printingSlot.kind === 'scryfall' && (
        <PrintingSwitcher
          currentSlot={printingSlot}
          onSelect={handlePrintingSelect}
          onClose={() => setPrintingForIndex(null)}
        />
      )}
    </div>
  )
}

export default App
