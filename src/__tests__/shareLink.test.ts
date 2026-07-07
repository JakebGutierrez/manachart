import { describe, it, expect } from 'vitest'
import LZString from 'lz-string'
import {
  encodeShareLink,
  decodeSharePayload,
  reconstructSlots,
  type ShareSlotStub,
} from '@/utils/shareLink'
import type { Chart, ScryfallSlot } from '@/types/chart'

function makeChart(overrides: Partial<Chart> = {}): Chart {
  return {
    id: 'test-id',
    name: 'Test Chart',
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
    ...overrides,
  }
}

function makeScryfallSlot(overrides: Partial<ScryfallSlot> = {}): ScryfallSlot {
  return {
    kind: 'scryfall',
    scryfallId: 'abc-123',
    oracleId: 'oracle-1',
    cardName: 'Lightning Bolt',
    setCode: 'm20',
    collectorNumber: '150',
    layout: 'normal',
    selectedFaceIndex: 0,
    imageUris: [{ artCrop: 'https://cards.scryfall.io/art_crop/abc.jpg', normal: 'https://cards.scryfall.io/normal/abc.jpg' }],
    cropX: 0.5,
    cropY: 0.5,
    cropScale: 1.0,
    cmc: 1,
    colors: ['R'],
    typeLine: 'Instant',
    ...overrides,
  }
}

// ─── encodeShareLink / decodeSharePayload round-trip ─────────────────────────

describe('encodeShareLink + decodeSharePayload', () => {
  it('round-trips an empty chart', () => {
    const chart = makeChart()
    const { encoded, customSlotsOmitted } = encodeShareLink(chart)
    expect(customSlotsOmitted).toBe(0)

    const result = decodeSharePayload(encoded)
    expect(result.kind).toBe('compact')
    if (result.kind !== 'compact') return

    expect(result.payload.v).toBe(1)
    expect(result.payload.c.name).toBe(chart.name)
    expect(result.payload.c.gridRows).toBe(2)
    expect(result.payload.c.gridCols).toBe(2)
    expect(result.payload.s).toHaveLength(0)
  })

  it('round-trips a chart with scryfall slots', () => {
    const slot = makeScryfallSlot()
    const chart = makeChart({ slots: [slot, null, slot] })
    const { encoded, customSlotsOmitted } = encodeShareLink(chart)
    expect(customSlotsOmitted).toBe(0)

    const result = decodeSharePayload(encoded)
    expect(result.kind).toBe('compact')
    if (result.kind !== 'compact') return

    expect(result.payload.s).toHaveLength(3)
    expect(result.payload.s[0]).toMatchObject({ id: 'abc-123' })
    expect(result.payload.s[1]).toBeNull()
    expect(result.payload.s[2]).toMatchObject({ id: 'abc-123' })
  })

  it('omits default face/crop fields from stubs', () => {
    const slot = makeScryfallSlot({ selectedFaceIndex: 0, cropX: 0.5, cropY: 0.5, cropScale: 1.0 })
    const chart = makeChart({ slots: [slot] })
    const { encoded } = encodeShareLink(chart)

    const result = decodeSharePayload(encoded)
    expect(result.kind).toBe('compact')
    if (result.kind !== 'compact') return

    const stub = result.payload.s[0]
    expect(stub).not.toBeNull()
    if (stub === null) return
    expect(stub.f).toBeUndefined()
    expect(stub.x).toBeUndefined()
    expect(stub.y).toBeUndefined()
    expect(stub.z).toBeUndefined()
  })

  it('preserves non-default face and crop fields', () => {
    const slot = makeScryfallSlot({ selectedFaceIndex: 1, cropX: 0.3, cropY: 0.7, cropScale: 1.5 })
    const chart = makeChart({ slots: [slot] })
    const { encoded } = encodeShareLink(chart)

    const result = decodeSharePayload(encoded)
    expect(result.kind).toBe('compact')
    if (result.kind !== 'compact') return

    const stub = result.payload.s[0] as ShareSlotStub
    expect(stub.f).toBe(1)
    expect(stub.x).toBeCloseTo(0.3)
    expect(stub.y).toBeCloseTo(0.7)
    expect(stub.z).toBeCloseTo(1.5)
  })

  it('replaces custom slots with null and counts them', () => {
    const custom = {
      kind: 'custom' as const,
      label: 'My Art',
      localImageDataUrl: 'data:image/png;base64,abc',
      cropX: 0.5,
      cropY: 0.5,
      cropScale: 1.0,
    }
    const scryfall = makeScryfallSlot()
    const chart = makeChart({ slots: [custom, scryfall, custom] })
    const { encoded, customSlotsOmitted } = encodeShareLink(chart)
    expect(customSlotsOmitted).toBe(2)

    const result = decodeSharePayload(encoded)
    expect(result.kind).toBe('compact')
    if (result.kind !== 'compact') return

    expect(result.payload.s[0]).toBeNull()
    expect(result.payload.s[1]).toMatchObject({ id: 'abc-123' })
    expect(result.payload.s[2]).toBeNull()
  })
})

