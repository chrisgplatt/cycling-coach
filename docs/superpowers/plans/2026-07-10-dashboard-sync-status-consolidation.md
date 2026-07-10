# Dashboard Sync Status Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the dashboard's Sync button, Garmin last-sync time, and intervals.icu last-sync time into a single block in the top-right header, removing the duplicate intervals.icu sync timestamp currently shown lower down in the Strain panel.

**Architecture:** Extract the existing (currently private, `MetricsBar`-only) relative-day sync-time formatter into a small shared `lib/format-sync-time.ts` module. Then, in one coupled edit, strip the sync-time rendering out of `components/MetricsBar.tsx` and replace the dashboard header's single Garmin-only caption in `app/dashboard/page.tsx` with two lines (Garmin + intervals.icu) built from that shared formatter.

**Tech Stack:** Next.js App Router, TypeScript, React, Jest + Testing Library.

## Global Constraints

- Sync time is shown in exactly one place per source: the new header block for both Garmin and intervals.icu; the Strain panel (`MetricsBar`) shows neither.
- The Garmin line's amber/warning styling reuses the page's existing `garminStale` value (`isGarminSyncStale(garminLastSyncAt)`) — no new staleness logic is introduced.
- The amber "Garmin hasn't synced today" banner and its `formatGarminSyncTime` absolute-date formatting (`lib/garmin/sync-staleness.ts`) are unchanged — it keeps its own caller in `app/dashboard/page.tsx`.
- Both new header lines use the same relative-time format (`formatRelativeSyncTime`) so Garmin and intervals.icu read consistently side by side: `today at HH:MM`, `yesterday at HH:MM`, or `{day} {month} at HH:MM` for anything older.
- The spec's full design doc is at `docs/superpowers/specs/2026-07-10-dashboard-sync-status-design.md` — read it if any task step below is ambiguous.

---

### Task 1: Extract the shared relative sync-time formatter

**Files:**
- Create: `lib/format-sync-time.ts`
- Test: `__tests__/lib/format-sync-time.test.ts`

**Interfaces:**
- Produces: `formatRelativeSyncTime(syncedAt: Date | null, now?: Date): string` — returns `''` for `null`; `"today at HH:MM"` when `syncedAt` falls on the same calendar date as `now`; `"yesterday at HH:MM"` when it falls on the calendar date immediately before `now`; otherwise `"{day} {month-short} at HH:MM"` (e.g. `"28 Jun at 11:45"`). `now` defaults to `new Date()` when omitted — this optional second parameter is a small deliberate addition on top of the spec's literal code sample, purely so tests can pin "today" deterministically instead of depending on the real system clock. It matches the same pattern already used by `isGarminSyncStale` in `lib/garmin/sync-staleness.ts` (`now: Date = new Date()`), and every call site in this plan only ever passes one argument, so it changes nothing about observed behavior at the two call sites added in Task 2.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/format-sync-time.test.ts`:

```ts
import { formatRelativeSyncTime } from '@/lib/format-sync-time'

describe('formatRelativeSyncTime', () => {
  it('returns an empty string when syncedAt is null', () => {
    expect(formatRelativeSyncTime(null)).toBe('')
  })

  it('formats a timestamp from today as "today at HH:MM"', () => {
    const now = new Date('2026-07-10T14:30:00')
    const syncedAt = new Date('2026-07-10T09:05:00')
    expect(formatRelativeSyncTime(syncedAt, now)).toBe('today at 09:05')
  })

  it('formats a timestamp from yesterday as "yesterday at HH:MM"', () => {
    const now = new Date('2026-07-10T08:00:00')
    const syncedAt = new Date('2026-07-09T21:14:00')
    expect(formatRelativeSyncTime(syncedAt, now)).toBe('yesterday at 21:14')
  })

  it('formats an older timestamp as "{day} {month} at HH:MM"', () => {
    const now = new Date('2026-07-10T08:00:00')
    const syncedAt = new Date('2026-06-28T11:45:00')
    expect(formatRelativeSyncTime(syncedAt, now)).toBe('28 Jun at 11:45')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/format-sync-time.test.ts`
