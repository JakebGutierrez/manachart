import { useSyncExternalStore } from 'react'

export type ShellLayout = 'docked' | 'drawer'

/**
 * The docked↔drawer breakpoint, in px. This constant is THE one place the
 * breakpoint lives (brief §2.a / §7.6 — owner tunable): all mode-dependent CSS
 * keys off the `data-layout` attribute this hook drives, never off its own
 * media query. Viewports narrower than this get the off-canvas drawer and a
 * full-width canvas (tablet portrait included); at or above it the sidebar
 * docks beside the canvas.
 */
export const LAYOUT_BREAKPOINT_PX = 900

// The 0.02px epsilon keeps a fractional viewport width from falling between a
// 899px boundary and a 900px one.
const DRAWER_QUERY = `(max-width: ${LAYOUT_BREAKPOINT_PX - 0.02}px)`

// One `change` listener for the whole app (the hook has a single consumer:
// App, which stamps the mode on the app root as data-layout="docked|drawer" —
// the contract every layout-dependent stylesheet selects on, and what tests
// assert). window.matchMedia is looked up per call, not cached, so tests can
// stub it; jsdom doesn't implement it at all, so absent matchMedia means
// docked — the mode the test suite assumes (tests stub it to force drawer).
function subscribe(onStoreChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(DRAWER_QUERY)
  mql.addEventListener('change', onStoreChange)
  return () => mql.removeEventListener('change', onStoreChange)
}

function getSnapshot(): ShellLayout {
  if (typeof window.matchMedia !== 'function') return 'docked'
  return window.matchMedia(DRAWER_QUERY).matches ? 'drawer' : 'docked'
}

// Server rendering has no viewport to measure; docked is the pre-hydration
// default (matches getSnapshot's no-matchMedia fallback, so a hydrating
// client only re-stamps if its viewport genuinely differs). The app is
// client-only today — this exists so useSyncExternalStore is SSR-correct
// rather than throwing "Missing getServerSnapshot" if that ever changes.
function getServerSnapshot(): ShellLayout {
  return 'docked'
}

export function useLayoutMode(): ShellLayout {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
