import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

// Low-level pointer-drag engine shared by cell drag and search-result drag.
//
// It owns the pre-drag phase and arms a drag by one of two paths (§3.3):
//   - mouse / pen: arm as soon as the pointer travels past slop.
//   - touch:       arm only after a still-finger LONG_PRESS; if the finger moves
//                  past slop first it's a scroll — the browser takes the gesture
//                  and we abort without arming or suppressing anything.
// Once armed it captures the pointer, streams moves, and (touch only) suppresses
// page scrolling for the remainder of the gesture via a document-level
// non-passive touchmove listener that is torn down on release. A generic per-drag
// `context` is snapshotted synchronously at pointerdown (React nulls a synthetic
// event's currentTarget after the handler returns).

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
  isTouch: boolean
  context: T
}

// Mouse/pen: pointer travel that promotes a press into a drag.
const DEFAULT_SLOP_PX = 4
// Touch tunables (on-device tuning is a one-line change, per the brief):
//   LONG_PRESS_MS — still-finger hold before a touch drag arms.
//   TOUCH_SLOP_PX — finger travel before the hold fires that counts as a scroll
//                   (larger than mouse slop to tolerate finger jitter).
const LONG_PRESS_MS = 400
const TOUCH_SLOP_PX = 10

export function usePointerDrag<T>(callbacks: PointerDragCallbacks<T>): (e: React.PointerEvent) => void {
  const cbRef = useRef(callbacks)
  useLayoutEffect(() => {
    cbRef.current = callbacks
  })

  const activeRef = useRef<ActiveDrag<T> | null>(null)
  const moveRef = useRef<((e: PointerEvent) => void) | null>(null)
  const upRef = useRef<((e: PointerEvent) => void) | null>(null)
  const keyRef = useRef<((e: KeyboardEvent) => void) | null>(null)
  // The active-drag scroll suppressor + long-press timer, live only between arm
  // and teardown of a touch drag.
  const touchMoveRef = useRef<((e: TouchEvent) => void) | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The element+pointer we called setPointerCapture on, or null if capture was
  // never taken (a press that never armed, or a jsdom/throwing capture).
  const captureRef = useRef<{ el: Element; pointerId: number } | null>(null)

  const teardown = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (moveRef.current) window.removeEventListener('pointermove', moveRef.current)
    if (upRef.current) {
      window.removeEventListener('pointerup', upRef.current)
      window.removeEventListener('pointercancel', upRef.current)
    }
    if (keyRef.current) window.removeEventListener('keydown', keyRef.current)
    // Scoped scroll suppressor is removed on EVERY terminal path — never left
    // standing (it would otherwise kill all page scrolling).
    if (touchMoveRef.current) {
      document.removeEventListener('touchmove', touchMoveRef.current)
      touchMoveRef.current = null
    }
    // Release capture on EVERY terminal path (commit, Escape, pointercancel,
    // unmount). Cleared first so a second teardown can't double-release, and only
    // attempted when capture was actually taken. releasePointerCapture legitimately
    // throws if the pointer is already up / capture already gone — same throw-safe
    // pattern as the acquire.
    const cap = captureRef.current
    captureRef.current = null
    if (cap) {
      try {
        ;(cap.el as Element & { releasePointerCapture(id: number): void }).releasePointerCapture(cap.pointerId)
      } catch {
        /* ignore */
      }
    }
    moveRef.current = null
    upRef.current = null
    keyRef.current = null
    activeRef.current = null
  }, [])

  // Detach everything if the component unmounts mid-drag.
  useEffect(() => teardown, [teardown])

  return useCallback(
    (e: React.PointerEvent) => {
      if (activeRef.current) return
      // Primary pointer + primary button only: a right/middle-button press and a
      // secondary touch point must not start a drag (leaves the context-menu path
      // free; matches the old HTML5 DnD).
      if (!e.isPrimary || e.button !== 0) return
      const context = cbRef.current.getContext(e)
      if (context === null) return

      const isTouch = e.pointerType === 'touch'
      const active: ActiveDrag<T> = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        started: false,
        isTouch,
        context,
      }
      activeRef.current = active
      // Snapshot the source element now — React nulls currentTarget after this
      // handler returns, but capture is only taken once a drag actually arms.
      const sourceEl = e.currentTarget as HTMLElement
      const armSlop = cbRef.current.slop ?? DEFAULT_SLOP_PX

      const arm = () => {
        const a = activeRef.current
        if (!a || a.started) return
        a.started = true
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        // Capture on arm (not on the press) so a tap/scroll never takes capture,
        // and moves keep flowing if the pointer leaves the source. Throw-safe.
        try {
          sourceEl.setPointerCapture(a.pointerId)
          captureRef.current = { el: sourceEl, pointerId: a.pointerId }
        } catch {
          /* ignore */
        }
        if (a.isTouch) {
          // Suppress page scrolling for the REMAINDER of this gesture only — a
          // document-level NON-PASSIVE touchmove that preventDefaults. Attached
          // here on arm, removed in teardown; never a standing/global listener.
          const suppress = (ev: TouchEvent) => ev.preventDefault()
          document.addEventListener('touchmove', suppress, { passive: false })
          touchMoveRef.current = suppress
        }
        cbRef.current.onStart(a.context)
      }

      const onMove = (ev: PointerEvent) => {
        const a = activeRef.current
        if (!a || ev.pointerId !== a.pointerId) return
        a.lastX = ev.clientX
        a.lastY = ev.clientY
        if (!a.started) {
          const travel = Math.hypot(ev.clientX - a.startX, ev.clientY - a.startY)
          if (a.isTouch) {
            // Finger moved past slop before the long-press fired → it's a scroll.
            // Let the browser have the gesture; abort without arming/suppressing.
            if (travel >= TOUCH_SLOP_PX) teardown()
            return
          }
          if (travel < armSlop) return
          arm() // mouse/pen: slop-cross arms
        }
        cbRef.current.onMove(a.context, ev.clientX, ev.clientY)
      }

      const finish = (committed: boolean, x: number, y: number) => {
        const a = activeRef.current
        const started = a?.started ?? false
        const context = a?.context
        teardown()
        // Only fire onEnd if a drag actually began; a press-without-arm is a plain
        // tap/click and is left entirely to the element's own onClick.
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
      // Registered at pointerdown (not at arm) by design: finish() only fires
      // onEnd when the drag has `started`, so Escape before arm dispatches no
      // machine transition (it just drops the pending press) — inert at the
      // machine level. Registering once here avoids add/remove churn as the drag
      // arms, with no observable difference before arm.
      window.addEventListener('keydown', onKeyDown)

      // Touch arms on a still-finger long-press; the timer is cleared by onMove
      // (scroll), by teardown, or when it fires and arms.
      if (isTouch) {
        timerRef.current = setTimeout(arm, LONG_PRESS_MS)
      }
    },
    [teardown],
  )
}
