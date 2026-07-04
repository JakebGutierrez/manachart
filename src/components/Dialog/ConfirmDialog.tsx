import { useRef } from 'react'
import Dialog from '@/components/Dialog'
import styles from './ConfirmDialog.module.css'

interface Props {
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

// Modal replacement for window.confirm: Enter activates the focused confirm
// button and Escape/backdrop cancel, matching the native dialog's keyboard feel.
export default function ConfirmDialog({
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog
      label={message}
      onClose={onCancel}
      initialFocus={confirmRef}
      panelClassName={styles.panel}
    >
      <p className={styles.message}>{message}</p>
      <div className={styles.actions}>
        <button className={styles.cancelBtn} type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          ref={confirmRef}
          className={danger ? `${styles.confirmBtn} ${styles.confirmDanger}` : styles.confirmBtn}
          type="button"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}
