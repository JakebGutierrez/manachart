import type { Chart } from '@/types/chart'

// Deep-clone a chart under a new id with a derived name, for the "Duplicate chart"
// action (I3). structuredClone copies slots (sparse, visual-cell-indexed) and
// heroConfig/titleFont faithfully and deeply, so the duplicate shares no references
// with the source — mutating one can never affect the other. No schema change: the
// clone keeps the source's schemaVersion and every config field verbatim.
export function duplicateChart(source: Chart, newId: string): Chart {
  return {
    ...structuredClone(source),
    id: newId,
    name: `${source.name} copy`,
  }
}
