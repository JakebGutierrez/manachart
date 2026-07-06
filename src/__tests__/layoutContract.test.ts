// Phase 4 layout contract: the docked↔drawer breakpoint lives ONLY in
// useLayoutMode.ts — stylesheets select on [data-layout=…], never on their own
// width media queries — and grid sizing is container-driven, never
// viewport-derived. jsdom can't compute layout, so this guards the contract at
// the source level: a reintroduced width query or viewport unit fails here.
//
// The stylesheets are read from disk: vitest's CSS pipeline replaces imported
// CSS with class-map stubs (even under ?raw), so fs is the only way to see the
// actual text. tsconfig.app deliberately omits @types/node (no node globals in
// app code); node-shim.d.ts types exactly the three builtin functions used here.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LAYOUT_BREAKPOINT_PX } from '@/hooks/useLayoutMode'

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT_DIR = join(SRC_DIR, '..')

const cssFiles = readdirSync(SRC_DIR, { recursive: true })
  .filter((p) => p.endsWith('.css'))
  .map((p) => ({ path: p, text: readFileSync(join(SRC_DIR, p), 'utf8') }))

// Media features that are legitimately capability queries, not layout-mode
// breakpoints.
const ALLOWED_MEDIA = [/prefers-reduced-motion/, /hover:\s*none/]

describe('layout contract', () => {
  it('found the stylesheets', () => {
    expect(cssFiles.length).toBeGreaterThan(5)
  })

  it('the docked↔drawer breakpoint is 900 (owner tunable, §7.6)', () => {
    expect(LAYOUT_BREAKPOINT_PX).toBe(900)
  })

  it('no stylesheet carries its own width breakpoint (the old 768px triplication)', () => {
    for (const { path, text } of cssFiles) {
      expect(text, `${path} mentions 768`).not.toMatch(/768/)
      const queries = [...text.matchAll(/@media\s*([^{]+)\{/g)].map((m) => m[1].trim())
      for (const q of queries) {
        expect(
          ALLOWED_MEDIA.some((allowed) => allowed.test(q)),
          `${path} has a media query outside the allowed list (layout modes must key off [data-layout]): @media ${q}`,
        ).toBe(true)
      }
    }
  })

  it('grid sizing is container-driven — no viewport units, no clamp floor', () => {
    const grid = cssFiles.find((f) => f.path.endsWith('Grid.module.css'))!
    expect(grid.text).not.toMatch(/\d(vw|vh)\b/)
    expect(grid.text).not.toMatch(/clamp\(/)
    // The grid fills a flexing, capped canvas column (§2.a): the column takes
    // a definite width (shrink-wrap would pin to the grid's preferred size and
    // overflow on phones) and the grid fills it up to the cap.
    expect(grid.text).toMatch(/width:\s*min\(100%,\s*900px\)/)
    expect(grid.text).toMatch(/max-width:\s*900px/)
  })

  it('drawer-mode CSS keys off the data-layout contract', () => {
    const panelCss = cssFiles.find((f) => f.path.endsWith('ControlPanel.module.css'))!
    expect(panelCss.text).toMatch(/\[data-layout='drawer'\]/)
    // Closed-drawer semantics: hidden from paint AND delayed so the slide-out shows.
    expect(panelCss.text).toMatch(/visibility:\s*hidden/)
    expect(panelCss.text).toMatch(/visibility 0s 0\.25s/)
  })

  it('the viewport meta opts into safe-area insets (viewport-fit=cover)', () => {
    const html = readFileSync(join(ROOT_DIR, 'index.html'), 'utf8')
    expect(html).toMatch(/viewport-fit=cover/)
  })
})