// ─── titleFont round-trip and validation ──────────────────────────────────────

describe('titleFont in share link', () => {
  it('round-trips titleFont when set to a valid font name', () => {
    const chart = makeChart({ titleFont: 'Cinzel' })
    const { encoded } = encodeShareLink(chart)
    const result = decodeSharePayload(encoded)
    expect(result.kind).toBe('compact')
    if (result.kind !== 'compact') return
    expect(result.payload.c.titleFont).toBe('Cinzel')
  })

  it('omits titleFont from the payload when not set', () => {
    const chart = makeChart()
    const { encoded } = encodeShareLink(chart)
    const result = decodeSharePayload(encoded)
    expect(result.kind).toBe('compact')
    if (result.kind !== 'compact') return
    expect(result.payload.c.titleFont).toBeUndefined()
  })

  it('rejects a payload with a titleFont that is not in the allowed set', () => {
    const chart = makeChart({ titleFont: 'Cinzel' })
    const { encoded } = encodeShareLink(chart)
    const decompressed = LZString.decompressFromEncodedURIComponent(encoded)!
    const payload = JSON.parse(decompressed) as Record<string, unknown>
    ;(payload.c as Record<string, unknown>).titleFont = 'Evil"Font'
    const tampered = LZString.compressToEncodedURIComponent(JSON.stringify(payload))
    expect(decodeSharePayload(tampered).kind).toBe('error')
  })

  it('rejects a payload with a non-string titleFont', () => {
    const chart = makeChart({ titleFont: 'Inter' })
    const { encoded } = encodeShareLink(chart)
    const decompressed = LZString.decompressFromEncodedURIComponent(encoded)!
    const payload = JSON.parse(decompressed) as Record<string, unknown>
    ;(payload.c as Record<string, unknown>).titleFont = 42
    const tampered = LZString.compressToEncodedURIComponent(JSON.stringify(payload))
    expect(decodeSharePayload(tampered).kind).toBe('error')
  })

  it('encode-side allowlist: a titleFont outside ALLOWED_TITLE_FONTS is OMITTED at encode (contracts.md §2) — dropping this gate mints links every decoder rejects on arrival', () => {
    const chart = makeChart({ titleFont: 'Papyrus' })
    const { encoded } = encodeShareLink(chart)
    // Inspect the raw payload, not just the decode result: the decoder would
    // reject a payload that carried the rogue font, so the link must never
    // carry it in the first place.
    const payload = JSON.parse(LZString.decompressFromEncodedURIComponent(encoded)!) as {
      c: Record<string, unknown>
    }
    expect('titleFont' in payload.c && payload.c.titleFont !== undefined).toBe(false)
    expect(decodeSharePayload(encoded).kind).toBe('compact')
  })
})

// ─── Unknown-field tolerance ──────────────────────────────────────────────────

describe('decodeSharePayload — unknown-field tolerance (contracts.md §2: what makes additive payload fields backward-compatible; do not add strictness)', () => {
  function tamper(mutate: (payload: { c: Record<string, unknown>; s: unknown[] } & Record<string, unknown>) => void): string {
    const { encoded } = encodeShareLink(makeChart({ slots: [makeScryfallSlot()] }))
    const payload = JSON.parse(LZString.decompressFromEncodedURIComponent(encoded)!) as {
      c: Record<string, unknown>
      s: unknown[]
    } & Record<string, unknown>
    mutate(payload)
    return LZString.compressToEncodedURIComponent(JSON.stringify(payload))
  }

  it('tolerates unknown keys in c and spreads them through — a link minted by a NEWER build with an extra chart field must keep opening here', () => {
    const result = decodeSharePayload(tamper((p) => { p.c.futureField = 'from-a-newer-build' }))
    expect(result.kind).toBe('compact')
    if (result.kind !== 'compact') return
    expect((result.payload.c as unknown as Record<string, unknown>).futureField).toBe('from-a-newer-build')
  })

  it('tolerates unknown top-level payload keys', () => {
    const result = decodeSharePayload(tamper((p) => { p.extra = { anything: true } }))
    expect(result.kind).toBe('compact')
  })

  it('tolerates unknown keys on a slot stub', () => {
    const result = decodeSharePayload(tamper((p) => {
      ;(p.s[0] as Record<string, unknown>).w = 3
    }))
    expect(result.kind).toBe('compact')
  })
})

// ─── Legacy compatibility ─────────────────────────────────────────────────────

