// @vitest-environment jsdom
// Phase 4 responsive re-tier, app-level: data-layout stamping, drawer
// semantics (inert / focus / Escape / backdrop), the bottom-sheet home of the
// Selected-card surface in drawer mode, and the delete-chart ConfirmDialog.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from '@/App'
import type { Chart, Slot } from '@/types/chart'
import { renderComponent, act, click, pressKey, byAriaLabel, buttonByText } from './harness'

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

function makeChart(id: string, name: string, slots: Array<Slot | null>): Chart {
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
    slots,
  }
}

function seedCharts(charts: Chart[], activeId: string) {
  store.set('manachart:charts', JSON.stringify(charts))
  store.set('manachart:activeId', activeId)
}

// Controllable matchMedia stub; without it jsdom has no matchMedia and the
// app renders docked.
function stubMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<EventListener>()
  const mql = {
    get matches() { return matches },
    media: '',
    addEventListener: (_type: string, cb: EventListener) => { listeners.add(cb) },
    removeEventListener: (_type: string, cb: EventListener) => { listeners.delete(cb) },
  } as unknown as MediaQueryList
  vi.stubGlobal('matchMedia', vi.fn(() => mql))
  return {
    setMatches(next: boolean) {
      matches = next
      act(() => {
        for (const cb of [...listeners]) cb(new Event('change'))
      })
    },
  }
}

const appRoot = (container: HTMLElement) => container.querySelector<HTMLElement>('.app')!
const panel = (container: HTMLElement) => container.querySelector<HTMLElement>('aside')!
const sheet = () => document.querySelector<HTMLElement>('[role="region"][aria-label="Selected card"]')
const dialog = () => document.querySelector<HTMLElement>('#dialog-root [role="dialog"]')
const cell = (container: HTMLElement, slotIndex: number) =>
  container.querySelector<HTMLElement>(`[data-slot-index="${slotIndex}"]`)!

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', localStorageStub)
  window.history.pushState({}, '', '/')
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe('data-layout stamping', () => {
  it('stamps docked on the app root when the drawer query does not match', () => {
    stubMatchMedia(false)
    const { container, unmount } = renderComponent(<App />)
    try {
      expect(appRoot(container).getAttribute('data-layout')).toBe('docked')
    } finally {
      unmount()
    }
  })

  it('stamps drawer below the breakpoint and re-stamps live on crossing', () => {
    const mm = stubMatchMedia(true)
    const { container, unmount } = renderComponent(<App />)
    try {
      expect(appRoot(container).getAttribute('data-layout')).toBe('drawer')
      mm.setMatches(false)
      expect(appRoot(container).getAttribute('data-layout')).toBe('docked')
      mm.setMatches(true)
      expect(appRoot(container).getAttribute('data-layout')).toBe('drawer')
    } finally {
      unmount()
    }
  })
})

describe('drawer semantics', () => {
  it('closed drawer is inert; docked panel never is', () => {
    stubMatchMedia(true)
    const { container, unmount } = renderComponent(<App />)
    try {
      expect(panel(container).hasAttribute('inert')).toBe(true)
    } finally {
      unmount()
    }
  })

  it('docked panel is not inert', () => {
    stubMatchMedia(false)
    const { container, unmount } = renderComponent(<App />)
    try {
      expect(panel(container).hasAttribute('inert')).toBe(false)
    } finally {
      unmount()
    }
  })

  it('open lifts inert, sets aria-expanded, and moves focus into the panel', () => {
    stubMatchMedia(true)
    const { container, unmount } = renderComponent(<App />)
    try {
      const toggle = byAriaLabel<HTMLButtonElement>(container, 'Toggle controls')
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      click(toggle)
      expect(panel(container).hasAttribute('inert')).toBe(false)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(document.activeElement).toBe(panel(container))
    } finally {
      unmount()
    }
  })

  it('Escape closes the open drawer and returns focus to the toggle', () => {
    stubMatchMedia(true)
    const { container, unmount } = renderComponent(<App />)
    try {
      const toggle = byAriaLabel<HTMLButtonElement>(container, 'Toggle controls')
      click(toggle)
      expect(panel(container).hasAttribute('inert')).toBe(false)
      pressKey(panel(container), 'Escape')
      expect(panel(container).hasAttribute('inert')).toBe(true)
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(toggle)
    } finally {
      unmount()
    }
  })

  it('backdrop click closes the drawer and returns focus to the toggle', () => {
    stubMatchMedia(true)
    const { container, unmount } = renderComponent(<App />)
    try {
      const toggle = byAriaLabel<HTMLButtonElement>(container, 'Toggle controls')
      click(toggle)
      const backdrop = container.querySelector<HTMLElement>('.backdrop')!
      click(backdrop)
      expect(panel(container).hasAttribute('inert')).toBe(true)
      expect(document.activeElement).toBe(toggle)
    } finally {
      unmount()
    }
  })

  it('crossing into docked mode dissolves an open drawer', () => {
    const mm = stubMatchMedia(true)
    const { container, unmount } = renderComponent(<App />)
    try {
      click(byAriaLabel<HTMLButtonElement>(container, 'Toggle controls'))
      mm.setMatches(false)
      expect(panel(container).hasAttribute('inert')).toBe(false) // docked: usable
      // Back to drawer mode: the drawer must not reopen unasked.
      mm.setMatches(true)
      expect(panel(container).hasAttribute('inert')).toBe(true)
    } finally {
      unmount()
    }
  })
})

