import { forwardRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './DragGhost.module.css'

interface Props {
  src: string
}

// A pointer-following image of the card being dragged. Purely presentational and
// aria-hidden — the real state lives in the move machine. App positions it via
// the forwarded ref: once on drag start (a layout effect, before paint, so it
// never flashes at the origin) and then on every pointermove.
const DragGhost = forwardRef<HTMLDivElement, Props>(function DragGhost({ src }, ref) {
  return createPortal(
    <div ref={ref} className={styles.ghost} aria-hidden="true">
      <img className={styles.img} src={src} alt="" crossOrigin="anonymous" draggable={false} />
    </div>,
    document.body,
  )
})

export default DragGhost