describe('decodeSharePayload — legacy fallback', () => {
  it('decodes a Phase-16 base64+JSON link as legacy', () => {
    const chart = makeChart({ slots: [makeScryfallSlot()] })
    const raw = btoa(encodeURIComponent(JSON.stringify(chart)))

    const result = decodeSharePayload(raw)
    expect(result.kind).toBe('legacy')
    if (result.kind !== 'legacy') return

    expect(result.chart.name).toBe(chart.name)
    expect(result.chart.slots).toHaveLength(1)
  })

  it('returns an error for a completely invalid string', () => {
    const result = decodeSharePayload('!!!not-valid-at-all!!!')
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.message).toMatch(/invalid|expired/i)
  })

  it('migrates an old-schema (v1) legacy chart on decode — legacy links in the wild predate the current schema (contracts.md §2 legacy path)', () => {
    // A realistic v1 chart: no crop fields or sort fields on the slot, no
    // heroConfig on the chart. Built as a raw literal so nothing modern leaks in.
    const v1Chart = {
      id: 'legacy-1',
      name: 'Old Link',
      schemaVersion: 1,
      gridRows: 2,
      gridCols: 2,
      layout: 'uniform',
      displayMode: 'landscape',
      nameDisplayMode: 'none',
      title: '',
      backgroundColor: '#000',
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
    const raw = btoa(encodeURIComponent(JSON.stringify(v1Chart)))

    const result = decodeSharePayload(raw)
    expect(result.kind).toBe('legacy')
    if (result.kind !== 'legacy') return

    expect(result.chart.schemaVersion).toBe(4)
    const slot = result.chart.slots[0] as ScryfallSlot
    expect(slot.cropX).toBe(0.5)
    expect(slot.cropY).toBe(0.5)
    expect(slot.cropScale).toBe(1.0)
    expect(slot.cmc).toBeNull()
    expect(result.chart.heroConfig).toEqual([])
  })
})

// ─── Unknown version ──────────────────────────────────────────────────────────

describe('decodeSharePayload — unknown version', () => {
  it('returns an error when v is an unrecognised number', () => {
    const payload = JSON.stringify({ v: 99, c: {}, s: [] })
    const encoded = LZString.compressToEncodedURIComponent(payload)

    const result = decodeSharePayload(encoded)
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.message).toMatch(/not supported/i)
  })
})

// ─── reconstructSlots ─────────────────────────────────────────────────────────

describe('reconstructSlots', () => {
  const boltSlot = makeScryfallSlot({ scryfallId: 'bolt-id', cardName: 'Lightning Bolt' })
  const walkSlot = makeScryfallSlot({ scryfallId: 'walk-id', cardName: 'Ancestral Recall' })
  const dfcSlot = makeScryfallSlot({
    scryfallId: 'dfc-id',
    cardName: 'Delver of Secrets',
    imageUris: [
      { artCrop: 'https://x/front.jpg', normal: 'https://x/front-n.jpg' },
      { artCrop: 'https://x/back.jpg', normal: 'https://x/back-n.jpg' },
    ],
  })

  const cardMap = new Map<string, ScryfallSlot>([
    ['bolt-id', boltSlot],
    ['walk-id', walkSlot],
    ['dfc-id', dfcSlot],
  ])

  it('maps stubs to slots in order', () => {
    const stubs: Array<ShareSlotStub | null> = [
      { id: 'bolt-id' },
      null,
      { id: 'walk-id' },
    ]
    const slots = reconstructSlots(stubs, cardMap)
    expect(slots).toHaveLength(3)
    expect((slots[0] as ScryfallSlot).cardName).toBe('Lightning Bolt')
    expect(slots[1]).toBeNull()
    expect((slots[2] as ScryfallSlot).cardName).toBe('Ancestral Recall')
  })

  it('returns null for stubs whose id is not in cardMap', () => {
    const stubs: Array<ShareSlotStub | null> = [{ id: 'missing-id' }]
    const slots = reconstructSlots(stubs, cardMap)
    expect(slots[0]).toBeNull()
  })

  it('applies default crop values when stub fields are absent', () => {
    const stubs: Array<ShareSlotStub | null> = [{ id: 'bolt-id' }]
    const slots = reconstructSlots(stubs, cardMap)
    const slot = slots[0] as ScryfallSlot
    expect(slot.selectedFaceIndex).toBe(0)
    expect(slot.cropX).toBeCloseTo(0.5)
    expect(slot.cropY).toBeCloseTo(0.5)
    expect(slot.cropScale).toBeCloseTo(1.0)
  })

  it('applies non-default stub overrides for a real two-face card', () => {
    const stubs: Array<ShareSlotStub | null> = [{ id: 'dfc-id', f: 1, x: 0.2, y: 0.8, z: 2.0 }]
    const slots = reconstructSlots(stubs, cardMap)
    const slot = slots[0] as ScryfallSlot
    expect(slot.selectedFaceIndex).toBe(1)
    expect(slot.cropX).toBeCloseTo(0.2)
    expect(slot.cropY).toBeCloseTo(0.8)
    expect(slot.cropScale).toBeCloseTo(2.0)
  })

  it('clamps a tampered f:1 on a single-face card to face 0 (B8)', () => {
    const stubs: Array<ShareSlotStub | null> = [{ id: 'bolt-id', f: 1 }]
    const slots = reconstructSlots(stubs, cardMap)
    expect((slots[0] as ScryfallSlot).selectedFaceIndex).toBe(0)
  })
})
