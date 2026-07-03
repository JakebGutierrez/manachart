import { describe, it, expect, afterEach, vi } from 'vitest'
import { sortSlots, shuffleSlots } from '@/utils/sort'
import type { ScryfallSlot, CustomSlot, Slot } from '@/types/chart'

function sc(overrides: Partial<ScryfallSlot> = {}): ScryfallSlot {
  return {
    kind: 'scryfall',
    scryfallId: 'id',
    oracleId: 'o',
    cardName: 'Card',
    setCode: 's',
    collectorNumber: '1',
    layout: 'normal',
    selectedFaceIndex: 0,
    imageUris: [{ artCrop: 'x' }],
    cropX: 0.5,
    cropY: 0.5,
    cropScale: 1,
    cmc: null,
    colors: null,
    typeLine: null,
    ...overrides,
  }
}

function cu(overrides: Partial<CustomSlot> = {}): CustomSlot {
  return {
    kind: 'custom',
    label: 'L',
    localImageDataUrl: 'data:,',
    cropX: 0.5,
    cropY: 0.5,
    cropScale: 1,
    ...overrides,
  }
}

function names(slots: Array<Slot | null>): Array<string | null> {
  return slots.map((s) => (s === null ? null : s.kind === 'scryfall' ? s.cardName : s.label))
}

describe('sortSlots — type', () => {
  it('buckets by type priority: creature < instant < sorcery < enchantment < artifact < planeswalker < land', () => {
    const slots = [
      sc({ cardName: 'land', typeLine: 'Basic Land — Forest' }),
      sc({ cardName: 'instant', typeLine: 'Instant' }),
      sc({ cardName: 'creature', typeLine: 'Creature — Elf' }),
      sc({ cardName: 'artifact', typeLine: 'Artifact' }),
    ]
    expect(names(sortSlots(slots, 'type'))).toEqual(['creature', 'instant', 'artifact', 'land'])
  })

  it('unknown/null type sinks to the end', () => {
    const slots = [
      sc({ cardName: 'null', typeLine: null }),
      sc({ cardName: 'creature', typeLine: 'Creature' }),
      sc({ cardName: 'weird', typeLine: 'Conspiracy' }),
    ]
    // creature first; null and unknown share the last bucket, stable order preserved
    expect(names(sortSlots(slots, 'type'))).toEqual(['creature', 'null', 'weird'])
  })
})

describe('sortSlots — cmc', () => {
  it('cmc-asc orders low→high with nulls last', () => {
    const slots = [
      sc({ cardName: '3', cmc: 3 }),
      sc({ cardName: 'null', cmc: null }),
      sc({ cardName: '1', cmc: 1 }),
      sc({ cardName: '2', cmc: 2 }),
    ]
    expect(names(sortSlots(slots, 'cmc-asc'))).toEqual(['1', '2', '3', 'null'])
  })

  it('cmc-desc orders high→low with nulls still last', () => {
    const slots = [
      sc({ cardName: '3', cmc: 3 }),
      sc({ cardName: 'null', cmc: null }),
      sc({ cardName: '1', cmc: 1 }),
    ]
    expect(names(sortSlots(slots, 'cmc-desc'))).toEqual(['3', '1', 'null'])
  })
})

describe('sortSlots — color', () => {
  it('orders WUBRG, then multicolour, then colourless, then null', () => {
    const slots = [
      sc({ cardName: 'colorless', colors: [] }),
      sc({ cardName: 'multi', colors: ['U', 'B'] }),
      sc({ cardName: 'red', colors: ['R'] }),
      sc({ cardName: 'white', colors: ['W'] }),
      sc({ cardName: 'null', colors: null }),
    ]
    expect(names(sortSlots(slots, 'color'))).toEqual([
      'white',
      'red',
      'multi',
      'colorless',
      'null',
    ])
  })
})

describe('sortSlots — custom slots and compaction', () => {
  it('sinks custom slots to the end regardless of sort key', () => {
    const slots = [
      cu({ label: 'custom-a' }),
      sc({ cardName: 'creature', typeLine: 'Creature' }),
      cu({ label: 'custom-b' }),
      sc({ cardName: 'land', typeLine: 'Land' }),
    ]
    const out = names(sortSlots(slots, 'type'))
    expect(out.slice(0, 2)).toEqual(['creature', 'land'])
    expect(out.slice(2).sort()).toEqual(['custom-a', 'custom-b'])
  })

  it('compacts filled slots to the front and pads the tail with null, preserving length', () => {
    const slots: Array<Slot | null> = [
      null,
      sc({ cardName: '2', cmc: 2 }),
      null,
      sc({ cardName: '1', cmc: 1 }),
      null,
    ]
    const out = sortSlots(slots, 'cmc-asc')
    expect(out.length).toBe(5)
    expect(names(out)).toEqual(['1', '2', null, null, null])
  })

  it('an all-empty array stays all-empty', () => {
    const slots = [null, null, null]
    expect(sortSlots(slots, 'type')).toEqual([null, null, null])
  })
})

describe('shuffleSlots', () => {
  afterEach(() => vi.restoreAllMocks())

  it('preserves the multiset of filled slots and compacts nulls to the tail', () => {
    // Deterministic: Math.random → 0 makes Fisher-Yates a fixed permutation
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const slots: Array<Slot | null> = [
      sc({ cardName: 'a' }),
      null,
      sc({ cardName: 'b' }),
      sc({ cardName: 'c' }),
      null,
    ]
    const out = shuffleSlots(slots)
    expect(out.length).toBe(5)
    // three filled at the front, two nulls at the tail
    expect(out.slice(0, 3).every((s) => s !== null)).toBe(true)
    expect(out.slice(3)).toEqual([null, null])
    // same names, just reordered
    expect(names(out.slice(0, 3)).sort()).toEqual(['a', 'b', 'c'])
  })
})