Expected: FAIL — `Cannot find module '@/lib/format-sync-time'` (the file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `lib/format-sync-time.ts`:

```ts
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Formats a sync timestamp relative to now's date, e.g. "today at 14:20",
 * "yesterday at 09:05", "2 Jul at 21:14". Returns '' when syncedAt is null.
 */
export function formatRelativeSyncTime(syncedAt: Date | null, now: Date = new Date()): string {
  if (!syncedAt) return ''
  const timeStr = syncedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const todayStr = now.toISOString().split('T')[0]
  const syncedStr = syncedAt.toISOString().split('T')[0]
  if (syncedStr === todayStr) return `today at ${timeStr}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (syncedStr === yesterday.toISOString().split('T')[0]) return `yesterday at ${timeStr}`
  const [, month, day] = syncedStr.split('-').map(Number)
  return `${day} ${MONTHS_SHORT[month - 1]} at ${timeStr}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/format-sync-time.test.ts`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/format-sync-time.ts __tests__/lib/format-sync-time.test.ts
git commit -m "feat: add shared relative sync-time formatter"
```

---

### Task 2: Consolidate sync status into the dashboard header

**Files:**
- Modify: `components/MetricsBar.tsx` (remove the now-superseded local `formatSyncTime` function, `MONTHS_SHORT` constant, the `syncedAt` prop, and its two render sites)
- Modify: `app/dashboard/page.tsx` (import the shared formatter, stop passing `syncedAt` to `MetricsBar`, compute the two new status lines, replace the header's Garmin-only caption with both lines)

**Interfaces:**
- Consumes: `formatRelativeSyncTime(syncedAt: Date | null, now?: Date): string` from Task 1's `lib/format-sync-time.ts`.
- Produces: nothing further — this is the last task in the plan.

- [ ] **Step 1: Remove the old formatter and constant from `components/MetricsBar.tsx`**

Find and delete this whole block (currently near the top of the file, just after the `Metric` component):

```ts
function formatSyncTime(syncedAt: Date | null): string {
  if (!syncedAt) return ''
  const timeStr = syncedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const syncedStr = syncedAt.toISOString().split('T')[0]
  if (syncedStr === todayStr) return `Synced today at ${timeStr}`
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (syncedStr === yesterday.toISOString().split('T')[0]) return `Synced yesterday at ${timeStr}`
  const [, month, day] = syncedStr.split('-').map(Number)
  const monthName = MONTHS_SHORT[month - 1]
  return `Synced ${day} ${monthName} at ${timeStr}`
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
```

Delete it entirely — nothing else in this file references `formatSyncTime` or `MONTHS_SHORT` after Step 3 below.

- [ ] **Step 2: Remove the `syncedAt` prop from `MetricsBar`'s signature**

Find:

```ts
export default function MetricsBar({
  wellness,
  syncedAt = null,
  stale = {},
  embedded = false,
  lastRideLabel,
  onStrainTap,
  strainHistory,
  hrvStatus,
  todayDailyWellness,
}: {
  wellness: ICUWellness | null
  syncedAt?: Date | null
  stale?: { hrv?: boolean; restingHr?: boolean }
  embedded?: boolean
  lastRideLabel?: string
  onStrainTap?: () => void
  strainHistory?: DailyStrainPoint[]
  hrvStatus?: HrvStatus | null
  todayDailyWellness?: { energy: number | null; leg_freshness: number | null } | null
}) {
```

Replace with:

```ts
export default function MetricsBar({
  wellness,
  stale = {},
  embedded = false,
  lastRideLabel,
  onStrainTap,
  strainHistory,
  hrvStatus,
  todayDailyWellness,
}: {
  wellness: ICUWellness | null
  stale?: { hrv?: boolean; restingHr?: boolean }
  embedded?: boolean
  lastRideLabel?: string
  onStrainTap?: () => void
  strainHistory?: DailyStrainPoint[]
  hrvStatus?: HrvStatus | null
  todayDailyWellness?: { energy: number | null; leg_freshness: number | null } | null
}) {
```

- [ ] **Step 3: Remove the two `formatSyncTime` render call sites**

Inside the colored strain band, find:

```tsx
            <div className="text-right">
              <div className="text-[11px] text-white/60">{formatSyncTime(syncedAt)}</div>
              {lastRideLabel && (
                <div className="text-[11px] text-white/60">
                  Last ride: <span className="font-semibold text-white/85">{lastRideLabel}</span>
                </div>
              )}
            </div>
```

Replace with:

```tsx
            <div className="text-right">
              {lastRideLabel && (
                <div className="text-[11px] text-white/60">
                  Last ride: <span className="font-semibold text-white/85">{lastRideLabel}</span>
                </div>
              )}
            </div>
```

Inside the gray fallback header (the "no strain data" branch), find:

```tsx
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
          <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">Fitness Stats</h2>
          <div className="text-right">
            <div className="text-xs text-gray-400">{formatSyncTime(syncedAt)}</div>
            {lastRideLabel && (
              <div className="text-[11px] text-gray-400">Last ride: <span className="font-medium text-gray-500">{lastRideLabel}</span></div>
            )}
          </div>
        </div>
```

Replace with:

```tsx
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
          <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">Fitness Stats</h2>
          <div className="text-right">
            {lastRideLabel && (
              <div className="text-[11px] text-gray-400">Last ride: <span className="font-medium text-gray-500">{lastRideLabel}</span></div>
            )}
          </div>
        </div>
```

(The `text-right` wrapper `<div>` stays in both places even though its only remaining child is now conditional — this matches its existing behavior when `lastRideLabel` was already `undefined` and `formatSyncTime` returned `''`, which also rendered this wrapper with no visible content.)

- [ ] **Step 4: Add the new import to `app/dashboard/page.tsx`**

Find this existing import line:

```ts
import { isGarminSyncStale, formatGarminSyncTime } from '@/lib/garmin/sync-staleness'
```

Add a new line directly after it:

```ts
import { formatRelativeSyncTime } from '@/lib/format-sync-time'
```

(`formatGarminSyncTime` stays imported and stays used — it's still the formatter for the amber "Garmin hasn't synced today" banner further down the page, which this task does not touch.)

- [ ] **Step 5: Stop passing `syncedAt` to `MetricsBar`**

Find:

```tsx
          <MetricsBar
            wellness={latestWellnessWithLoad}
            syncedAt={lastSyncedAt}
            stale={wellnessStale}
            embedded
            lastRideLabel={lastRide ? formatLastRide() : undefined}
            onStrainTap={() => setStrainSheetOpen(true)}
            strainHistory={chartsData?.dailyStrain}
            hrvStatus={hrvStatus}
            todayDailyWellness={todayDailyWellnessForCard}
          />
```

Replace with:

```tsx
          <MetricsBar
            wellness={latestWellnessWithLoad}
            stale={wellnessStale}
            embedded
            lastRideLabel={lastRide ? formatLastRide() : undefined}
            onStrainTap={() => setStrainSheetOpen(true)}
            strainHistory={chartsData?.dailyStrain}
            hrvStatus={hrvStatus}
            todayDailyWellness={todayDailyWellnessForCard}
          />
```

- [ ] **Step 6: Compute the two new status lines**

Find (just above the component's `return (`):

```tsx
  const garminStale = !!garminEmail && isGarminSyncStale(garminLastSyncAt)

  return (
```

Replace with:

```tsx
  const garminStale = !!garminEmail && isGarminSyncStale(garminLastSyncAt)
  const garminSyncLine = garminEmail
    ? (garminLastSyncAt ? `Garmin: synced ${formatRelativeSyncTime(new Date(garminLastSyncAt))}` : 'Garmin: not yet synced')
    : null
  const intervalsSyncLine = lastSyncedAt ? `Intervals: synced ${formatRelativeSyncTime(lastSyncedAt)}` : null

  return (
```

- [ ] **Step 7: Replace the header's Garmin-only caption with both lines**

Find:

```tsx
        <div className="flex flex-col items-end gap-1 shrink-0">
          <button
            onClick={doSync}
            disabled={syncing}
            className="relative overflow-hidden flex items-center justify-center gap-1.5 w-28 py-1.5 text-sm font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-full hover:bg-blue-100 disabled:cursor-default transition-colors"
          >
            {syncLogoVisible && (
              <span className={syncLogoExiting
                ? 'animate-[sync-bike-exit_0.35s_ease-in_forwards]'
                : 'animate-[sync-bike-enter_0.3s_ease-out_forwards]'
              }>
                <AnimatedLogo size={18} spin={!syncLogoExiting} />
              </span>
            )}
            <span className={syncLogoExiting ? 'opacity-0 transition-opacity duration-200' : ''}>
              {syncLogoVisible ? 'Syncing' : '↻ Sync'}
            </span>
          </button>
          {garminEmail && (
            <p className="w-28 text-[11px] leading-snug text-gray-500 text-center">
              {garminLastSyncAt ? `Garmin synced ${formatGarminSyncTime(garminLastSyncAt)}` : 'Garmin not yet synced'}
            </p>
          )}
        </div>
```

Replace with:

```tsx
        <div className="flex flex-col items-end gap-1 shrink-0">
          <button
            onClick={doSync}
            disabled={syncing}
            className="relative overflow-hidden flex items-center justify-center gap-1.5 w-28 py-1.5 text-sm font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-full hover:bg-blue-100 disabled:cursor-default transition-colors"
          >
            {syncLogoVisible && (
              <span className={syncLogoExiting
                ? 'animate-[sync-bike-exit_0.35s_ease-in_forwards]'
                : 'animate-[sync-bike-enter_0.3s_ease-out_forwards]'
              }>
                <AnimatedLogo size={18} spin={!syncLogoExiting} />
              </span>
            )}
            <span className={syncLogoExiting ? 'opacity-0 transition-opacity duration-200' : ''}>
              {syncLogoVisible ? 'Syncing' : '↻ Sync'}
            </span>
          </button>
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
        </div>
```

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms `MetricsBar`'s narrowed prop type and the dashboard page's new usage line up, and that no other file in the codebase still passes a `syncedAt` prop to `MetricsBar`).

- [ ] **Step 9: Run the full test suite**

Run: `npx jest`
Expected: all suites pass, including `__tests__/components/MetricsBar.test.tsx` (unaffected — it never referenced `syncedAt`) and Task 1's new `__tests__/lib/format-sync-time.test.ts`.

- [ ] **Step 10: Manual verification**

`app/dashboard/page.tsx` has no existing automated test file (consistent with the rest of the dashboard), so verify the layout by hand. Start the dev server (`npm run dev`), open the dashboard, and resize the browser to ~375px wide. Check:

- **Garmin linked, synced today:** header shows the Sync button, then a gray "Garmin: synced today at HH:MM" line, then a gray "Intervals: synced today at HH:MM" line — no warning glyph.
- **Garmin linked, stale** (simulate by checking a profile where Garmin hasn't synced today, or temporarily editing `garmin_last_sync_at` in the DB to yesterday): the Garmin line turns amber/bold with a leading `⚠` glyph; the Intervals line is unaffected; the existing amber "Garmin hasn't synced today" banner at the top of the page still appears as before.
- **Garmin not linked** (`garmin_email` unset on the profile): only the Intervals line appears; no Garmin line, no layout gap, no crash.
- **Before the first sync completes** (reload the page and look immediately, before `lastSyncedAt` populates): the Intervals line is simply absent until the sync finishes, then appears without a page reload.
- **Strain panel**: scroll down to the strain/fitness-stats card and confirm it no longer shows any sync timestamp — only the "Last ride" label (or nothing, if there's no recent ride).

- [ ] **Step 11: Commit**

```bash
git add components/MetricsBar.tsx app/dashboard/page.tsx
git commit -m "feat: consolidate Garmin and intervals.icu sync status into dashboard header"
```
