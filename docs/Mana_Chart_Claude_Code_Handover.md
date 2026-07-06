# Mana Chart — Claude Code Build Spec

## Working Agreement — Read This First

Do not start building yet.

First, produce:
1. Your recommended tech stack with brief justification (see Tech Stack section — there is a default, justify any deviation).
2. A phased build plan breaking the app into logical checkpoints, each small enough to review and commit independently. A rough order might be: scaffold → grid UI → Scryfall search → drag and drop → display modes → name display → export → persistence → multiple charts. Use your judgement, but keep phases small.
3. An `ARCHITECTURE.md` draft covering component structure, data model, CORS/export strategy, export defaults, and where post-MVP features slot in.

Then stop and wait for my approval before writing any code.

After I approve the plan, we build one phase at a time. After each phase:
- You summarise what was built and any decisions made.
- I will review with a second AI tool before we proceed.
- I will confirm before you start the next phase.

Never proceed to the next phase without explicit confirmation. If you hit an ambiguity not covered by this spec, flag it and ask rather than guessing.

---

## Overview

Build a web application called **Mana Chart** — a Topsters-style collage builder for Magic: The Gathering cards. Users build a grid of MTG card art, customise layout and display options, then download the result as a PNG. Think Topsters (topsters3.com) but for MTG cards instead of albums.

A reference screenshot of the intended control-panel layout and aesthetic accompanies this spec (dark, minimal, single warm accent). The screenshot is a **visual target for the control panel only**. Where the screenshot and this written spec disagree, **this spec wins**.

---

## Tech Stack

Default to **Vite + React + TypeScript**, deployed as a static site (Vercel/Netlify), with:
- **dnd-kit** for drag and drop
- **dom-to-image-more** or **html2canvas** for PNG export
- **localStorage** for persistence (no backend in MVP)
- plain `fetch` with debounce for Scryfall (a query library is optional)

The one legitimate reason to deviate: if your chosen export/CORS strategy requires serverless functions (an image proxy), a minimal **Next.js** setup becomes attractive for the API route. If you go client-side blob fetching (pure static), stay on Vite. Recommend and justify before scaffolding, and tie the decision to the CORS strategy.

---

## Data Model

This is the most important section — all features depend on it. Include `schemaVersion` from day one.

Each **chart** stores:
- `id` (uuid)
- `name` (string)
- `schemaVersion` (integer, start at 1)
- `gridRows`, `gridCols` (integer)
- `layout`: `"uniform" | "hybrid"` — only `"uniform"` is built in MVP (see Layout section), but reserve the field now
- `displayMode`: `"landscape" | "square"` — only `"landscape"` is built in MVP; reserve `"square"` for later (open enum, not a boolean)
- `nameDisplayMode`: `"none" | "sidebar" | "overlay"`
- `title` (string) — chart title text, rendered above the grid, included in export
- `backgroundColor` (string, hex)
- `cellGap` (integer, px)
- `padding` (integer, px) — outer padding/frame around the grid
- `cornerRadius` (integer, px) — tile corner radius
- `slots`: ordered array (row-major, left-to-right top-to-bottom) of slot objects or `null` for empty

Each **slot** stores:
- `scryfallId` (string) — ID of the specific printing selected
- `oracleId` (string) — used for the printing switcher
- `cardName` (string)
- `setCode` (string)
- `collectorNumber` (string)
- `layout` (string) — Scryfall card layout (transform, modal_dfc, etc.), used to detect multi-face cards
- `selectedFaceIndex` (`0 | 1`) — for double-faced cards; default 0
- `imageUris`: `{ artCrop: string, normal: string }` — cached at add time, no refetch needed for render

**Reserved for post-MVP (do not build, but design the slot so adding these later is a non-breaking migration):** per-slot manual crop framing — an `x`/`y` offset and `scale`/`zoom` per tile. This will power both manual full-art framing and the future square mode. When added, bump `schemaVersion` and default existing slots to centre-crop.

