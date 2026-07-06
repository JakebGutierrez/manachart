import { useRef, useEffect, useCallback } from 'react'
import type { Slot, DisplayMode } from '@/types/chart'
import { isMultiFaceLayout } from '@/utils/scryfall'
import styles from './SelectedCard.module.css'

type CropValues = { cropX: number; cropY: number; cropScale: number }

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

interface Props {
  slot: Slot
  displayMode: DisplayMode
  onRemove: () => void
  onFlip: () => void
  onSwitchPrinting: () => void
  onArmMove: () => void
  moveArmed: boolean
  onCropDragBegin: () => void
  onCropLive: (crop: CropValues) => void
  onCropChange: (crop: CropValues) => void
}

// The canonical Selected-card action surface (Phase 2). One component, two
// homes (§7.1b): the ControlPanel section in docked mode, the bottom sheet in
// drawer mode — never forked. Move (Phase 3) works from both: arming in the
// sheet then tapping a target cell is the phone move path, since the grid
// stays visible and interactive behind the sheet.
export default function SelectedCard({
  slot,
  displayMode,
  onRemove,
  onFlip,
  onSwitchPrinting,
  onArmMove,
  moveArmed,
  onCropDragBegin,
  onCropLive,
  onCropChange,
}: Props) {
  return (
    <div>
      <p className={styles.selectedName}>
        {slot.kind === 'scryfall' ? slot.cardName : slot.label}
      </p>
      {/* Canonical, always-visible action surface — the keyboard/touch home
          for actions that otherwise live only on hover buttons or right-click. */}
      <div className={styles.selectedActions}>
        <button
          type="button"
          className={`${styles.selectedActionBtn} ${styles.selectedActionBtnDanger}`}
          onClick={onRemove}
        >
          Remove
        </button>
        {slot.kind === 'scryfall' &&
          isMultiFaceLayout(slot.layout) &&
          slot.imageUris.length > 1 && (
          <button type="button" className={styles.selectedActionBtn} onClick={onFlip}>
            Flip
          </button>
        )}
        {slot.kind === 'scryfall' && (
          <button
            type="button"
            className={styles.selectedActionBtn}
            onClick={onSwitchPrinting}
          >
            Switch printing
          </button>
        )}
        {/* Arms move mode: then arrow+Enter (keyboard) or tap a target cell
            (pointer) to drop. Toggles off / cancels when already armed. */}
        <button
          type="button"
          className={`${styles.selectedActionBtn}${moveArmed ? ` ${styles.selectedActionBtnActive}` : ''}`}
          aria-pressed={moveArmed}
          onClick={onArmMove}
        >
          {moveArmed ? 'Cancel move' : 'Move'}
        </button>
      </div>
      <CropEditor
        slot={slot}
        displayMode={displayMode}
        onCropDragBegin={onCropDragBegin}
        onCropLive={onCropLive}
        onCropChange={onCropChange}
      />
    </div>
  )
}
