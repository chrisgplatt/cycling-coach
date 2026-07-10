# Dashboard Sync Status Consolidation Design

## Goal

Bring the dashboard's scattered sync information — the manual Sync button, Garmin's last-sync time, and intervals.icu's last-sync time — together into a single block in the top-right corner of the dashboard, so the athlete doesn't have to scroll down to the Strain panel to see when data last synced.

## Background

Today, sync-related UI is split across three places in `app/dashboard/page.tsx` and `components/MetricsBar.tsx`:

1. **Header, top-right** (`app/dashboard/page.tsx`): the animated Sync button, with a single caption underneath showing only Garmin's last-sync time (`Garmin synced {formatGarminSyncTime(garminLastSyncAt)}`), rendered only when `garminEmail` is set.
2. **Strain panel** (`components/MetricsBar.tsx`): the colored strain band (or its gray fallback header, when there's no strain data) shows the intervals.icu sync time via a local `formatSyncTime(syncedAt)` helper, plus a "Last ride" label.
3. **Amber warning banner** at the very top of the page, shown when `isGarminSyncStale(garminLastSyncAt)` is true — this stays unchanged.

## Layout Change

The header's top-right block (currently just the Sync button + Garmin caption) becomes:

```
                    [↻ Sync]
   ⚠ Garmin: synced yesterday at 21:14     (amber, only when garminStale)
      Intervals: synced today at 10:20
```

- The Sync button itself is unchanged (including its animated logo while syncing).
- Below it, up to two right-aligned status lines, each rendered independently:
  - **Garmin line** — rendered only when `garminEmail` is set (same condition as today). Reads `Garmin: synced {relative time}` normally, or `Garmin: not yet synced` when `garminLastSyncAt` is null. Rendered in `text-amber-600 font-semibold` with a leading `⚠ ` glyph when `garminStale` is true (reusing the `garminStale` value already computed on the page); otherwise plain gray (`text-gray-500`).
  - **Intervals line** — rendered only when `lastSyncedAt` is set. Reads `Intervals: synced {relative time}`. Always plain gray — intervals.icu doesn't have a staleness concept in this app.
- The current fixed `w-28` width on the caption is dropped; the block right-aligns naturally to its content instead of wrapping inside a fixed narrow column, since two lines of text are now shown instead of one.
- The Strain panel (`components/MetricsBar.tsx`) no longer shows any sync timestamp, in either its colored-band or gray-fallback header. It keeps the "Last ride" label alone in that corner.
- The amber "Garmin hasn't synced today" banner at the top of the page is unchanged — it keeps its own verbose absolute-date format (`formatGarminSyncTime`), since it's already showing a one-off explanatory message rather than a compact status line.

## Time Formatting

The two new header lines use a single, relative-day formatter so both sources read consistently at a glance: `today at HH:MM`, `yesterday at HH:MM`, or `{day} {month} at HH:MM` for anything older. This logic already exists as a local, unexported `formatSyncTime` function inside `components/MetricsBar.tsx` (used only for the intervals.icu line that's being removed from that component). It moves out into a new shared helper so both the Garmin and intervals.icu lines in `app/dashboard/page.tsx` can use it:

**New file: `lib/format-sync-time.ts`**

```ts
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Formats a sync timestamp relative to today's date, e.g. "today at 14:20",
 * "yesterday at 09:05", "2 Jul at 21:14". Returns '' when syncedAt is null.
 */
export function formatRelativeSyncTime(syncedAt: Date | null): string {
  if (!syncedAt) return ''
  const timeStr = syncedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const syncedStr = syncedAt.toISOString().split('T')[0]
  if (syncedStr === todayStr) return `today at ${timeStr}`
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (syncedStr === yesterday.toISOString().split('T')[0]) return `yesterday at ${timeStr}`
  const [, month, day] = syncedStr.split('-').map(Number)
  return `${day} ${MONTHS_SHORT[month - 1]} at ${timeStr}`
}
```

This differs from the old `MetricsBar` version only in that it no longer includes the leading `Synced ` word — the call site now supplies that as part of `Garmin: synced …` / `Intervals: synced …`, so the same formatted fragment reads naturally after either source label.

`garminLastSyncAt` is stored as an ISO string (`string | null`), so the dashboard page converts it before calling the formatter: `formatRelativeSyncTime(garminLastSyncAt ? new Date(garminLastSyncAt) : null)`. `lastSyncedAt` is already a `Date | null`, so it's passed directly.

The existing `formatGarminSyncTime` in `lib/garmin/sync-staleness.ts` (verbose absolute format) is untouched and keeps its one remaining caller: the amber stale banner.

## File Changes

### `lib/format-sync-time.ts` (new)
- Exports `formatRelativeSyncTime`, as shown above.

### `components/MetricsBar.tsx`
- Delete the local `formatSyncTime` function and the `MONTHS_SHORT` constant (both fully superseded by the new shared helper, which this component no longer needs).
- Remove the `syncedAt` prop from `MetricsBarProps` and its default value in the destructured props.
- Remove the two render call sites of `formatSyncTime(syncedAt)`:
  - Inside the colored strain band: `<div className="text-[11px] text-white/60">{formatSyncTime(syncedAt)}</div>`
  - Inside the gray fallback header: `<div className="text-xs text-gray-400">{formatSyncTime(syncedAt)}</div>`
  In both places, the `lastRideLabel` block that sits below/beside it stays exactly as-is; only the sync-time line is removed. If removing the sync-time `<div>` leaves the surrounding `<div className="text-right">` with only the (conditionally-rendered) `lastRideLabel` child, that wrapper stays — it's still needed for the `lastRideLabel` case.

### `app/dashboard/page.tsx`
- Add the import: `import { formatRelativeSyncTime } from '@/lib/format-sync-time'`.
- Remove the `syncedAt={lastSyncedAt}` prop passed to `<MetricsBar ... />`.
- Just above the `return (`, compute the two line strings (or `null`) from existing state (`garminEmail`, `garminLastSyncAt`, `garminStale`, `lastSyncedAt` are all already in scope at this point in the component):

  ```ts
  const garminSyncLine = garminEmail
    ? (garminLastSyncAt ? `Garmin: synced ${formatRelativeSyncTime(new Date(garminLastSyncAt))}` : 'Garmin: not yet synced')
    : null
  const intervalsSyncLine = lastSyncedAt ? `Intervals: synced ${formatRelativeSyncTime(lastSyncedAt)}` : null
  ```

  (The inner ternary guards the case where `garminEmail` is set but `garminLastSyncAt` is still null — matching today's "Garmin not yet synced" copy.)

- Replace the current single-caption block:

  ```tsx
  {garminEmail && (
    <p className="w-28 text-[11px] leading-snug text-gray-500 text-center">
      {garminLastSyncAt ? `Garmin synced ${formatGarminSyncTime(garminLastSyncAt)}` : 'Garmin not yet synced'}
    </p>
  )}
  ```

  with:

  ```tsx
  {(garminSyncLine || intervalsSyncLine) && (
    <div className="text-right">
      {garminSyncLine && (
        <p className={`text-[11px] leading-snug ${garminStale ? 'text-amber-600 font-semibold' : 'text-gray-500'}`}>
          {garminStale && '⚠ '}{garminSyncLine}
        </p>
      )}
      {intervalsSyncLine && (
        <p className="text-[11px] leading-snug text-gray-500">{intervalsSyncLine}</p>
      )}
    </div>
  )}
  ```

- No changes to the Sync button itself, to `doSync`, or to the amber stale banner block (which keeps calling `formatGarminSyncTime` directly, imported as it already is).

## Testing

- New unit test file `__tests__/lib/format-sync-time.test.ts` covering `formatRelativeSyncTime`: returns `''` for `null`; returns `today at HH:MM` for a timestamp on today's date; returns `yesterday at HH:MM` for yesterday; returns `{day} {month} at HH:MM` for an older date. (This logic previously had no dedicated unit test — it was only exercised indirectly through `MetricsBar` — so extracting it is a net improvement in coverage, not just a move.)
- `__tests__/components/MetricsBar.test.tsx`: no existing test references `syncedAt` or sync-time text, so no test changes are required there; the existing suite continues to pass unmodified against the trimmed component.
- `app/dashboard/page.tsx` has no existing test file (consistent with the rest of the dashboard — it's not covered by page-level tests today, likely due to its size and heavy use of effects/drag-and-drop), and this change doesn't introduce one. Verification for the page-level layout is manual: check the header block at 375px width with (a) Garmin linked and fresh, (b) Garmin linked and stale, (c) Garmin not linked, (d) before the first sync completes (`lastSyncedAt` still null).

## Global Constraints

- Sync time is shown in exactly one place per source: the new header block for both Garmin and intervals.icu; the Strain panel shows neither.
- The Garmin line's amber/warning styling reuses the page's existing `garminStale` value (`isGarminSyncStale(garminLastSyncAt)`) — no new staleness logic is introduced.
- The amber "Garmin hasn't synced today" banner and its `formatGarminSyncTime` absolute-date formatting are unchanged.
- Both new header lines use the same relative-time format (`formatRelativeSyncTime`) so Garmin and intervals.icu read consistently side by side.
