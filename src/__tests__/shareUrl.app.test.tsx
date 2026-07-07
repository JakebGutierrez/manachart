// @vitest-environment jsdom
//
// Fences the MINT side of the share-link contract (docs/contracts.md §2): the
// URL copied by the real "Copy link" control must use the literal ?c= param and
// a payload the current decoder accepts. The read side is fenced in
// useCharts.test.ts; without this test the two build sites in App.tsx could
// drift (renamed param, changed codec) while every existing test stays green —
// and every newly copied link would be dead on arrival.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import App from '@/App'
import { decodeSharePayload } from '@/utils/shareLink'
import type { Chart, ScryfallSlot } from '@/types/chart'
import { renderComponent, click, flush, buttonByText } from './harness'

const store = new Map<string, string>()
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => { store.clear() },
  get length() { return store.size },
  key: (i: number) => [...store.keys()][i] ?? null,
}

const writeText = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve())

function seedChart() {
  const slot: ScryfallSlot = {
    kind: 'scryfall', scryfallId: 'bolt-id', oracleId: 'o1', cardName: 'Lightning Bolt',
    setCode: 'm20', collectorNumber: '150', layout: 'normal', selectedFaceIndex: 0,
    imageUris: [{ artCrop: 'https://img.example/bolt.jpg' }],
    cropX: 0.5, cropY: 0.5, cropScale: 1.0, cmc: 1, colors: ['R'], typeLine: 'Instant',
  }
  const chart: Chart = {
    id: 'a', name: 'Alpha', schemaVersion: 4,
    gridRows: 2, gridCols: 2, layout: 'uniform', heroConfig: [],
    displayMode: 'landscape', nameDisplayMode: 'none', title: '',
    backgroundColor: '#0b0c0e', cellGap: 4, padding: 16, cornerRadius: 4,
    slots: [slot],
  }
  store.set('manachart:charts', JSON.stringify([chart]))
  store.set('manachart:activeId', 'a')
}

beforeEach(() => {
  store.clear()
  writeText.mockClear()
  vi.stubGlobal('localStorage', localStorageStub)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  window.history.pushState({}, '', '/')
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
  document.body.innerHTML = ''
})

describe('share-URL minting (contracts.md §2: the ?c= param name can never change)', () => {
  it('Copy link mints {origin}{pathname}?c={payload} and the payload round-trips through the current decoder', async () => {
    seedChart()
    const { container, unmount } = renderComponent(<App />)
    try {
      click(buttonByText(container, 'Copy link'))
      await flush()

      expect(writeText).toHaveBeenCalledTimes(1)
      const url = writeText.mock.calls[0][0]
      expect(url).toContain('?c=')

      const param = new URL(url).searchParams.get('c')
      expect(param).toBeTruthy()

      const result = decodeSharePayload(param!)
      expect(result.kind).toBe('compact')
      if (result.kind !== 'compact') return
      expect(result.payload.c.name).toBe('Alpha')
      expect(result.payload.s[0]).toMatchObject({ id: 'bolt-id' })
    } finally {
      unmount()
    }
  })
})
