export type Layout = 'uniform' | 'hybrid'
export type NumericStyleField = keyof Pick<Chart, 'cellGap' | 'padding' | 'cornerRadius'>
export type DisplayMode = 'landscape' | 'square'
export type NameDisplayMode = 'none' | 'sidebar' | 'overlay'
export type HeroConfig = Array<{ row: number; col: number; rowSpan: number; colSpan: number }>

export interface ScryfallSlot {
  kind: 'scryfall'
  scryfallId: string
  oracleId: string
  cardName: string
  setCode: string
  collectorNumber: string
  layout: string
  selectedFaceIndex: 0 | 1
  imageUris: Array<{
    artCrop: string
    normal?: string   // absent on some unusual printings; stored for post-MVP export, not rendered
    artist?: string
  }>
  cropX: number      // 0–1 normalised horizontal offset, default 0.5
  cropY: number      // 0–1 normalised vertical offset, default 0.5
  cropScale: number  // 1.0 = fit; >1 = zoom in, default 1.0
  cmc: number | null
  colors: string[] | null
  typeLine: string | null
}

export interface CustomSlot {
  kind: 'custom'
  label: string
  localImageDataUrl: string
  cropX: number
  cropY: number
  cropScale: number
}

export type Slot = ScryfallSlot | CustomSlot

export interface Chart {
  id: string
  name: string
  schemaVersion: number
  gridRows: number
  gridCols: number
  layout: Layout
  heroConfig: HeroConfig
  displayMode: DisplayMode
  nameDisplayMode: NameDisplayMode
  title: string
  titleFont?: string
  backgroundColor: string
  cellGap: number
  padding: number
  cornerRadius: number
  slots: Array<Slot | null>
}

export type CellDef =
  | { kind: 'slot'; slotIndex: number }
  | { kind: 'hero'; slotIndex: number; rowSpan: number; colSpan: number }
  // heroSlotIndex is a back-pointer to the hero that covers this position, so
  // keyboard navigation and drop-targeting can resolve a covered cell to its
  // hero. Derived at render (never persisted) — no schema impact.
  | { kind: 'covered'; heroSlotIndex: number }

export type CellMap = CellDef[]
