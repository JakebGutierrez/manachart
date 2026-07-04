import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './ContextMenu.module.css'

interface Props {
  position: { x: number; y: number }
  onRemove: () => void
  onSwitchPrinting: (() => void) | null
  onSwitchFace: (() => void) | null
  onClose: () => void
  /** Keyboard-invoked: move focus into the first item on open. */
  autoFocus?: boolean
}

export default function ContextMenu({
  position,
  onRemove,
  onSwitchPrinting,
  onSwitchFace,
  onClose,
  autoFocus = false,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const handleMousedown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose()
    }
    const handleScroll = () => onClose()

    window.addEventListener('keydown', handleKey)
    window.addEventListener('mousedown', handleMousedown)
    window.addEventListener('scroll', handleScroll, { capture: true })

    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('mousedown', handleMousedown)
      window.removeEventListener('scroll', handleScroll, { capture: true })
    }
  }, [onClose])

  // Keyboard-open: land focus on the first item so arrow navigation has a home.
  useEffect(() => {
    if (autoFocus) menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [autoFocus])

  // Arrow/Home/End roving among menu items, plus a Tab trap so keyboard focus is
  // contained within the open menu (items are tabIndex=-1, so a bare Tab would
  // otherwise walk out of the menu while it stays open). The menu is one
  // composite widget with a single conceptual tab stop.
  function handleMenuKeyDown(e: React.KeyboardEvent) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    let next: number | null = null
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      next = current < 0 ? 0 : (current + 1) % items.length
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      next = current <= 0 ? items.length - 1 : current - 1
    } else if (e.key === 'Home') {
      next = 0
    } else if (e.key === 'End') {
      next = items.length - 1
    }
    if (next === null) return
    e.preventDefault()
    items[next].focus()
  }

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      role="menu"
      aria-label="Card actions"
      style={{ left: position.x, top: position.y }}
      onKeyDown={handleMenuKeyDown}
    >
      <button className={styles.item} type="button" role="menuitem" tabIndex={-1} onClick={onRemove}>
        Remove
      </button>
      {onSwitchPrinting && (
        <button className={styles.item} type="button" role="menuitem" tabIndex={-1} onClick={onSwitchPrinting}>
          Switch Printing
        </button>
      )}
      {onSwitchFace && (
        <button className={styles.item} type="button" role="menuitem" tabIndex={-1} onClick={onSwitchFace}>
          Switch Face
        </button>
      )}
    </div>,
    document.body,
  )
}
