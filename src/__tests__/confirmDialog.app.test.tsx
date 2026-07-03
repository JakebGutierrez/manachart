// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from '@/App'
import type { Chart, Slot } from '@/types/chart'
import { renderComponent, click, byAriaLabel, buttonByText } from './harness'

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

function seedChart(slots: Array<Slot | null>) {
  store.set('mtg-chart:charts', JSON.stringify([makeChart(slots)]))
  store.set('mtg-chart:activeId', 'a')
}

const dialog = () => document.querySelector<HTMLElement>('#dialog-root [role="dialog"]')

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', localStorageStub)
  window.history.pushState({}, '', '/')
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe('ConfirmDialog replaces window.confirm', () => {
  it('clear cards: confirm clears the grid and pushes one undo entry', () => {
    seedChart([makeSlot('Bolt')])
    const { container, unmount } = renderComponent(<App />)
    try {
      expect(container.querySelectorAll('img').length).toBe(1)

      click(buttonByText(container, 'Clear cards'))
      expect(dialog()).not.toBeNull()
      expect(dialog()!.textContent).toContain('Clear all cards from this chart?')

      click(buttonByText(dialog()!, 'Clear cards'))
      expect(dialog()).toBeNull()
      expect(container.querySelectorAll('img').length).toBe(0)
      expect(byAriaLabel<HTMLButtonElement>(container, 'Undo').disabled).toBe(false)
    } finally {
      unmount()
    }
  })

  it('clear cards: cancel leaves the chart untouched', () => {
    seedChart([makeSlot('Bolt')])
    const { container, unmount } = renderComponent(<App />)
    try {
      click(buttonByText(container, 'Clear cards'))
      click(buttonByText(dialog()!, 'Cancel'))

      expect(dialog()).toBeNull()
      expect(container.querySelectorAll('img').length).toBe(1)
      expect(byAriaLabel<HTMLButtonElement>(container, 'Undo').disabled).toBe(true)
    } finally {
      unmount()
    }
  })

  it('layout change with cards: asks first, applies on confirm', () => {
    seedChart([makeSlot('Bolt')])
    const { container, unmount } = renderComponent(<App />)
    try {
      click(buttonByText(container, 'Commander'))
      expect(dialog()).not.toBeNull()
      expect(dialog()!.textContent).toContain('Changing the layout will clear all placed cards.')
      // Nothing applied while the dialog is open.
      expect(container.querySelectorAll('img').length).toBe(1)

      click(buttonByText(dialog()!, 'Change layout'))
      expect(dialog()).toBeNull()
      expect(container.querySelectorAll('img').length).toBe(0)
      expect(byAriaLabel<HTMLButtonElement>(container, 'Undo').disabled).toBe(false)
    } finally {
      unmount()
    }
  })

  it('layout change with cards: cancel keeps cards and layout', () => {
    seedChart([makeSlot('Bolt')])
    const { container, unmount } = renderComponent(<App />)
    try {
      click(buttonByText(container, 'Commander'))
      click(buttonByText(dialog()!, 'Cancel'))

      expect(dialog()).toBeNull()
      expect(container.querySelectorAll('img').length).toBe(1)
      expect(buttonByText(container, 'Commander').getAttribute('aria-checked')).toBe('false')
      expect(byAriaLabel<HTMLButtonElement>(container, 'Undo').disabled).toBe(true)
    } finally {
      unmount()
    }
  })

  it('layout change on an empty chart applies without a dialog', () => {
    seedChart([])
    const { container, unmount } = renderComponent(<App />)
    try {
      click(buttonByText(container, 'Commander'))
      expect(dialog()).toBeNull()
      expect(buttonByText(container, 'Commander').getAttribute('aria-checked')).toBe('true')
      expect(byAriaLabel<HTMLButtonElement>(container, 'Undo').disabled).toBe(false)
    } finally {
      unmount()
    }
  })
})
