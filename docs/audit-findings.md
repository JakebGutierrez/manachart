# Repository Audit — Findings (July 2026)

Senior-level audit of the live manachart.app deployment (static Vercel, auto-deploy on push to `main`). Read-only pass; nothing was changed. Companion to `docs/phase-22.5-findings.md` and follows its format: every line citation below was verified against the actual code in this session.

## Ground truth

All three gates pass clean on `main` (42b2b46):

```
npm run build  → tsc -b && vite build → ✓ 54 modules, built in 154ms
npm run lint   → eslint . → clean
npm run test   → vitest run → Test Files 17 passed (17) | Tests 143 passed (143)
```

**Stated up front:** `CLAUDE.md` is materially stale (it claims there are no tests and lists ten fully-implemented modules as "stubs"). The code and passing suite were treated as ground truth throughout; the drift itself is logged as finding F6.

Files read to verify: all of `src/` (every hook, util, component, CSS module, and the 17 test files), `index.html`, `package.json`, `vite.config.ts`, `tsconfig.app.json`, `eslint.config.js`, `.gitignore`, `public/`, `design/`, plus `ARCHITECTURE.md`, `CLAUDE.md`, `Mana_Chart_Roadmap_Phase18plus.md`, and `docs/phase-22.5-findings.md`.

---

## Findings (ordered by value: severity × leverage, cheap-and-important first)

### F1 — Lint and tests never run before a production deploy · **infra · S**

**Evidence.** There is no `.github/` directory — no CI of any kind. Vercel auto-deploys every push to `main`. One nuance that softens this: Vercel runs `npm run build` (`tsc -b && vite build`), and a failed build leaves the previous deployment live — so pure type errors cannot take the site down. But a change that type-checks while breaking tests or lint ships to production silently. This exact failure mode already happened once: Phase 18a existed because `main` sat with a red test suite. The suite is now 143 tests strong and is the only thing standing between the hardening work of Phase 22.5 and a regression.

**Recommendation.** Add `.github/workflows/ci.yml` running the existing scripts on push and PR to `main`: `npm ci`, `npm run build`, `npm run lint`, `npm run test` (Node 22, `actions/setup-node` with npm cache, concurrency-cancel). Effort is genuinely small — the scripts already exist and pass. Two levels of strictness, pick one:

- *Alarm (minimal):* CI on push. Doesn't block the Vercel deploy, but a red ✗ on the commit within ~a minute is most of the value for a solo-push workflow.
- *True gate (optional):* change the Vercel project's build command to `npm run lint && npm run test && npm run build` — then a failing test fails the deploy itself and production keeps the previous build. Costs build minutes; no new infra. Branch protection + PR flow is the conventional third option if the workflow ever grows past solo pushes.

No source changes; no test implications.

### F2 — Export resolution is coupled to the live viewport width · **correctness · M**

**Evidence.** Confirmed exactly as suspected, and it contradicts the repo's own architecture doc. [useExport.ts:132](../src/hooks/useExport.ts#L132) derives cell size from the DOM:

```ts
const gridClientWidth = gridRef.current.getBoundingClientRect().width
```

while the grid's width is viewport-driven — `width: clamp(400px, 70vw, 900px)` at [Grid.module.css:40](../src/components/Grid/Grid.module.css#L40), and `min(92vw, 900px)` under 768px ([Grid.module.css:45-52](../src/components/Grid/Grid.module.css#L45-L52)). Concretely, the same 5×5 chart at the same 2× setting exports:

- ≈ **1864px** wide on a desktop ≥1286px wide (grid clamps to 900),
- ≈ **1790px** on a 1280px window (70vw = 896),
- ≈ **754px** on a 375px phone (92vw = 345).

