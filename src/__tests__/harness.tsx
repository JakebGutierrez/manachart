// Minimal React render harness for tests (no @testing-library dependency).
// Uses react-dom/client + React's act so tests can drive real hooks/components
// and flush effects. NOT a test file itself (no .test/.spec in the name).
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export { act }

export interface HookHarness<T> {
  result: { current: T }
  unmount: () => void
}

// Render a hook in a probe component and expose its latest return value.
export function renderHook<T>(useHook: () => T): HookHarness<T> {
  const result: { current: T } = { current: undefined as unknown as T }
  function Probe() {
    result.current = useHook()
    return null
  }
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  act(() => {
    root.render(<Probe />)
  })
  return {
    result,
    unmount() {
      act(() => root.unmount())
    },
  }
}

export interface ComponentHarness {
  container: HTMLElement
  unmount: () => void
}

export function renderComponent(element: ReactElement): ComponentHarness {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  return {
    container,
    unmount() {
      act(() => root.unmount())
      container.remove()
    },
  }
}

// Flush pending microtasks + effects (e.g. an async reconstruction settling).
export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

// Set a controlled input's value the way the browser does, so React's onChange
// fires (native value setter + input event).
export function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

// Dispatch a real keydown on an element (bubbles so grid-scoped handlers catch it).
export function pressKey(el: Element, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  })
}

export function byAriaLabel<T extends Element = HTMLElement>(root: ParentNode, label: string): T {
  const el = root.querySelector<T>(`[aria-label="${label}"]`)
  if (!el) throw new Error(`No element with aria-label="${label}"`)
  return el
}

export function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const btn = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!btn) throw new Error(`No button with text "${text}"`)
  return btn
}
