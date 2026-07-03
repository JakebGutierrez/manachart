import { useState, useCallback, useEffect, useRef } from 'react'
import type { Chart, Slot } from '@/types/chart'
import { createDefaultChart } from '@/utils/defaultChart'
import { migrateAll, CURRENT_SCHEMA_VERSION } from '@/utils/schemaVersion'
import { decodeSharePayload, reconstructSlots, type ShareSlotStub } from '@/utils/shareLink'
import { isChartShaped } from '@/utils/chartShape'
import { fetchCollectionSlots } from '@/utils/reconstruct'
import { sanitizeChartConfig, chartCapacity } from '@/utils/sanitizeChart'
import { duplicateChart as cloneChart } from '@/utils/duplicateChart'

const CHARTS_KEY = 'mtg-chart:charts'
const ACTIVE_ID_KEY = 'mtg-chart:activeId'

// Two separate writes — not atomic. A crash between them leaves one key stale.
// loadOrInit recovers by falling back to charts[0] when activeId is unrecognised,
// so the worst case is activating the wrong chart, not data loss.
function persist(charts: Chart[], activeId: string): void {
  localStorage.setItem(CHARTS_KEY, JSON.stringify(charts))
  localStorage.setItem(ACTIVE_ID_KEY, activeId)
}

const STORAGE_FULL_MESSAGE =
  'Could not save — browser storage is full. Recent changes are kept in memory but may be lost if you close the tab.'
const PERSIST_DEBOUNCE_MS = 300

// Wraps persist so a storage failure (quota exceeded, storage disabled/blocked)
// never throws out of the persistence effect and crashes the React tree. Returns
// { ok: false } instead — the in-memory chart keeps working, only the save failed.
export function safeWrite(charts: Chart[], activeId: string): { ok: boolean } {
  try {
    persist(charts, activeId)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

// Idempotent storageError transition. A successful write clears the error; a
// failure sets the message but returns an already-present one *by reference* so a
// storageError setState cannot re-enter the persist effect and retry the failing
// write (no quota retry loop).
export function nextStorageError(prev: string | undefined, ok: boolean): string | undefined {
  if (ok) return undefined
  return prev ?? STORAGE_FULL_MESSAGE
}

export interface PersistScheduler {
  schedule: (charts: Chart[], activeId: string) => void
  flush: () => void
  cancel: () => void
}

// Trailing-edge debounce around a write function. Coalesces the per-frame write
// stream from live crop drags / title typing into a single localStorage write,
// while the trailing edge still persists the final value (no drag-end event
// needed). flush() forces a pending write immediately — used on pagehide so a
// debounced change survives a tab close inside the debounce window.
export function createPersistScheduler(
  write: (charts: Chart[], activeId: string) => { ok: boolean },
  onResult: (ok: boolean) => void,
  delayMs: number,
): PersistScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { charts: Chart[]; activeId: string } | null = null

  const run = () => {
    timer = null
    if (!pending) return
    const { charts, activeId } = pending
    pending = null
    onResult(write(charts, activeId).ok)
  }

  return {
    schedule(charts, activeId) {
      pending = { charts, activeId }
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(run, delayMs)
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      run()
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      pending = null
    },
  }
}

function readStoredCharts(): Chart[] {
  try {
    const raw = localStorage.getItem(CHARTS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isChartShaped)) {
      return migrateAll(parsed as Chart[]).map(sanitizeChartConfig)
    }
  } catch { /* ignore */ }
  return []
}

function loadFromStorageOrDefault(): ChartsState {
  try {
    const chartsJson = localStorage.getItem(CHARTS_KEY)
    const storedActiveId = localStorage.getItem(ACTIVE_ID_KEY)
    if (chartsJson) {
      const parsed: unknown = JSON.parse(chartsJson)
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isChartShaped)) {
        const charts = migrateAll(parsed as Chart[]).map(sanitizeChartConfig)
        const activeId =
          storedActiveId && charts.some((c) => c.id === storedActiveId)
            ? storedActiveId
            : charts[0].id
        return { charts, activeId }
      }
    }
  } catch {
    // Fall through to fresh default
  }
  const fresh = createDefaultChart()
  return { charts: [fresh], activeId: fresh.id }
}

