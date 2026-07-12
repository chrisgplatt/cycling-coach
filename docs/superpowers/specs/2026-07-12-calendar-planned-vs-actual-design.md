# Calendar Planned vs Actual Summary Design

## Goal

Show both planned and actual TSS/time together, everywhere the calendar currently shows a per-week summary number — the mini month-calendar's left-hand summary column, and the week-list header above each week's day cards — instead of showing only one value (chosen by week status) as it does today.

## Background

Two places on the calendar page (`app/calendar/page.tsx`) currently show a single weekly TSS/duration figure per week:

1. **`MonthStrip`'s week-row summary column** (lines ~164-193): a narrow (`w-10`, 40px) column to the left of each week's 7 day cells. Today it picks ONE value to show — actual (green) for a fully past week, actual-if-available-else-planned (orange) for the current week, planned (slate) for a fully future week — via `isPastWeek`/`isCurrentWeek`/`hasActual`/`showActual` branching.
2. **`WeekHeader`** (lines ~382-411), shown above each week's block in the scrollable "continuous week list" below the mini calendar. Today it sums TSS/duration across ALL non-skipped workouts for the week regardless of status, blending planned and completed sessions into one combined number — not even a clean "one or the other" choice like `MonthStrip`, just a mixed total.

Both places already have (or can easily get) the data needed to show planned and actual side by side: `getWeeklySummary(dates, workouts, activities)` (`lib/calendar-helpers.ts:129`) already computes `plannedTss`, `actualTss`, `plannedMins`, `actualMins` together — `MonthStrip` already calls it but only displays one side; `WeekHeader` doesn't call it at all, computing its own combined total independently.

## Display Format

Both locations render the same two-line stacked block:

```
180/220
210m/240m
```

- **Line 1 (TSS)**: `{actualTss}/{plannedTss}`, bare integers, no unit suffix. Actual in green (`text-emerald-600`), the `/` in a neutral tone (`text-slate-300`), planned in gray (`text-slate-400`).
- **Line 2 (time)**: `{actualMins}m/{plannedMins}m`, full-precision minutes (no hour conversion, no rounding beyond whole minutes — durations are already integer-minute granularity in this app) with an explicit `m` suffix on both sides so the line stays visually distinct from the bare-number TSS line above it. Same actual/`/`/planned coloring as the TSS line.
- Each line renders independently: the TSS line only appears when `actualTss > 0 || plannedTss > 0`; the time line only appears when `actualMins > 0 || plannedMins > 0`. A week with genuinely nothing to show (no planned sessions ever existed and nothing was completed) renders neither line, same as today's "hide if nothing to show" behavior.
- Coloring is by *value type* (actual vs planned), not by week status — this replaces `MonthStrip`'s current past/current/future color scheme (`text-emerald-600` / `text-orange-500` / `text-slate-300` chosen by week position), since actual and planned are now always shown together and distinguished by their own color rather than the week's temporal state.

## Shared Component

