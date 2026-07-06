// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from '@/App'
import type { Chart, Slot } from '@/types/chart'
import cpStyles from '@/components/SelectedCard/SelectedCard.module.css'
import { renderComponent, act, click, byAriaLabel } from './harness'

const store = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
  clear: () => { store.clear() },
  get length() { return store.size },
  key: (index: number) => [...store.keys()][index] ?? null,
}

function makeSlot(name: string): Slot {
  return {
    kind: 'scryfall',
    scryfallId: `id-${name}`,
    oracleId: `oracle-${name}`,
    cardName: name,
    setCode: 'tst',
    collectorNumber: '1',
    layout: 'normal',
    selectedFaceIndex: 0,
    imageUris: [{ artCrop: `https://img.example/${name}.jpg` }],
    cropX: 0.5,
    cropY: 0.5,
    cropScale: 1.0,
    cmc: 1,
    colors: ['R'],
    typeLine: 'Instant',
  }
}

function makeChart(slots: Array<Slot | null>): Chart {
  return {
    id: 'a',
    name: 'Alpha',
    schemaVersion: 4,
    gridRows: 2,
    gridCols: 2,
    layout: 'uniform',
    heroConfig: [],
    displayMode: 'landscape',
    nameDisplayMode: 'none',
    title: '',
    backgroundColor: '#0b0c0e',
    cellGap: 4,
    padding: 16,
    cornerRadius: 4,
    slots,
  }
}

// Dispatch a real PointerEvent. jsdom lacks setPointerCapture (the editor wraps
// that call in try/catch), but PointerEvent itself carries clientX/pointerId.
function pointer(target: EventTarget, type: string, x: number, y: number, pointerId = 1) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId }),
    )
  })
}

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', localStorageStub)
  window.history.pushState({}, '', '/')
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

// Selects the single card so the crop editor renders, and returns its preview el.
function openCropEditor(container: HTMLElement): HTMLElement {
  click(container.querySelector('img')!) // the grid cell's card → selects the slot
  const preview = container.querySelector<HTMLElement>('.' + cpStyles.cropPreview)
  if (!preview) throw new Error('crop preview not rendered after selecting a cell')
  return preview
}

describe('crop drag slop threshold', () => {
  it('a pure tap (sub-slop) pushes no undo entry', () => {
    store.set('mtg-chart:charts', JSON.stringify([makeChart([makeSlot('Bolt')])]))
    store.set('mtg-chart:activeId', 'a')
    const { container, unmount } = renderComponent(<App />)
    try {
      const preview = openCropEditor(container)
      expect(byAriaLabel<HTMLButtonElement>(container, 'Undo').disabled).toBe(true)

      // pointerdown then a 1px jitter then up — below the 4px slop radius.
      pointer(preview, 'pointerdown', 100, 100)
      pointer(window, 'pointermove', 101, 101)
      pointer(window, 'pointerup', 101, 101)

      expect(byAriaLabel<HTMLButtonElement>(container, 'Undo').disabled).toBe(true)
    } finally {
      unmount()
    }
  })

  it('a real drag (past slop) pushes exactly one undo entry', () => {
    store.set('mtg-chart:charts', JSON.stringify([makeChart([makeSlot('Bolt')])]))
    store.set('mtg-chart:activeId', 'a')
    const { container, unmount } = renderComponent(<App />)
    try {
      const preview = openCropEditor(container)
      expect(byAriaLabel<HTMLButtonElement>(container, 'Undo').disabled).toBe(true)

      // One drag: several moves well past slop, then release.
      pointer(preview, 'pointerdown', 100, 100)
      pointer(window, 'pointermove', 130, 130)
      pointer(window, 'pointermove', 160, 150)
      pointer(window, 'pointerup', 160, 150)

      const undo = byAriaLabel<HTMLButtonElement>(container, 'Undo')
      expect(undo.disabled).toBe(false)

      // Exactly one entry: undoing once empties the history again.
      click(undo)
      expect(byAriaLabel<HTMLButtonElement>(container, 'Undo').disabled).toBe(true)
    } finally {
      unmount()
    }
  })
})