export interface ChartsState {
  charts: Chart[]
  activeId: string
  // Set to true only when loadOrInit decoded a valid share-link param.
  // Absent (undefined) on normal loads and after any subsequent setState.
  consumedShareParam?: true
  pendingReconstruction?: Array<ShareSlotStub | null>
  isReconstructing?: boolean
  reconstructionError?: string
  reconstructionWarning?: string
  storageError?: string
  // Id of a share-link placeholder whose slots haven't reconstructed yet. While
  // set, the placeholder is excluded from persistence (so a reload re-derives it
  // from the still-present ?c= rather than duplicating it). Cleared on success;
  // retained on failure so retry/reload keep working.
  unreconstructedPlaceholderId?: string
}

const RECONSTRUCTION_FAIL_MESSAGE =
  "Couldn't load cards from the shared link — check your connection or Scryfall's status, then Retry."

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stripShareParam(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('c')
  window.history.replaceState(null, '', url.toString())
}

// Charts to write to localStorage: everything except an un-reconstructed share
// placeholder. Excluding it means a failed share-load that keeps ?c= in the URL
// re-derives exactly one placeholder on reload instead of accumulating duplicates.
export function chartsToPersist(charts: Chart[], excludeId: string | undefined): Chart[] {
  if (!excludeId) return charts
  return charts.filter((c) => c.id !== excludeId)
}

// Reconstruction succeeded: fill the placeholder's slots and clear all
// reconstruction flags (including the persistence exclusion). If the placeholder
// was deleted mid-fetch, just clear the flags.
export function applyReconstructionSuccess(
  prev: ChartsState,
  placeholderId: string,
  slots: Array<Slot | null>,
  warningCount: number,
): ChartsState {
  const prevChart = prev.charts.find((c) => c.id === placeholderId)
  if (!prevChart) {
    return {
      ...prev,
      pendingReconstruction: undefined,
      isReconstructing: false,
      unreconstructedPlaceholderId: undefined,
    }
  }
  const updatedChart = { ...prevChart, slots }
  return {
    ...prev,
    charts: prev.charts.map((c) => (c.id === updatedChart.id ? updatedChart : c)),
    pendingReconstruction: undefined,
    isReconstructing: false,
    reconstructionError: undefined,
    unreconstructedPlaceholderId: undefined,
    reconstructionWarning:
      warningCount > 0
        ? `${warningCount} card(s) from the shared link could not be found or loaded.`
        : undefined,
  }
}

// Reconstruction failed: KEEP the named placeholder (empty grid), surface a
// retryable error, and retain both the stubs and the persistence exclusion so
// Retry (in-app) and reload (?c= still present) both work without deleting the
// chart. If the placeholder was deleted mid-fetch, just clear the flags.
export function applyReconstructionFailure(
  prev: ChartsState,
  placeholderId: string,
  message: string,
): ChartsState {
  if (!prev.charts.some((c) => c.id === placeholderId)) {
    return {
      ...prev,
      pendingReconstruction: undefined,
      isReconstructing: false,
      unreconstructedPlaceholderId: undefined,
    }
  }
  return {
    ...prev,
    isReconstructing: false,
    reconstructionError: message,
    // pendingReconstruction + unreconstructedPlaceholderId retained for retry/reload.
  }
}

