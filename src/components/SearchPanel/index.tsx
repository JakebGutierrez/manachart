import { useState, useMemo, useRef, useCallback } from 'react'
import type { Chart, Slot, CustomSlot } from '@/types/chart'
import { useScryfall } from '@/hooks/useScryfall'
import { getSlot } from '@/utils/chart'
import { generateCellMap } from '@/utils/cellMap'
import styles from './SearchPanel.module.css'

interface Props {
  chart: Chart
  onSlotFill: (slot: Slot) => void
}

export default function SearchPanel({ chart, onSlotFill }: Props) {
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
          {results.map((result) => (
            <li
              key={result.scryfallId}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-mtg-search-result', JSON.stringify(result))
                e.dataTransfer.effectAllowed = 'copy'
              }}
            >
              <button
                className={styles.resultBtn}
                type="button"
                disabled={isFull}
                onClick={() => onSlotFill(result)}
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
