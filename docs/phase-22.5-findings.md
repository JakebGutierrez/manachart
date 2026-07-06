> **Historical record — do not act on this file.** This adjudication predates the
> hardening phases and the UI overhaul. Buckets A and B were subsequently fixed
> (quota-safe persistence, decode sanitization, printings pagination, keyboard
> grid, the Dialog primitive, deferred `?c=` strip + retry, debounced persistence,
> editable-target undo guard, edit-burst coalescing, face-index clamps, hybrid
> import expansion, …) — except B10 (sequential export prefetch) and B11 (sidebar
> grouping in hero layouts), now tracked in [tech-debt.md](tech-debt.md) (G3 and
> C7 respectively). Bucket D items are deliberate keeps. Verify against current
> source before acting on anything here.

I've now verified both reviews against the actual code. Every line-number citation in both reviews checked out — no hallucinated locations in either. Here's the adjudication.

Step 1 — Ground truth
All three gates pass clean (matching what both reviews reported):


npm run build  → tsc -b && vite build → ✓ 48 modules, built in 109ms, no errors
npm run lint   → eslint . → clean, no output
npx vitest run → Test Files 6 passed (6) | Tests 68 passed (68)
Source files I read to verify: useCharts.ts, App.tsx, shareLink.ts, chartShape.ts, useImport.ts, cellMap.ts, decklistParser.ts, useExport.ts, scryfall.ts, useScryfall.ts, Grid/index.tsx, PrintingSwitcher/index.tsx, SearchPanel/index.tsx, NameDisplay/index.tsx, ImportModal/index.tsx, ControlPanel/index.tsx (crop/color handlers), chart.ts, defaultChart.ts, main.tsx, plus Mana_Chart_Roadmap_Phase18plus.md and CLAUDE.md. Confirmed by grep: no error boundary exists anywhere in src/.

