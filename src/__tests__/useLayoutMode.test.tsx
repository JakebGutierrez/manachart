// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { useLayoutMode, LAYOUT_BREAKPOINT_PX } from '@/hooks/useLayoutMode'
import { renderHook, act } from './harness'

// Controllable matchMedia stub: tests flip `matches` and fire the change
// listeners the way a real viewport crossing would.
function stubMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<EventListener>()
  const mql = {
    get matches() {
      return matches
    },
    media: '',
    addEventListener: (_type: string, cb: EventListener) => {
      listeners.add(cb)
    },
    removeEventListener: (_type: string, cb: EventListener) => {
      listeners.delete(cb)
    },
  } as unknown as MediaQueryList
  const factory = vi.fn(() => mql)
  vi.stubGlobal('matchMedia', factory)
  return {
    factory,
    setMatches(next: boolean) {
      matches = next
      act(() => {
        for (const cb of [...listeners]) cb(new Event('change'))
      })
    },
    get listenerCount() {
      return listeners.size
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useLayoutMode', () => {
  it('the breakpoint is 900px and lives in this one exported constant (§7.6)', () => {
    expect(LAYOUT_BREAKPOINT_PX).toBe(900)
  })

  it('queries matchMedia with the breakpoint constant', () => {
    const stub = stubMatchMedia(false)
    const { unmount } = renderHook(useLayoutMode)
    expect(stub.factory).toHaveBeenCalledWith(`(max-width: ${LAYOUT_BREAKPOINT_PX - 0.02}px)`)
    unmount()
  })

  it('returns docked when the drawer query does not match', () => {
    stubMatchMedia(false)
    const { result, unmount } = renderHook(useLayoutMode)
    expect(result.current).toBe('docked')
    unmount()
  })

  it('returns drawer when the drawer query matches', () => {
    stubMatchMedia(true)
    const { result, unmount } = renderHook(useLayoutMode)
    expect(result.current).toBe('drawer')
    unmount()
  })

  it('flips live when the viewport crosses the breakpoint', () => {
    const stub = stubMatchMedia(false)
    const { result, unmount } = renderHook(useLayoutMode)
    expect(result.current).toBe('docked')
    stub.setMatches(true)
    expect(result.current).toBe('drawer')
    stub.setMatches(false)
    expect(result.current).toBe('docked')
    unmount()
  })

  it('registers exactly one change listener and removes it on unmount', () => {
    const stub = stubMatchMedia(false)
    const { unmount } = renderHook(useLayoutMode)
    expect(stub.listenerCount).toBe(1)
    unmount()
    expect(stub.listenerCount).toBe(0)
  })

  it('falls back to docked when matchMedia is unavailable (jsdom)', () => {
    // No stub: jsdom has no window.matchMedia. This is the mode every
    // pre-existing app test implicitly renders in.
    expect(typeof window.matchMedia).toBe('undefined')
    const { result, unmount } = renderHook(useLayoutMode)
    expect(result.current).toBe('docked')
    unmount()
  })

  it('server-renders as docked (getServerSnapshot provided)', () => {
    // renderToString always takes useSyncExternalStore's server path, so this
    // throws "Missing getServerSnapshot" if the third argument is dropped.
    function Probe() {
      return <div data-layout={useLayoutMode()} />
    }
    // Even with a drawer-matching viewport stubbed, the server pass has no
    // viewport to consult and must render the docked default.
    stubMatchMedia(true)
    expect(renderToString(<Probe />)).toContain('data-layout="docked"')
  })
})
