# Dashboard Week Navigation Design

**Date:** 2026-07-20
**Status:** Approved

## Problem

The dashboard's "This week" section (day-by-day list of workout cards, standalone events, unplanned activities, and wellness cards) is hardcoded to the calendar week containing today — `weekDates` is computed directly from `new Date()` with no way to view any other week. The rest of the dashboard (briefing card, strain ring, HRV/CTL panels, progress stats) is inherently a "right now" view and should stay anchored to today regardless.

## Scope decisions (from brainstorming)

- Navigation applies **only** to the "This week" day-list section. Every other widget on the dashboard (`TodayCard`, `StrainRingStrip`, `MetricsBar`/`HrvStatusChip`/`HrvTrendPanel`/`CtlTrendStrip`, `ProgressStats`) continues to reflect today, unaffected by which week is being viewed.
- Range is **unbounded** in both directions. Outside the data windows that already exist (wellness ~±45 days from sync, activities ~6 weeks back, weather forecast only for the current week), the affected cards/chips simply render nothing — the same graceful-empty behavior the dashboard already has for any date with no data. No special-casing needed.
- When viewing the **current week**, the heading keeps its exact existing look: "This week" title, date-range subtitle, TSS/duration summary.
- When viewing **any other week**, the "This week" title is replaced by the date range itself (subtitle format unchanged), and a "Today" button appears next to the navigation chevrons to jump back to the current week in one tap. The TSS/duration summary line continues to reflect whichever week is displayed — no change needed there since it's already derived from `weekDates`.
- The selected week is **transient, page-local state** — it always resets to the current week on reload/reopen. No persistence, no URL state.

## Architecture

### Reuse the existing `weekDates` helper instead of duplicating date math

`app/dashboard/page.tsx` currently computes its own `weekDates` array inline (lines 476–483) via a hand-rolled day-of-week loop. `lib/calendar-helpers.ts` already exports a `weekDates(dateStr: string): string[]` function (used by the calendar page) that does the same thing, built on `getWeekBounds`. The dashboard should import and use that helper instead, keyed off a new piece of state rather than always off today — removing the duplicated logic as part of this change.

### New state: `selectedWeekStart`

Add `const [selectedWeekStart, setSelectedWeekStart] = useState(() => getWeekBounds(localDateStr(new Date())).start)` to `DashboardPage`. This is the Monday (YYYY-MM-DD) of whichever week is currently displayed in the "This week" section, initialized to the current week's Monday.

Replace the inline `weekDates` computation with:
```ts
import { weekDates as computeWeekDates } from '@/lib/calendar-helpers'
// ...
const weekDates = computeWeekDates(selectedWeekStart)
```
(the imported helper is aliased on import so the existing local variable name `weekDates` — used throughout the rest of the file — needs no renaming at any call site).

### Navigation handlers

Two simple handlers shift `selectedWeekStart` by a week using existing local-date-safe math (matching the pattern already used elsewhere in this file, e.g. `getWeekBounds`):

```ts
function shiftWeek(deltaDays: number) {
  const [y, m, d] = selectedWeekStart.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + deltaDays))
  setSelectedWeekStart(next.toISOString().split('T')[0])
}
```
Prev button calls `shiftWeek(-7)`, Next calls `shiftWeek(7)`. A "Today" button (shown only when not on the current week) calls `setSelectedWeekStart(getWeekBounds(localDateStr(new Date())).start)`.

### Heading changes

`isCurrentWeek = selectedWeekStart === getWeekBounds(localDateStr(new Date())).start` determines:
- Title text: `isCurrentWeek ? 'This week' : '<date range>'` (the date range already renders below as the subtitle today; when not on the current week, the same formatted range also becomes the title, and the subtitle can be dropped or kept — implementation will keep the subtitle for consistency and just change the `<h2>` text).
- Whether the "Today" button renders next to the chevrons.

Everything downstream in the day-list render (the `.map` over `weekDates`, workout/event/activity/wellness lookups) is already keyed off the `weekDates` array and needs no other changes — it will naturally render whichever week is selected.

### Placement of controls

The Prev/Next chevrons (and conditional Today button) sit inline with the existing "This week" heading row, to the right of the TSS/duration summary — consistent with the existing `MonthStrip` prev/next month button styling in `app/calendar/page.tsx` (`‹`/`›`, `min-h-[44px]` tap targets, `aria-label`s for accessibility).

## Files to change

| File | Change |
|---|---|
| `app/dashboard/page.tsx` | Add `selectedWeekStart` state; replace inline week-date computation with `lib/calendar-helpers`'s `weekDates`; add `shiftWeek`/jump-to-today handlers; add Prev/Next/Today controls to the section heading; conditional title text |
| Tests | Cover: default view is the current week; Prev/Next shift the displayed days and heading; Today button appears only when off the current week and returns to it; day-list content (workouts/events/wellness cards) reflects the newly selected week's dates |

## Out of scope

- Any change to today-anchored widgets (`TodayCard`, `StrainRingStrip`, HRV/CTL panels, `ProgressStats`) — none of them read `selectedWeekStart`.
- Any new data fetching — existing `workouts`, `events`, `dailyWellness`, and `syncData.activities` loads are unchanged; they already cover a wide enough window for adjacent weeks to render meaningfully, and gracefully show nothing outside that window.
- Persisting the selected week across reloads (e.g. via URL query param) — explicitly deferred; state is transient and always resets to the current week on page load.
- Swipe/gesture navigation — only tap-target buttons are in scope.