A new small presentational component, `WeeklySummaryStack({ summary }: { summary: WeeklySummary })`, defined inline in `app/calendar/page.tsx` (matching this file's existing convention of keeping calendar-specific subcomponents local rather than splitting into `components/` — `WeekHeader`, `WeekDetail`, `ContinuousWeeks`, and `MonthStrip` are all already defined this way in the same file). It takes the `WeeklySummary` object `getWeeklySummary()` already returns and renders exactly the two-line block described above. Both call sites below use it, so the format is defined once.

## Call Site 1: `MonthStrip`

The week-row summary column (`app/calendar/page.tsx`, inside the `weeks.map(...)` block) currently computes:

```ts
const summary = getWeeklySummary(weekDateStrs, workouts, unlinkedActivities)
const isCurrentWeek = weekDateStrs.includes(todayStr)
const isPastWeek = !isCurrentWeek && weekDateStrs.every(d => d < todayStr)
const hasActual = summary.actualTss > 0 || summary.actualMins > 0
const showActual = isPastWeek || (isCurrentWeek && hasActual)
const showTss = showActual ? summary.actualTss : summary.plannedTss
const showMins = showActual ? summary.actualMins : summary.plannedMins
const summaryColor = isPastWeek ? 'text-emerald-600' : isCurrentWeek ? 'text-orange-500' : 'text-slate-300'
```

then renders `showTss`/`showMins` in `summaryColor`. This is replaced by keeping the existing `getWeeklySummary(...)` call (unchanged) and rendering `<WeeklySummaryStack summary={summary} />` in place of the old conditional block. `isCurrentWeek`, `isPastWeek`, `hasActual`, `showActual`, `showTss`, `showMins`, and `summaryColor` are all removed — nothing else in that render block depends on them (the day-cell grid below uses its own separately-computed `isToday`/`inSelectedWeek`, untouched).

## Call Site 2: `WeekHeader`

Currently:

```ts
function WeekHeader({ monday, todayStr, workouts }: { monday: string; todayStr: string; workouts: Workout[] }) {
  ...
  const weekWorkouts = workouts.filter(w => w.date >= start && w.date <= end && w.status !== 'skipped')
  const totalMins = weekWorkouts.reduce((sum, w) => sum + w.duration_minutes, 0)
  const totalTss = weekWorkouts.reduce((sum, w) => sum + (w.tss ?? 0), 0)
  const hasTss = weekWorkouts.some(w => w.tss != null)
  return (
    <div className="flex items-center gap-2 px-1 pb-1 pt-0.5">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      {isThisWeek && (...)}
      {weekWorkouts.length > 0 && (
        <span className="ml-auto text-[10px] text-slate-400">
          {formatDurationMins(totalMins)}{hasTss ? ` · ${Math.round(totalTss)} TSS` : ''}
        </span>
      )}
    </div>
  )
}
```

Changes:
- Signature gains `unlinkedActivities: ICUActivity[]`, matching the type already used elsewhere in this file (`WeekDetailProps.unlinkedActivities`).
- `weekWorkouts`/`totalMins`/`totalTss`/`hasTss` are removed, replaced by `const summary = getWeeklySummary(weekDates(monday), workouts, unlinkedActivities)` (`weekDates` is already imported in this file and already used the same way elsewhere, e.g. `MonthStrip`'s `selectedWeek = weekDates(selectedDateStr)`).
- The final `{weekWorkouts.length > 0 && (...)}` block is replaced by rendering `<WeeklySummaryStack summary={summary} />` inside a wrapper that keeps it right-aligned in the header row (`ml-auto`), now stacked as two lines instead of one — the header row's height grows slightly to accommodate this, which is expected and accepted (this was explicitly chosen over a single inline line during design).

**Call site update**: `ContinuousWeeks` renders `<WeekHeader monday={monday} todayStr={week.todayStr} workouts={week.workouts} />` (`app/calendar/page.tsx:487`). This becomes `<WeekHeader monday={monday} todayStr={week.todayStr} workouts={week.workouts} unlinkedActivities={week.unlinkedActivities} />` — `week` is the spread `ContinuousWeeksProps` (`Omit<WeekDetailProps, 'selectedDateStr'>`), which already includes `unlinkedActivities`, so no new prop threading beyond this one call site.

## Testing

`app/calendar/page.tsx` has no existing test file (consistent with several other large page components in this app — dashboard, plan — which also have none, likely due to size and heavy use of drag-and-drop/scrolling interactions). This change follows that existing gap; no new page-level test is introduced. `lib/calendar-helpers.ts`'s `getWeeklySummary` is unchanged and already has its own test coverage (unaffected). Verification is manual: check the mini calendar and week-list header render both lines correctly for a past week (both actual and planned present), the current week (in-progress, partial actual), and a future week (planned only, TSS/time lines still render since `plannedTss`/`plannedMins` are nonzero even though actual is 0).

## Global Constraints

- `getWeeklySummary` (`lib/calendar-helpers.ts`) is unchanged — this is a display-only change built on data it already computes.
- No hour conversion or rounding for the time line — always full-precision whole minutes with an `m` suffix.
- Coloring is by value type (actual = green, planned = gray) everywhere this component is used, not by week temporal status.
- `WeeklySummaryStack` is the single source of truth for this two-line format — both call sites render it rather than each re-implementing the layout.
