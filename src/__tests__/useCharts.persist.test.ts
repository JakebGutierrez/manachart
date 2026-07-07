// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { safeWrite, nextStorageError, createPersistScheduler } from '@/hooks/useCharts'
import type { Chart } from '@/types/chart'

const store = new Map<string, string>()
let throwOnSet = false
const localStorageStub = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (throwOnSet) {
      const err = new DOMException('quota', 'QuotaExceededError')
      throw err
    }
    store.set(key, value)
  },
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
    backgroundColor: '#000',
    cellGap: 4,
    padding: 16,
    cornerRadius: 4,
    slots: [],
  }
}

beforeEach(() => {
  store.clear()
  throwOnSet = false
  vi.stubGlobal('localStorage', localStorageStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('safeWrite', () => {
  it('returns ok and writes both keys on success', () => {
    expect(safeWrite([makeChart('a')], 'a')).toEqual({ ok: true })
    expect(store.get('manachart:activeId')).toBe('a')
    expect(store.get('manachart:charts')).toContain('"id":"a"')
  })

  it('returns ok:false instead of throwing when setItem throws QuotaExceededError', () => {
    throwOnSet = true
    expect(() => safeWrite([makeChart('a')], 'a')).not.toThrow()
    expect(safeWrite([makeChart('a')], 'a')).toEqual({ ok: false })
  })
})

describe('nextStorageError (idempotent transition)', () => {
  it('clears the error on a successful write', () => {
    expect(nextStorageError(undefined, true)).toBeUndefined()
    expect(nextStorageError('previous', true)).toBeUndefined()
  })

  it('sets a message on failure but preserves an existing one by reference (no loop)', () => {
    const first = nextStorageError(undefined, false)
    expect(first).toBeTypeOf('string')
    // A repeat failure returns the SAME string reference, so an idempotency
    // guard (next === prev) sees no change and skips the setState → no retry loop.
    expect(nextStorageError(first, false)).toBe(first)
  })
})

describe('createPersistScheduler (trailing debounce)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('coalesces rapid schedules into one write with the last value', () => {
    const write = vi.fn(() => ({ ok: true }))
    const onResult = vi.fn()
    const s = createPersistScheduler(write, onResult, 300)

    s.schedule([makeChart('a')], 'a')
    s.schedule([makeChart('b')], 'b')
    s.schedule([makeChart('c')], 'c')
    expect(write).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith([makeChart('c')], 'c')
    expect(onResult).toHaveBeenCalledWith(true)
  })

  it('flush() writes the pending value immediately (e.g. on pagehide)', () => {
    const write = vi.fn(() => ({ ok: true }))
    const s = createPersistScheduler(write, () => {}, 300)

    s.schedule([makeChart('z')], 'z')
    s.flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith([makeChart('z')], 'z')

    // No double-write when the (already cleared) timer later fires.
    vi.advanceTimersByTime(300)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('cancel() drops a pending write', () => {
    const write = vi.fn(() => ({ ok: true }))
    const s = createPersistScheduler(write, () => {}, 300)
    s.schedule([makeChart('q')], 'q')
    s.cancel()
    vi.advanceTimersByTime(300)
    expect(write).not.toHaveBeenCalled()
  })
})
