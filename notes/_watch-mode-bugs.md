# Watch Mode — two bugs found while filming it

Found 2026-07-30 while building Playwright capture clips for the marketing site.
Trying to film the feature is what surfaced them; neither is caught by the
existing test suite or by `tests/e2e/watch-mode.spec.ts` (which asserts row
*count*, never that values change).

Marketing copy being tested against, from `apps/web/src/components/marketing/features.tsx`:

> **Watch Mode** — Pin a SELECT, see it move. Re-runs on a cadence with live
> cell-level diff highlights. Refuses to poll INSERT/UPDATE/DELETE/DDL.

## Bug 1 — grid never refreshed on a tick — FIXED

**Symptom:** Watch Mode painted "this cell changed" highlights over the *old*
value. Displayed data never updated while watching.

**Cause:** the tick path wrote rows only into `useWatchStore`. `updateTabResult`
— the sole writer of `tab.result`, which the grid renders — was called only from
the manual Run path (`tab-query-editor.tsx:404`) and explain-error paths.
`editable-data-table.tsx` consumed `watchState` purely to mount the decoration
overlay, passing it `rows={rows}`, i.e. the stale host rows. The overlay paints
rectangles and cannot change cell text.

So the differ was correct — it compared two freshly-fetched snapshots — and the
UI highlighted a cell whose on-screen value was stale.

**Fix:** commits `f2ccecd`, `efa23e7`, `4b10884` on `feat/feature-clips`.

New `useTabStore.applyWatchResult` writes tick rows into `tab.result`. The
non-obvious part: `updateTabResult` deliberately drops pending inline edits (see
`stores/__tests__/tab-result-invalidation.test.ts`), because rows changing under
a pending edit lets that edit commit against the wrong row. A naive per-tick
call would therefore have destroyed a user's in-progress edit every few seconds.
So `applyWatchResult` **declines** the refresh while edits are pending or a cell
editor is open, and the watch pill renders **Held** (paused styling) rather than
counting down to ticks that do nothing.

Also in that fix:
- diff baseline is read from `tab.result` at tick time rather than cached in the
  scheduler. The cached version desynced on the commit-then-re-run path that most
  often follows a declined tick, producing **missed highlights**.
- `autoResetPageIndex: !isWatching` on `DataTable` — a watched multi-page result
  was bouncing to page 1 every tick.
- dropped a `computeDiff` call that ran with `next.rows = []` on failed polls,
  which had been inflating `rowsRemovedCumulative` and firing spurious
  rows-removed alerts on every failed tick.

Suite: 1137 passed / 56 skipped / 0 failures (was 1119). Reviewed, all findings
closed.

## Bug 2 — diff highlights invisible at 50 rows or fewer — NOT FIXED

**Symptom:** with Bug 1 fixed, cell text now updates correctly on a tick
(verified in footage: `Ahmed Hassan` → `Ahmed Hassan (Live)`), but **no amber
changed-cell background and no green added-row band ever appear** for a result of
≤50 rows. That is nearly every realistic query, and every small demo.

**Cause — verified in code, both grid paths:**

`apps/desktop/src/renderer/src/components/editable-data-table.tsx`
- `:76` — `const VIRTUALIZATION_THRESHOLD = 50`
- `:1077` — `const shouldVirtualize = rows.length > VIRTUALIZATION_THRESHOLD`
- `:1363-1369` — `<EditableWatchOverlay … enabled={shouldVirtualize && columnWidths.length > 0} />`
- `:1442,1458` — returns `null` unless `enabled`

`apps/desktop/src/renderer/src/components/data-table.tsx`
- `:54,548` — same threshold and `shouldVirtualize`
- `:770` — `{diffOverlay && shouldVirtualize && columnWidths.length > 0 && (`
- `diffOverlay` is a prop. The only caller that passes it is
  `time-machine/time-machine-view.tsx:131`.
  `query-editor/query-results.tsx` renders both grids for query results
  (`EditableDataTable` at `:298`, `DataTable` at `:331`) and **never passes it**.

