// @vitest-environment jsdom
//
// Named tripwires for the localStorage contract (docs/contracts.md §1,
// docs/decisions.md §1). If one of these fails, you are about to break every
// existing user's saved charts — read those docs before "fixing" the test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { safeWrite, loadOrInit, useCharts } from '@/hooks/useCharts'
import { renderHook, act } from './harness'
import type { Chart } from '@/types/chart'

const store = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
  clear: () => { store.clear() },
  get length() { return store.size },
  key: (index: number) => [...store.keys()][index] ?? null,
}

function makeChart(id: string): Chart {
  return {
    id,
    name: id,
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
  vi.useRealTimers()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe("localStorage key contract — the 'mtg-chart' prefix is permanent (decisions.md §1)", () => {
  it("writes user data under EXACTLY 'mtg-chart:charts' + 'mtg-chart:activeId' — the pre-rename brand is deliberate; renaming the keys orphans every existing user's charts", () => {
    safeWrite([makeChart('a')], 'a')
    expect([...store.keys()].sort()).toEqual(['mtg-chart:activeId', 'mtg-chart:charts'])
  })

  it("stores activeId as a plain string, NOT JSON — writing '\"a\"' instead of 'a' breaks active-chart restore for every existing user", () => {
    safeWrite([makeChart('a')], 'a')
    expect(store.get('mtg-chart:activeId')).toBe('a')
    const charts = JSON.parse(store.get('mtg-chart:charts')!) as Chart[]
    expect(charts[0].id).toBe('a')
  })

  it("loads charts back from the same literal keys — renaming only the read side silently abandons every stored chart", () => {
    store.set('mtg-chart:charts', JSON.stringify([makeChart('k')]))
    store.set('mtg-chart:activeId', 'k')
    const { charts, activeId } = loadOrInit()
    expect(charts).toHaveLength(1)
    expect(charts[0].id).toBe('k')
    expect(activeId).toBe('k')
  })
})

describe('corrupt-store recovery — abandon, then overwrite on next write (contracts.md §1)', () => {
  it('a corrupt stored value is abandoned on load and OVERWRITTEN with the fresh default by the persistence effect after the debounce', () => {
    vi.useFakeTimers()
    store.set('mtg-chart:charts', 'not valid json{{{')

    const h = renderHook(() => useCharts())
    // Still corrupt inside the debounce window…
    expect(store.get('mtg-chart:charts')).toBe('not valid json{{{')
    act(() => {
      vi.advanceTimersByTime(300)
    })
    // …then replaced wholesale: this is the documented all-or-nothing recovery.
    const written = JSON.parse(store.get('mtg-chart:charts')!) as Chart[]
    expect(Array.isArray(written)).toBe(true)
    expect(written).toHaveLength(1)
    expect(written[0].schemaVersion).toBe(4)
    expect(store.get('mtg-chart:activeId')).toBe(written[0].id)
    h.unmount()
  })

  it('pagehide flushes a pending debounced write immediately — unhooking this loses the last edit on tab close (contracts.md §1 write behaviour)', () => {
    vi.useFakeTimers() // hold the 300ms debounce so only the flush can write
    const h = renderHook(() => useCharts())
    expect(store.get('mtg-chart:charts')).toBeUndefined()

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(store.get('mtg-chart:charts')).toBeDefined()
    h.unmount()
  })
})
