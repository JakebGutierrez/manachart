// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import LZString from 'lz-string'
import { loadOrInit } from '@/hooks/useCharts'
import { encodeShareLink } from '@/utils/shareLink'
import type { Chart } from '@/types/chart'

// Node 22 exposes its own experimental localStorage global that takes precedence
// over jsdom's in vitest workers. Stub it explicitly so tests are isolated.
const store = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
  clear: () => { store.clear() },
  get length() { return store.size },
  key: (index: number) => [...store.keys()][index] ?? null,
}

function makeStoredChart(overrides: Partial<Chart> = {}): Chart {
  return {
    id: 'stored-id',
    name: 'Stored Chart',
    schemaVersion: 2,
    gridRows: 4,
    gridCols: 4,
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
    ...overrides,
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

describe('loadOrInit — localStorage paths', () => {
  it('returns a fresh default chart when localStorage is empty', () => {
    const { charts, activeId } = loadOrInit()
    expect(charts).toHaveLength(1)
    expect(activeId).toBe(charts[0].id)
    expect(charts[0].schemaVersion).toBe(4)
  })

  it('restores charts and active ID from valid stored JSON', () => {
    const chart = makeStoredChart({ id: 'chart-a' })
    localStorageStub.setItem('manachart:charts', JSON.stringify([chart]))
    localStorageStub.setItem('manachart:activeId', 'chart-a')

    const { charts, activeId } = loadOrInit()
    expect(charts).toHaveLength(1)
    expect(charts[0].id).toBe('chart-a')
    expect(activeId).toBe('chart-a')
    expect(charts[0].schemaVersion).toBe(4)
  })

  it('falls back to a fresh default when stored JSON is malformed', () => {
    localStorageStub.setItem('manachart:charts', 'not valid json{{{')
    const { charts, activeId } = loadOrInit()
    expect(charts).toHaveLength(1)
    expect(activeId).toBe(charts[0].id)
  })

  it('falls back to charts[0].id when activeId in storage does not match any chart', () => {
    const chart = makeStoredChart({ id: 'chart-b' })
    localStorageStub.setItem('manachart:charts', JSON.stringify([chart]))
    localStorageStub.setItem('manachart:activeId', 'nonexistent-id')

    const { charts, activeId } = loadOrInit()
    expect(activeId).toBe(charts[0].id)
  })
})

describe('loadOrInit — all-or-nothing store abandonment (contracts.md §1: no per-chart salvage BY DESIGN)', () => {
  it('ONE malformed chart among valid ones abandons the ENTIRE store — do not "improve" this into per-chart salvage without updating contracts.md first', () => {
    const good = makeStoredChart({ id: 'good-chart' })
    const bad = { id: 42, gridRows: 'nope' } // fails isChartShaped
    localStorageStub.setItem('manachart:charts', JSON.stringify([good, bad]))
    localStorageStub.setItem('manachart:activeId', 'good-chart')

    const { charts, activeId } = loadOrInit()
    expect(charts).toHaveLength(1)
    expect(charts[0].id).not.toBe('good-chart')
    expect(activeId).toBe(charts[0].id)
  })

  it('an empty stored array is abandoned (the non-empty gate) — fresh default instead', () => {
    localStorageStub.setItem('manachart:charts', JSON.stringify([]))
    const { charts } = loadOrInit()
    expect(charts).toHaveLength(1)
    expect(charts[0].schemaVersion).toBe(4)
  })
})

describe('loadOrInit — load-path order (contracts.md §1: parse → isChartShaped → migrateAll → sanitize)', () => {
  it('a stored v1 chart (no crop/sort fields, no heroConfig) passes the shape gate BEFORE migration — strengthening isChartShaped to require modern fields orphans every v1 store in the wild', () => {
    // Raw v1 literal: slots lack cropX/cropY/cropScale and cmc/colors/typeLine,
    // the chart lacks heroConfig. Dirty dims/background prove sanitize runs too.
    const v1Chart = {
      id: 'v1-survivor',
      name: 'Ancient',
      schemaVersion: 1,
      gridRows: 9999,
      gridCols: 2,
      layout: 'uniform',
      displayMode: 'landscape',
      nameDisplayMode: 'none',
      title: '',
      backgroundColor: 'url(https://attacker/x.png)',
      cellGap: 4,
      padding: 16,
      cornerRadius: 4,
      slots: [
        {
          kind: 'scryfall',
          scryfallId: 'abc',
          oracleId: 'o',
          cardName: 'Lightning Bolt',
          setCode: 'm20',
          collectorNumber: '150',
          layout: 'normal',
          selectedFaceIndex: 0,
          imageUris: [{ artCrop: 'https://x/a.jpg' }],
        },
        null,
      ],
    }
    localStorageStub.setItem('manachart:charts', JSON.stringify([v1Chart]))
    localStorageStub.setItem('manachart:activeId', 'v1-survivor')

    const { charts, activeId } = loadOrInit()
    // Not abandoned: the v1 chart survived the shape gate.
    expect(charts).toHaveLength(1)
    expect(charts[0].id).toBe('v1-survivor')
    expect(activeId).toBe('v1-survivor')
    // Migrated: v1→v2 crop defaults, v2→v3 heroConfig, v3→v4 sort fields.
    expect(charts[0].schemaVersion).toBe(4)
    const slot = charts[0].slots[0]
    expect(slot).not.toBeNull()
    if (slot === null) return
    expect(slot.cropX).toBe(0.5)
    expect(slot.cropY).toBe(0.5)
    expect(slot.cropScale).toBe(1.0)
    expect(charts[0].heroConfig).toEqual([])
    if (slot.kind === 'scryfall') {
      expect(slot.cmc).toBeNull()
      expect(slot.colors).toBeNull()
      expect(slot.typeLine).toBeNull()
    }
    // Sanitized after migration: dims clamped, unsafe background replaced.
    expect(charts[0].gridRows).toBe(10)
    expect(charts[0].backgroundColor).toBe('#0b0c0e')
  })
})

describe('loadOrInit — share link paths', () => {
  it('compact ?c=: sets isReconstructing, pendingReconstruction, consumedShareParam', () => {
    const chart = makeStoredChart({ name: 'Imported' })
    const { encoded } = encodeShareLink(chart)
    window.history.pushState({}, '', `/?c=${encoded}`)

    const state = loadOrInit()
    expect(state.isReconstructing).toBe(true)
    expect(state.consumedShareParam).toBe(true)
    expect(state.pendingReconstruction).toBeDefined()
    expect(state.reconstructionError).toBeUndefined()
    expect(state.charts).toHaveLength(1)
    expect(state.charts[0].name).toBe('Imported')
    expect(state.charts[0].slots).toHaveLength(0)
    expect(state.activeId).toBe(state.charts[0].id)
  })

  it('compact ?c=: appends placeholder to existing stored charts', () => {
    const stored = makeStoredChart({ id: 'existing-1' })
    localStorageStub.setItem('manachart:charts', JSON.stringify([stored]))

    const chart = makeStoredChart({ name: 'Imported', id: 'other-id' })
    const { encoded } = encodeShareLink(chart)
    window.history.pushState({}, '', `/?c=${encoded}`)

    const state = loadOrInit()
    expect(state.charts).toHaveLength(2)
    expect(state.charts[0].id).toBe('existing-1')
    expect(state.charts[1].name).toBe('Imported')
    expect(state.activeId).toBe(state.charts[1].id)
  })

  it('compact ?c=: placeholder has schemaVersion 4 and empty slots', () => {
    const chart = makeStoredChart({ schemaVersion: 2 })
    const { encoded } = encodeShareLink(chart)
    window.history.pushState({}, '', `/?c=${encoded}`)

    const state = loadOrInit()
    expect(state.charts[0].schemaVersion).toBe(4)
    expect(state.charts[0].slots).toHaveLength(0)
  })

  it('legacy ?c=: returns decoded chart with consumedShareParam, no reconstruction flags', () => {
    const chart = makeStoredChart({ name: 'Legacy Chart' })
    const raw = btoa(encodeURIComponent(JSON.stringify(chart)))
    window.history.pushState({}, '', `/?c=${raw}`)

    const state = loadOrInit()
    expect(state.consumedShareParam).toBe(true)
    expect(state.pendingReconstruction).toBeUndefined()
    expect(state.isReconstructing).toBeUndefined()
    expect(state.reconstructionError).toBeUndefined()
    expect(state.charts.some((c) => c.name === 'Legacy Chart')).toBe(true)
  })

  it('invalid ?c=: sets reconstructionError, does not set consumedShareParam, falls back to default', () => {
    window.history.pushState({}, '', '/?c=!!!totally-invalid!!!')

    const state = loadOrInit()
    expect(state.reconstructionError).toBeDefined()
    expect(state.consumedShareParam).toBeUndefined()
    expect(state.pendingReconstruction).toBeUndefined()
    expect(state.charts).toHaveLength(1)
    expect(state.charts[0].schemaVersion).toBe(4)
  })

  it('unknown version ?c=: sets reconstructionError with "not supported" message', () => {
    const raw = LZString.compressToEncodedURIComponent(JSON.stringify({ v: 99, c: { gridRows: 3, gridCols: 3 }, s: [] }))
    window.history.pushState({}, '', `/?c=${raw}`)

    const state = loadOrInit()
    expect(state.reconstructionError).toMatch(/not supported/i)
    expect(state.consumedShareParam).toBeUndefined()
  })

  it('invalid ?c=: existing stored charts are preserved on error', () => {
    const stored = makeStoredChart({ id: 'my-chart' })
    localStorageStub.setItem('manachart:charts', JSON.stringify([stored]))
    window.history.pushState({}, '', '/?c=!!!totally-invalid!!!')

    const state = loadOrInit()
    expect(state.reconstructionError).toBeDefined()
    expect(state.charts).toHaveLength(1)
    expect(state.charts[0].id).toBe('my-chart')
  })
})