Mobile users get an export at roughly 40% of desktop resolution, re-exports are not reproducible across machines, and two people sharing the same chart link produce visibly different-quality PNGs. `ARCHITECTURE.md` (Export flow, Step 1) explicitly requires the opposite: *"Dimensions derived from chart config (not DOM measurements — must be deterministic)"*. The implementation comment at [useExport.ts:131](../src/hooks/useExport.ts#L131) ("Cell dims from DOM — matches what the user sees") documents the drift rather than resolving it.

**Recommendation.** Decouple export geometry from the DOM: a fixed logical cell width constant (e.g. `EXPORT_CELL_W = 240`; cellH derived as ×3/4 or ×1 by display mode), with everything downstream (gap, padding, sidebar, title) already in logical px as today. The existing preflight logic transfers unchanged — re-verify budgets: a 10×10 landscape grid at 240px cells and 2× is ≈ 4900px wide (fits desktop 8192); the iOS 3MP budget will trigger the existing 1×-downgrade path more often, which is exactly what it's for. `gridRef` then becomes unnecessary in `useExport` (remove the parameter — `noUnusedParameters` will enforce it). Pairs naturally with F8: extract the geometry into a pure `src/utils/exportGeometry.ts` and unit-test it. No schema change, no migration; the only user-visible effect is that exports become consistent (and better on mobile).

### F3 — Zero social/meta tags on a product whose whole point is sharing · **infra/QoL · S**

**Evidence.** [index.html](../index.html) contains a `<title>` and favicon and nothing else: no meta description, no Open Graph tags, no Twitter card, no `theme-color`, no `apple-touch-icon`; `public/` has no `robots.txt`. Pasting a manachart.app link (including a `?c=` share link) into Discord/Twitter/Slack renders a bare URL with no preview card — for a tool built around shareable links this is the single cheapest visibility fix in the repo.

**Recommendation.** Static tags in `index.html`: description, `og:title` / `og:description` / `og:image` / `og:url` / `og:type`, `twitter:card: summary_large_image`, `theme-color: #0b0c0e`, an `apple-touch-icon` PNG, plus a `robots.txt`. Ship a single branded 1200×630 `og-image.png` in `public/` (an attractive example chart is the obvious artwork). **Per-share OG images are not feasible purely statically** — crawlers don't execute JS, so the `?c=` payload can never influence a static tag. An `@vercel/og` edge function reading `?c=` could do it and would be genuinely great for this product, but it's the repo's first server-side code; logged in the ideas lane as conditional rather than recommended here.

### F4 — No `vercel.json`: no security headers, no cache policy · **infra · S**

**Evidence.** No `vercel.json` exists. The deployed site ships with Vercel's defaults: no CSP, no `X-Content-Type-Options`, no `Referrer-Policy`, and Vite's content-hashed `/assets/*` files are not marked `immutable` (Vercel only does that automatically for some frameworks). The app's external surface is well-defined — exactly two origins (`api.scryfall.com`, `cards.scryfall.io`) plus Google Fonts — which makes a tight CSP unusually cheap here.

**Recommendation.** Add `vercel.json` with:

- `Content-Security-Policy`: `default-src 'self'; script-src 'self'; connect-src 'self' https://api.scryfall.com https://cards.scryfall.io; img-src 'self' data: blob: https://cards.scryfall.io; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'` — notes: `'unsafe-inline'` for styles is required (chart style values are applied as React inline styles by design, per CLAUDE.md); `blob:`/`data:` in `img-src` are required by the export pipeline and custom slots. If F5 (self-hosted fonts) lands first, drop both Google hosts.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a minimal `Permissions-Policy`.
- `Cache-Control: public, max-age=31536000, immutable` for `/assets/*`.

Verify on a preview deployment before production — a mis-scoped CSP would break export (blob fetch) or custom uploads (data URLs), which is exactly why those directives are spelled out above.

### F5 — Fonts load from Google's CDN; canvas export depends on it · **robustness · S–M**

**Evidence.** [index.html:8-10](../index.html#L8-L10) loads five families (Cinzel, Cormorant Garamond, Uncial Antiqua, Inter, Comic Neue) via a render-blocking Google Fonts stylesheet. Three concrete costs: (1) third-party availability — [useExport.ts:248-250](../src/hooks/useExport.ts#L248-L250) calls `document.fonts.load()` for the selected title font at export time; if the stylesheet loaded but the woff2 fetch fails then, `FontFaceSet.load` **rejects**, the outer catch fires, and the export aborts with a raw network-error message; if the stylesheet never loaded, the export silently draws in the fallback font. (2) Privacy: every visitor's IP goes to fonts.gstatic.com (this has GDPR case-law attached in the EU). (3) Render-blocking third-party CSS on first paint. All five families are SIL OFL — the Phase 22 selection was made deliberately so bundling is legal, and the roadmap's own phrasing ("self-hosted or via Google Fonts") left the door open.

**Recommendation.** Self-host via `@fontsource`: add the five packages as dependencies, import the needed weights in `main.tsx` (Cinzel 400/700, Cormorant Garamond 400/700, Uncial Antiqua 400, Inter 400/600/700, Comic Neue 400/700 — ~10 latin-subset woff2 files, each 15–80KB, hashed into `/assets/` and covered by F4's immutable caching; `unicode-range` means browsers only fetch what they render), delete the three `<link>` tags. Independently of hosting, wrap the `document.fonts.load()` call in a try/catch that falls back to the default font instead of failing the whole export. Test implication: none for the suite (jsdom doesn't load fonts); verify visually that the picker and export render identically.

### F6 — `CLAUDE.md` is materially stale; `ARCHITECTURE.md` has two drifted sections · **hygiene · S**

**Evidence.** `CLAUDE.md` is injected into every agent session, and today it actively misleads:

- "There are no tests yet. `npm run build && npm run lint` is the full correctness gate" — there are 143 tests in 17 files, `npm run test` exists in [package.json](../package.json), and the roadmap *requires* the suite green from Phase 18 onward.
- The "What is not built yet (stubs only)" section lists `useCharts`, `useScryfall`, `useExport`, `scryfall.ts`, `imageBlob.ts`, `schemaVersion.ts`, `SearchPanel`, `ContextMenu`, `NameDisplay`, `PrintingSwitcher` — all ten are fully implemented and load-bearing.
- "State: `App.tsx` owns `useState<Chart>`" — state is `useCharts` (localStorage-persisted multi-chart with share-link reconstruction) plus a history stack in App; the "reach for useReducer when a second write site appears" advice is years of phases out of date.
- "`schemaVersion: 1` is present from day one" reads as current; `CURRENT_SCHEMA_VERSION` is 4 ([schemaVersion.ts:3](../src/utils/schemaVersion.ts#L3)) with three shipped migrations. The `Chart` summary also omits `heroConfig` and `titleFont`.

`ARCHITECTURE.md` drift (smaller, but one of them matters): the export section mandates config-derived deterministic dimensions while the code measures the DOM — that's F2, and whichever way F2 is resolved, doc and code must agree again. The "Grid resize guard" section describes position-based shrink *blocking*, while the shipped behaviour recompacts slots on shrink ([App.tsx:258-264](../src/App.tsx#L258-L264), deliberate per 22.5 bucket D). Also at root: `MTG_Chart_Claude_Code_Handover.md` is the pre-build spec, fully superseded by the roadmap — move to `docs/` or delete.

**Recommendation.** Rewrite `CLAUDE.md` against current reality (test gate included; delete the stubs section; describe `useCharts`/history state ownership; current schema version and migration rule stands). Patch the two `ARCHITECTURE.md` sections when F2 lands. Pure docs; no build/test implications.

### F7 — `README.md` is the stock Vite template · **hygiene · S**

**Evidence.** [README.md](../README.md) is the unmodified `create-vite` boilerplate ("This template provides a minimal setup…") — on the public repo behind a live domain, it's the front door and says nothing about the product.

**Recommendation.** Short real README: what it is (Topster-style MTG collage builder), screenshot, link to manachart.app, feature list, dev commands (`dev`/`build`/`lint`/`test`), the Scryfall/WotC attribution line (mirroring the in-app disclaimer from Phase 19), and a license statement (the repo currently has **no license file** — worth an explicit decision while touching this).

### F8 — `useExport` has zero tests; pure geometry is trapped in the hook · **robustness · M**

**Evidence.** [useExport.ts](../src/hooks/useExport.ts) is the largest, most side-effect-heavy module (404 lines) and the only major subsystem with no coverage at all. Four pure, high-value functions are module-private and untestable as-is:

- `drawCoverCrop` ([:63-89](../src/hooks/useExport.ts#L63-L89)) — the cover-crop math, now extended beyond ARCHITECTURE.md's formula with `cropX/cropY/cropScale`; the `sx/sy` interaction between crop offset and zoom is exactly the kind of arithmetic a regression slips into unnoticed.
- `fitsAt` / scale-downgrade ([:161-175](../src/hooks/useExport.ts#L161-L175)) — the iOS-vs-desktop pixel-budget branch; becomes *more* load-bearing after F2.
- `measureSidebarWidth` ([:37-43](../src/hooks/useExport.ts#L37-L43)) and `fillTextTruncated` ([:45-61](../src/hooks/useExport.ts#L45-L61)) — testable with a stubbed `measureText`.
- The sidebar hero-row grouping ([:327-374](../src/hooks/useExport.ts#L327-L374)) is the subtlest layout logic in the file and only exercised by hand.

Other gaps while in the area: **`src/utils/sort.ts` has no test file** (pure `sortSlots`/`shuffleSlots` — type/CMC/colour bucketing is trivially testable and feeds a user-facing button); `useScryfall`'s debounce/supersede logic and `useImport`'s `runLoop` are untested (both verified correct by reading — see F13 — but they're the two remaining async state machines relying on review alone; the existing `harness.tsx` + fake timers covers them).

**Recommendation.** Do the extraction as part of F2: move geometry into `src/utils/exportGeometry.ts` (layout computation, cover-crop source-rect math as a pure function returning `{sx, sy, sw, sh}`, `fitsAt`, truncation) and unit-test each; the hook keeps fetching/canvas/download. Add `sort.test.ts` independently (S, any time). The `@/` alias and no-unused-symbols constraints are satisfied naturally since the hook becomes the caller of everything extracted.

### F9 — Touch users can't reach core interactions · **QoL · S–M**

**Evidence.** Three distinct gaps, all verified:

1. The per-cell remove/printing/flip buttons are `opacity: 0` revealed only by `:hover`/`:focus-visible` ([Grid.module.css:93-96](../src/components/Grid/Grid.module.css#L93-L96), [:123-126](../src/components/Grid/Grid.module.css#L123-L126), [:153-156](../src/components/Grid/Grid.module.css#L153-L156)). Touch devices have no hover, so on a phone these controls are invisible (though still present as invisible 20px tap targets). The artist strip already solved this pattern — it also reveals on `.cellSelected` ([:188-191](../src/components/Grid/Grid.module.css#L188-L191)); the buttons don't.
2. The crop editor is wired to mouse events only ([ControlPanel/index.tsx:180-219](../src/components/ControlPanel/index.tsx#L180-L219): `onMouseDown` + window `mousemove`/`mouseup`) — crop repositioning is impossible on touch; only the zoom slider works.
3. Grid reordering and search-result drag use HTML5 drag-and-drop, which doesn't fire on touch. Mitigating: select-then-fill (Phase 21) gives mobile a tap path for *adding* cards; there is no touch path for *moving* them.

**Recommendation.** (1) is a two-line CSS fix — add `.cellSelected .removeBtn` (etc.) alongside the hover selectors; ship any time. (2) convert the crop drag to Pointer Events (`onPointerDown` + `setPointerCapture`, `touch-action: none` on the preview) — small, self-contained, and removes the mouse/touch fork entirely. (3) belongs in Phase 23's designed mobile layout (a tap-to-swap mode is the likely shape); don't bolt it on before then.

### F10 — `design/` is 1.6MB (~77% of repo language stats); history already carries it · **hygiene · S**

**Evidence.** `design/` holds a 1.17MB screenshot and a 436KB HTML mockup, both committed in the initial commit (`ffd5847`) — so the pack (`.git` is 5.6MB) already contains them permanently. That kills the "gitignore it to shrink clones" option: removing the files now stops future working-tree weight but doesn't shrink clones without a history rewrite, which is not worth the disruption on a live repo. The GitHub "77% HTML" label comes from linguist counting the mockup.

**Recommendation.** Cheapest correct fix: add a `.gitattributes` with `design/** linguist-vendored` — the language stats become honest (TypeScript-dominant) with zero deletion risk. Optionally also `git rm` the mockup if it's no longer a working reference (the screenshot arguably belongs in the README per F7 — a downscaled copy, not the 1.2MB original). Explicitly recommend **against** history rewriting.

### F11 — Accessibility: the two big items remain open (by plan); three cheap wins needn't wait · **QoL · S standalone / M in Phase 23**

**Evidence.** The 47 existing aria/role/alt attributes are real and mostly well-placed (steppers, remove/flip buttons, radiogroups, banners with `role="alert"`/`status`). What's still missing, verified:

- **Grid keyboard operability (22.5's A4)** — cells are `<div>`s with `onClick`/`draggable`, no `tabIndex`, `role`, or key handlers ([Grid/index.tsx:145-199](../src/components/Grid/index.tsx#L145-L199)). Unchanged since the 22.5 audit; deliberately deferred to Phase 23. Confirmed still open.
- **Modal focus management (A5)** — `PrintingSwitcher` has no `role="dialog"`/`aria-modal` at all ([PrintingSwitcher/index.tsx:69-76](../src/components/PrintingSwitcher/index.tsx#L69-L76)); `ImportModal` has the role ([ImportModal/index.tsx:64](../src/components/ImportModal/index.tsx#L64)) but no focus trap or focus-restore. Escape works in both. Also deferred to 23.
- `<progress>` in the import modal has no accessible name ([ImportModal/index.tsx:116-120](../src/components/ImportModal/index.tsx#L116-L120)).
- No `prefers-reduced-motion` handling anywhere in `src/**/*.css` — though honestly the only real *motion* is the 0.25s mobile-drawer transform ([ControlPanel.module.css:22](../src/components/ControlPanel/ControlPanel.module.css#L22)); everything else is sub-200ms opacity/colour fades. Near-trivial severity.

**Recommendation.** Keep A4/A5 in Phase 23 as planned (the surfaces are being rebuilt; doing traps twice is waste). Ship now as standalone S: `role="dialog" aria-modal="true" aria-label` on PrintingSwitcher, `aria-label="Import progress"` on the `<progress>`, and one `@media (prefers-reduced-motion: reduce)` block zeroing the drawer transition. Plus F9's `.cellSelected` button reveal, which doubles as an a11y win for touch.

### F12 — Small robustness nits · **robustness · S**

- **`URL.revokeObjectURL` immediately after `a.click()`** ([useExport.ts:384-390](../src/hooks/useExport.ts#L384-L390)): Safari has a history of intermittently aborting downloads whose blob URL is revoked synchronously. Defer the revoke (`setTimeout(..., 1000)` or next task). One line.
- **Silent copy-link failure** ([ControlPanel/index.tsx:323](../src/components/ControlPanel/index.tsx#L323)): `onCopyLink().then(...).catch(() => {})` — if the clipboard write is denied the button gives no feedback at all (never flips to "Copied!", never explains). Show a transient "Copy failed" state in the same slot.
- **`App.tsx:141`** hardcodes `h.future.slice(0, 49)` while the past side uses `pushPast`/`HISTORY_CAP`. Cosmetic consistency; fold into any App touch.
- **`buildImportUrl` doesn't URL-encode `setCode`/`collectorNumber`** ([scryfall.ts:22-30](../src/utils/scryfall.ts#L22-L30)) — *currently safe*: both values only ever arrive via the decklist parser, whose regexes restrict them to `[A-Za-z0-9-]`. Logged as defense-in-depth only; becomes real if the function ever gets a second caller.

### F13 — Leads investigated and confirmed **non-issues**

Explicitly closing out the remaining leads from the brief — these were checked, not assumed:

- **`useScryfall` debounce/abort/supersede** ([useScryfall.ts](../src/hooks/useScryfall.ts)): correct, including the subtle race where a response resolves inside the debounce window — the synchronously-updated `latestQueryRef` plus the `'\0'` cleanup sentinel close it. 429/404/error paths all set terminal state properly.
- **`fetchAllPrintings` pagination** ([scryfall.ts:195-231](../src/utils/scryfall.ts#L195-L231)): follows `has_more`/`next_page`, bounded at 5 pages with inter-page delay, typed rate-limit error, truncation surfaced in the modal ([PrintingSwitcher/index.tsx:117-121](../src/components/PrintingSwitcher/index.tsx#L117-L121)). 22.5's A3 is genuinely fixed.
- **Share-link round trip**, all requested edge cases: *empty chart* — `s: []` reconstructs instantly with no fetch; *hero/partner layouts* — slots are logical-slot-indexed on both encode and decode, `heroConfig` sanitized, stub array capped to real capacity ([useCharts.ts:240-254](../src/hooks/useCharts.ts#L240-L254)); *multi-face* — `f` clamped against the reconstructed card's actual face count ([shareLink.ts:169-183](../src/utils/shareLink.ts#L169-L183), B8 fixed); *oversized grids* — `clampGridDim` to 1–10 on every decode path; *malformed payloads* — shape-validated with distinct error messages, legacy fallback intact, unknown `v` handled. 429 during reconstruction honours `Retry-After` with bounded backoff ([reconstruct.ts:46-72](../src/utils/reconstruct.ts#L46-L72)). The failed-share placeholder persistence/claim semantics are covered by dedicated tests (`failedShare.persist.test.tsx`).
- **`useImport`**: generation-counter cancellation is airtight (checked at every await point), per-run dedupe cache, rate-limit retry keeps permanent failures in the tally, hybrid expansion derives indices from the cellMap (B9 fixed, tested in `importLayout.test.ts`), and the set+collector path verifies the returned card name so typos fail visibly.
- **Preview-vs-export drift beyond resolution**: nothing new of substance. Verified matches: overlay name metrics (export `20 + 11×1.5 + 5` exactly equals the CSS `padding: 20px 6px 5px` + 11px text), sidebar width bounds (120/200 in both), sidebar font/line-height, cover-crop math ≡ `object-fit: cover` + `object-position` + scale transform. Remaining known deltas, all cosmetic and previously adjudicated: sidebar hero-row grouping (22.5's B11, deferred), hero cells off-by-gap in the DOM preview (documented at [Grid/index.tsx:152-160](../src/components/Grid/index.tsx#L152-L160)), and title `letter-spacing: 0.02em`/line-height not replicated in canvas (sub-pixel league). The hover-only artist strip is a UI affordance, not chart content, so its absence from the export is correct — though see idea I6 for making attribution part of the export deliberately.
- **Export blob fetching is sequential with no cache** — true, unchanged, and already adjudicated as deferred (22.5's B10). Status quo confirmed, not re-litigated.

---

## Ideas & opportunities (speculative)

> **This section is not a defect list.** Everything here is optional product thinking, kept deliberately separate from the findings above. Roadmap-aware: nothing below re-proposes Phases 18–23 content or the explicitly-dropped items (backend/accounts/cloud sync, 300 DPI export), and nothing routes around them.

### Recommended, ranked by value-for-effort

**I1 — "Copy image" to clipboard · S.** A `Copy PNG` button beside Export using `ClipboardItem` with the same blob the download path already produces. Pasting directly into Discord is *the* dominant sharing flow in MTG communities — this turns export from a three-step save-locate-drag into one click. Feature-detect (`navigator.clipboard.write`), keep download as fallback; Safari needs the promise-form `ClipboardItem` constructor. Perfect static-site fit; touches only `useExport`'s final step.

**I2 — Web Share API on mobile · S.** `navigator.share({ files: [pngFile] })` for the export and `navigator.share({ url })` for share links, shown only where supported. Mobile users currently get a bare download and a clipboard write; the native share sheet (→ Discord, Messages, socials) is strictly better on every phone. Zero desktop impact (feature-detected). Pairs with I1 into one small "shareability" phase.

**I3 — Duplicate chart · S.** One button in the chart picker cloning the active chart under a new id/name. Iterating variants ("cube chart v2", "same deck, square mode") currently means rebuilding or mutating the original. Trivially additive to `useCharts` (`createChart` variant seeded from a chart), no schema change. Conspicuously absent for how cheap it is.

**I4 — Surface Scryfall search syntax · S.** `buildSearchUrl` already passes the raw query through, so `t:dragon set:ktk`, `art:mountain`, `is:borderless` all work *today* — invisibly. A placeholder hint ("Search cards… supports Scryfall syntax") or a one-line helper under the input unlocks the whole Scryfall query language for zero implementation cost. The kind of feature power users tell friends about.

**I5 — Paste image (Cmd+V) for custom slots · S.** A window-level `paste` handler feeding the existing `CustomSlot` path (same validation as the file input, target = selected-else-first-empty, same as search fill). Screenshot-to-slot without a save-to-disk round trip. Small; main design decision is label derivation (no filename — "Pasted image N").

**I6 — Deck-stats footer in the export (opt-in) · M.** `cmc`, `colors`, and `typeLine` are already stored on every `ScryfallSlot` (they power sort). An optional footer strip in the export — colour pips, a small mana curve, card count — would make Mana Chart output instantly recognisable next to a generic Topsters grid, and it's all data already in hand. Could also carry an "art: <artists>" credit line, extending Phase 19's attribution into the shared artifact itself. Trade-offs: a new preview-vs-export parity surface (build it *after* F2's deterministic geometry, render it in both DOM and canvas), and real design care to avoid clutter — strictly opt-in, default off.

**I7 — Fixed-size export presets · M.** Natural follow-on of F2: once resolution is deterministic, replace raw 1×/2× with named presets ("Standard 1600px", "Large 3200px", maybe "Square 1080" for IG). Trade-off: preset proliferation and letterbox/crop decisions for aspect-mismatched presets — keep it to 2–3 width presets and skip aspect-forcing entirely at first.

### Conditional — worth it only under stated conditions

**I8 — Per-share OG images via an edge function · M.** `@vercel/og` rendering a card-grid preview from the `?c=` payload would make shared links dramatically richer — arguably the highest-shareability idea here. Condition: it's the repo's first server-side code, and the static-only stance is an explicit constraint. ARCHITECTURE.md already blesses a single Vercel function as the CORS contingency, so the precedent isn't zero — but do static OG (F3) first, and only revisit if real share-link traffic materialises.

**I9 — Vercel Web Analytics · S.** One script tag; answers "does anyone use share links / import / export?" which currently has zero signal and would better prioritise everything else in this report. Condition: owner's comfort with any analytics on a hobby tool; Vercel's is cookie-less, which helps.

**I10 — PWA manifest (installable, no offline) · S.** A `manifest.webmanifest` + icons makes the app installable to a phone home screen — cheap and pleasant. Deliberately *without* a service worker (see rejected R2). Condition: only worth it after Phase 23 makes mobile genuinely good.

**I11 — IndexedDB for custom images · M.** Custom slots store full base64 data URLs in localStorage (~5MB cap shared with everything). The 22.5 storage-error banner handles overflow gracefully, so this is not urgent. Condition: implement only if storage-full reports actually occur; the migration (charts referencing image ids in IDB) is real work and complicates share/export paths.

### Considered and recommended against

- **R1 — Moxfield/Archidekt URL import.** Their APIs are unofficial, CORS-restricted from browsers, and ToS-grey. The decklist paste path already accepts every major exporter's text output — the URL nicety isn't worth building on sand. If demand appears, a "how to export from Moxfield" hint in the import modal costs nothing.
- **R2 — Full offline PWA (service worker).** Cache-invalidation complexity and stale-asset debugging for an app whose core content (Scryfall art) is remote anyway. localStorage already preserves user data. The manifest-only slice (I10) captures most of the perceived value.
- **R3 — Client-side art upscaling.** Shipping an upscaler (wasm/ML) to compensate for `art_crop` resolution contradicts the documented, accepted MVP tradeoff and would balloon the bundle. The `normal` URIs are already stored for the post-MVP framing path — that's the sanctioned quality lever.
- **R4 — Light theme.** The dark canvas is the product's visual identity; the chart's own background is already per-chart configurable, which covers the actual user need (light *exports*). A theme system is a permanent CSS tax for near-zero demand.
- **R5 — Price/legality overlays.** Prices drift daily and legality is format-relative; both rot instantly in a static shared image and fight the "art collage" identity. Scryfall links per card (context menu) would be the tasteful ceiling if ever wanted.
- **R6 — Backend anything / 300 DPI.** Already ruled out in the roadmap; nothing found in this audit changes that calculus. Concur — the failure modes this repo has actually hit (storage, rate limits, share-link robustness) were all solved client-side in 22.5.

---

## Suggested phasing

Sequenced for the repo's one-phase-at-a-time flow. A/B/C are small enough to each be a single reviewable phase; none blocks another, but this order front-loads the live-site risk reduction:

1. **Phase A — Ship-safety & front door (all S, no `src/` changes):** F1 CI workflow, F4 `vercel.json` (Google Fonts hosts included for now), F3 static OG/meta + og-image, F7 README (+license decision), F6 CLAUDE.md rewrite + handover-doc move, F10 `.gitattributes`. One sitting; verify headers/CSP on a preview deploy before merging.
2. **Phase B — Export determinism (the correctness core):** F2 fixed-resolution geometry + F8 extraction into `exportGeometry.ts` with unit tests (cover-crop, fitsAt budgets, truncation, sidebar measure) + F12's revoke-timing and copy-feedback nits + `sort.test.ts`. Update ARCHITECTURE.md's export section to match (closing that half of F6). This is the one phase that changes user-visible output — exports get consistent and mobile exports get sharper; call it out in the summary.
3. **Phase C — Fonts self-host:** F5 `@fontsource` migration + `fonts.load` failure guard, then tighten the F4 CSP (drop Google hosts).
4. **Phase D — Shareability (promoted from ideas):** I1 clipboard copy + I2 Web Share + I3 duplicate chart + I4 search-syntax hint. Four S items with one theme; the highest product-value-per-line-of-code in this report.
5. **Phase 23 (as planned)** absorbs A4/A5 keyboard+focus work and F9's drag-on-touch; F9's two cheap slices (`.cellSelected` button reveal, pointer-events crop) plus F11's standalone attrs (dialog role, progress label, reduced-motion) can ship any time before it as a half-day standalone if 23 is far off.
6. **Later / on evidence:** I6 stats footer and I7 presets after B settles; I8 per-share OG only if link traffic justifies revisiting the static-only stance; I9/I10/I11 per their stated conditions.

*End of report. No changes were made in this session; awaiting review before any fix phase begins.*
