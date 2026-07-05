import { useState, useMemo, useRef, useCallback } from 'react'
import type { Chart, Slot, CustomSlot } from '@/types/chart'
import { useScryfall } from '@/hooks/useScryfall'
import { getSlot } from '@/utils/chart'
import { generateCellMap } from '@/utils/cellMap'
import { usePointerDrag } from '@/interaction/usePointerDrag'
import type { SearchDragApi } from '@/interaction/moveApi'
import styles from './SearchPanel.module.css'

interface Props {
  chart: Chart
  onSlotFill: (slot: Slot) => void
  searchDrag: SearchDragApi
}

export default function SearchPanel({ chart, onSlotFill, searchDrag }: Props) {
  const [query, setQuery] = useState('')
  const { results, isLoading, error } = useScryfall(query)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      if (!['image/jpeg', 'image/png'].includes(file.type)) return
      const reader = new FileReader()
      reader.onerror = () => console.error('FileReader failed', reader.error)
      reader.onload = () => {
        if (typeof reader.result !== 'string') return
        const slot: CustomSlot = {
          kind: 'custom',
          label: file.name.replace(/\.[^.]+$/, ''),
          localImageDataUrl: reader.result,
          cropX: 0.5,
          cropY: 0.5,
          cropScale: 1.0,
        }
        onSlotFill(slot)
      }
      reader.readAsDataURL(file)
    },
    [onSlotFill],
  )

  const cellMap = useMemo(
    () => generateCellMap(chart.gridRows, chart.gridCols, chart.heroConfig),
    [chart.gridRows, chart.gridCols, chart.heroConfig],
  )
  const fillableCells = useMemo(() => cellMap.filter((c) => c.kind !== 'covered'), [cellMap])
  const isFull = fillableCells.every((c) => getSlot(chart, c.slotIndex) !== null)

  // Results are pointer-drag sources onto the grid (desktop accelerator). The
  // dragged Slot is carried in React state via the move machine — no dataTransfer
  // JSON round-trip. Tap-to-fill (the button below) remains the everywhere path.
  // usePointerDrag refreshes its callbacks each render, so getContext reads the
  // current `results` closure directly (no ref needed).
  // Suppress the synthetic click that follows a completed drag so a drag can't
  // also fire tap-to-fill (double fill / double history entry). Same guard Grid
  // uses; cleared on a microtask so an off-target drag can't leave it stuck.
  const suppressClickRef = useRef(false)
  const resultPointerDown = usePointerDrag<Slot>({
    getContext: (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-search-index]')
      if (!el) return null
      const idx = Number(el.dataset.searchIndex)
      return Number.isInteger(idx) ? results[idx] ?? null : null
    },
    onStart: (slot) => searchDrag.beginSearchDrag(slot),
    onMove: (_slot, x, y) => searchDrag.dragMove(x, y),
    onEnd: (_slot, committed, x, y) => {
      searchDrag.dragEnd(committed, x, y)
      suppressClickRef.current = true
      setTimeout(() => { suppressClickRef.current = false }, 0)
    },
  })

  // Tap-to-fill (skips the click that trails a drag; no-op when the grid is full).
  const handleResultClick = (result: Slot) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (!isFull) onSlotFill(result)
  }

  return (
    <div className={styles.container}>
      <input
        className={styles.input}
        type="search"
        placeholder="Search cards…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search cards"
        aria-describedby="search-syntax-hint"
      />
      <p className={styles.searchHint} id="search-syntax-hint">
        Supports Scryfall syntax — e.g. <code>t:dragon</code>, <code>set:ktk</code>,{' '}
        <code>is:borderless</code>
      </p>
      <button
        className={styles.uploadBtn}
        type="button"
        disabled={isFull}
        onClick={handleUploadClick}
      >
        Upload image
      </button>
      <p className={styles.uploadHint}>Label is taken from the filename.</p>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {isLoading && <p className={styles.status}>Searching…</p>}
      {error && <p className={styles.error}>{error}</p>}
      {isFull && query.trim() && !isLoading && !error && (
        <p className={styles.status}>Grid is full — drag a card to replace.</p>
      )}

      {!isLoading && !error && results.length > 0 && (
        <ul className={styles.results} role="list">
          {results.map((result, index) => (
            <li
              key={result.scryfallId}
              data-search-index={index}
              onPointerDown={resultPointerDown}
            >
              <button
                className={`${styles.resultBtn}${isFull ? ` ${styles.resultBtnFull}` : ''}`}
                type="button"
                // NOT `disabled`: a disabled button swallows pointer events, which
                // would kill the drag-to-replace source on the <li> when the grid
                // is full. aria-disabled + a dimmed style preserve the affordance
                // while keeping the element interactive for pointer drags.
                aria-disabled={isFull}
                onClick={() => handleResultClick(result)}
              >
                <img
                  className={styles.thumb}
                  src={result.imageUris[result.selectedFaceIndex].artCrop}
                  alt=""
                  loading="lazy"
                  // CORS-consistent so this load path can't poison the shared cache.
                  crossOrigin="anonymous"
                />
                <span className={styles.name}>{result.cardName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
