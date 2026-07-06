import type { ReactNode } from 'react'
import styles from './BottomSheet.module.css'

interface Props {
  /** Accessible name for the sheet region, also shown as its header. */
  label: string
  onDismiss: () => void
  children: ReactNode
}

// The phone home for the Selected-card surface (§7.1b): a fixed, safe-area-
// padded bottom container that appears on selection. Deliberately non-modal —
// no focus trap, no backdrop — so the grid stays visible and interactive
// behind it (selecting another cell retargets the sheet in place).
export default function BottomSheet({ label, onDismiss, children }: Props) {
  return (
    <div
      className={styles.sheet}
      role="region"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDismiss()
      }}
    >
      <div className={styles.header}>
        <span className={styles.title}>{label}</span>
        <button
          type="button"
          className={styles.dismiss}
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          ✕
        </button>
      </div>
      {children}
    </div>
  )
}
