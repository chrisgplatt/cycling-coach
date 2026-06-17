# MonthStrip Session Colours & Weekly Summary Design

## Goal

Enhance the compact monthly calendar grid (`MonthStrip`) at the top of the calendar page with two improvements:
1. Colour each day's workout dot by session type rather than a generic blue.
2. Add a left-side weekly summary column showing TSS and hours for each week row.

## Scope

Changes are confined to `MonthStrip` inside `app/calendar/page.tsx` and two new helpers in `lib/calendar-helpers.ts`. No new component files. No changes to `WeekDetail`, `WeekHeader`, or any other part of the page.

## Session Type Colour Mapping

Uses the existing `TYPE_BAR` accent colours already in `WorkoutCard.tsx`:

| Session type | Tailwind class   | Hex       |
|---|---|---|
| `intervals`  | `bg-orange-500`  | `#f97316` |
| `threshold`  | `bg-red-500`     | `#ef4444` |
| `endurance`  | `bg-blue-500`    | `#3b82f6` |
| `recovery`   | `bg-emerald-500` | `#10b981` |

When a day has multiple workouts, the hardest session wins. Priority order (descending): `intervals` (4) → `threshold` (3) → `endurance` (2) → `recovery` (1).

The existing event dot (`bg-red-400`) and unlinked-activity dot (`bg-sky-400`) are unchanged and continue to render alongside the workout dot.

## Weekly Summary Column

### Layout restructure

The current flat `grid grid-cols-7` date cell block is restructured into explicit week rows. The `cells` array (from `calendarMonthDays`) is chunked into arrays of 7. Each week row renders as:

```
[summary cell ~40px] [7 day cells flex-1]
```

The day-of-week header row (`M T W T F S S`) gains a blank left cell of equal width to stay aligned.

### Summary cell content

Two lines of `text-[9px]` text, right-aligned, inside a `~40px` column:

```
320        ← TSS (no label, context is clear)
4h 30m     ← hours and minutes
```

### Planned vs actual

For each week row, the summary calculates two buckets from that week's workouts:

- **Actual**: workouts with `status === 'completed'` or `status === 'needs_review'`
- **Planned**: workouts with `status === 'planned'`

Display rules:
- If actual TSS > 0 **or** actual minutes > 0 → show actual values in `text-slate-600` (full weight)
- Otherwise if planned TSS > 0 **or** planned minutes > 0 → show planned values in `text-slate-300` (dimmed)
- If no workouts at all → render nothing

This means:
- Past completed weeks → full-weight actual figures
- Future weeks → dimmed planned figures
- Current week → full-weight for what has been done, even if planned workouts remain

TSS is shown as a rounded integer. Duration uses the existing `formatDuration` helper (`"4h 30m"`, `"45m"`).

## New Helpers (`lib/calendar-helpers.ts`)

### `getDayWorkoutColor(dateStr: string, workouts: Workout[]): string | null`

Returns the Tailwind background class for the hardest workout on `dateStr`, or `null` if no workouts exist.

```ts
const TYPE_PRIORITY: Record<string, number> = {
  intervals: 4, threshold: 3, endurance: 2, recovery: 1,
}
const TYPE_COLOR: Record<string, string> = {
  intervals: 'bg-orange-500', threshold: 'bg-red-500',
  endurance: 'bg-blue-500',   recovery:  'bg-emerald-500',
}
```

### `getWeeklySummary(dates: string[], workouts: Workout[]): WeeklySummary`

```ts
interface WeeklySummary {
  actualTss: number
  actualMins: number
  plannedTss: number
  plannedMins: number
}
```

Filters `workouts` to those whose `date` is in `dates`, then partitions by status.

## Changes to `MonthStrip`

1. Import `getDayWorkoutColor` and `getWeeklySummary` from `lib/calendar-helpers`.
2. Chunk `cells` into weeks: `const weeks = chunk(cells, 7)`.
3. Replace the flat `<div className="grid grid-cols-7">` with:
   - A header row: `[blank 40px cell] + [M T W T F S S]`
   - Per-week rows: `[summary cell] + [grid-cols-7 day cells]`
4. In each day cell, replace the hard-coded `'bg-blue-400'` workout dot with `getDayWorkoutColor(dateStr, workouts) ?? 'bg-blue-400'` (fallback preserves existing behaviour for unknown types).

## Tests (`__tests__/lib/calendar-helpers.test.ts`)

### `getDayWorkoutColor`
1. Returns `null` when no workouts on that date.
2. Returns `bg-blue-500` for a single endurance workout.
3. Returns `bg-red-500` when a threshold and recovery workout are on the same day (threshold wins).
4. Returns `bg-orange-500` when intervals, threshold, and endurance all fall on the same day (intervals wins).

### `getWeeklySummary`
5. Returns actual TSS/mins from completed workouts; ignores planned.
6. Returns planned TSS/mins (dimmed bucket) when no completed workouts exist.
7. Returns zeros for both buckets when week has no workouts.
