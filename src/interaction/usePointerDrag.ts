import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

// Low-level pointer-drag engine shared by cell drag and search-result drag.
//
// It owns the pre-drag phase: capture the pointer, watch for slop, and once the
// pointer has travelled far enough, begin a drag and stream moves until release.
// A generic per-drag `context` is captured synchronously at pointerdown (React
// nullifies a synthetic event's currentTarget after the handler returns, so the
// consumer must snapshot what it needs up front, not in a later callback).
//
// Checkpoint 1 scope: mouse and pen only, primary button only. Touch pointerdowns
// are ignored here so page scrolling and tap-to-select keep working untouched;
// the touch gesture (long-press arming + non-passive scroll suppression) is a
// later slice.

export interface PointerDragCallbacks<T> {
  // Snapshot the drag context from the pointerdown event (sync). Return null to
  // decline the drag (e.g. an empty cell).
  getContext(e: React.PointerEvent): T | null
  onStart(context: T): void
  onMove(context: T, x: number, y: number): void
  // committed is false for an Escape/pointercancel abort. x/y are the terminal
  // pointer coordinates so the consumer can resolve the drop target from where
  // the pointer actually was released, not a cached hover.
  onEnd(context: T, committed: boolean, x: number, y: number): void
  slop?: number
}

interface ActiveDrag<T> {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
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
  const keyRef = useRef<((e: KeyboardEvent) => void) | null>(null)

  const teardown = useCallback(() => {
    if (moveRef.current) window.removeEventListener('pointermove', moveRef.current)
    if (upRef.current) {
      window.removeEventListener('pointerup', upRef.current)
      window.removeEventListener('pointercancel', upRef.current)
    }
    if (keyRef.current) window.removeEventListener('keydown', keyRef.current)
    moveRef.current = null
    upRef.current = null
    keyRef.current = null
    activeRef.current = null
  }, [])

  // Detach window listeners if the component unmounts mid-drag.
  useEffect(() => teardown, [teardown])

  return useCallback(
    (e: React.PointerEvent) => {
      if (activeRef.current) return
      // Mouse/pen only for now — see file header.
      if (e.pointerType === 'touch') return
      // Primary button only: a right/middle-button press must not start a drag
      // (and must leave the context-menu path free). Matches the old HTML5 DnD.
      if (!e.isPrimary || e.button !== 0) return
      const context = cbRef.current.getContext(e)
      if (context === null) return

      const active: ActiveDrag<T> = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
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
        a.lastX = ev.clientX
        a.lastY = ev.clientY
        if (!a.started) {
          if (Math.hypot(ev.clientX - a.startX, ev.clientY - a.startY) < slop) return
          a.started = true
          cbRef.current.onStart(a.context)
        }
        cbRef.current.onMove(a.context, ev.clientX, ev.clientY)
      }

      const finish = (committed: boolean, x: number, y: number) => {
        const a = activeRef.current
        const started = a?.started ?? false
        const context = a?.context
        teardown()
        // Only fire onEnd if a drag actually began; a press-without-slop is a
        // plain click and is left entirely to the element's own onClick.
        if (started && context !== undefined) {
          cbRef.current.onEnd(context, committed, x, y)
        }
      }

      const onUp = (ev: PointerEvent) => {
        const a = activeRef.current
        if (a && ev.pointerId !== a.pointerId) return
        finish(ev.type !== 'pointercancel', ev.clientX, ev.clientY)
      }

      // Escape aborts an in-flight drag with no commit (§3.2 dragging → cancel),
      // mirroring the keyboard-grab Escape behavior.
      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape') return
        const a = activeRef.current
        if (!a) return
        ev.preventDefault()
        finish(false, a.lastX, a.lastY)
      }

      moveRef.current = onMove
      upRef.current = onUp
      keyRef.current = onKeyDown
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      window.addEventListener('keydown', onKeyDown)
    },
    [teardown],
  )
}
