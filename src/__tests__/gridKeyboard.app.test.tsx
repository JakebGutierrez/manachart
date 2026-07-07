// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import App from '@/App'
import type { Chart, Slot } from '@/types/chart'
import { renderComponent, act, click, pressKey, buttonByText } from './harness'

const store = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
  clear: () => { store.clear() },
  get length() { return store.size },
  key: (index: number) => [...store.keys()][index] ?? null,
}

function makeSlot(name: string, multiFace = false): Slot {
  return {
    kind: 'scryfall',
    scryfallId: `id-${name}`,
    oracleId: `oracle-${name}`,
    cardName: name,
    setCode: 'tst',
    collectorNumber: '1',
    layout: multiFace ? 'transform' : 'normal',
    selectedFaceIndex: 0,
    imageUris: multiFace
      ? [{ artCrop: `https://img.example/${name}-a.jpg` }, { artCrop: `https://img.example/${name}-b.jpg` }]
      : [{ artCrop: `https://img.example/${name}.jpg` }],
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
  store.set('manachart:charts', JSON.stringify([makeChart(slots)]))
  store.set('manachart:activeId', 'a')
}

function cell(container: HTMLElement, slotIndex: number): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-slot-index="${slotIndex}"]`)
  if (!el) throw new Error(`No cell with data-slot-index=${slotIndex}`)
  return el
}

beforeEach(() => {
  store.clear()
  viStubStorage()
})

afterEach(() => {
  document.body.innerHTML = ''
})

function viStubStorage() {
  Object.defineProperty(window, 'localStorage', { value: localStorageStub, configurable: true })
}

describe('grid keyboard spine', () => {
  it('exposes the grid as role=grid with gridcells carrying positional labels', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)

    expect(container.querySelector('[role="grid"]')).toBeTruthy()
    const c0 = cell(container, 0)
    expect(c0.getAttribute('role')).toBe('gridcell')
    expect(c0.getAttribute('aria-label')).toBe('Bolt, row 1 column 1')
    // empty cell announces "Empty" + position
    expect(cell(container, 2).getAttribute('aria-label')).toBe('Empty, row 2 column 1')
    unmount()
  })

  it('arrow keys move focus and selection together (selection follows focus)', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), makeSlot('Swords'), makeSlot('Giant')])
    const { container, unmount } = renderComponent(<App />)

    const c0 = cell(container, 0)
    act(() => c0.focus())
    pressKey(c0, 'ArrowRight')

    // cell 1 is now selected and focused
    expect(cell(container, 1).getAttribute('aria-selected')).toBe('true')
    expect(cell(container, 0).getAttribute('aria-selected')).toBe('false')
    expect(document.activeElement).toBe(cell(container, 1))
    // the Selected-card action surface reflects the new selection
    expect(buttonByText(container, 'Remove')).toBeTruthy()
    unmount()
  })

  it('roving tabindex: only the selected cell is tabbable', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), makeSlot('Swords'), makeSlot('Giant')])
    const { container, unmount } = renderComponent(<App />)

    const c0 = cell(container, 0)
    act(() => c0.focus())
    pressKey(c0, 'ArrowDown') // select cell 2

    expect(cell(container, 2).getAttribute('tabindex')).toBe('0')
    expect(cell(container, 0).getAttribute('tabindex')).toBe('-1')
    expect(cell(container, 1).getAttribute('tabindex')).toBe('-1')
    unmount()
  })

  it('Enter selects a cell; Escape clears the selection', () => {
    seedChart([makeSlot('Bolt'), null, null, null])
    const { container, unmount } = renderComponent(<App />)

    const c0 = cell(container, 0)
    act(() => c0.focus())
    pressKey(c0, 'Enter')
    expect(cell(container, 0).getAttribute('aria-selected')).toBe('true')

    pressKey(cell(container, 0), 'Escape')
    expect(cell(container, 0).getAttribute('aria-selected')).toBe('false')
    // action surface gone once nothing is selected
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Remove')).toBe(false)
    unmount()
  })

  it('Delete clears a filled slot and keeps focus on the emptied cell', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)

    expect(container.querySelectorAll('[data-slot-index] img')).toHaveLength(2)

    const c0 = cell(container, 0)
    act(() => c0.focus())
    pressKey(c0, 'Delete')

    // slot cleared: one fewer card image, cell 0 now announces Empty
    expect(container.querySelectorAll('[data-slot-index] img')).toHaveLength(1)
    expect(cell(container, 0).getAttribute('aria-label')).toBe('Empty, row 1 column 1')
    // focus stays on the now-empty cell 0
    expect(document.activeElement).toBe(cell(container, 0))
    unmount()
  })

  it('Shift+F10 opens the context menu anchored on the cell, focus into first item', () => {
    seedChart([makeSlot('Bolt'), null, null, null])
    const { container, unmount } = renderComponent(<App />)

    const c0 = cell(container, 0)
    act(() => c0.focus())
    pressKey(c0, 'F10', { shiftKey: true })

    const menu = document.querySelector('[role="menu"]')
    expect(menu).toBeTruthy()
    const firstItem = menu!.querySelector('[role="menuitem"]')
    expect(document.activeElement).toBe(firstItem)
    unmount()
  })

  it('traps Tab within the open context menu', () => {
    seedChart([makeSlot('Bolt'), null, null, null])
    const { container, unmount } = renderComponent(<App />)

    const c0 = cell(container, 0)
    act(() => c0.focus())
    pressKey(c0, 'F10', { shiftKey: true })

    const menu = document.querySelector('[role="menu"]')!
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(items.length).toBeGreaterThanOrEqual(2) // Remove + Switch Printing
    expect(document.activeElement).toBe(items[0])

    // Tab cycles forward within the menu instead of walking out of it.
    pressKey(items[0], 'Tab')
    expect(document.activeElement).toBe(items[1])
    // Tab from the last item wraps back to the first — focus never escapes.
    pressKey(items[items.length - 1], 'Tab')
    expect(document.activeElement).toBe(items[0])
    // Shift+Tab goes backward, still contained.
    pressKey(items[0], 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(items[items.length - 1])
    unmount()
  })

  it('context menu items are out of the page tab order (roving)', () => {
    seedChart([makeSlot('Bolt'), null, null, null])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)
    act(() => c0.focus())
    pressKey(c0, 'F10', { shiftKey: true })
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    for (const item of items) expect(item.getAttribute('tabindex')).toBe('-1')
    unmount()
  })

  it('does not open the context menu on an empty cell', () => {
    seedChart([null, null, null, null])
    const { container, unmount } = renderComponent(<App />)

    const c0 = cell(container, 0)
    act(() => c0.focus())
    pressKey(c0, 'F10', { shiftKey: true })
    expect(document.querySelector('[role="menu"]')).toBeNull()
    unmount()
  })

  it('per-cell overlay buttons are demoted out of the tab order and hidden from AT', () => {
    seedChart([makeSlot('Bolt'), null, null, null])
    const { container, unmount } = renderComponent(<App />)

    const removeX = cell(container, 0).querySelector('button')
    expect(removeX).toBeTruthy()
    expect(removeX!.getAttribute('tabindex')).toBe('-1')
    expect(removeX!.getAttribute('aria-hidden')).toBe('true')
    unmount()
  })
})

describe('segmented control arrow-key roving', () => {
  it('is a single tab stop and arrow keys change the value', () => {
    seedChart([makeSlot('Bolt'), null, null, null])
    const { container, unmount } = renderComponent(<App />)

    const group = [...container.querySelectorAll('[role="radiogroup"]')].find(
      (g) => g.getAttribute('aria-label') === 'Display mode',
    )!
    const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')]
    // landscape checked → tabbable; square unchecked → not tabbable
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    expect(radios[0].getAttribute('tabindex')).toBe('0')
    expect(radios[1].getAttribute('tabindex')).toBe('-1')

    act(() => radios[0].focus())
    pressKey(radios[0], 'ArrowRight')

    const after = [...group.querySelectorAll<HTMLElement>('[role="radio"]')]
    expect(after[1].getAttribute('aria-checked')).toBe('true')
    // focus followed the change to the newly-checked radio
    expect(document.activeElement).toBe(after[1])
    unmount()
  })

  it('keeps focus on the checked radio when a change is deferred then cancelled', () => {
    // Layout change with cards present opens a confirm dialog instead of applying.
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)

    const group = [...container.querySelectorAll('[role="radiogroup"]')].find(
      (g) => g.getAttribute('aria-label') === 'Layout mode',
    )!
    const uniform = group.querySelectorAll<HTMLElement>('[role="radio"]')[0]
    expect(uniform.getAttribute('aria-checked')).toBe('true')

    act(() => uniform.focus())
    pressKey(uniform, 'ArrowRight') // request Commander → opens confirm, value unchanged

    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
    // Cancel the deferred change.
    click(buttonByText(document.body, 'Cancel'))

    // Layout is still uniform, and focus is restored to the still-checked Uniform
    // radio — not stranded on the unchecked Commander option.
    const uniformAfter = group.querySelectorAll<HTMLElement>('[role="radio"]')[0]
    expect(uniformAfter.getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(uniformAfter)
    unmount()
  })

  it('moves focus to the newly-checked radio when a deferred change is confirmed', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)

    const group = [...container.querySelectorAll('[role="radiogroup"]')].find(
      (g) => g.getAttribute('aria-label') === 'Layout mode',
    )!
    const uniform = group.querySelectorAll<HTMLElement>('[role="radio"]')[0]
    act(() => uniform.focus())
    pressKey(uniform, 'ArrowRight') // request Commander → opens confirm

    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
    click(buttonByText(document.body, 'Change layout')) // confirm

    // Commander is now checked, and focus lands on it — not stranded on the
    // now-unchecked, tabIndex=-1 Uniform radio.
    const radios = group.querySelectorAll<HTMLElement>('[role="radio"]')
    expect(radios[1].getAttribute('aria-checked')).toBe('true')
    expect(radios[1].getAttribute('tabindex')).toBe('0')
    expect(document.activeElement).toBe(radios[1])
    unmount()
  })
})

describe('action surface reaches every context-menu capability', () => {
  it('renders Flip for a multi-face card and Switch printing for scryfall cards', () => {
    seedChart([makeSlot('DFC', true), null, null, null])
    const { container, unmount } = renderComponent(<App />)

    click(cell(container, 0)) // select
    expect(buttonByText(container, 'Remove')).toBeTruthy()
    expect(buttonByText(container, 'Flip')).toBeTruthy()
    expect(buttonByText(container, 'Switch printing')).toBeTruthy()
    unmount()
  })
})
