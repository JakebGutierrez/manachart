// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from '@/App'
import type { Chart, Slot } from '@/types/chart'
import { renderComponent, act, click, pressKey, buttonByText, byAriaLabel } from './harness'

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
    id: 'a', name: 'Alpha', schemaVersion: 4,
    gridRows: 2, gridCols: 2, layout: 'uniform', heroConfig: [],
    displayMode: 'landscape', nameDisplayMode: 'none', title: '',
    backgroundColor: '#0b0c0e', cellGap: 4, padding: 16, cornerRadius: 4, slots,
  }
}

function seedChart(slots: Array<Slot | null>) {
  store.set('mtg-chart:charts', JSON.stringify([makeChart(slots)]))
  store.set('mtg-chart:activeId', 'a')
}

function cell(container: HTMLElement, slotIndex: number): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-slot-index="${slotIndex}"]`)
  if (!el) throw new Error(`No cell with data-slot-index=${slotIndex}`)
  return el
}
const nameOf = (c: HTMLElement) => c.getAttribute('aria-label')

function pointer(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  init: PointerEventInit = {},
) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
        pointerId: 1, isPrimary: true, button: 0, ...init,
      }),
    )
  })
}

// jsdom has no layout, so document.elementFromPoint is undefined. Install a stub
// resolving the drag hit-test to a chosen element; reassignable mid-drag so a
// test can differ the transient hover target from the release target.
function hitTest(el: Element | null) {
  ;(document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint =
    () => el
}

// jsdom's pointer-capture methods throw/are partial; install spies so the engine
// can actually take capture and we can assert it is released on teardown.
function stubCapture(el: Element) {
  const setCap = vi.fn()
  const relCap = vi.fn()
  Object.assign(el, { setPointerCapture: setCap, releasePointerCapture: relCap })
  return { setCap, relCap }
}

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', localStorageStub)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'elementFromPoint')
  document.body.innerHTML = ''
})

describe('pointer drag movement (mouse)', () => {
  it('drags a card onto another cell and swaps them', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)
    const c1 = cell(container, 1)
    // jsdom has no layout; make the hit-test resolve to cell 1.
    hitTest(c1)

    pointer(c0, 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 10, 0) // cross slop → drag begins
    pointer(window, 'pointermove', 100, 0) // over cell 1
    pointer(window, 'pointerup', 100, 0)

    expect(nameOf(cell(container, 0))).toBe('Path, row 1 column 1')
    expect(nameOf(cell(container, 1))).toBe('Bolt, row 1 column 2')
    unmount()
  })

  it('drags a card onto an empty cell (source becomes empty)', () => {
    seedChart([makeSlot('Bolt'), null, null, null])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)
    hitTest(cell(container, 2))

    pointer(c0, 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 10, 0)
    pointer(window, 'pointermove', 0, 100)
    pointer(window, 'pointerup', 0, 100)

    expect(nameOf(cell(container, 0))).toBe('Empty, row 1 column 1')
    expect(nameOf(cell(container, 2))).toBe('Bolt, row 2 column 1')
    unmount()
  })

  it('a release off any cell makes no move', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)
    hitTest(document.body) // not a cell

    pointer(c0, 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 40, 0)
    pointer(window, 'pointerup', 400, 400)

    expect(nameOf(cell(container, 0))).toBe('Bolt, row 1 column 1')
    expect(nameOf(cell(container, 1))).toBe('Path, row 1 column 2')
    unmount()
  })

  it('a sub-slop press-and-release does not move (it is a click, not a drag)', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)
    hitTest(cell(container, 1))

    pointer(c0, 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 2, 0) // under slop
    pointer(window, 'pointerup', 2, 0)

    expect(nameOf(cell(container, 0))).toBe('Bolt, row 1 column 1')
    unmount()
  })

  it('commits to the release target, not a transient hover (last-over ≠ release)', () => {
    seedChart([makeSlot('Bolt'), null, null, makeSlot('Giant')])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)

    pointer(c0, 'pointerdown', 0, 0)
    hitTest(cell(container, 1)) // transient hover over cell 1
    pointer(window, 'pointermove', 10, 0)
    pointer(window, 'pointermove', 50, 0)
    hitTest(cell(container, 3)) // released over cell 3
    pointer(window, 'pointerup', 300, 0)

    // Commit landed on the release target (3), not the hovered cell (1).
    expect(nameOf(cell(container, 0))).toBe('Giant, row 1 column 1')
    expect(nameOf(cell(container, 1))).toBe('Empty, row 1 column 2')
    expect(nameOf(cell(container, 3))).toBe('Bolt, row 2 column 2')
    unmount()
  })

  it('an off-grid release after hovering a cell commits nothing', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)

    pointer(c0, 'pointerdown', 0, 0)
    hitTest(cell(container, 1)) // hovered cell 1 during the drag
    pointer(window, 'pointermove', 10, 0)
    pointer(window, 'pointermove', 60, 0)
    hitTest(document.body) // released off-grid
    pointer(window, 'pointerup', 500, 500)

    expect(nameOf(cell(container, 0))).toBe('Bolt, row 1 column 1')
    expect(nameOf(cell(container, 1))).toBe('Path, row 1 column 2')
    unmount()
  })

  it('Escape mid-drag cancels: no mutation, no history, ghost gone', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)
    hitTest(cell(container, 1))

    pointer(c0, 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 30, 0) // drag in flight
    expect(document.querySelector('[aria-hidden="true"] img')).not.toBeNull()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    // No swap, ghost gone. (A subsequent pointerup must also do nothing.)
    pointer(window, 'pointerup', 100, 0)
    expect(nameOf(cell(container, 0))).toBe('Bolt, row 1 column 1')
    expect(nameOf(cell(container, 1))).toBe('Path, row 1 column 2')
    expect(document.querySelector('[aria-hidden="true"] img')).toBeNull()
    // undo is unavailable — nothing was committed
    expect(byAriaLabel<HTMLButtonElement>(container, 'Undo').disabled).toBe(true)
    unmount()
  })

  it('Escape mid-drag releases pointer capture and returns to idle', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)
    const { setCap, relCap } = stubCapture(c0)
    hitTest(cell(container, 1))

    pointer(c0, 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 30, 0) // arm → capture taken here
    expect(setCap).toHaveBeenCalledWith(1)

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(relCap).toHaveBeenCalledWith(1) // released on the cancel path
    expect(nameOf(cell(container, 0))).toBe('Bolt, row 1 column 1') // idle, no mutation
    expect(document.querySelector('[aria-hidden="true"] img')).toBeNull()
    unmount()
  })

  it('a normal commit releases pointer capture', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)
    const { setCap, relCap } = stubCapture(c0)
    hitTest(cell(container, 1))

    pointer(c0, 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 30, 0)
    pointer(window, 'pointerup', 100, 0)

    expect(setCap).toHaveBeenCalledTimes(1)
    expect(relCap).toHaveBeenCalledWith(1)
    expect(nameOf(cell(container, 0))).toBe('Path, row 1 column 1') // move committed
    unmount()
  })

  it('a sub-slop press-release never takes or releases capture', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)
    const { setCap, relCap } = stubCapture(c0)
    hitTest(cell(container, 1))

    pointer(c0, 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 2, 0) // under slop → never arms
    pointer(window, 'pointerup', 2, 0)

    expect(setCap).not.toHaveBeenCalled()
    expect(relCap).not.toHaveBeenCalled()
    unmount()
  })

  it('a right-button press does not start a drag', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)
    hitTest(cell(container, 1))

    pointer(c0, 'pointerdown', 0, 0, { button: 2 }) // right button
    pointer(window, 'pointermove', 40, 0)
    pointer(window, 'pointerup', 40, 0)

    // No drag began (no ghost was shown) and nothing moved.
    expect(document.querySelector('[aria-hidden="true"] img')).toBeNull()
    expect(nameOf(cell(container, 0))).toBe('Bolt, row 1 column 1')
    expect(nameOf(cell(container, 1))).toBe('Path, row 1 column 2')
    unmount()
  })

  it('renders a drag ghost only while a drag is in flight', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)
    hitTest(cell(container, 1))

    expect(document.querySelector('img[alt=""]')).toBeNull() // no ghost yet
    pointer(c0, 'pointerdown', 0, 0)
    pointer(window, 'pointermove', 20, 0)
    // ghost present mid-drag (portaled to body, aria-hidden, empty alt)
    expect(document.querySelector('[aria-hidden="true"] img')).not.toBeNull()
    pointer(window, 'pointerup', 20, 0)
    expect(document.querySelector('[aria-hidden="true"] img')).toBeNull()
    unmount()
  })
})

describe('keyboard grab & move', () => {
  it('Space grabs, arrows retarget, Enter commits the move', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)
    act(() => c0.focus())

    pressKey(c0, ' ') // grab cell 0
    pressKey(document.activeElement!, 'ArrowRight') // retarget to cell 1
    pressKey(document.activeElement!, 'Enter') // commit

    expect(nameOf(cell(container, 0))).toBe('Path, row 1 column 1')
    expect(nameOf(cell(container, 1))).toBe('Bolt, row 1 column 2')
    unmount()
  })

  it('Escape cancels an armed move without mutating', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)
    act(() => c0.focus())

    pressKey(c0, ' ')
    pressKey(document.activeElement!, 'ArrowRight')
    pressKey(document.activeElement!, 'Escape')

    expect(nameOf(cell(container, 0))).toBe('Bolt, row 1 column 1')
    expect(nameOf(cell(container, 1))).toBe('Path, row 1 column 2')
    unmount()
  })

  it('the Selected-card "Move" button arms move and focuses the source cell', () => {
    seedChart([makeSlot('Bolt'), makeSlot('Path'), null, null])
    const { container, unmount } = renderComponent(<App />)

    click(cell(container, 0)) // select cell 0 → Selected-card surface appears
    const moveBtn = buttonByText(container, 'Move')
    click(moveBtn)

    // Button relabels + focus jumps to the source cell so arrows can retarget.
    expect(buttonByText(container, 'Cancel move')).toBeTruthy()
    expect(document.activeElement).toBe(cell(container, 0))

    pressKey(cell(container, 0), 'ArrowRight')
    pressKey(document.activeElement!, 'Enter')
    expect(nameOf(cell(container, 0))).toBe('Path, row 1 column 1')
    expect(nameOf(cell(container, 1))).toBe('Bolt, row 1 column 2')
    unmount()
  })

  it('an armed move commits to a tapped target cell (pointer)', () => {
    seedChart([makeSlot('Bolt'), null, null, null])
    const { container, unmount } = renderComponent(<App />)
    const c0 = cell(container, 0)
    act(() => c0.focus())
    pressKey(c0, ' ') // grab

    click(cell(container, 3)) // tap an empty target commits there
    expect(nameOf(cell(container, 0))).toBe('Empty, row 1 column 1')
    expect(nameOf(cell(container, 3))).toBe('Bolt, row 2 column 2')
    unmount()
  })
})