Steps 2 & 3 — Verified findings, by bucket
Bucket A — Confirmed real, BOTH reviews caught it (highest signal)
#	Finding	Verification
A1	localStorage quota overflow is uncaught → blank-screen crash (Claude #3 / Codex #3)	Confirmed. useCharts.ts:15-18 persist() has no try/catch; called from the effect at useCharts.ts:237-240. Custom uploads embed full base64 data URLs (SearchPanel/index.tsx:30-39). No error boundary in main.tsx. A throw from the effect crashes the tree.
A2	Share links accept unbounded grid dimensions → freeze/OOM (Claude #6 / Codex #1)	Confirmed. shareLink.ts:98-99 checks >= 1 integer, no upper bound. Legacy chartShape.ts:25-26 is weaker (only typeof === 'number'). In-app resize is clamped to 10 (App.tsx:222); links bypass it.
A3	Printing switcher ignores has_more pagination (Claude #8 / Codex #6)	Confirmed. PrintingSwitcher/index.tsx:39-44 reads only data.data. Scryfall caps a page at 175; high-printing cards (basics, Sol Ring) silently truncate. (Claude also notes search at useScryfall.ts:76-80 — lower impact.)
A4	Grid cells not keyboard-operable (Claude #11 / Codex #9)	Confirmed. Cells are <div> with onClick/draggable, no role/tabIndex/key handler (Grid/index.tsx:144-200). Per-cell remove/printing/flip are real <button>s.
A5	Modals not focus-trapped / missing dialog semantics (Claude #12 / Codex #10)	Confirmed. ImportModal has role="dialog" aria-modal (ImportModal/index.tsx:64) but no trap/restore. PrintingSwitcher has no dialog role at all (PrintingSwitcher/index.tsx:80-87). Escape-to-close works in both.
Bucket B — Confirmed real, only ONE review caught it
#	Finding	Verification
B1	?c= is stripped before reconstruction succeeds; placeholder deleted on transient failure (Claude #1)	Confirmed. The strip effect useCharts.ts:135-141 and the reconstruct effect useCharts.ts:146-232 both run on mount; the URL is cleared immediately, then a 429/network blip throws (:170) and the catch deletes the placeholder (:204-226). Mitigating: persist is suppressed during isReconstructing (:238), so the user's existing charts survive — the loss is the shared chart + the URL.
B2	Persistence is synchronous & unthrottled on hot paths (Claude #2)	Confirmed. handleCropLive fires on every mousemove (ControlPanel/index.tsx:192-204 → App.tsx:364-376) → setState → full-array JSON.stringify to localStorage every frame. Same for title keystrokes and the <input type="color"> onChange stream.
B3	Cmd/Ctrl+Z hijacked inside text inputs (Claude #4)	Confirmed. The global handler App.tsx:136-154 only guards importActive; no e.target check, so Cmd+Z in the title/rename/search fields runs chart-undo + preventDefault(). (In-app face/print toggles are guarded, but text-input undo is not.)
B4	Title/color edits flood undo history (Claude #5)	Confirmed. handleTitleChange/handleBgColorChange route through updateChartWithHistory (App.tsx:239-274), one snapshot per keystroke/drag delta, vs. the 50-entry cap. Crop drag got special single-snapshot handling; title/color did not.
B5	Reconstruction treats 429 as fatal, fires chunks back-to-back (Claude #9)	Confirmed. useCharts.ts:162-178 loops /cards/collection in 75-id chunks with no delay; any !res.ok throws and feeds B1.
B6	Decklist parser drops bare-name lines & capital-X (Claude #10)	Confirmed. /^(\d+)[x]?\s+(.+)$/ (decklistParser.ts:25) requires a leading quantity, so plain name-per-line lists yield zero entries, and 4X Lightning Bolt fails ([x] is lowercase-only) — both silently, no feedback.
B7	backgroundColor from share link applied unvalidated (Claude #7; partially in Codex's "style values")	Confirmed. Passed straight through (shareLink.ts:72,103), rendered as background: <value> (Grid/index.tsx:104). Not XSS, but a url(https://attacker/…) value would issue a network request when a victim opens the link.
B8	Invalid face index crashes render/export; weak isSlotShaped (Codex #2)	Confirmed — and this one corrects a Claude error (see Bucket C). isSharePayloadShaped only checks f ∈ {0,1} (shareLink.ts:122); reconstructSlots applies it blindly (:175). A tampered link with f:1 on a single-face card → render reads imageUris[1].artCrop (Grid/index.tsx:203) / export (useExport.ts:196) → TypeError → blank screen. isSlotShaped (chartShape.ts:5-6) accepts any imageUris array, even empty. In-app paths are guarded, so this only fires via tampered link/storage.
B9	Auto-expand import misplaces cards in commander/partner layouts (Codex #4)	Confirmed — strong catch. proceedExpand computes added indices from gridRows*gridCols (useImport.ts:261-265), but hybrid cellMaps use compact non-covered indices. Worked example: 5×5 commander has 22 slots (0–21); expanding adds row-5 cells that the cellMap indexes 22–26, but the code generates [25,26,27,28,29] → cards land in wrong cells and indices 27–29 never render → "missing." Uniform layouts are unaffected.
B10	PNG export fetches images sequentially, no blob cache (Codex #7)	Confirmed. useExport.ts:188-224 awaits each fetchAsBlob/loadImage one at a time; repeated exports re-download. Real perf cost, low priority for typical small charts.
B11	Sidebar names disagree between DOM and PNG in hero layouts (Codex #8)	Confirmed. Live sidebar groups per visual row (NameDisplay/index.tsx:32-41); export folds hero-spanned rows into one origin block (useExport.ts:320-348). Same names, different vertical grouping — cosmetic, hero-layout-only.
B12	Custom-slot loadImage unguarded vs. Scryfall 404 recovery (Claude, low)	Confirmed. useExport.ts:192 has no try/catch; a corrupt data URL fails the whole export. <progress> lacks an accessible label (ImportModal/index.tsx:109-113). Both low.
Bucket C — Wrong / already handled
Claude's "well done: share-link face indexing is guarded" is inaccurate. Claude listed f validated to 0/1 as proof of safety; Codex correctly shows 0/1 validation does not guarantee the reconstructed card actually has face 1 (single-face cards have only index 0). Codex (B8) is right; Claude's reassurance is the false claim here. Worth calling out so B8 isn't dismissed.
Otherwise no hallucinated findings in either review — line numbers and behavior descriptions were accurate throughout.
Bucket D — Real behavior, deliberate tradeoff (do not "fix")
Shrink recompacts/reorders the collage (Codex #5) — explicitly commented as intentional at App.tsx:216-217; Codex itself hedged. Leave as-is (could add a confirm later if desired).
No Scryfall query cache; printing modal refetches each open (Codex #11) — MVP simplicity; Codex hedged. Fine.
Custom slots omitted from share links — surfaced to the user; intentional.
Two-key non-atomic localStorage write — commented recovery path (useCharts.ts:12-14).
Hero cells off-by-gap in DOM preview — documented; export computes spans correctly (Grid/index.tsx:155-160).
updateChartWithHistory runs the updater twice — assumes pure updaters; shuffleSlots is impure but harmless. Worth a one-line comment, not a fix.
selectedFaceIndex: 0 | 1 can't represent 3+-face art_series cards — a baked-in type/schema limitation, not a defect. Only widen if 3+-face support becomes a goal.
History session-only, title weight 600 synthesized (matches DOM), crypto.randomUUID secure-context requirement — all fine for this app/deployment.
Bucket E — Pure style/preference
Codex already declined naming/CSS/import-order/README. Nothing actionable. Agreed.
Step 4 — Severity / effort / timing (A & B)
Phase 23 reworks the control panel + grid UI surface and modals; it does not touch the share-codec, persistence, import, or parser logic. So data/logic fixes are independent of the overhaul; a11y fixes belong with it.

ID	Severity	Effort	Timing vs Phase 23
A1 quota crash + error boundary	High	S	Before (independent)
B1 share-load strips URL / deletes on failure	High	M	Before (independent)
B5 reconstruction 429 fatal	Medium	S	Before (with B1)
A2 unbounded grid dims	Medium-high	S	Before (independent)
B8 invalid face index crash / weak isSlotShaped	Medium	S–M	Before (with A2)
B7 bg-color unvalidated	Low	S	Before (with A2)
B3 Cmd+Z in inputs	Medium-high	S	Before (logic survives overhaul)
B4 title/color history flood	Medium	S–M	Before (with B3)
B2 unthrottled persistence (jank)	Medium	S–M	Before (with A1)
B9 hybrid import misplacement	Medium	S–M	Before (independent)
A3 printing pagination	Medium	M	Before (independent; modal not in Phase 23 scope)
B6 decklist parser bare-name / capital-X	Low-medium	S	Before (cheap; or anytime)
A4 grid keyboard a11y	Medium	M	Fold into Phase 23 (grid surface rebuilt)
A5 modal focus trap + <progress> label	Medium	M	Fold into Phase 23 (or cheap standalone)
B10 export bounded-parallel + cache	Low-medium	M	After (perf, not blocking)
B11 sidebar DOM/export parity	Low	S–M	After (cosmetic)
B12 custom loadImage guard	Low	S	Opportunistic (fold into A1 work)
Step 5 — Prioritized next-steps plan
The cluster of independent crash/data-loss/correctness issues is large enough and unrelated enough to the UI overhaul that I recommend a dedicated pre-overhaul phase rather than folding into 23. It slots cleanly between the shipped Phase 22 and the Phase 23 overhaul, and honors the roadmap's "keep tests green from 18 onward" rule.

Proposed Phase 22.5 — Pre-overhaul hardening (logic only, no UI redesign)
Ranked by signal (crash/data-loss first):

Persistence safety + error boundary (A1, B2, B12). Wrap persist() in try/catch with a "storage full" notice; add a top-level error boundary in main.tsx; debounce persistence and skip it during live crop drags; guard custom loadImage in export. Removes a crash class and the main jank source.
Share-load resilience (B1, B5). Strip ?c= only after reconstruction succeeds; on failure keep the config placeholder (empty slots + retry affordance) instead of deleting it; treat 429 as retryable rather than fatal, with a small inter-chunk delay.
Share / localStorage decode hardening (A2, B7, B8). Clamp gridRows/gridCols to 1–10 on both compact and legacy decode; clamp f against imageUris.length in reconstructSlots; validate backgroundColor as hex/rgb; validate heroConfig item shapes; strengthen isSlotShaped to require non-empty imageUris/artCrop. Closes the freeze-via-link and crash-via-tampered-link vectors.
Undo correctness (B3, B4). Bail the global keydown handler when e.target is an input/textarea/contentEditable; coalesce title/color edit bursts into one snapshot each (same single-snapshot pattern already used for crop drag).
Hybrid import indexing fix (B9). In proceedExpand, derive added slot indices from a fresh generateCellMap of the expanded grid, not gridRows*gridCols. Stops cards vanishing in commander/partner imports.
Printing pagination (A3). Follow has_more/next_page (or cap with a "showing first N" note) so high-printing cards expose all options.
Decklist parser robustness (B6). Accept bare card names as qty 1, accept capital X, and surface a count of unparsed lines.
Tests for the pure modules these fixes touch — decklistParser, the import-expansion indexing, reconstructSlots face-clamp, share-decode bounds, and drawCoverCrop. Both reviews independently flagged these as the highest-risk zero-coverage code, and the roadmap requires the suite stay green.
Fold into Phase 23 (UI overhaul)
A4 grid keyboard operability and A5 modal focus-trap / dialog semantics / <progress> label — the grid surface and modals are being rebuilt there anyway; doing accessibility as part of the redesign avoids rework.
Defer until after the overhaul (low priority)
B10 bounded-parallel export fetch + blob cache; B11 sidebar DOM/export parity in hero layouts. Neither blocks anything.
Leave alone
Everything in Bucket D (shrink-recompact, no-cache, custom-slot omission, two-key write, hero gap, twice-run updater, 0|1 face type). Add the one-line "pure updater" comment to updateChartWithHistory if you want, but no behavioral change.
This stops here for your approval — I haven't modified anything. If you greenlight Phase 22.5, my suggestion is to scope items 1–5 as the must-ship core and 6–8 as same-phase follow-ons. Want me to draft the detailed per-step checkpoint plan (roadmap-style) for it?