# Compatibility Contracts

> **Read this before touching persistence, share links, or the schema.** This file
> specifies every external compatibility surface — the things that break **user
> data** or **saved links** if changed. User data lives in browsers we don't
> control; share links live in Discord threads we can't regenerate. Neither can be
> migrated by shipping code alone, so the constants below are contracts, not
> implementation details. Verified constant-for-constant against source in July
> 2026; the source is canonical if they ever drift — but if they drift, treat the
> drift itself as the bug.
>
> Rationale for these designs lives in [decisions.md](decisions.md). Known debt in
> [tech-debt.md](tech-debt.md).

---

## 1. localStorage contract

### Keys — never rename

| Key | Value | Written by |
|---|---|---|
| `manachart:charts` | `JSON.stringify(Chart[])` | [useCharts.ts:11](../src/hooks/useCharts.ts#L11) |
| `manachart:activeId` | plain string (chart id, **not** JSON) | [useCharts.ts:12](../src/hooks/useCharts.ts#L12) |

These are the live user-data keys. The `manachart:*` prefix replaced the
pre-rebrand `mtg-chart:*` prefix in a one-time, migration-backed rename done
pre-launch ([decisions.md](decisions.md) §1). **Do not rename them again** without
a fresh migration and a reason: user data lives in browsers we don't control, so a
rename with no read-old path silently orphans every existing chart.

### Legacy keys — read once, on the migration path only

| Legacy key | Superseded by |
|---|---|
| `mtg-chart:charts` | `manachart:charts` |
| `mtg-chart:activeId` | `manachart:activeId` |

`migrateStorageKeys` ([useCharts.ts:31](../src/hooks/useCharts.ts#L31)) runs at the
top of `loadOrInit`, **before** the load chain below. For each key independently:
if the `manachart:*` key is absent but the `mtg-chart:*` key has data, it copies
legacy → new. It is idempotent (new key present → no-op) and **non-destructive** —
the legacy keys are left in place, so a round-trip to an older build still finds
its data. Never write to the legacy keys; treat them as a read-once source that
existing installs may still carry.

### Value shape

`manachart:charts` is an array of `Chart` objects exactly as typed in
[src/types/chart.ts](../src/types/chart.ts) — including `id`, `schemaVersion`, and
the sparse visual-cell-indexed `slots: Array<Slot | null>`. Custom slots embed the
full image as a data URL (`localImageDataUrl`), which is why quota can be
exhausted (see Write behaviour below).

### Schema version and migration chain

`CURRENT_SCHEMA_VERSION = 4` ([schemaVersion.ts:3](../src/utils/schemaVersion.ts#L3)).
`migrate` runs each step in order on any chart whose version is below current;
`migrateAll` maps it over the stored array on every load, **before render**.

| Step | Where | What it fills |
|---|---|---|
| v1 → v2 | [schemaVersion.ts:15-27](../src/utils/schemaVersion.ts#L15-L27) | `cropX`/`cropY`/`cropScale` on every non-null slot, defaults `0.5` / `0.5` / `1.0` |
| v2 → v3 | [schemaVersion.ts:29-35](../src/utils/schemaVersion.ts#L29-L35) | `heroConfig` on the chart, default `[]` |
| v3 → v4 | [schemaVersion.ts:37-52](../src/utils/schemaVersion.ts#L37-L52) | `cmc`/`colors`/`typeLine` on every non-null slot, default `null` |

**Unknown/future version** (`schemaVersion > 4`): the chart is loaded **as-is**
with a console warning ([schemaVersion.ts:6-11](../src/utils/schemaVersion.ts#L6-L11))
— never dropped, never crashed on. This is what lets a user open the app after a
rollback without losing charts a newer build wrote.

### Load path (order matters)

`loadFromStorageOrDefault` ([useCharts.ts:109-129](../src/hooks/useCharts.ts#L109-L129)),
after `migrateStorageKeys` has already carried any legacy store forward:

1. `JSON.parse` the `manachart:charts` value.
2. Structural gate: array, non-empty, **every** element passes `isChartShaped`
   ([chartShape.ts:39-49](../src/utils/chartShape.ts#L39-L49)) — string `id`,
   numeric dims, `slots` array whose every slot is well-shaped (scryfall slots:
   non-empty `imageUris`, string `artCrop` per face, in-range `selectedFaceIndex`;
   custom slots: string `localImageDataUrl`/`label`, numeric crop fields).
   Because this gate runs **before** migration, it must stay tolerant of
   historical slot shapes: a v1 scryfall slot has no crop fields and no
   `cmc`/`colors`/`typeLine`, and must still pass — strengthening the gate to
   require modern fields silently abandons every v1 store in the wild
   (fenced in [useCharts.test.ts](../src/__tests__/useCharts.test.ts),
   "load-path order"). The stricter custom-slot requirements (numeric crop
   fields) are safe despite this: custom slots shipped in Phase 17, **after**
   schema v2 introduced the crop fields, so no v1 chart in the wild can contain
   a custom slot (verified against git history, July 2026 — `500fa1e` postdates
   `3e47ce9`).
3. `migrateAll` (chain above).
4. `sanitizeChartConfig` per chart ([sanitizeChart.ts:67-78](../src/utils/sanitizeChart.ts#L67-L78)):
   dims clamped to 1–10, invalid hero items dropped, background restricted to
   hex/`rgb()`/`rgba()` (else `#0b0c0e`), and `slots` **truncated to grid
   capacity**. This truncation is the data-loss edge in tech-debt
   [C1](tech-debt.md) — a chart persisted with more slots than capacity is
   silently trimmed on next load.
5. `activeId` is honoured only if it names a loaded chart; otherwise `charts[0]`
   (recovery for the non-atomic two-key write, below).

If step 1 or 2 fails (corrupt JSON, one malformed chart), the **entire store is
abandoned** and a fresh default chart is created — and the persistence effect will
then overwrite the stored value. All-or-nothing by design: one malformed chart
fails the whole array, there is no per-chart salvage.

### Write behaviour

- Writes are debounced **300 ms** trailing-edge (`PERSIST_DEBOUNCE_MS`,
  [useCharts.ts:24](../src/hooks/useCharts.ts#L24)), flushed on `pagehide` and
  `visibilitychange: hidden` ([useCharts.ts:409-421](../src/hooks/useCharts.ts#L409-L421)).
  A hard crash inside the window can lose the last edit (tech-debt G4).
- The two keys are written **non-atomically**
  ([useCharts.ts:14-20](../src/hooks/useCharts.ts#L14-L20)); worst case after a
  crash between them is the wrong active chart, never data loss.
- `safeWrite` ([useCharts.ts:29-36](../src/hooks/useCharts.ts#L29-L36)) converts any
  storage throw (quota, storage disabled) into `{ ok: false }` → a storage-error
  banner; the app keeps working in memory. `nextStorageError` is deliberately
  idempotent so a failing write can't retry-loop.
- An un-reconstructed share placeholder is **excluded** from every write
  (`chartsToPersist`, [useCharts.ts:165-168](../src/hooks/useCharts.ts#L165-L168)) —
  see §2, reconstruction flow.

---

## 2. Share-link contract

### URL structure

```
{origin}{pathname}?c={payload}
```

Built at [App.tsx:479-489](../src/App.tsx#L479-L489). The query param name **`c`**
is load-bearing: `loadOrInit` reads it
([useCharts.ts:232](../src/hooks/useCharts.ts#L232)) and strips it via
`stripShareParam` ([useCharts.ts:156-160](../src/hooks/useCharts.ts#L156-L160)).
Links live in chat logs and bookmarks indefinitely — the param name and both
payload encodings below can never change, only gain versioned successors.

### Compact payload (current, "URL version 1")

Encoding: `LZString.compressToEncodedURIComponent(JSON.stringify(payload))`
([shareLink.ts:80](../src/utils/shareLink.ts#L80)). lz-string's URI-safe alphabet
is itself part of the contract — switching compressor or alphabet breaks every
link ever copied.

Payload shape ([shareLink.ts:8-36](../src/utils/shareLink.ts#L8-L36)):

```ts
{
  v: 1,                       // format version — bump for any incompatible change
  c: {                        // chart config: name, gridRows, gridCols, layout,
                              // heroConfig, displayMode, nameDisplayMode, title,
                              // titleFont?, backgroundColor, cellGap, padding,
                              // cornerRadius  (no id, no schemaVersion, no slots)
  },
  s: Array<ShareSlotStub | null>   // visual-cell-indexed, same indexing as slots
}

ShareSlotStub {
  id: string   // scryfallId — the ONLY identity carried
  f?: 0 | 1    // selectedFaceIndex — OMITTED when 0
  x?: number   // cropX      — OMITTED when 0.5
  y?: number   // cropY      — OMITTED when 0.5
  z?: number   // cropScale  — OMITTED when 1.0
}
```

The omission defaults (`0`, `0.5`, `0.5`, `1.0`) are semantic: decode fills them
back in (`reconstructSlots`, [shareLink.ts:180-182](../src/utils/shareLink.ts#L180-L182)).
Changing a slot default in the app therefore changes the *meaning of every old
link* unless the codec is versioned first.

Everything else on a `ScryfallSlot` (`imageUris`, `cardName`, `oracleId`,
`setCode`, `collectorNumber`, `layout`, `cmc`, `colors`, `typeLine`, `artist`) is
**reconstructed from Scryfall by id** at open time — never encoded.

- **Custom slots** cannot be reconstructed → encoded as `null`;
  `encodeShareLink` returns `customSlotsOmitted` so the copy UI shows a count
  ([shareLink.ts:48-51](../src/utils/shareLink.ts#L48-L51)).
- **`titleFont` is allowlisted at both ends**: encoded only if it's in
  `ALLOWED_TITLE_FONTS` (`Cinzel`, `Cormorant Garamond`, `Uncial Antiqua`,
  `Inter`, `Comic Neue` — [shareLink.ts:84-86](../src/utils/shareLink.ts#L84-L86)),
  and a decoded payload with an unknown font is **rejected outright**
  ([shareLink.ts:115](../src/utils/shareLink.ts#L115)). Adding a font is
  additive-safe; removing one invalidates links that carry it.

### Legacy payload (Phase 16 — decode-only, keep forever)

`decodeURIComponent(atob(raw))` → full `Chart` JSON → `isChartShaped` →
`migrateAll` ([shareLink.ts:153-162](../src/utils/shareLink.ts#L153-L162)). No new
legacy links are minted, but old ones must keep opening. The legacy chart carries
its own slots, so it never reconstructs — it loads synchronously.

### Decode gates, in order

`decodeSharePayload` ([shareLink.ts:130-163](../src/utils/shareLink.ts#L130-L163)):

1. Try lz-string decompress → JSON parse → look for `v`.
2. `v === 1` → `isSharePayloadShaped`
   ([shareLink.ts:90-128](../src/utils/shareLink.ts#L90-L128)): integer dims ≥ 1,
   required string/number fields, enum fields exact, `heroConfig` an array,
   `titleFont` allowlisted, and per-stub: non-empty string `id`, `f ∈ {0, 1}`,
   `x`/`y`/`z` numbers. Fail → `"Invalid or expired link."`.
3. `v` present but ≠ 1 → `"Link format not supported — ask sender to
   regenerate."` (this is the forward-compat slot: a future `v: 2` decoder slots
   in above it).
4. No `v` / decompression failed → legacy path; its failure →
   `"Invalid or expired link."`.

Then `loadOrInit` ([useCharts.ts:231-269](../src/hooks/useCharts.ts#L231-L269))
applies the same `sanitizeChartConfig` used on storage loads to the decoded
config, and **caps the stub array to grid capacity**
([useCharts.ts:247-252](../src/hooks/useCharts.ts#L247-L252)) so a crafted link
can't force unbounded reconstruction work. Finally `reconstructSlots` **clamps
each stub's face index into the reconstructed card's actual face count**
([shareLink.ts:173-179](../src/utils/shareLink.ts#L173-L179)) — a tampered `f: 1`
on a single-face card must not crash render/export.

Note the decoder is *tolerant of unknown fields* — extra keys in `c` pass shape
validation and are spread into the placeholder chart. That tolerance is what makes
additive payload fields backward-compatible; don't add strictness that removes it.

### Reconstruction flow (compact links only)

1. `loadOrInit` is synchronous: it appends a sanitized **placeholder** chart
   (fresh `id`, `schemaVersion: 4`, `slots: []`) to the user's existing charts and
   returns `pendingReconstruction` (the stubs) + `isReconstructing` +
   `unreconstructedPlaceholderId`.
2. A mount effect batches the stubs to
   `POST https://api.scryfall.com/cards/collection`
   (`fetchCollectionSlots`, [reconstruct.ts:79-105](../src/utils/reconstruct.ts#L79-L105)):
   chunks of **75** ids, **100 ms** between chunks, and on **429** honours
   `Retry-After` (default backoff **1500 ms**), retrying up to **3** times before
   throwing `RetryableReconstructionError`
   ([reconstruct.ts:32-35](../src/utils/reconstruct.ts#L32-L35),
   [46-72](../src/utils/reconstruct.ts#L46-L72)). Politeness is deliberate —
   decision log §11.
3. **Success**: slots filled, all reconstruction flags cleared, not-found /
   un-normalisable ids surfaced as a warning count
   (`applyReconstructionSuccess`, [useCharts.ts:173-201](../src/hooks/useCharts.ts#L173-L201)).
4. **Failure**: the placeholder is **kept** (empty grid), the error is retryable,
   and stubs + the persistence exclusion are **retained**
   (`applyReconstructionFailure`, [useCharts.ts:207-226](../src/hooks/useCharts.ts#L207-L226))
   so both in-app Retry and a plain reload re-attempt the load.
5. **Persistence exclusion**: while `unreconstructedPlaceholderId` is set, the
   placeholder is filtered out of every localStorage write (`chartsToPersist`).
   This is why a failed share load + reload yields exactly **one** placeholder
   instead of accumulating duplicates. The exclusion lifts on success, or when
   the user *claims* the chart by editing it
   ([useCharts.ts:452-464](../src/hooks/useCharts.ts#L452-L464)).
6. **`?c=` strip timing**: legacy links strip on mount
   ([useCharts.ts:304-308](../src/hooks/useCharts.ts#L304-L308)); compact links
   strip only when the placeholder stops being pending — success or user claim
   ([useCharts.ts:365-373](../src/hooks/useCharts.ts#L365-L373)). Decode *errors*
   never strip, so the user can inspect/retry the URL.

---

## 3. Export determinism (secondary surface)

Not user data, but a reproducibility promise: **export dimensions derive from
chart config alone, never the DOM/viewport**, so the same chart exports at the
same resolution on every device. All the sizing/budget math is pure in
[exportGeometry.ts](../src/utils/exportGeometry.ts); the one sanctioned exception
is sidebar-mode name measurement via `ctx.measureText` (platform-variant by a few
px — tech-debt G2, noted in the file header). If you change export geometry,
`exportGeometry.test.ts` is the fence; keep the preflight and the canvas
allocation flowing through the shared `exportPixelDims` so they can't disagree
(see ARCHITECTURE.md, Export flow).

---

## 4. The rules

**Safe (additive, no ceremony):**
- A new **optional** field on `Chart` or a slot type (`titleFont` is the
  precedent). Old data loads fine (`undefined`), no version bump. If it should
  travel in share links, also add it to `SharePayloadChart`, encode it in
  `encodeShareLink`, and validate it in `isSharePayloadShaped` — with an
  allowlist if it's ever interpolated into CSS/URLs.
- Adding a font to `ALLOWED_TITLE_FONTS` (ship the `@fontsource` package in the
  same PR — CSP `font-src 'self'`).
- New localStorage keys under a **new** name (never repurpose the two existing
  ones).

**Requires a schema bump + migration step:**
- Any **non-optional** persisted field on `Chart` or a slot type: bump
  `CURRENT_SCHEMA_VERSION`, append a chain step in
  [schemaVersion.ts](../src/utils/schemaVersion.ts) filling the default, extend
  `schemaVersion.test.ts`. Never edit an existing migration step — charts at
  every historical version exist in the wild.

**Requires a payload version bump (`v: 2` + decoder that keeps `v: 1`):**
- Any change to stub field names/meanings, the omission defaults, or the payload
  structure. The `v: 1` decode path then becomes the second legacy path and is
  kept forever, like the Phase 16 one.

**Never change:**
- The key strings `manachart:charts` / `manachart:activeId`, and the read-once
  legacy migration from `mtg-chart:charts` / `mtg-chart:activeId`.
- The `?c=` param name.
- The lz-string `compressToEncodedURIComponent` encoding for `v: 1` payloads,
  and the Phase 16 base64 legacy decode path.
- The meaning of existing stub fields (`id`, `f`, `x`, `y`, `z`) and their
  omission defaults.
- The unknown-future-version behaviours: load-as-is for storage, explicit
  "regenerate" error for links. Both are what make rollbacks and version skew
  survivable.

**Test fences** (each contract's regression net — extend, never delete):

| Contract | Tests |
|---|---|
| localStorage key literals, plain-string `activeId`, corrupt-store overwrite-on-next-write, `pagehide` flush | [contracts.storage.test.ts](../src/__tests__/contracts.storage.test.ts) |
| Migration chain, unknown versions | [schemaVersion.test.ts](../src/__tests__/schemaVersion.test.ts) |
| Codec round-trip, titleFont allowlist (both ends), legacy incl. v1 migration, unknown `v`, face clamp, unknown-field tolerance | [shareLink.test.ts](../src/__tests__/shareLink.test.ts) |
| Mint-side `?c=` param name + copy-link → decoder round-trip | [shareUrl.app.test.tsx](../src/__tests__/shareUrl.app.test.tsx) |
| Chunking, 429 backoff, failure/retry reducers, placeholder exclusion | [reconstruct.test.ts](../src/__tests__/reconstruct.test.ts) |
| Sanitization gates (dims, hero, colour, capacity, slot shape) | [sanitizeChart.test.ts](../src/__tests__/sanitizeChart.test.ts), [decodeHardening.test.ts](../src/__tests__/decodeHardening.test.ts) |
| Quota handling, debounce/flush scheduler | [useCharts.persist.test.ts](../src/__tests__/useCharts.persist.test.ts) |
| Failed-share placeholder claim/persist semantics | [failedShare.persist.test.tsx](../src/__tests__/failedShare.persist.test.tsx) |
| Load/CRUD/active-id behaviour, all-or-nothing abandonment, load-path order (v1 shape tolerance) | [useCharts.test.ts](../src/__tests__/useCharts.test.ts) |
| `crossOrigin="anonymous"` on every Scryfall art `<img>` (tech-debt F5) | [crossOrigin.app.test.tsx](../src/__tests__/crossOrigin.app.test.tsx) |
| Export sizing determinism | [exportGeometry.test.ts](../src/__tests__/exportGeometry.test.ts) |
