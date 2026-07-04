import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { Chart, Slot, NumericStyleField, NameDisplayMode, DisplayMode, HeroConfig } from '@/types/chart'
import type { SortKey } from '@/utils/sort'
import { ALLOWED_TITLE_FONTS } from '@/utils/shareLink'
import {
  supportsClipboardImage,
  supportsFileShare,
  supportsUrlShare,
  realClipboardEnv,
  realShareEnv,
} from '@/utils/shareSupport'

type LayoutMode = 'uniform' | 'commander' | 'partner'

function getLayoutMode(heroConfig: HeroConfig): LayoutMode {
  if (heroConfig.length === 0) return 'uniform'
  if (heroConfig.length >= 2) return 'partner'
  return 'commander'
}
import type { ExportScale } from '@/hooks/useExport'
import SearchPanel from '@/components/SearchPanel'
import Stepper from '@/components/Stepper'
import styles from './ControlPanel.module.css'

type CropValues = { cropX: number; cropY: number; cropScale: number }

interface Props {
  chart: Chart
  charts: Chart[]
  activeId: string
  onSlotFill: (slot: Slot) => void
  onGridResize: (dimension: 'rows' | 'cols', delta: 1 | -1) => void
  onBgColorChange: (value: string) => void
  onStyleStep: (field: NumericStyleField, delta: number) => void
  onTitleChange: (value: string) => void
  onTitleFontChange: (font: string | undefined) => void
  onNameDisplayChange: (mode: NameDisplayMode) => void
  onDisplayModeChange: (mode: DisplayMode) => void
  onLayoutModeChange: (mode: LayoutMode) => void
  onSelectChart: (id: string) => void
  onCreateChart: () => void
  onDuplicateChart: () => void
  onDeleteChart: (id: string) => void
  onRenameChart: (id: string, name: string) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  exporting: boolean
  exportScale: ExportScale
  onScaleChange: (s: ExportScale) => void
  onExport: () => void
  selectedSlot: Slot | null
  onCropDragBegin: () => void
  onCropLive: (crop: CropValues) => void
  onCropChange: (crop: CropValues) => void
  onOpenImport: () => void
  onClearCards: () => void
  onSort: (key: SortKey) => void
  onShuffle: () => void
  onCopyLink: () => Promise<number>
  onCopyImage: () => Promise<void>
  onShareImage: () => Promise<void>
  onShareLink: () => Promise<void>
  mobileOpen?: boolean
}