Multiple charts are stored in localStorage as an array. Chart state (grid size, layout, display mode, name display, all style values, card placements) is **per-chart, not global**.

---

## Grid & Layout

- Configurable grid dimensions (e.g. 3×3 up to 10×10) via the Width/Height controls.
- Empty cells are visually distinct (dark placeholder).
- Drag and drop to reorder cards within the grid (dnd-kit).
- Removing a card sets its slot to `null` (sparse — no auto-compaction of remaining cards).

**Layout toggle (`layout` field):**
- MVP ships **uniform** grid only: `gridRows × gridCols` equal cells.
- **Hybrid hero** is a post-MVP feature and should be the *first* post-MVP phase. Structure the grid renderer and export composition so a second layout slots in cleanly without a rewrite. The toggle UI may be present but hybrid can be disabled/"coming soon" until built.

**Grid resize rules:**
- Do not allow shrinking the grid below the current occupied card count. Warn the user that they must remove cards first.

---

## Display Mode (`displayMode` field)

MVP is **landscape art only**:
- Render each tile using Scryfall's `art_crop` image in a **landscape** cell (roughly the native art-box aspect).
- Use `object-fit: cover` to auto-centre the art and fill the cell. Normal cards display cleanly; full-art cards receive a sensible auto-centred crop.
- This auto-crop is the accepted MVP behaviour for full-art cards. Hand-tuned framing is post-MVP.

**Post-MVP (reserved, do not build):** manual drag-to-frame and square mode. A fixed crop window where the user drags/zooms the art inside it. This single feature serves both (a) fine-tuning full-art card framing and (b) the square (1:1) display mode. The `square` enum value and per-slot crop fields are reserved for this.

---

## Card Search (Scryfall API)

- Search bar querying `https://api.scryfall.com/cards/search?q={query}`.
- Filter to **English, playable cards only** — exclude tokens, emblems, art series, and digital-only cards.
- Results shown as a scrollable thumbnail list. Clicking a result adds the card to the next empty cell.
- **Pagination:** Scryfall returns up to 175 results per page with a `has_more` flag. MVP shows the **first page only**, displays the result count, and prompts the user to refine their query if what they want isn't shown. Do not build infinite scroll or a paginated fetcher — that is post-MVP.
- Respect Scryfall rate limits: debounce search input, 50–100ms between requests. Add a descriptive User-Agent **only** where you control the request (i.e. a serverless proxy if used). Browser JS cannot set User-Agent — do not attempt it client-side.

**Add when grid is full:** dragging a new card onto an occupied cell replaces it. (Adding via click goes to the next empty cell; if full, the user must replace by drag.)

---

## Printing / Art Switcher

- Accessible via a hover button and a right-click context menu on a filled cell.
- Fetch printings using `oracleId`, not card name:
  `GET https://api.scryfall.com/cards/search?q=oracleId:{oracleId}+lang:en+-is:digital&unique=prints`
- Show results in a modal/popover: thumbnail (small/normal), set name, year. Only show printings with usable image URIs.
- On selection: update `scryfallId`, `setCode`, `collectorNumber`, `layout`, and re-cache `imageUris` for the new printing.
- Preserve `selectedFaceIndex` only if the new printing supports that face index; otherwise reset to 0.
- Modal closes on selection, outside click, or Escape.

---

## Double-Faced Cards

- Default display and export: face 0.
- "Switch Face" appears in the right-click menu only when the `layout` field indicates multiple image-bearing faces (transform, modal_dfc, etc.).
- Switching face updates `selectedFaceIndex` and re-reads `imageUris` from `card_faces[newIndex]`.
- If a new printing after a switch has fewer faces than `selectedFaceIndex`, reset to 0.
- When caching images, use `card.image_uris` if present, else `card.card_faces[selectedFaceIndex].image_uris`.

---

