// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from '@/App'
import type { Chart } from '@/types/chart'
import { renderComponent, setInputValue, click, byAriaLabel, buttonByText } from './harness'

const store = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
  clear: () => { store.clear() },
  get length() { return store.size },
  key: (index: number) => [...store.keys()][index] ?? null,
}

function makeChart(id: string, name: string): Chart {
  return {
    id,
    name,
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
    slots: [],
  }
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

describe('edit-burst resets on chart switch (Fix 1)', () => {
  it("makes chart B's first title edit undoable after editing chart A's title", () => {
    // Two charts; Alpha is active.
    store.set('manachart:charts', JSON.stringify([makeChart('a', 'Alpha'), makeChart('b', 'Beta')]))
    store.set('manachart:activeId', 'a')

    const { container, unmount } = renderComponent(<App />)
    try {
      const titleInput = byAriaLabel<HTMLInputElement>(container, 'Chart title')
      const undo = () => byAriaLabel<HTMLButtonElement>(container, 'Undo')

      // Edit chart A's title — starts (and stays in) a 'title' burst.
      setInputValue(titleInput, 'Alpha edited')

      // Switch to chart B (its name button; B is not active so it selects).
      click(buttonByText(container, 'Beta'))
      // Selecting a chart resets history, so undo is disabled at this point.
      expect(undo().disabled).toBe(true)

      // Edit chart B's title. With the burst carried over from A this would push
      // NO snapshot (the bug); with the reset it pushes one → undo enabled.
      const titleInputB = byAriaLabel<HTMLInputElement>(container, 'Chart title')
      setInputValue(titleInputB, 'Beta edited')

      expect(undo().disabled).toBe(false)
    } finally {
      unmount()
    }
  })
})
