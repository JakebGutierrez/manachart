import { describe, it, expect } from 'vitest'
import { duplicateChart } from '@/utils/duplicateChart'
import type { Chart, ScryfallSlot } from '@/types/chart'

function makeScryfallSlot(name: string): ScryfallSlot {
  return {
    kind: 'scryfall',
    scryfallId: `id-${name}`,
    oracleId: `oracle-${name}`,
    cardName: name,
    setCode: 'ktk',
    collectorNumber: '1',
    layout: 'normal',
    selectedFaceIndex: 0,
    imageUris: [{ artCrop: `https://img/${name}`, normal: `https://img/${name}-n`, artist: 'A' }],
    cropX: 0.5,
    cropY: 0.5,
    cropScale: 1,
    cmc: 3,
    colors: ['R'],
    typeLine: 'Creature — Dragon',
  }
}

function makeChart(overrides: Partial<Chart> = {}): Chart {
  return {
    id: 'source-id',
    name: 'My Deck',
    schemaVersion: 4,
    gridRows: 3,
    gridCols: 3,
    layout: 'hybrid',
    heroConfig: [{ row: 0, col: 0, rowSpan: 2, colSpan: 2 }],
    displayMode: 'square',
    nameDisplayMode: 'sidebar',
    title: 'Cube Chart',
    titleFont: 'Cinzel',
    backgroundColor: '#123456',
    cellGap: 8,
    padding: 24,
    cornerRadius: 6,
    slots: [makeScryfallSlot('Niv-Mizzet'), null, makeScryfallSlot('Bolt')],
    ...overrides,
  }
}

describe('duplicateChart', () => {
  it('assigns the provided new id, distinct from the source', () => {
    const source = makeChart()
    const clone = duplicateChart(source, 'new-id')
    expect(clone.id).toBe('new-id')
    expect(clone.id).not.toBe(source.id)
  })

  it('derives the name as "<name> copy"', () => {
    const clone = duplicateChart(makeChart({ name: 'Aggro' }), 'x')
    expect(clone.name).toBe('Aggro copy')
  })

  it('copies every config field verbatim (no schema change)', () => {
    const source = makeChart()
    const clone = duplicateChart(source, 'x')
    expect(clone.schemaVersion).toBe(source.schemaVersion)
    expect(clone.gridRows).toBe(source.gridRows)
    expect(clone.gridCols).toBe(source.gridCols)
    expect(clone.layout).toBe(source.layout)
    expect(clone.displayMode).toBe(source.displayMode)
    expect(clone.nameDisplayMode).toBe(source.nameDisplayMode)
    expect(clone.title).toBe(source.title)
    expect(clone.titleFont).toBe(source.titleFont)
    expect(clone.backgroundColor).toBe(source.backgroundColor)
    expect(clone.cellGap).toBe(source.cellGap)
    expect(clone.padding).toBe(source.padding)
    expect(clone.cornerRadius).toBe(source.cornerRadius)
    expect(clone.heroConfig).toEqual(source.heroConfig)
    expect(clone.slots).toEqual(source.slots)
  })

  it('deep-clones slots — mutating the copy does not touch the original', () => {
    const source = makeChart()
    const clone = duplicateChart(source, 'x')

    // Mutate the clone's slot in place.
    const clonedSlot = clone.slots[0] as ScryfallSlot
    clonedSlot.cardName = 'MUTATED'
    clonedSlot.cropX = 0.1
    clonedSlot.imageUris[0].artCrop = 'https://tampered'

    const sourceSlot = source.slots[0] as ScryfallSlot
    expect(sourceSlot.cardName).toBe('Niv-Mizzet')
    expect(sourceSlot.cropX).toBe(0.5)
    expect(sourceSlot.imageUris[0].artCrop).toBe('https://img/Niv-Mizzet')

    // Slot arrays and nested objects are not shared references.
    expect(clone.slots).not.toBe(source.slots)
    expect(clone.slots[0]).not.toBe(source.slots[0])
  })

  it('deep-clones heroConfig — mutating the copy does not touch the original', () => {
    const source = makeChart()
    const clone = duplicateChart(source, 'x')
    clone.heroConfig[0].colSpan = 99
    expect(source.heroConfig[0].colSpan).toBe(2)
    expect(clone.heroConfig).not.toBe(source.heroConfig)
  })

  it('preserves null (empty) slots at their positions', () => {
    const clone = duplicateChart(makeChart(), 'x')
    expect(clone.slots[1]).toBeNull()
    expect(clone.slots).toHaveLength(3)
  })
})
