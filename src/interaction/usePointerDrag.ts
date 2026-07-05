import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

// Low-level pointer-drag engine shared by cell drag and search-result drag.
//
// It owns the pre-drag phase: capture the pointer, watch for slop, and once the
// pointer has travelled far enough, begin a drag and stream moves until release.
// A generic per-drag `context` is captured synchronously at pointerdown (React
// nullifies a synthetic event's currentTarget after the handler returns, so the
// consumer must snapshot what it needs up front, not in a later callback).
//
// Checkpoint 1 scope: mouse and pen only. Touch pointerdowns are ignored here so
// page scrolling and tap-to-select keep working untouched; the touch gesture
// (long-press arming + non-passive scroll suppression) is a later slice.

export interface PointerDragCallbacks<T> {
  // Snapshot the drag context from the pointerdown event (sync). Return null to
  // decline the drag (e.g. an empty cell).
  getContext(e: React.PointerEvent): T | null
  onStart(context: T): void
  onMove(context: T, x: number, y: number): void
  onEnd(context: T, committed: boolean): void
  slop?: number
}

interface ActiveDrag<T> {
  pointerId: number
  startX: number
  startY: number
  started: boolean
  context: T
}

const DEFAULT_SLOP_PX = 4

export function usePointerDrag<T>(callbacks: PointerDragCallbacks<T>): (e: React.PointerEvent) => void {
  const cbRef = useRef(callbacks)
  useLayoutEffect(() => {
    cbRef.current = callbacks
  })

  const activeRef = useRef<ActiveDrag<T> | null>(null)
  const moveRef = useRef<((e: PointerEvent) => void) | null>(null)
  const upRef = useRef<((e: PointerEvent) => void) | null>(null)

  const teardown = useCallback(() => {
    if (moveRef.current) window.removeEventListener('pointermove', moveRef.current)
    if (upRef.current) {
      window.removeEventListener('pointerup', upRef.current)
      window.removeEventListener('pointercancel', upRef.current)
    }
    moveRef.current = null
    upRef.current = null
    activeRef.current = null
  }, [])

  // Detach window listeners if the component unmounts mid-drag.
  useEffect(() => teardown, [teardown])

  return useCallback(
    (e: React.PointerEvent) => {
      if (activeRef.current) return
      // Mouse/pen only for now — see file header.
      if (e.pointerType === 'touch') return
      const context = cbRef.current.getContext(e)
      if (context === null) return

      const active: ActiveDrag<T> = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        started: false,
        context,
      }
      activeRef.current = active

      // Capture keeps moves flowing if the pointer leaves the source element. It
      // throws if the pointer is already up, and jsdom's impl is partial — ignore.
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }

      const slop = cbRef.current.slop ?? DEFAULT_SLOP_PX

      const onMove = (ev: PointerEvent) => {
        const a = activeRef.current
        if (!a || ev.pointerId !== a.pointerId) return
        if (!a.started) {
          if (Math.hypot(ev.clientX - a.startX, ev.clientY - a.startY) < slop) return
          a.started = true
          cbRef.current.onStart(a.context)
        }
        cbRef.current.onMove(a.context, ev.clientX, ev.clientY)
      }

      const onUp = (ev: PointerEvent) => {
        const a = activeRef.current
        if (a && ev.pointerId !== a.pointerId) return
        const started = a?.started ?? false
        const context = a?.context
        teardown()
        // Only fire onEnd if a drag actually began; a press-without-slop is a
        // plain click and is left entirely to the element's own onClick.
        if (started && context !== undefined) {
          cbRef.current.onEnd(context, ev.type !== 'pointercancel')
        }
      }

      moveRef.current = onMove
      upRef.current = onUp
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [teardown],
  )
}
