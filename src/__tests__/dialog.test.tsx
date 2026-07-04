// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRef } from 'react'
import Dialog from '@/components/Dialog'
import ConfirmDialog from '@/components/Dialog/ConfirmDialog'
import { renderComponent, act, click, buttonByText } from './harness'

// The dialog portals to #dialog-root under document.body, so queries go through
// document rather than the harness container. #root stands in for the app root
// that Dialog marks inert while open.
let appRoot: HTMLDivElement

beforeEach(() => {
  appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.appendChild(appRoot)
})

afterEach(() => {
  appRoot.remove()
})

const panel = () => document.querySelector<HTMLElement>('#dialog-root [role="dialog"]')

function pressKey(target: EventTarget, init: KeyboardEventInit) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  })
}

describe('Dialog', () => {
  it('portals into #dialog-root with dialog semantics and label', () => {
    const { unmount } = renderComponent(
      <Dialog label="Test dialog" onClose={() => {}}>
        <button type="button">Ok</button>
      </Dialog>,
    )
    try {
      const p = panel()
      expect(p).not.toBeNull()
      expect(p!.getAttribute('aria-modal')).toBe('true')
      expect(p!.getAttribute('aria-label')).toBe('Test dialog')
    } finally {
      unmount()
    }
  })

  it('marks the app root inert while open and lifts it on close', () => {
    const { unmount } = renderComponent(
      <Dialog label="d" onClose={() => {}}>
        <button type="button">Ok</button>
      </Dialog>,
    )
    expect(appRoot.hasAttribute('inert')).toBe(true)
    unmount()
    expect(appRoot.hasAttribute('inert')).toBe(false)
  })

  it('focuses the first focusable on open and restores the opener on close', () => {
    const opener = document.createElement('button')
    appRoot.appendChild(opener)
    act(() => opener.focus())

    const { unmount } = renderComponent(
      <Dialog label="d" onClose={() => {}}>
        <button type="button">First</button>
        <button type="button">Second</button>
      </Dialog>,
    )
    try {
      expect((document.activeElement as HTMLElement).textContent).toBe('First')
    } finally {
      unmount()
    }
    expect(document.activeElement).toBe(opener)
  })

  it('falls back to the app root when the opener disabled itself before close', () => {
    const opener = document.createElement('button')
    appRoot.appendChild(opener)
    act(() => opener.focus())

    const { unmount } = renderComponent(
      <Dialog label="d" onClose={() => {}}>
        <button type="button">Ok</button>
      </Dialog>,
    )
    // The confirmed action disabled its own opener (e.g. "Clear cards").
    opener.disabled = true
    unmount()

    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(appRoot)
  })

  it('falls back to the app root when the opener was removed before close', () => {
    const opener = document.createElement('button')
    appRoot.appendChild(opener)
    act(() => opener.focus())

    const { unmount } = renderComponent(
      <Dialog label="d" onClose={() => {}}>
        <button type="button">Ok</button>
      </Dialog>,
    )
    opener.remove()
    unmount()

    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(appRoot)
  })

  it('honours an explicit initialFocus ref', () => {
    function Wrapper() {
      const ref = useRef<HTMLButtonElement>(null)
      return (
        <Dialog label="d" onClose={() => {}} initialFocus={ref}>
          <button type="button">First</button>
          <button ref={ref} type="button">Target</button>
        </Dialog>
      )
    }
    const { unmount } = renderComponent(<Wrapper />)
    try {
      expect((document.activeElement as HTMLElement).textContent).toBe('Target')
    } finally {
      unmount()
    }
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    const { unmount } = renderComponent(
      <Dialog label="d" onClose={onClose}>
        <button type="button">Ok</button>
      </Dialog>,
    )
    try {
      pressKey(window, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      unmount()
    }
  })

  it('wraps Tab at the panel edges (fallback cycle)', () => {
    const { unmount } = renderComponent(
      <Dialog label="d" onClose={() => {}}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </Dialog>,
    )
    try {
      const buttons = [...panel()!.querySelectorAll('button')]
      const first = buttons[0]
      const last = buttons[buttons.length - 1]

      act(() => last.focus())
      pressKey(last, { key: 'Tab' })
      expect(document.activeElement).toBe(first)

      pressKey(first, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(last)
    } finally {
      unmount()
    }
  })

  it('closes on backdrop mousedown but not on mousedown inside the panel', () => {
    const onClose = vi.fn()
    const { unmount } = renderComponent(
      <Dialog label="d" onClose={onClose}>
        <button type="button">Ok</button>
      </Dialog>,
    )
    try {
      const inner = panel()!.querySelector('button')!
      act(() => {
        inner.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      })
      expect(onClose).not.toHaveBeenCalled()

      const backdrop = panel()!.parentElement!
      act(() => {
        backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      unmount()
    }
  })
})

describe('ConfirmDialog', () => {
  it('shows the message, focuses the confirm button, and resolves confirm and cancel', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { unmount } = renderComponent(
      <ConfirmDialog
        message="Clear everything?"
        confirmLabel="Clear"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    try {
      expect(panel()!.textContent).toContain('Clear everything?')
      // window.confirm parity: Enter activates the pre-focused confirm button.
      expect((document.activeElement as HTMLElement).textContent).toBe('Clear')

      click(buttonByText(panel()!, 'Clear'))
      expect(onConfirm).toHaveBeenCalledTimes(1)

      click(buttonByText(panel()!, 'Cancel'))
      expect(onCancel).toHaveBeenCalledTimes(1)
    } finally {
      unmount()
    }
  })

  it('cancels on Escape', () => {
    const onCancel = vi.fn()
    const { unmount } = renderComponent(
      <ConfirmDialog
        message="Sure?"
        confirmLabel="Do it"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    )
    try {
      pressKey(window, { key: 'Escape' })
      expect(onCancel).toHaveBeenCalledTimes(1)
    } finally {
      unmount()
    }
  })
})
