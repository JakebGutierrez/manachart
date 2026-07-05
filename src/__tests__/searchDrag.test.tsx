// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Chart, Slot, ScryfallSlot } from '@/types/chart'
import { renderComponent, act, click } from './harness'

// Fixed search results regardless of query, so the results list renders.
const RESULT: ScryfallSlot = {
  kind: 'scryfall', scryfallId: 'r1', oracleId: 'o1', cardName: 'Bolt',
  setCode: 'tst', collectorNumber: '1', layout: 'normal', selectedFaceIndex: 0,
  imageUris: [{ artCrop: 'https://img.example/bolt.jpg' }],
  cropX: 0.5, cropY: 0.5, cropScale: 1.0, cmc: 1, colors: ['R'], typeLine: 'Instant',
}
vi.mock('@/hooks/useScryfall', () => ({
  useScryfall: () => ({ results: [RESULT], isLoading: false, error: null }),
}))

import SearchPanel from '@/components/SearchPanel'

function makeSlot(name: string): Slot {
  return { ...RESULT, scryfallId: `id-${name}`, cardName: name }
}

function makeChart(slots: Array<Slot | null>, rows: number, cols: number): Chart {
  return {
    id: 'a', name: 'Alpha', schemaVersion: 4,
    gridRows: rows, gridCols: cols, layout: 'uniform', heroConfig: [],
    displayMode: 'landscape', nameDisplayMode: 'none', title: '',
    backgroundColor: '#0b0c0e', cellGap: 4, padding: 16, cornerRadius: 4, slots,
  }
}

function pointer(target: EventTarget, type: string, x: number, y: number, init: PointerEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
        pointerId: 1, isPrimary: true, button: 0, ...init,
      }),
    )
  })
}

function noopSearchDrag() {
  return { beginSearchDrag: vi.fn(), dragMove: vi.fn(), dragEnd: vi.fn() }
}

beforeEach(() => { document.body.innerHTML = '' })

describe('search result drag source', () => {
  it('stays interactive (not disabled) when the grid is full so drag-to-replace works', () => {
    const full = makeChart([makeSlot('X')], 1, 1) // 1×1, filled → isFull
    const searchDrag = noopSearchDrag()
    const { container, unmount } = renderComponent(
      <SearchPanel chart={full} onSlotFill={vi.fn()} searchDrag={searchDrag} />,
    )
    const btn = container.querySelector<HTMLButtonElement>('[data-search-index="0"] button')!
    // Not a disabled control (which would swallow pointer events); aria-disabled instead.
    expect(btn.disabled).toBe(false)
    expect(btn.getAttribute('aria-disabled')).toBe('true')

    const li = container.querySelector('[data-search-index="0"]')!
    pointer(li, 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 20, 0) // cross slop
    // Drag initiated even though the grid is full.
    expect(searchDrag.beginSearchDrag).toHaveBeenCalledTimes(1)
    pointer(window, 'pointerup', 20, 0)
    unmount()
  })

  it('does not tap-fill when the grid is full', () => {
    const full = makeChart([makeSlot('X')], 1, 1)
    const onSlotFill = vi.fn()
    const { container, unmount } = renderComponent(
      <SearchPanel chart={full} onSlotFill={onSlotFill} searchDrag={noopSearchDrag()} />,
    )
    click(container.querySelector('[data-search-index="0"] button')!)
    expect(onSlotFill).not.toHaveBeenCalled()
    unmount()
  })

  it('tap-fills once when not full; a drag suppresses the trailing click (exactly one fill)', () => {
    const notFull = makeChart([null, null], 1, 2) // capacity 2, empty
    const onSlotFill = vi.fn()
    const searchDrag = noopSearchDrag()
    const { container, unmount } = renderComponent(
      <SearchPanel chart={notFull} onSlotFill={onSlotFill} searchDrag={searchDrag} />,
    )
    const li = container.querySelector('[data-search-index="0"]')!
    const btn = container.querySelector<HTMLButtonElement>('[data-search-index="0"] button')!

    // A completed drag, then its trailing click — must NOT tap-fill.
    pointer(li, 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 20, 0)
    pointer(window, 'pointerup', 20, 0)
    click(btn) // synthetic trailing click
    expect(onSlotFill).not.toHaveBeenCalled()

    // A plain click (no preceding drag) fills exactly once.
    click(btn)
    expect(onSlotFill).toHaveBeenCalledTimes(1)
    unmount()
  })
})
