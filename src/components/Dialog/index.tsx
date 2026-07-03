import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import styles from './Dialog.module.css'

interface Props {
  /** Accessible name for the dialog (rendered as aria-label). */
  label: string
  onClose: () => void
  /** Focused on open. Defaults to the panel's first focusable, else the panel. */
  initialFocus?: RefObject<HTMLElement | null>
  closeOnBackdrop?: boolean
  /** Per-consumer panel sizing (width, padding) — chrome comes from the primitive. */
  panelClassName?: string
  children: ReactNode
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Lazily created portal target under document.body, shared by all dialogs.
// Re-created if a previous one was detached (tests tear the DOM down between runs).
let dialogRoot: HTMLElement | null = null
function getDialogRoot(): HTMLElement {
  if (!dialogRoot || !dialogRoot.isConnected) {
    dialogRoot = document.createElement('div')
    dialogRoot.id = 'dialog-root'
    document.body.appendChild(dialogRoot)
  }
  return dialogRoot
}

// Open-dialog counter so `inert` is lifted from the app root only when the last
// dialog closes. Also keeps StrictMode's mount → unmount → mount probe balanced.
let openCount = 0

export default function Dialog({
  label,
  onClose,
  initialFocus,
  closeOnBackdrop = true,
  panelClassName,
  children,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Fresh ref so the Escape listener (registered once) always calls the latest
  // onClose without re-registering every render (same pattern as App's undoRedoRef).
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => {
    onCloseRef.current = onClose
  })

  // Containment, initial focus, and restore — one mount-only effect so the close
  // ordering is explicit: `inert` must be lifted before restoring focus, because
  // elements inside an inert subtree cannot receive focus.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    openCount++
    const appRoot = document.getElementById('root')
    appRoot?.setAttribute('inert', '')

    const panel = panelRef.current
    const target = initialFocus?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel
    target?.focus()

    return () => {
      openCount--
      if (openCount === 0) appRoot?.removeAttribute('inert')
      opener?.focus()
    }
    // Mount-only by design: initialFocus is read once, at open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape closes — the one listener for all consumers.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Tab-cycle fallback. `inert` already fences the page behind the dialog; this
  // keeps Tab from walking out of the panel into the browser chrome at the edges.
  function handleTabCycle(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const focusables = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (focusables.length === 0) {
      e.preventDefault()
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className={styles.backdrop}
      // mousedown, not click: a drag that starts inside the panel (e.g. selecting
      // text) and releases over the backdrop must not close the dialog.
      onMouseDown={
        closeOnBackdrop
          ? (e) => {
              if (e.target === e.currentTarget) onClose()
            }
          : undefined
      }
    >
      <div
        ref={panelRef}
        className={panelClassName ? `${styles.panel} ${panelClassName}` : styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={handleTabCycle}
      >
        {children}
      </div>
    </div>,
    getDialogRoot(),
  )
}