**Why it is not a one-line fix:** `cell-grid/watch-decoration-overlay.tsx`
positions absolutely-placed rectangles from `virtualizer` and `geometry` (column
widths, row offsets), which only exist on the virtualized path. The overlay is
architecturally dependent on the virtualizer, so ungating it is not sufficient.

**Relevant precedent already in the codebase:** `data-table.tsx:713`
(`isAddedRow` from `diffOverlay?.addedRowKeys`) and `:730`
(`diffOverlay?.cells.get(...)`) style rows and cells **inline**, inside the
ordinary non-virtualized row map, with no virtualizer. That is how Time Machine
renders its diff. Extending that mechanism to Watch Mode — and adding an
equivalent to `EditableDataTable` — looks more promising than making geometry
available for small results.

**Also worth deciding:** there are two half-wired mechanisms for the same visual
feature — a `diffOverlay` prop and a self-subscribing overlay. That split is how
this bug survived. Pick one.

## Deferred / related

- **Alerts fire over a held grid.** During a decline, `runAlerts` still evaluates
  polled snapshots, so an alert can announce "5 rows added" over a grid showing
  none of them. Surfaced by the Held pill but not fixed — needs a product call on
  whether alerts describe the data or the display.
- **No component tests possible.** `apps/desktop/vitest.config.ts:7` sets
  `environment: 'node'` and `include` only matches `*.test.ts`, so grid rendering
  behaviour cannot be unit-tested as things stand.
- **First tick has no diff baseline** — by design, unchanged.
- Minor items from the Bug 1 review, all deferred: dead multi-statement branch
  (`tab-store.ts:831`), `fields: result.columns` mirror dropping `dataTypeID`
  (`:852`), no execution guard on `applyWatchResult`'s unconditional `error: null`
  (`:844`), `carryDiff` vs `computeDiff` fade-pruning disagreement
  (`watch-scheduler.ts:70-81`), untested table-preview + watch combination.

## State of the clip

`apps/desktop/tests/capture/watch-mode.capture.ts` is committed and **fails on
purpose**. It asserts two things: that the `(Live)` value becomes visible
(Bug 1's fix made this true and it passes), and that the amber changed-cell
decoration (`[style*="--cell-diff-fill"]`) becomes visible. The decoration
assertion is Bug 2's acceptance check, and fails today because the query
returns 3 rows and the overlay is gated behind `shouldVirtualize` — it should
start passing once Bug 2 is fixed, with no other change to the spec needed.

The clip is **not shipped**: `watch-mode` is absent from
`apps/web/src/components/marketing/feature-clips.ts` and from
`tools/feature-clips/clips.manifest.json`, because footage of a static-looking
table would undercut the copy sitting next to it. Once Bug 2 is fixed, re-run the
capture and add both entries — no new capture code needed.

Footage and the frames that prove each claim are in the capture workspace under
`.superpowers/sdd/2026-07-30-feature-clips/`.

## Decision: Bug 2 is a follow-up branch

Agreed 2026-07-30. `feat/feature-clips` merges with Bug 2 open. Fix it separately so
it gets review on its own merits rather than riding a marketing diff.

The follow-up has a ready-made acceptance test: `watch-mode.capture.ts` already
asserts the amber decoration and **fails today for exactly this reason**. When it
passes, re-run the capture and add `watch-mode` to `clips.manifest.json` and
`feature-clips.ts` — no new capture code needed.

Until then, two public claims are false for results of ≤50 rows and should be
revisited when the fix lands:

- `apps/web/src/components/marketing/features.tsx` — the Watch Mode feature copy
- `notes/watch-mode.mdx` — a published blog post promising "changed cells flash
  amber, new rows enter green"

## Note on branching

Bug 1's fix is currently committed on `feat/feature-clips` alongside the
marketing-clip work. If you want it reviewed and merged independently of the
clips, cherry-pick `f2ccecd`, `efa23e7`, `4b10884` onto their own branch.