function ChartPicker({
  charts,
  activeId,
  onSelectChart,
  onCreateChart,
  onDuplicateChart,
  onDeleteChart,
  onRenameChart,
}: Pick<Props, 'charts' | 'activeId' | 'onSelectChart' | 'onCreateChart' | 'onDuplicateChart' | 'onDeleteChart' | 'onRenameChart'>) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  function startEditing(chart: Chart) {
    setEditingId(chart.id)
    setDraftName(chart.name)
  }

  function commitEdit(id: string) {
    const trimmed = draftName.trim()
    if (trimmed) onRenameChart(id, trimmed)
    setEditingId(null)
  }

  return (
    <section className={styles.section}>
      <div className={styles.pickerHeader}>
        <h2 className={styles.sectionLabel}>Charts</h2>
        <div className={styles.pickerActions}>
          <button
            className={styles.pickerAdd}
            type="button"
            aria-label="Duplicate chart"
            title="Duplicate chart"
            onClick={onDuplicateChart}
          >
            ⧉
          </button>
          <button
            className={styles.pickerAdd}
            type="button"
            aria-label="New chart"
            title="New chart"
            onClick={onCreateChart}
          >
            +
          </button>
        </div>
      </div>
      <ul className={styles.pickerList}>
        {charts.map((c) => {
          const isActive = c.id === activeId
          const isEditing = editingId === c.id
          return (
            <li
              key={c.id}
              className={`${styles.pickerItem}${isActive ? ` ${styles.pickerItemActive}` : ''}`}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  className={styles.pickerNameInput}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => commitEdit(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit(c.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                />
              ) : (
                <button
                  className={styles.pickerName}
                  type="button"
                  onClick={() => {
                    if (isActive) {
                      startEditing(c)
                    } else {
                      onSelectChart(c.id)
                    }
                  }}
                  title={isActive ? 'Click to rename' : c.name}
                >
                  {c.name}
                </button>
              )}
              {charts.length > 1 && (
                <button
                  className={styles.pickerDelete}
                  type="button"
                  aria-label={`Delete ${c.name}`}
                  onClick={() => onDeleteChart(c.id)}
                >
                  ×
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// Minimum pointer travel (px) before a crop press counts as a drag. Touch
// digitizers emit tiny sub-pixel pointermoves during a plain tap; without a
// threshold those would push an undo snapshot and register as a zero-op drag.
const CROP_DRAG_SLOP_PX = 4

function CropEditor({
  slot,
  displayMode,
  onCropDragBegin,
  onCropLive,
  onCropChange,
}: {
  slot: Slot
  displayMode: DisplayMode
  onCropDragBegin: () => void
  onCropLive: (crop: CropValues) => void
  onCropChange: (crop: CropValues) => void
}) {
  const previewRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; cropX: number; cropY: number } | null>(null)
  const moveListenerRef = useRef<((e: PointerEvent) => void) | null>(null)
  const upListenerRef = useRef<((e: PointerEvent) => void) | null>(null)

  // Remove any active window listeners if the editor unmounts mid-drag (e.g. selected
  // slot is cleared while the pointer is still down).
  useEffect(() => () => {
    if (moveListenerRef.current) window.removeEventListener('pointermove', moveListenerRef.current)
    if (upListenerRef.current) {
      window.removeEventListener('pointerup', upListenerRef.current)
      window.removeEventListener('pointercancel', upListenerRef.current)
    }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // A second pointer landing mid-drag (multi-touch) must not restart the gesture.
    if (dragStateRef.current) return
    e.preventDefault()
    // Capture keeps moves flowing after the pointer leaves the preview. It throws if
    // the pointer is already up, and jsdom's implementation is partial — skip quietly.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch { /* ignore */ }
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      cropX: slot.cropX,
      cropY: slot.cropY,
    }
    // begun gates the history push so a click-without-move doesn't create a phantom
    // undo entry. onCropDragBegin is called only on the first actual movement.
    let begun = false

    const handlePointerMove = (ev: PointerEvent) => {
      if (!dragStateRef.current || ev.pointerId !== dragStateRef.current.pointerId) return
      if (!previewRef.current) return
      if (!begun) {
        // Ignore sub-slop jitter so a tap doesn't register as a drag: no undo
        // snapshot and no crop change until the pointer has actually travelled.
        const movedX = ev.clientX - dragStateRef.current.startX
        const movedY = ev.clientY - dragStateRef.current.startY
        if (Math.hypot(movedX, movedY) < CROP_DRAG_SLOP_PX) return
        begun = true
        onCropDragBegin()
      }
      const rect = previewRef.current.getBoundingClientRect()
      // Dragging right → image moves right → cropX decreases (reveal left side)
      const dx = (ev.clientX - dragStateRef.current.startX) / rect.width
      const dy = (ev.clientY - dragStateRef.current.startY) / rect.height
      const newCropX = Math.max(0, Math.min(1, dragStateRef.current.cropX - dx))
      const newCropY = Math.max(0, Math.min(1, dragStateRef.current.cropY - dy))
      onCropLive({ cropX: newCropX, cropY: newCropY, cropScale: slot.cropScale })
    }

    const handlePointerUp = (ev: PointerEvent) => {
      if (dragStateRef.current && ev.pointerId !== dragStateRef.current.pointerId) return
      dragStateRef.current = null
      moveListenerRef.current = null
      upListenerRef.current = null
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }

    moveListenerRef.current = handlePointerMove
    upListenerRef.current = handlePointerUp
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }, [slot.cropX, slot.cropY, slot.cropScale, onCropDragBegin, onCropLive])

  const aspectRatio = displayMode === 'square' ? '1 / 1' : '4 / 3'

  return (
    <div>
      <div
        ref={previewRef}
        className={styles.cropPreview}
        style={{ aspectRatio }}
        onPointerDown={handlePointerDown}
      >
        <img
          className={styles.cropPreviewImg}
          src={slot.kind === 'scryfall' ? slot.imageUris[slot.selectedFaceIndex].artCrop : slot.localImageDataUrl}
          alt={slot.kind === 'scryfall' ? slot.cardName : slot.label}
          // CORS-consistent with the export fetch so all art load paths share one
          // cache entry (harmless on custom data: URLs). See Grid/index.tsx.
          crossOrigin="anonymous"
          draggable={false}
          style={{
            objectPosition: `${slot.cropX * 100}% ${slot.cropY * 100}%`,
            ...(slot.cropScale !== 1.0 && {
              transform: `scale(${slot.cropScale})`,
              transformOrigin: `${slot.cropX * 100}% ${slot.cropY * 100}%`,
            }),
          }}
        />
      </div>
      <div className={styles.cropRow}>
        <span className={styles.label}>Zoom</span>
        <input
          type="range"
          className={styles.cropZoomSlider}
          min={1.0}
          max={3.0}
          step={0.05}
          value={slot.cropScale}
          onChange={(e) =>
            onCropChange({ cropX: slot.cropX, cropY: slot.cropY, cropScale: Number(e.target.value) })
          }
        />
        <span className={styles.value}>{slot.cropScale.toFixed(2)}×</span>
      </div>
      <button
        type="button"
        className={styles.cropResetBtn}
        onClick={() => onCropChange({ cropX: 0.5, cropY: 0.5, cropScale: 1.0 })}
      >
        Reset
      </button>
    </div>
  )
}

export default function ControlPanel({
  chart,
  charts,
  activeId,
  onSlotFill,
  onGridResize,
  onBgColorChange,
  onStyleStep,
  onTitleChange,
  onTitleFontChange,
  onNameDisplayChange,
  onDisplayModeChange,
  onLayoutModeChange,
  onSelectChart,
  onCreateChart,
  onDuplicateChart,
  onDeleteChart,
  onRenameChart,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  exporting,
  exportScale,
  onScaleChange,
  onExport,
  selectedSlot,
  onCropDragBegin,
  onCropLive,
  onCropChange,
  onClearCards,
  onOpenImport,
  onSort,
  onShuffle,
  onCopyLink,
  onCopyImage,
  onShareImage,
  onShareLink,
  mobileOpen,
}: Props) {
  const occupiedCount = chart.slots.filter((s) => s != null).length
  const [sortKey, setSortKey] = useState<SortKey>('type')
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [customSlotsNotice, setCustomSlotsNotice] = useState(0)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [imageCopied, setImageCopied] = useState(false)
  const [imageCopyFailed, setImageCopyFailed] = useState(false)
  const imageCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Feature-detected once — desktop/unsupported browsers simply don't render the
  // extra affordances (they keep download + copy-link). canShareImage needs a
  // representative file for canShare({ files }), so we probe with a tiny PNG.
  const canCopyImage = useMemo(() => supportsClipboardImage(realClipboardEnv()), [])
  const canShareImage = useMemo(
    () => supportsFileShare(new File(['x'], 'probe.png', { type: 'image/png' }), realShareEnv()),
    [],
  )
  const canShareLink = useMemo(() => supportsUrlShare(realShareEnv()), [])

  function handleCopyLink() {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    setCopyFailed(false)
    onCopyLink().then((omitted) => {
      setCopied(true)
      setCustomSlotsNotice(omitted)
      const delay = omitted > 0 ? 3000 : 1500
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false)
        setCustomSlotsNotice(0)
      }, delay)
    }).catch(() => {
      setCopied(false)
      setCopyFailed(true)
      copyTimeoutRef.current = setTimeout(() => setCopyFailed(false), 2000)
    })
  }

  // Copy the rendered PNG to the clipboard, mirroring the copy-link transient
  // success/failure feedback. onCopyImage re-runs the export pipeline for the blob.
  function handleCopyImage() {
    if (imageCopyTimeoutRef.current) clearTimeout(imageCopyTimeoutRef.current)
    setImageCopyFailed(false)
    onCopyImage().then(() => {
      setImageCopied(true)
      imageCopyTimeoutRef.current = setTimeout(() => setImageCopied(false), 1500)
    }).catch(() => {
      setImageCopied(false)
      setImageCopyFailed(true)
      imageCopyTimeoutRef.current = setTimeout(() => setImageCopyFailed(false), 2000)
    })
  }

  // Native share sheet — the OS sheet is its own feedback, so no transient state.
  // A dismissed sheet / already-handled render failure resolves quietly.
  function handleShareImage() {
    onShareImage().catch(() => {})
  }

  function handleShareLink() {
    onShareLink().catch(() => {})
  }

  return (
    <aside className={`${styles.panel} ${mobileOpen ? styles.panelOpen : ''}`}>
      <header className={styles.header}>
        <span className={styles.logo}>MTG Chart</span>
      </header>

      <div className={styles.body}>
        <ChartPicker
          charts={charts}
          activeId={activeId}
          onSelectChart={onSelectChart}
          onCreateChart={onCreateChart}
          onDuplicateChart={onDuplicateChart}
          onDeleteChart={onDeleteChart}
          onRenameChart={onRenameChart}
        />

        <section className={styles.section}>
          <div className={styles.pickerHeader}>
            <h2 className={styles.sectionLabel}>Search</h2>
            <button
              className={styles.importBtn}
              type="button"
              onClick={onOpenImport}
            >
              Import decklist
            </button>
          </div>
          <SearchPanel chart={chart} onSlotFill={onSlotFill} />
        </section>

        {selectedSlot && (
          <section className={styles.section}>
            <h2 className={styles.sectionLabel}>Crop — {selectedSlot.kind === 'scryfall' ? selectedSlot.cardName : selectedSlot.label}</h2>
            <CropEditor
              slot={selectedSlot}
              displayMode={chart.displayMode}
              onCropDragBegin={onCropDragBegin}
              onCropLive={onCropLive}
              onCropChange={onCropChange}
            />
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionLabel}>Grid</h2>
          <div className={styles.row}>
            <span className={styles.label}>Layout</span>
            <div className={styles.segmented} role="radiogroup" aria-label="Layout mode">
              {(['uniform', 'commander', 'partner'] as const).map((mode) => {
                const active = getLayoutMode(chart.heroConfig) === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`${styles.segBtn}${active ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => onLayoutModeChange(mode)}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                )
              })}
            </div>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Width</span>
            <Stepper
              value={chart.gridCols}
              min={1}
              max={10}
              decrementLabel="Decrease columns"
              incrementLabel="Increase columns"
              decrementDisabled={
                chart.gridCols <= 1 ||
                occupiedCount > chart.gridRows * (chart.gridCols - 1) ||
                chart.heroConfig.some((h) => h.col + h.colSpan > chart.gridCols - 1)
              }
              onDecrement={() => onGridResize('cols', -1)}
              onIncrement={() => onGridResize('cols', 1)}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Height</span>
            <Stepper
              value={chart.gridRows}
              min={1}
              max={10}
              decrementLabel="Decrease rows"
              incrementLabel="Increase rows"
              decrementDisabled={
                chart.gridRows <= 1 ||
                occupiedCount > (chart.gridRows - 1) * chart.gridCols ||
                chart.heroConfig.some((h) => h.row + h.rowSpan > chart.gridRows - 1)
              }
              onDecrement={() => onGridResize('rows', -1)}
              onIncrement={() => onGridResize('rows', 1)}
            />
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionLabel}>Style</h2>
          <div className={styles.row}>
            <span className={styles.label}>Mode</span>
            <div className={styles.segmented} role="radiogroup" aria-label="Display mode">
              {(['landscape', 'square'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={chart.displayMode === mode}
                  className={`${styles.segBtn}${chart.displayMode === mode ? ` ${styles.segBtnActive}` : ''}`}
                  onClick={() => onDisplayModeChange(mode)}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Background</span>
            <label className={styles.colorControl}>
              <span
                className={styles.colorSwatch}
                style={{ backgroundColor: chart.backgroundColor }}
              />
              <span className={styles.colorHex}>{chart.backgroundColor}</span>
              <input
                type="color"
                className={styles.colorInput}
                value={chart.backgroundColor}
                onChange={(e) => onBgColorChange(e.target.value)}
              />
            </label>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Gap</span>
            <Stepper
              value={chart.cellGap}
              min={0}
              max={32}
              unit="px"
              decrementLabel="Decrease gap"
              incrementLabel="Increase gap"
              onDecrement={() => onStyleStep('cellGap', -2)}
              onIncrement={() => onStyleStep('cellGap', 2)}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Padding</span>
            <Stepper
              value={chart.padding}
              min={0}
              max={64}
              unit="px"
              decrementLabel="Decrease padding"
              incrementLabel="Increase padding"
              onDecrement={() => onStyleStep('padding', -4)}
              onIncrement={() => onStyleStep('padding', 4)}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.label}>Corner Radius</span>
            <Stepper
              value={chart.cornerRadius}
              min={0}
              max={32}
              unit="px"
              decrementLabel="Decrease corner radius"
              incrementLabel="Increase corner radius"
              onDecrement={() => onStyleStep('cornerRadius', -2)}
              onIncrement={() => onStyleStep('cornerRadius', 2)}
            />
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionLabel}>Title</h2>
          <input
            className={styles.titleInput}
            type="text"
            aria-label="Chart title"
            placeholder="Chart title…"
            value={chart.title}
            onChange={(e) => onTitleChange(e.target.value)}
          />
          <div className={styles.row}>
            <span className={styles.label}>Font</span>
            <select
              className={styles.arrangeSelect}
              value={chart.titleFont ?? ''}
              onChange={(e) => onTitleFontChange(e.target.value || undefined)}
              style={chart.titleFont ? { fontFamily: chart.titleFont } : undefined}
            >
              <option value="">Default</option>
              {ALLOWED_TITLE_FONTS.map((font) => (
                <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
              ))}
            </select>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionLabel}>Names</h2>
          <div className={styles.segmented} role="radiogroup" aria-label="Name display mode">
            {(['none', 'overlay', 'sidebar'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={chart.nameDisplayMode === mode}
                className={`${styles.segBtn}${chart.nameDisplayMode === mode ? ` ${styles.segBtnActive}` : ''}`}
                onClick={() => onNameDisplayChange(mode)}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionLabel}>Arrange</h2>
          <div className={styles.row}>
            <span className={styles.label}>Sort by</span>
            <select
              className={styles.arrangeSelect}
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
            >
              <option value="type">Type</option>
              <option value="cmc-asc">CMC ↑</option>
              <option value="cmc-desc">CMC ↓</option>
              <option value="color">Color</option>
            </select>
          </div>
          <div className={styles.arrangeRow}>
            <button
              type="button"
              className={styles.arrangeBtn}
              disabled={occupiedCount === 0}
              onClick={() => onSort(sortKey)}
            >
              Sort
            </button>
            <button
              type="button"
              className={styles.arrangeBtn}
              disabled={occupiedCount === 0}
              onClick={onShuffle}
            >
              Shuffle
            </button>
          </div>
          <button
            type="button"
            className={styles.clearBtn}
            disabled={occupiedCount === 0}
            onClick={onClearCards}
          >
            Clear cards
          </button>
        </section>
      </div>

      <footer className={styles.footer}>
        <div className={styles.undoRow}>
          <button
            className={styles.undoBtn}
            type="button"
            disabled={!canUndo}
            onClick={onUndo}
            aria-label="Undo"
            title="Undo (Cmd+Z)"
          >
            Undo
          </button>
          <button
            className={styles.undoBtn}
            type="button"
            disabled={!canRedo}
            onClick={onRedo}
            aria-label="Redo"
            title="Redo (Cmd+Shift+Z)"
          >
            Redo
          </button>
        </div>
        <div className={styles.linkRow}>
          <button
            className={styles.copyLinkBtn}
            type="button"
            onClick={handleCopyLink}
          >
            {copied ? 'Copied!' : copyFailed ? 'Copy failed' : 'Copy link'}
          </button>
          {canShareLink && (
            <button
              className={styles.shareLinkBtn}
              type="button"
              aria-label="Share link"
              onClick={handleShareLink}
            >
              Share
            </button>
          )}
        </div>
        {customSlotsNotice > 0 && (
          <p className={styles.copyLinkNotice}>
            {customSlotsNotice} custom image{customSlotsNotice !== 1 ? 's' : ''} not included in link.
          </p>
        )}
        <div className={styles.scaleRow}>
          <span className={styles.label}>Scale</span>
          <div className={styles.segmented} role="radiogroup" aria-label="Export scale">
            {([1, 2] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={exportScale === s}
                className={`${styles.segBtn}${exportScale === s ? ` ${styles.segBtnActive}` : ''}`}
                onClick={() => onScaleChange(s)}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
        <div className={styles.actionRow}>
          <button
            className={styles.exportBtn}
            type="button"
            disabled={exporting || occupiedCount === 0}
            onClick={onExport}
          >
            {exporting ? 'Exporting…' : 'Export PNG'}
          </button>
          {canCopyImage && (
            <button
              className={styles.copyImageBtn}
              type="button"
              aria-label="Copy image to clipboard"
              disabled={exporting || occupiedCount === 0}
              onClick={handleCopyImage}
            >
              {imageCopied ? 'Copied!' : imageCopyFailed ? 'Copy failed' : 'Copy image'}
            </button>
          )}
        </div>
        {canShareImage && (
          <button
            className={styles.shareImageBtn}
            type="button"
            aria-label="Share image"
            disabled={exporting || occupiedCount === 0}
            onClick={handleShareImage}
          >
            Share image
          </button>
        )}
        <p className={styles.disclaimer}>
          Card data and images provided by Scryfall. Cards © Wizards of the Coast. Not affiliated with or endorsed by Scryfall or Wizards of the Coast.
        </p>
      </footer>
    </aside>
  )
}