describe('bottom sheet (drawer mode home of the Selected-card surface)', () => {
  it('appears on selecting a filled cell, outside the drawer, and dismisses', () => {
    stubMatchMedia(true)
    seedCharts([makeChart('a', 'Alpha', [makeSlot('Bolt')])], 'a')
    const { container, unmount } = renderComponent(<App />)
    try {
      expect(sheet()).toBeNull()

      click(cell(container, 0))
      expect(sheet()).not.toBeNull()
      expect(sheet()!.textContent).toContain('Bolt')
      expect(buttonByText(sheet()!, 'Remove')).toBeTruthy()
      // The surface lives in the sheet, not the drawer (§7.1b split).
      expect(panel(container).contains(sheet()!)).toBe(false)
      expect(panel(container).textContent).not.toContain('Selected card')

      click(byAriaLabel(sheet()!, 'Dismiss'))
      expect(sheet()).toBeNull()
      expect(cell(container, 0).getAttribute('aria-selected')).toBe('false')
    } finally {
      unmount()
    }
  })

  it('does not appear for an empty cell (nothing to act on)', () => {
    stubMatchMedia(true)
    seedCharts([makeChart('a', 'Alpha', [makeSlot('Bolt')])], 'a')
    const { container, unmount } = renderComponent(<App />)
    try {
      click(cell(container, 1))
      expect(sheet()).toBeNull()
    } finally {
      unmount()
    }
  })

  it('Remove in the sheet clears the card and closes the sheet', () => {
    stubMatchMedia(true)
    seedCharts([makeChart('a', 'Alpha', [makeSlot('Bolt')])], 'a')
    const { container, unmount } = renderComponent(<App />)
    try {
      click(cell(container, 0))
      click(buttonByText(sheet()!, 'Remove'))
      expect(sheet()).toBeNull()
      expect(container.querySelectorAll('img').length).toBe(0)
    } finally {
      unmount()
    }
  })

  it('docked mode keeps the Selected-card surface in the panel, no sheet', () => {
    stubMatchMedia(false)
    seedCharts([makeChart('a', 'Alpha', [makeSlot('Bolt')])], 'a')
    const { container, unmount } = renderComponent(<App />)
    try {
      click(cell(container, 0))
      expect(sheet()).toBeNull()
      expect(panel(container).textContent).toContain('Selected card')
      expect(buttonByText(panel(container), 'Remove')).toBeTruthy()
    } finally {
      unmount()
    }
  })
})

describe('chart delete confirmation (§7.3a)', () => {
  const twoCharts = () => [
    makeChart('a', 'Alpha', [makeSlot('Bolt')]),
    makeChart('b', 'Beta', []),
  ]

  it('delete asks first and cancel keeps the chart', () => {
    seedCharts(twoCharts(), 'a')
    const { container, unmount } = renderComponent(<App />)
    try {
      click(byAriaLabel(container, 'Delete Beta'))
      expect(dialog()).not.toBeNull()
      expect(dialog()!.textContent).toContain('Delete "Beta"?')
      // Nothing deleted while the dialog is open.
      expect(container.textContent).toContain('Beta')

      click(buttonByText(dialog()!, 'Cancel'))
      expect(dialog()).toBeNull()
      expect(container.textContent).toContain('Beta')
    } finally {
      unmount()
    }
  })

  it('confirm deletes the chart', () => {
    seedCharts(twoCharts(), 'a')
    const { container, unmount } = renderComponent(<App />)
    try {
      click(byAriaLabel(container, 'Delete Beta'))
      click(buttonByText(dialog()!, 'Delete chart'))
      expect(dialog()).toBeNull()
      expect(container.textContent).not.toContain('Beta')
    } finally {
      unmount()
    }
  })

  it('confirm deletes the active chart and activates a survivor', () => {
    seedCharts(twoCharts(), 'a')
    const { container, unmount } = renderComponent(<App />)
    try {
      click(byAriaLabel(container, 'Delete Alpha'))
      click(buttonByText(dialog()!, 'Delete chart'))
      expect(container.textContent).not.toContain('Alpha')
      // The survivor's (empty) grid renders — Alpha's card is gone with it.
      expect(container.querySelectorAll('img').length).toBe(0)
    } finally {
      unmount()
    }
  })
})
