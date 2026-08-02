# Weekly Progress Motivation Design

**Date:** 2026-08-02
**Status:** Approved

## Problem

The app already tracks a weekly activity streak (`computeWeeklyStreak` in `lib/streak.ts`: consecutive ISO weeks with ≥1 activity) and per-activity-type weekly stats (`ActivityStatsPanel`: a trailing 12-week distance/time/elevation chart per Ride/Walk/Run/Other), both inside a collapsible "Progress Stats" card on the dashboard. Two gaps make this data less motivating than it could be:

1. **The streak is buried.** Its row header already shows the live count ("🔥 Streak · 43 wks"), but that row sits below Today's card, a strain ring strip, a metrics bar, and an HRV/CTL panel — it requires scrolling past all of that, and the detailed calendar view requires an additional tap to expand.
2. **No session count for Ride/Walk/Run.** The stats row for these three activity types shows Distance / Time / Elevation for the selected week, but never how many sessions that week contained — even though the underlying weekly bucket already computes a `sessions` count (the "Other" tab already displays it, since it has no distance to show instead).

## Scope decisions (from brainstorming)

- The streak *definition* (any ISO week with ≥1 activity) is unchanged — this is a visibility fix, not a redefinition.
- The streak badge shows only when there's an active streak (>0); it renders nothing otherwise, matching the existing calendar's own behavior. No "start a streak" nudge copy.
- The badge is static — no tap interaction, no scroll-to/expand wiring to the Progress Stats card.
- The session-count addition applies to all three of Ride, Walk, and Run (not Ride alone), for consistency with the existing "Other" tab.

## Feature 1: Streak badge at the top of the dashboard

### Architecture

A new small display-only component, `StreakBadge`, rendered in `app/dashboard/page.tsx` directly above `TodayCard` — inside the existing `<div className="space-y-3">` wrapper that currently holds only `NotificationBanner` (`app/dashboard/page.tsx:680-695`). It computes its own value from the same `chartsData?.activities` array already fetched for `ProgressStats` (`app/dashboard/page.tsx:736`) — no new data fetching, no new API route.

### Component

`components/StreakBadge.tsx`:

```tsx
'use client'
import type { ActivitySummary } from '@/types'
import { computeWeeklyStreak } from '@/lib/streak'

interface Props {
  activities: ActivitySummary[] | undefined
  today: string
}

export default function StreakBadge({ activities, today }: Props) {
  const streak = computeWeeklyStreak(activities ?? [], today)
  if (streak === 0) return null

  return (
    <div
      data-testid="streak-badge"
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold bg-orange-50 border-orange-200 text-orange-700"
    >
      <span aria-hidden="true">🔥</span>
      <span>{streak}-week streak</span>
    </div>
  )
}
```

Reuses `computeWeeklyStreak` from `lib/streak.ts` unchanged — the same pure function the existing calendar and row-header count already call — so the badge, the row header, and the calendar can never disagree with each other.

### Wiring

In `app/dashboard/page.tsx`, add `<StreakBadge activities={chartsData?.activities} today={todayStr} />` as the first child inside the existing `<div className="space-y-3">` block that wraps `NotificationBanner` and `TodayCard` (both `chartsData` and `todayStr` are already in scope at that point in the file, per their existing use at lines 719 and 736).

### Error handling

- `activities` undefined/empty → `computeWeeklyStreak` returns 0 → component renders `null`. No loading or error state needed; this mirrors how `ProgressStats` already treats a missing/empty `activities` array (renders nothing for the streak/activity sections — see `activities && activities.length > 0` guard in `ProgressStats.tsx`).

### Testing

Unit tests for `StreakBadge` (React Testing Library, following this repo's existing component-test pattern):
- Renders `🔥 4-week streak` text when `computeWeeklyStreak` would return 4 for the given activities/today
- Renders nothing (`null`) when the streak is 0
- Renders nothing when `activities` is `undefined`

## Feature 2: Session count in the activity stats row

### Architecture

`components/ActivityStatsPanel.tsx`'s `TypePanel` already computes `sel.sessions` for every week bucket (`WeekBucket.sessions`, built in `buildBuckets` — `components/ActivityStatsPanel.tsx:62`), for every tab including Ride/Walk/Run. It's just not rendered for those three tabs today; only the `tab === 'Other'` branch of the "Stats row" shows a Sessions cell (`components/ActivityStatsPanel.tsx:139-146`). This feature surfaces that existing value for Ride/Walk/Run too — no new computation, no new props, no data-layer change.

### Change

In `components/ActivityStatsPanel.tsx`, the "Stats row" block (currently `lines 138-168`) changes from a 3-column layout for non-Other tabs to 4 columns, adding a session-count cell using each tab's own label (`TAB_LABELS[tab]`, already defined at the top of the file as `{ Ride: 'Rides', Walk: 'Walks', Run: 'Runs', Other: 'Other' }`):

```tsx
<div className={`grid gap-2 mb-3 ${tab === 'Other' ? 'grid-cols-2' : 'grid-cols-4'}`}>
  {tab === 'Other' ? (
    <>
      <div className="text-center">
        <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Sessions</div>
        <div className="text-base font-bold text-gray-900">
          {sel.sessions === 1 ? '1 session' : `${sel.sessions} sessions`}
        </div>
      </div>
      <div className="text-center">
        <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Time</div>
        <div className="text-base font-bold text-gray-900">{sel.timeSecs > 0 ? fmtTime(sel.timeSecs) : '—'}</div>
      </div>
    </>
  ) : (
    <>
      <div className="text-center">
        <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Distance</div>
        <div className="text-base font-bold text-gray-900">{sel.distanceKm > 0 ? `${sel.distanceKm.toFixed(1)} km` : '—'}</div>
      </div>
      <div className="text-center">
        <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Time</div>
        <div className="text-base font-bold text-gray-900">{sel.timeSecs > 0 ? fmtTime(sel.timeSecs) : '—'}</div>
      </div>
      <div className="text-center">
        <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Elevation</div>
        <div className="text-base font-bold text-gray-900">{sel.elevationM > 0 ? `${sel.elevationM} m` : '—'}</div>
      </div>
      <div className="text-center">
        <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">{TAB_LABELS[tab]}</div>
        <div className="text-base font-bold text-gray-900">{sel.sessions}</div>
      </div>
    </>
  )}
</div>
```

The count reflects whichever week is currently selected in the chart (`sel`, driven by `selectedIdx` — same selected-week semantics as Distance/Time/Elevation already use), so clicking a past week in the trend chart updates all four stats together, not just three.

### Error handling

None needed beyond what already exists — `sel.sessions` is always a plain number (`week.length` from a filter, per `buildBuckets`), never null/undefined, so no new empty-state branch is required.

### Testing

Extend the existing `ActivityStatsPanel` test file:
- Ride tab's stats row shows a 4th cell labeled "Rides" with the correct session count for the selected week
- Walk tab shows "Walks" with its count; Run tab shows "Runs" with its count
- Selecting a different week (via the existing chart-click interaction already under test) updates the session-count cell along with Distance/Time/Elevation
- "Other" tab's existing 2-column layout and Sessions cell are unchanged (regression check)
