// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useCharts, loadOrInit } from '@/hooks/useCharts'
import { encodeShareLink } from '@/utils/shareLink'
import type { Chart, ScryfallSlot } from '@/types/chart'
import { renderHook, flush, act } from './harness'

const store = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
  clear: () => { store.clear() },
  get length() { return store.size },
  key: (index: number) => [...store.keys()][index] ?? null,
}

function makeSlot(id: string): ScryfallSlot {
  return {
    kind: 'scryfall',
    scryfallId: id,
    oracleId: `o-${id}`,
    cardName: `Card ${id}`,
    setCode: 's',
    collectorNumber: '1',
    layout: 'normal',
    selectedFaceIndex: 0,
    imageUris: [{ artCrop: `https://x/${id}.jpg`, normal: `https://x/n.jpg` }],
    cropX: 0.5,
    cropY: 0.5,
    cropScale: 1.0,
    cmc: 1,
    colors: ['R'],
    typeLine: 'Instant',
  }
}

function makeChart(id: string, name: string, slots: Array<ScryfallSlot | null> = []): Chart {
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

function openFailedShare(): void {
  // A share with one card, so reconstruction attempts a fetch (which we reject).
  const { encoded } = encodeShareLink(makeChart('shared', 'Shared', [makeSlot('card-1')]))
  window.history.pushState({}, '', `/?c=${encoded}`)
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('network'))))
}

function hasShareParam(): boolean {
  return new URLSearchParams(window.location.search).has('c')
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

describe('failed-share placeholder claim + persistence (Fix 2)', () => {
  it('failed share → add cards → reload → cards survive', async () => {
    openFailedShare()
    const { result, unmount } = renderHook(() => useCharts())
    try {
      await flush() // reconstruction fails
      expect(result.current.reconstructionError).not.toBeNull()
      expect(result.current.activeChart.slots.filter(Boolean)).toHaveLength(0)
      expect(hasShareParam()).toBe(true) // ?c= retained on failure

      // Add a card to the failed placeholder — claims it as a normal chart.
      act(() => {
        result.current.updateChart((prev) => ({ ...prev, slots: [makeSlot('added')] }))
      })
      // Claiming strips ?c= so a reload won't re-reconstruct.
      expect(hasShareParam()).toBe(false)

      // Flush the debounced production persist path.
      act(() => { window.dispatchEvent(new Event('pagehide')) })

      // Reload from storage.
      const reloaded = loadOrInit()
      const chart = reloaded.charts.find((c) => c.name === 'Shared')
      expect(chart).toBeDefined()
      expect(chart!.slots.filter(Boolean)).toHaveLength(1)
    } finally {
      unmount()
    }
  })

  it('failed share + delete the other stored chart → reload → it stays deleted', async () => {
    store.set('manachart:charts', JSON.stringify([makeChart('s1', 'Stored')]))
    store.set('manachart:activeId', 's1')
    openFailedShare()

    const { result, unmount } = renderHook(() => useCharts())
    try {
      await flush() // reconstruction fails
      expect(result.current.reconstructionError).not.toBeNull()
      expect(result.current.charts.map((c) => c.name).sort()).toEqual(['Shared', 'Stored'])

      // Delete the stored sibling while the placeholder is still un-reconstructed.
      act(() => { result.current.deleteChart('s1') })
      // Deleting a sibling must NOT discard the failed share: ?c= is retained so
      // reload-retry still works (regresses if deleteChart drops the exclusion id).
      expect(hasShareParam()).toBe(true)
      act(() => { window.dispatchEvent(new Event('pagehide')) })

      // The deletion still persists (gate writes [] post-reconstruction), so the
      // stored chart does NOT come back; ?c= re-derives exactly one placeholder.
      const reloaded = loadOrInit()
      expect(reloaded.charts.some((c) => c.name === 'Stored')).toBe(false)
      expect(reloaded.charts.filter((c) => c.name === 'Shared')).toHaveLength(1)
    } finally {
      unmount()
    }
  })

  it('failed share → create a new chart → ?c= retained and placeholder still retriable', async () => {
    openFailedShare()
    const { result, unmount } = renderHook(() => useCharts())
    try {
      await flush()
      expect(result.current.canRetryReconstruction).toBe(true)

      act(() => { result.current.createChart() })

      // Creating a chart doesn't touch the placeholder, so the failed share's
      // recovery is preserved.
      expect(hasShareParam()).toBe(true)
      expect(result.current.canRetryReconstruction).toBe(true)
    } finally {
      unmount()
    }
  })

  it('failed share → delete the placeholder itself → ?c= is dropped (share discarded)', async () => {
    openFailedShare()
    const { result, unmount } = renderHook(() => useCharts())
    try {
      await flush()
      const placeholderId = result.current.activeId
      expect(hasShareParam()).toBe(true)

      act(() => { result.current.deleteChart(placeholderId) })

      // Discarding the placeholder strips ?c= so reload won't re-derive it.
      expect(hasShareParam()).toBe(false)
    } finally {
      unmount()
    }
  })
})