// Does not call persist() — the useEffect in useCharts handles all writes.
// Does not call replaceState — a post-mount useEffect in useCharts does that,
// conditional on consumedShareParam so malformed ?c= params are left untouched.
export function loadOrInit(): ChartsState {
  const param = new URLSearchParams(window.location.search).get('c')
  if (param) {
    const result = decodeSharePayload(param)

    if (result.kind === 'compact') {
      const existingCharts = readStoredCharts()
      // Sanitize the decoded chart config (clamp dims, drop bad hero items, safe
      // bg) before it reaches state, then cap the stub array to grid capacity so
      // a crafted link can't force excessive reconstruction work.
      const placeholder = sanitizeChartConfig({
        ...result.payload.c,
        id: crypto.randomUUID(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
        slots: [],
      })
      const capacity = chartCapacity(placeholder.gridRows, placeholder.gridCols, placeholder.heroConfig)
      return {
        charts: [...existingCharts, placeholder],
        activeId: placeholder.id,
        consumedShareParam: true,
        pendingReconstruction: result.payload.s.slice(0, capacity),
        isReconstructing: true,
        unreconstructedPlaceholderId: placeholder.id,
      }
    }

    if (result.kind === 'legacy') {
      const existingCharts = readStoredCharts()
      const chart = sanitizeChartConfig({ ...result.chart, id: crypto.randomUUID() })
      return { charts: [...existingCharts, chart], activeId: chart.id, consumedShareParam: true }
    }

    // error: fall through to stored/default; leave URL intact so user can see it
    return { ...loadFromStorageOrDefault(), reconstructionError: result.message }
  }

  return loadFromStorageOrDefault()
}

export function useCharts(): {
  charts: Chart[]
  activeId: string
  activeChart: Chart
  isReconstructing: boolean
  reconstructionError: string | null
  reconstructionWarning: string | null
  storageError: string | null
  canRetryReconstruction: boolean
  retryReconstruction: () => void
  createChart: () => void
  duplicateChart: () => void
  deleteChart: (id: string) => void
  updateChart: (updater: (prev: Chart) => Chart) => void
  renameChart: (id: string, name: string) => void
  setActiveId: (id: string) => void
  dismissReconstructionError: () => void
  dismissReconstructionWarning: () => void
  dismissStorageError: () => void
} {
  const [state, setState] = useState<ChartsState>(loadOrInit)

  // Capture the initial consumedShareParam and reconstruction context into refs so
  // post-mount effects can read them without being listed as dependencies. These
  // values are only meaningful at initial load time (set by loadOrInit from the URL).
  const consumedShareParamRef = useRef(state.consumedShareParam ?? false)
  const pendingReconstructionRef = useRef(state.pendingReconstruction ?? null)
  const placeholderIdRef = useRef(state.activeId)

  // Strip ?c= immediately only for synchronous successes — legacy links, which
  // never reconstruct. Decode errors don't set consumedShareParam, so their URL
  // is left intact. Compact links defer the strip to reconstruction success
  // (below) so a failed load keeps ?c= in the URL for reload-retry.
  useEffect(() => {
    if (consumedShareParamRef.current && pendingReconstructionRef.current === null) {
      stripShareParam()
    }
  }, [])

  // One reconstruction attempt for a placeholder. Shared by the mount effect and
  // Retry. Strips ?c= only after success; on transient failure keeps the
  // placeholder + stubs (applyReconstructionFailure) so Retry and reload both work.
  const runReconstruction = useCallback(
    async (stubs: Array<ShareSlotStub | null>, placeholderId: string, signal: AbortSignal) => {
      try {
        const { cardMap, notFoundCount, normaliseFailCount } = await fetchCollectionSlots(stubs, {
          fetch: globalThis.fetch.bind(globalThis),
          sleep: delay,
          signal,
        })
        const slots = reconstructSlots(stubs, cardMap)
        const warningCount = notFoundCount + normaliseFailCount
        setState((prev) => applyReconstructionSuccess(prev, placeholderId, slots, warningCount))
        // ?c= is stripped by the effect watching unreconstructedPlaceholderId,
        // which covers both success and the user-claim path.
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setState((prev) =>
          applyReconstructionFailure(prev, placeholderId, RECONSTRUCTION_FAIL_MESSAGE),
        )
      }
    },
    [],
  )

  // Reconstruct slots when a compact share link was decoded. Runs once on mount;
  // AbortController cleanup handles StrictMode double-invoke and genuine unmount.
  useEffect(() => {
    const stubs = pendingReconstructionRef.current
    if (!stubs) return
    const controller = new AbortController()
    void runReconstruction(stubs, placeholderIdRef.current, controller.signal)
    return () => controller.abort()
  }, [runReconstruction])

  // Retry a failed reconstruction using the retained stubs. Re-enters the loading
  // state and clears the error; the placeholder id is stable from mount.
  const retryReconstruction = useCallback(() => {
    const stubs = pendingReconstructionRef.current
    if (!stubs) return
    const placeholderId = placeholderIdRef.current
    setState((prev) => {
      if (!prev.charts.some((c) => c.id === placeholderId)) return prev
      return { ...prev, isReconstructing: true, reconstructionError: undefined }
    })
    const controller = new AbortController()
    void runReconstruction(stubs, placeholderId, controller.signal)
  }, [runReconstruction])

  // Strip ?c= once a compact share placeholder is no longer pending — either it
  // reconstructed (applyReconstructionSuccess clears the id) or the user claimed
  // it by editing (updateChart clears the id). On failure the id is retained, so
  // ?c= stays in the URL for reload-retry. Legacy links are handled by the
  // mount-strip effect above (they have no pendingReconstruction).
  useEffect(() => {
    if (
      consumedShareParamRef.current &&
      pendingReconstructionRef.current !== null &&
      state.unreconstructedPlaceholderId === undefined
    ) {
      stripShareParam()
    }
  }, [state.unreconstructedPlaceholderId])

  // Stable debounced persistence scheduler — created once, survives re-renders.
  // safeWrite never throws; a quota/storage failure flips storageError via the
  // idempotent nextStorageError transition.
  const schedulerRef = useRef<PersistScheduler | null>(null)
  if (schedulerRef.current === null) {
    schedulerRef.current = createPersistScheduler(
      safeWrite,
      (ok) =>
        setState((prev) => {
          const nextErr = nextStorageError(prev.storageError, ok)
          return nextErr === prev.storageError ? prev : { ...prev, storageError: nextErr }
        }),
      PERSIST_DEBOUNCE_MS,
    )
  }

  // Schedule a debounced write after every settled state change. An
  // un-reconstructed share placeholder is excluded (chartsToPersist) so it isn't
  // written before its slots resolve. Skipping an empty result applies ONLY while
  // reconstruction is in flight (initial hydration: the lone chart is the
  // not-yet-loaded placeholder, nothing to save). Once reconstruction has settled,
  // an empty result is a real state — e.g. the user deleted the last
  // non-placeholder chart — and must persist so the change survives reload. Deps
  // are narrowed to the persisted slice so a storageError setState cannot re-enter
  // this effect and retry a failing write (no quota loop).
  useEffect(() => {
    const toPersist = chartsToPersist(state.charts, state.unreconstructedPlaceholderId)
    if (toPersist.length === 0 && state.isReconstructing) return
    schedulerRef.current!.schedule(toPersist, state.activeId)
  }, [state.charts, state.activeId, state.unreconstructedPlaceholderId, state.isReconstructing])

  // Flush a pending debounced write when the tab is hidden/closed so the last
  // change isn't lost inside the debounce window. cancel() on unmount avoids a
  // late setState from a timer firing after teardown.
  useEffect(() => {
    const flush = () => schedulerRef.current?.flush()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      schedulerRef.current?.cancel()
    }
  }, [])

  const { charts, activeId } = state
  const activeChart = charts.find((c) => c.id === activeId) ?? charts[0]

  // Retry is offered only for a failed compact reconstruction (stubs retained in
  // state), not for decode errors (no stubs) and not while a load is in flight.
  // pendingReconstruction is retained on failure and cleared on success, so it is
  // a render-safe signal for "there are stubs to retry".
  const canRetryReconstruction =
    state.pendingReconstruction !== undefined &&
    state.reconstructionError !== undefined &&
    !(state.isReconstructing ?? false)

  // Runs the updater against the freshest active chart from prev. Bails out without a
  // new state object when the updater returns the same reference (no-op paths like
  // out-of-range clamps or missing-slot guards), preventing spurious re-renders and
  // unnecessary localStorage writes.
  const updateChart = useCallback((updater: (prev: Chart) => Chart) => {
    setState((prev) => {
      const prevActiveChart =
        prev.charts.find((c) => c.id === prev.activeId) ?? prev.charts[0]
      const nextChart = updater(prevActiveChart)
      if (nextChart === prevActiveChart) return prev
      const charts = prev.charts.map((c) => (c.id === nextChart.id ? nextChart : c))
      // Claim a failed share placeholder on its first real edit: once the user
      // mutates it, it's their chart — drop the reconstruction exclusion (so it
      // persists as a normal chart) and the retained stubs/error. The ?c= strip
      // is handled by the effect watching unreconstructedPlaceholderId. Gated on
      // !isReconstructing so an in-flight reconstruction isn't claimed out from
      // under itself.
      if (
        prev.unreconstructedPlaceholderId !== undefined &&
        prev.unreconstructedPlaceholderId === nextChart.id &&
        !prev.isReconstructing
      ) {
        return {
          ...prev,
          charts,
          unreconstructedPlaceholderId: undefined,
          pendingReconstruction: undefined,
          reconstructionError: undefined,
        }
      }
      return { ...prev, charts }
    })
  }, [])

  // Renames any chart by id — not restricted to the active chart, so it uses its own
  // setState path rather than going through updateChart (which only operates on the
  // active chart).
  const renameChart = useCallback((id: string, name: string) => {
    setState((prev) => ({
      ...prev,
      charts: prev.charts.map((c) => (c.id === id ? { ...c, name } : c)),
    }))
  }, [])

  const createChart = useCallback(() => {
    setState((prev) => {
      const fresh = createDefaultChart()
      // Spread prev so reconstruction/storage context survives — creating a chart
      // must not silently discard a failed share's placeholder or its ?c= retry.
      return { ...prev, charts: [...prev.charts, fresh], activeId: fresh.id }
    })
  }, [])

  // Deep-clone the active chart under a new id/name, insert it right after the
  // source, and make it active. Spread prev so reconstruction/storage context
  // survives (mirrors createChart). The clone is fully independent (see cloneChart).
  const duplicateChart = useCallback(() => {
    setState((prev) => {
      const source = prev.charts.find((c) => c.id === prev.activeId) ?? prev.charts[0]
      const clone = cloneChart(source, crypto.randomUUID())
      const idx = prev.charts.findIndex((c) => c.id === source.id)
      const charts = [...prev.charts]
      charts.splice(idx + 1, 0, clone)
      return { ...prev, charts, activeId: clone.id }
    })
  }, [])

  const deleteChart = useCallback((id: string) => {
    setState((prev) => {
      const remaining = prev.charts.filter((c) => c.id !== id)
      // Drop reconstruction context only when the un-reconstructed placeholder
      // itself is gone (deleted here, or no chart remains). Deleting a *sibling*
      // chart preserves it, so a failed share keeps ?c= and its retry/reload path.
      // (The strip effect keys on unreconstructedPlaceholderId, so clearing it
      // here is what strips ?c= when the placeholder is discarded.)
      const placeholderGone =
        prev.unreconstructedPlaceholderId !== undefined &&
        (id === prev.unreconstructedPlaceholderId || remaining.length === 0)
      const clearedReconstruction = placeholderGone
        ? {
            unreconstructedPlaceholderId: undefined,
            pendingReconstruction: undefined,
            isReconstructing: false,
            reconstructionError: undefined,
          }
        : {}
      if (remaining.length === 0) {
        const fresh = createDefaultChart()
        return { ...prev, ...clearedReconstruction, charts: [fresh], activeId: fresh.id }
      }
      let activeId = prev.activeId
      if (activeId === id) {
        const deletedIndex = prev.charts.findIndex((c) => c.id === id)
        // Activate previous sibling; falls back to first remaining when index 0 is deleted
        activeId = remaining[Math.max(0, deletedIndex - 1)].id
      }
      return { ...prev, ...clearedReconstruction, charts: remaining, activeId }
    })
  }, [])

  const setActiveId = useCallback((id: string) => {
    setState((prev) => {
      if (!prev.charts.some((c) => c.id === id)) return prev
      return { ...prev, activeId: id }
    })
  }, [])

  const dismissReconstructionError = useCallback(() => {
    setState((prev) => ({ ...prev, reconstructionError: undefined }))
  }, [])

  const dismissReconstructionWarning = useCallback(() => {
    setState((prev) => ({ ...prev, reconstructionWarning: undefined }))
  }, [])

  const dismissStorageError = useCallback(() => {
    setState((prev) => (prev.storageError ? { ...prev, storageError: undefined } : prev))
  }, [])

  return {
    charts,
    activeId,
    activeChart,
    isReconstructing: state.isReconstructing ?? false,
    reconstructionError: state.reconstructionError ?? null,
    reconstructionWarning: state.reconstructionWarning ?? null,
    storageError: state.storageError ?? null,
    canRetryReconstruction,
    retryReconstruction,
    createChart,
    duplicateChart,
    deleteChart,
    updateChart,
    renameChart,
    setActiveId,
    dismissReconstructionError,
    dismissReconstructionWarning,
    dismissStorageError,
  }
}
