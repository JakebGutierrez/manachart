// Layout probe: real-browser regression check for Phase 4's container-driven
// grid sizing — the one mechanic jsdom cannot judge (it computes no layout).
// This is the check that caught the original Phase 4 sizing bug, committed as
// a one-command probe.
//
//   npm run test:layout
//
// What it does: starts a vite dev server, then drives system headless Chrome
// across viewport widths 500/768/899/900/901/1280/1920 against
// scripts/layout-probe.html (which frames the real app same-origin and writes
// measurements into its <title>). Asserts, per width:
//   - no horizontal overflow on the document, the app root, or the grid area
//   - data-layout is 'drawer' below 900px and 'docked' at 900px and above
//     (the flip is exactly at LAYOUT_BREAKPOINT_PX)
//
// NOT part of `npm test` / the commit gate: it needs a Chrome/Chromium binary
// (set CHROME_BIN to override discovery) and real layout, which CI runners may
// lack. Run it manually — or wire it into CI where Chrome is guaranteed.
// Headless Chrome clamps window width to ~500px, hence the 500 floor; widths
// below that follow the same formula (grid = 100% of the canvas column).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 5199
const PROBE_URL = `http://localhost:${PORT}/scripts/layout-probe.html`
const WIDTHS = [500, 768, 899, 900, 901, 1280, 1920]
const BREAKPOINT = 900 // mirrors LAYOUT_BREAKPOINT_PX (asserted equal in layoutContract.test.ts)

function findChrome() {
  const absolute = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean)
  for (const p of absolute) if (existsSync(p)) return p
  for (const name of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    const found = spawnSync('which', [name], { encoding: 'utf8' })
    if (found.status === 0) return found.stdout.trim()
  }
  return null
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`vite dev server did not answer at ${url} within ${timeoutMs}ms`)
}

function measureAt(chrome, width, profileDir) {
  const args = [
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},900`,
    '--virtual-time-budget=8000',
    '--dump-dom',
    PROBE_URL,
  ]
  const run = spawnSync(chrome, args, { encoding: 'utf8', timeout: 60000 })
  if (run.status !== 0) {
    throw new Error(`Chrome exited ${run.status} at width ${width}: ${run.stderr?.slice(0, 400)}`)
  }
  const title = run.stdout.match(/<title>([^<]*)<\/title>/)?.[1]
  if (!title) throw new Error(`no <title> in dump at width ${width}`)
  const payload = JSON.parse(title.replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
  if (payload.pending) throw new Error(`probe page never reported at width ${width}`)
  if (payload.error) throw new Error(`probe at width ${width}: ${payload.error}`)
  return payload
}

const chrome = findChrome()
if (!chrome) {
  console.error(
    'layout-probe: no Chrome/Chromium binary found.\n' +
      'Install Google Chrome or set CHROME_BIN=/path/to/chrome and re-run npm run test:layout.',
  )
  process.exit(2)
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: join(import.meta.dirname, '..'),
  stdio: 'ignore',
})
const profileDir = mkdtempSync(join(tmpdir(), 'layout-probe-'))
let failures = 0

try {
  await waitForServer(PROBE_URL, 20000)
  console.log(`layout-probe: ${chrome}`)
  console.log('width  data-layout  overflow(doc/app/area)  grid-px')
  for (const width of WIDTHS) {
    const m = measureAt(chrome, width, profileDir)
    const problems = []
    const expected = width < BREAKPOINT ? 'drawer' : 'docked'
    if (m.dataLayout !== expected) problems.push(`data-layout=${m.dataLayout}, expected ${expected}`)
    if (m.docOverflowX) problems.push('document overflows horizontally')
    if (m.appOverflowX) problems.push('app root overflows horizontally')
    if (m.areaOverflowX) problems.push('grid area overflows horizontally')
    const overflow = `${m.docOverflowX}/${m.appOverflowX}/${m.areaOverflowX}`
    const mark = problems.length ? `FAIL  ${problems.join('; ')}` : 'ok'
    console.log(`${String(width).padEnd(6)} ${String(m.dataLayout).padEnd(12)} ${overflow.padEnd(23)} ${String(m.gridWidth).padEnd(7)} ${mark}`)
    failures += problems.length
  }
} catch (err) {
  console.error(`layout-probe: ${err.message}`)
  failures += 1
} finally {
  server.kill()
  rmSync(profileDir, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`layout-probe: FAILED (${failures} problem${failures === 1 ? '' : 's'})`)
  process.exit(1)
}
console.log('layout-probe: all widths clean — no horizontal overflow, flip at 900')
