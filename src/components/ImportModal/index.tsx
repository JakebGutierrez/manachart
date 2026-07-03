import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Chart, Slot } from '@/types/chart'
import { useImport } from '@/hooks/useImport'
import styles from './ImportModal.module.css'

interface Props {
  chart: Chart
  onImportBegin: () => void
  onSlotPlace: (slotIndex: number, slot: Slot) => void
  onExpandGrid: (newRows: number) => void
  onClose: () => void
}

export default function ImportModal({ chart, onImportBegin, onSlotPlace, onExpandGrid, onClose }: Props) {
  const [text, setText] = useState('')
  const [fillQuantity, setFillQuantity] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { phase, begin, proceedExpand, proceedCap, retry, reset } = useImport(
    chart,
    onImportBegin,
    onSlotPlace,
    onExpandGrid,
  )

  function handleClose() {
    reset()
    onClose()
  }

  // Keep a fresh ref so the Escape listener (registered once) always calls the
  // latest handleClose without being re-registered on every render.
  const handleCloseRef = useRef(handleClose)
  useLayoutEffect(() => {
    handleCloseRef.current = handleClose
  })

  // Focus textarea when modal opens
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Close on Escape — registered once, stays stable for the modal's lifetime.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function handleImport() {
    if (!text.trim()) return
    begin(text, fillQuantity)
  }

  const isIdle = phase.kind === 'idle'
  const isOverflow = phase.kind === 'overflow'
  const isImporting = phase.kind === 'importing'
  const isDone = phase.kind === 'done'

  return (
    <div className={styles.backdrop} onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Import decklist">
        <div className={styles.header}>
          <span className={styles.title}>Import Decklist</span>
          <button className={styles.closeBtn} type="button" aria-label="Close" onClick={handleClose}>
            ×
          </button>
        </div>

        <div className={styles.body}>
          {isIdle && (
            <>
              <textarea
                ref={textareaRef}
                className={styles.textarea}
                placeholder={
                  '4 Lightning Bolt (M20) 150\n4 Counterspell (MMQ) 61\n1 Black Lotus\n...'
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
              />
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={fillQuantity}
                  onChange={(e) => setFillQuantity(e.target.checked)}
                />
                Fill quantity copies (e.g. 4x Lightning Bolt fills 4 cells)
              </label>
            </>
          )}

          {isOverflow && phase.kind === 'overflow' && (
            <>
              <p className={styles.warningText}>
                This decklist has <strong>{phase.totalCards} cards</strong> but the grid only has{' '}
                <strong>{phase.availableSlots} empty {phase.availableSlots === 1 ? 'slot' : 'slots'}</strong> available.
                How would you like to proceed?
              </p>
              {phase.unreadableCount > 0 && (
                <p className={styles.warningText}>
                  Also couldn’t read {phase.unreadableCount} line{phase.unreadableCount === 1 ? '' : 's'} — check the formatting.
                </p>
              )}
            </>
          )}

          {isImporting && phase.kind === 'importing' && (
            <>
              <p className={styles.progressLabel}>
                Importing cards&hellip; <strong>{phase.progress} / {phase.total}</strong>
              </p>
              <progress
                className={styles.progressBar}
                aria-label="Import progress"
                value={phase.progress}
                max={phase.total}
              />
            </>
          )}

          {isDone && phase.kind === 'done' && (
            <>
              {phase.total > 0 && (
                <p className={styles.summaryCount}>
                  Imported {phase.succeeded} / {phase.total} cards.
                </p>
              )}
              {phase.unreadableCount > 0 && (
                <p className={styles.warningText}>
                  Couldn’t read {phase.unreadableCount} line{phase.unreadableCount === 1 ? '' : 's'} — check the formatting.
                </p>
              )}
              {phase.failed.length > 0 && (
                <>
                  <p className={styles.failedHeader}>Failed ({phase.failed.length})</p>
                  <ul className={styles.failedList}>
                    {phase.failed.map((f, i) => {
                      const label = f.setCode
                        ? `${f.name} (${f.setCode})${f.collectorNumber ? ` ${f.collectorNumber}` : ''}`
                        : f.name
                      return (
                        <li key={i} className={styles.failedItem}>
                          <span className={styles.failedBullet}>•</span>
                          <span className={styles.failedName}>{label}</span>
                          <span className={styles.failedReason}>
                            {f.reason === 'rate-limited' ? 'rate limited' : 'not found'}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </>
          )}
        </div>

        <div className={styles.footer}>
          {isIdle && (
            <>
              <button className={styles.btnSecondary} type="button" onClick={handleClose}>
                Cancel
              </button>
              <button
                className={styles.btnPrimary}
                type="button"
                disabled={!text.trim()}
                onClick={handleImport}
              >
                Import
              </button>
            </>
          )}

          {isOverflow && (
            <>
              <button className={styles.btnSecondary} type="button" onClick={handleClose}>
                Cancel
              </button>
              <button className={styles.btnSecondary} type="button" onClick={proceedCap}>
                Import first {phase.kind === 'overflow' ? phase.availableSlots : ''} cards
              </button>
              <button className={styles.btnPrimary} type="button" onClick={proceedExpand}>
                Auto-expand grid
              </button>
            </>
          )}

          {isImporting && (
            <button className={styles.btnSecondary} type="button" onClick={handleClose}>
              Cancel
            </button>
          )}

          {isDone && phase.kind === 'done' && (
            <>
              {phase.failed.some((f) => f.reason === 'rate-limited') && (
                <button className={styles.btnSecondary} type="button" onClick={retry}>
                  Retry failed
                </button>
              )}
              <button className={styles.btnPrimary} type="button" onClick={handleClose}>
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
