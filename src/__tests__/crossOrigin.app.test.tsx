// @vitest-environment jsdom
//
// Fences the crossOrigin="anonymous" cache-keying invariant (tech-debt F5,
// CLAUDE.md "Grid rendering"): every <img> that loads Scryfall art must carry
// crossOrigin="anonymous" so all render paths share one CORS-usable HTTP cache
// entry with the export's fetch(mode:'cors'). Dropping the attribute anywhere
// reintroduces cold-cache export failures that only reproduce with an empty
// HTTP cache — a red test here beats a field bug report.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Chart, ScryfallSlot } from '@/types/chart'
import { renderComponent, click, flush } from './harness'

const RESULT: ScryfallSlot = {
  kind: 'scryfall', scryfallId: 'r-new', oracleId: 'o-new', cardName: 'NewCard',
  setCode: 'tst', collectorNumber: '2', layout: 'normal', selectedFaceIndex: 0,
  imageUris: [{ artCrop: 'https://img.example/new.jpg' }],
  cropX: 0.5, cropY: 0.5, cropScale: 1.0, cmc: 2, colors: ['U'], typeLine: 'Sorcery',
}
vi.mock('@/hooks/useScryfall', () => ({
  useScryfall: () => ({ results: [RESULT], isLoading: false, error: null }),
}))

import App from '@/App'
import DragGhost from '@/components/DragGhost'
import PrintingSwitcher from '@/components/PrintingSwitcher'

const store = new Map<string, string>()
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => { store.clear() },
  get length() { return store.size },
  key: (i: number) => [...store.keys()][i] ?? null,
}

function gridSlot(): ScryfallSlot {
  return { ...RESULT, scryfallId: 'r-old', cardName: 'OldCard' }
}

function seedChart() {
  const chart: Chart = {
    id: 'a', name: 'Alpha', schemaVersion: 4,
    gridRows: 2, gridCols: 2, layout: 'uniform', heroConfig: [],
    displayMode: 'landscape', nameDisplayMode: 'none', title: '',
    backgroundColor: '#0b0c0e', cellGap: 4, padding: 16, cornerRadius: 4,
    slots: [gridSlot()],
  }
  store.set('mtg-chart:charts', JSON.stringify([chart]))
  store.set('mtg-chart:activeId', 'a')
}

function httpImgs(root: ParentNode): HTMLImageElement[] {
  return [...root.querySelectorAll('img')].filter((img) => img.src.startsWith('http'))
}

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', localStorageStub)
  window.history.pushState({}, '', '/')
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
  document.body.innerHTML = ''
})

describe('crossOrigin="anonymous" on every Scryfall art path (tech-debt F5)', () => {
  it('grid cell, selected-card preview, and search-result thumbnails all carry crossOrigin="anonymous"', () => {
    seedChart()
    const { container, unmount } = renderComponent(<App />)
    try {
      // Select the filled cell so the SelectedCard surface renders its preview.
      click(container.querySelector('[data-slot-index="0"]')!)

      const imgs = httpImgs(container)
      // Grid cell + selected-card preview + at least one search result. If this
      // count drops, a render path stopped producing an <img> and this fence
      // stopped covering it — extend the test, don't lower the bar.
      expect(imgs.length).toBeGreaterThanOrEqual(3)
      for (const img of imgs) {
        expect(img.crossOrigin, `img ${img.src} lost crossOrigin="anonymous"`).toBe('anonymous')
      }
    } finally {
      unmount()
    }
  })

  it('the drag ghost image carries crossOrigin="anonymous"', () => {
    const { unmount } = renderComponent(<DragGhost src="https://img.example/ghost.jpg" />)
    try {
      const imgs = httpImgs(document.body)
      expect(imgs).toHaveLength(1)
      expect(imgs[0].crossOrigin).toBe('anonymous')
    } finally {
      unmount()
    }
  })

  it('printing-switcher thumbnails carry crossOrigin="anonymous"', async () => {
    const page = {
      data: [{
        id: 'p1', oracle_id: 'o-old', name: 'OldCard', set: 'lea',
        set_name: 'Limited Edition Alpha', collector_number: '161',
        released_at: '1993-08-05', layout: 'normal', cmc: 2,
        image_uris: { art_crop: 'https://img.example/printing.jpg' },
      }],
      has_more: false,
      total_cards: 1,
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => page,
    })))

    const { unmount } = renderComponent(
      <PrintingSwitcher currentSlot={gridSlot()} onSelect={() => {}} onClose={() => {}} />,
    )
    try {
      await flush()
      const imgs = httpImgs(document.body)
      expect(imgs.length).toBeGreaterThanOrEqual(1)
      for (const img of imgs) {
        expect(img.crossOrigin, `img ${img.src} lost crossOrigin="anonymous"`).toBe('anonymous')
      }
    } finally {
      unmount()
    }
  })
})
