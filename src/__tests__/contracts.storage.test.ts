// @vitest-environment jsdom
//
// Named tripwires for the localStorage contract (docs/contracts.md §1,
// docs/decisions.md §1). If one of these fails, you are about to break every
// existing user's saved charts — read those docs before "fixing" the test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { safeWrite, loadOrInit, migrateStorageKeys, useCharts } from '@/hooks/useCharts'
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

describe("localStorage key contract — user data lives under EXACTLY 'manachart:*' (decisions.md §1)", () => {
  it("writes user data under EXACTLY 'manachart:charts' + 'manachart:activeId' — these are user-data keys; renaming them (again) without a migration orphans every existing user's charts", () => {
    safeWrite([makeChart('a')], 'a')
    expect([...store.keys()].sort()).toEqual(['manachart:activeId', 'manachart:charts'])
  })

  it("stores activeId as a plain string, NOT JSON — writing '\"a\"' instead of 'a' breaks active-chart restore for every existing user", () => {
    safeWrite([makeChart('a')], 'a')
    expect(store.get('manachart:activeId')).toBe('a')
    const charts = JSON.parse(store.get('manachart:charts')!) as Chart[]
    expect(charts[0].id).toBe('a')
  })

  it("loads charts back from the same literal keys — renaming only the read side silently abandons every stored chart", () => {
    store.set('manachart:charts', JSON.stringify([makeChart('k')]))
    store.set('manachart:activeId', 'k')
    const { charts, activeId } = loadOrInit()
    expect(charts).toHaveLength(1)
    expect(charts[0].id).toBe('k')
    expect(activeId).toBe('k')
  })
})

describe('one-time key rename migration mtg-chart:* → manachart:* (decisions.md §1, contracts.md §1)', () => {
  it('(a) legacy keys populated + new keys absent → charts load and the new keys get written', () => {
    store.set('mtg-chart:charts', JSON.stringify([makeChart('legacy')]))
    store.set('mtg-chart:activeId', 'legacy')

    const { charts, activeId } = loadOrInit()
    // The stored chart is carried forward, read through the new keys.
    expect(charts).toHaveLength(1)
    expect(charts[0].id).toBe('legacy')
    expect(activeId).toBe('legacy')
    // Migration copied legacy → new eagerly, so the new keys are now populated.
    expect(JSON.parse(store.get('manachart:charts')!)[0].id).toBe('legacy')
    expect(store.get('manachart:activeId')).toBe('legacy')
  })

  it('(b) both legacy and new keys present → the new keys win, legacy is ignored', () => {
    store.set('mtg-chart:charts', JSON.stringify([makeChart('old')]))
    store.set('mtg-chart:activeId', 'old')
    store.set('manachart:charts', JSON.stringify([makeChart('new')]))
    store.set('manachart:activeId', 'new')

    const { charts, activeId } = loadOrInit()
    expect(charts).toHaveLength(1)
    expect(charts[0].id).toBe('new')
    expect(activeId).toBe('new')
    // The new keys must not be clobbered by the legacy copy.
    expect(JSON.parse(store.get('manachart:charts')!)[0].id).toBe('new')
    expect(store.get('manachart:activeId')).toBe('new')
  })

  it('(c) neither legacy nor new keys present → a fresh default chart, nothing migrated', () => {
    const { charts } = loadOrInit()
    expect(charts).toHaveLength(1)
    expect(charts[0].schemaVersion).toBe(4)
    expect(store.has('mtg-chart:charts')).toBe(false)
  })

  it('(d) the legacy keys are NOT deleted — migration is non-destructive so an older-build round-trip still finds its data', () => {
    store.set('mtg-chart:charts', JSON.stringify([makeChart('legacy')]))
    store.set('mtg-chart:activeId', 'legacy')

    migrateStorageKeys()

    expect(store.get('mtg-chart:charts')).toBe(JSON.stringify([makeChart('legacy')]))
    expect(store.get('mtg-chart:activeId')).toBe('legacy')
  })

  it('migrates the two keys independently — charts present but no activeId still carries the charts over', () => {
    store.set('mtg-chart:charts', JSON.stringify([makeChart('lonely')]))
    // no mtg-chart:activeId

    migrateStorageKeys()

    expect(JSON.parse(store.get('manachart:charts')!)[0].id).toBe('lonely')
    expect(store.has('manachart:activeId')).toBe(false)
  })
})

describe('corrupt-store recovery — abandon, then overwrite on next write (contracts.md §1)', () => {
  it('a corrupt stored value is abandoned on load and OVERWRITTEN with the fresh default by the persistence effect after the debounce', () => {
    vi.useFakeTimers()
    store.set('manachart:charts', 'not valid json{{{')

    const h = renderHook(() => useCharts())
    // Still corrupt inside the debounce window…
    expect(store.get('manachart:charts')).toBe('not valid json{{{')
    act(() => {
      vi.advanceTimersByTime(300)
    })
    // …then replaced wholesale: this is the documented all-or-nothing recovery.
    const written = JSON.parse(store.get('manachart:charts')!) as Chart[]
    expect(Array.isArray(written)).toBe(true)
    expect(written).toHaveLength(1)
    expect(written[0].schemaVersion).toBe(4)
    expect(store.get('manachart:activeId')).toBe(written[0].id)
    h.unmount()
  })

  it('pagehide flushes a pending debounced write immediately — unhooking this loses the last edit on tab close (contracts.md §1 write behaviour)', () => {
    vi.useFakeTimers() // hold the 300ms debounce so only the flush can write
    const h = renderHook(() => useCharts())
    expect(store.get('manachart:charts')).toBeUndefined()

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(store.get('manachart:charts')).toBeDefined()
    h.unmount()
  })
})