## Card Name Display (`nameDisplayMode` field)

Three modes the user toggles between:
- **None:** no names, art only.
- **Sidebar:** numbered list to the side of the grid, row-major order, null slots skipped, duplicates listed each time. Renumbers live on reorder. Included in export. **When the legend would exceed the grid height (e.g. large grids), it wraps into multiple columns** rather than producing one excessively tall strip.
- **Overlay:** a compact bar inset on the **bottom edge of each filled card, overlapping the art** (not a caption strip below the tile). Name truncated with ellipsis. Included in export.

---

## Removing Cards

- Each filled cell has a remove button visible on hover.
- Right-click context menu on a filled cell: Remove, Switch Art/Printing, Switch Face (DFCs only).
- Removing sets the slot to `null`.

---

## Export / Download (PNG)

- Export the grid area as a PNG, including the chart title and the active name display (sidebar or overlay). No control UI in the export.
- Render the export from a **hidden off-screen DOM**, not the live UI.
- Wait until all images are fully loaded **and decoded** before rasterising.
- If any required image fails to load during export, **block export and show an actionable error** — do not produce a half-broken image.
- **Resolution:** default to **2× scale** (good screen/retina quality). Document this in `ARCHITECTURE.md`.
  - **True print-resolution export (e.g. 300 DPI) is post-MVP.** Note in `ARCHITECTURE.md` that browser canvas size limits (~16k px/side, stricter on Safari/total area) mean a print path may need to tile and stitch the canvas. Do not attempt print-res as the default — large grids would hit the limit or be slow, especially on mobile.
- **CORS** is the main technical risk. Scryfall images are cross-origin. Evaluate and choose between:
  a) Client-side blob fetch + object URLs (pure static), or
  b) Serverless image proxy (Vercel/Netlify function).
  Implement one cleanly from the start — do not leave it as a known broken edge case. Document the choice and tradeoffs in `ARCHITECTURE.md`. This choice also informs the Vite-vs-Next stack decision.
- Choose sensible export defaults (background, padding) and document them.

---

## Persistence

- Save all chart state to localStorage as an array of chart objects.
- Support multiple charts: add, delete, rename (like Topsters).
- Data model must stay clean and self-contained so it can migrate to a backend later without restructuring. `schemaVersion` is present from v1.

---

## Design / UI

- Dark, clean, minimal. Single warm accent used only for active/interactive states (see control-panel reference screenshot).
- Left-hand control panel; grid dominates the main area.
- Consistent vertical spacing rhythm; values right-aligned; two or three type sizes max.
- MTG-adjacent accents are fine but keep it tasteful — not full fantasy UI.
- Mobile is not a priority but don't actively break it.

---

## Non-Goals / Post-MVP (acknowledge in ARCHITECTURE.md, do not build)

In rough priority order:
1. **Hybrid hero layout** (first post-MVP phase — design the grid/export to accept it).
2. **Manual drag-to-frame + square (1:1) display mode** (per-slot crop state; serves full-art tuning and square mode together).
3. **Decklist import** (MTGO format: `4x Lightning Bolt (M20)` — parse quantity, name, set code; auto-populate; use set code to pick printing).
4. **URL-encoded shareable chart links.**
5. **Custom items** (blank tiles / user image upload, like Topsters' "Custom" category). MVP is Scryfall cards only.
6. **Supabase backend** for accounts and cloud save.
7. **Font selection** (deferred specifically because export font-embedding in the off-screen capture DOM is fiddly).
8. **Standalone numbering toggle** (independent of name display).
9. **True print-resolution export.**

---

## Deliverables

1. Recommend and justify the tech stack.
2. Scaffold the project.
3. Implement MVP features above, phase by phase, with confirmation gates.
4. Write `ARCHITECTURE.md` covering component structure, data model shape, CORS/export strategy, export defaults, and post-MVP integration points (especially the reserved per-slot crop fields and the hybrid layout seam).
