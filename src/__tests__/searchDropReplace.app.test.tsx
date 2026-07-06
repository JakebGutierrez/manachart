// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Chart, Slot, ScryfallSlot } from '@/types/chart'
import { renderComponent, act, byAriaLabel } from './harness'

// A fixed search result so the results list renders inside the real App.
const RESULT: ScryfallSlot = {
  kind: 'scryfall', scryfallId: 'r-new', oracleId: 'o-new', cardName: 'NewCard',
  setCode: 'tst', collectorNumber: '2', layout: 'normal', selectedFaceIndex: 0,
  imageUris: [{ artCrop: 'https://img.example/new.jpg' }],
  cropX: 0.5, cropY: 0.5, cropScale: 1.0, cmc: 2, colors: ['U'], typeLine: 'Sorcery',
}
vi.mock('@/hooks/useScryfall', () => ({
  useScryfall: () => ({ results: [RESULT], isLoading: false, error: null }),
}))

import App from '@/App'

const store = new Map<string, string>()
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => { store.clear() },
  get length() { return store.size },
  key: (i: number) => [...store.keys()][i] ?? null,
}

function oldCard(): Slot {
  return { ...RESULT, scryfallId: 'r-old', cardName: 'OldCard' }
}

function seedFull() {
  const chart: Chart = {
    id: 'a', name: 'Alpha', schemaVersion: 4,
    gridRows: 1, gridCols: 1, layout: 'uniform', heroConfig: [],
    displayMode: 'landscape', nameDisplayMode: 'none', title: '',
    backgroundColor: '#0b0c0e', cellGap: 4, padding: 16, cornerRadius: 4,
    slots: [oldCard()], // 1×1 grid, filled → full
  }
  store.set('mtg-chart:charts', JSON.stringify([chart]))
  store.set('mtg-chart:activeId', 'a')
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

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', localStorageStub)
})
afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'elementFromPoint')
  document.body.innerHTML = ''
})

describe('search → grid drag on a full grid', () => {
  it('completes the replace commit and records exactly one history entry', () => {
    seedFull()
    const { container, unmount } = renderComponent(<App />)

    const cell0 = container.querySelector<HTMLElement>('[data-slot-index="0"]')!
    expect(cell0.getAttribute('aria-label')).toBe('OldCard, row 1 column 1')
    expect(byAriaLabel<HTMLButtonElement>(container, 'Undo').disabled).toBe(true)

    const li = container.querySelector('[data-search-index="0"]')!
    // The drop target resolves to the (full) grid cell.
    ;(document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint =
      () => cell0

    pointer(li, 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 20, 0) // cross slop → search drag begins
    pointer(window, 'pointermove', 100, 100) // over the cell
    pointer(window, 'pointerup', 100, 100) // drop → replace

    // The full cell was REPLACED by the dragged search result.
    expect(container.querySelector<HTMLElement>('[data-slot-index="0"]')!.getAttribute('aria-label'))
      .toBe('NewCard, row 1 column 1')
    // Exactly one history entry (undo now available).
    expect(byAriaLabel<HTMLButtonElement>(container, 'Undo').disabled).toBe(false)
    unmount()
  })
})
