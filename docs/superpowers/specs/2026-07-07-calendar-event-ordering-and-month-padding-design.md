# Calendar Event Ordering & Month Padding Design

## Goal

Two independent fixes to the Calendar page and Dashboard's weekly widget:

1. A day's standalone event card (e.g. a holiday banner, an upcoming race with no result yet) should render above that day's workout card(s), not below.
2. The Calendar month-strip's grid should show real adjacent-month dates (dimmed, fully interactive) instead of blank cells when the first/last day of the month doesn't land on the first/last day of a week — and the weekly TSS/duration totals shown alongside each week row should correctly include those adjacent-month days.

## Background

Both the Calendar page's `WeekDetail` component and the Dashboard's "This week" widget build each day's card stack in the same order today: workout cards first (with any event *linked* to a specific completed workout — matched by `icu_activity_id` — nested directly beneath that workout via a small connector bracket), then standalone events, then unplanned activities. This means a standalone event for the day always appears visually last, below any workouts.

Separately, `lib/calendar-helpers.ts`'s `calendarMonthDays(year, month)` returns `(string | null)[]`: real date strings for the displayed month, with `null` placeholders for the days before day 1 needed to align the grid to Monday-start weeks. It adds no trailing padding after the last day of the month, so the final week's row can come up short of 7 cells. `MonthStrip` (`app/calendar/page.tsx`) renders each `null` as an empty, non-interactive `<div>`, and its weekly summary (`getWeeklySummary`) is computed only from the real (non-null) dates in each week row — so a week straddling a month boundary currently shows an incomplete total and blank cells instead of the previous/next month's actual dates.

## Change 1: Event-before-workout ordering

In `app/calendar/page.tsx`'s `WeekDetail` and `app/dashboard/page.tsx`'s weekly widget, each day's render block currently is:

```
{dayWorkouts.map(w => ... linked-event-nested-beneath ...)}
{standaloneEvents.map(e => ...)}
{dayActivities / unplannedActivities .map(...)}
```

This becomes:

```
{standaloneEvents.map(e => ...)}
{dayWorkouts.map(w => ... linked-event-nested-beneath ...)}
{dayActivities / unplannedActivities .map(...)}
```

Only the order of these two blocks changes — no changes to what counts as "standalone" vs "linked," no changes to the linked-event nesting under its workout, no changes to `isEmpty`/rest-day logic. This is a pure JSX reorder in both files.

## Change 2: Adjacent-month days in the month grid

### `lib/calendar-helpers.ts`

`calendarMonthDays`'s return type changes from `(string | null)[]` to `{ date: string; inMonth: boolean }[]`:

```ts
export function calendarMonthDays(year: number, month: number): { date: string; inMonth: boolean }[]
```

- Leading days (before day 1, up to the previous Monday) are real dates from the previous month, `inMonth: false`.
- Days 1..daysInMonth of the requested month are `inMonth: true`.
- Trailing days are added, real dates from the next month (`inMonth: false`), until the total length is a multiple of 7 (so the grid always ends on a Sunday).

This is the only function whose contract changes. Its single call site (`MonthStrip` in `app/calendar/page.tsx`) and its existing unit tests in `__tests__/lib/calendar-helpers.test.ts` are updated for the new shape; no other call site exists in the codebase.

### `app/calendar/page.tsx` — `MonthStrip`

- `weeks: (string | null)[][]` becomes `weeks: { date: string; inMonth: boolean }[][]`, chunked from `calendarMonthDays`'s output the same way (7 per row).
- The weekly summary row no longer filters anything out — `getWeeklySummary` is called with all 7 real dates in the row (`weekCells.map(c => c.date)`), so a week spanning a month boundary now correctly totals both months' workouts. (The underlying `workouts` data is already the full active plan's workouts, not month-scoped, so no data-fetching change is needed — this was purely a filtering gap.)
- The day-cell render (`weekCells.map(...)`) drops its `if (!dateStr) return <div />` early return — every cell is now a real, interactive date. The date-number circle's base text color becomes conditional: `inMonth ? 'text-slate-600' : 'text-slate-300'` for the default (non-today/race/test) case; the existing today/race-day/test-day highlight circles (which already override the base color with a solid background) are unchanged and apply the same way regardless of `inMonth`, since a highlighted day should stay legible either way.
- Tapping an `inMonth: false` cell calls the same `onDateClick(dateStr)` as any other day — no special-casing. This naturally jumps `WeekDetail`'s selected week to include the adjacent month's dates, which already renders correctly since `WeekDetail` operates on whatever 7 dates `weekDates(selectedDateStr)` returns, independent of which month is "currently displayed" in the strip.
- Dots (event/workout/unlinked-activity indicators) and the race/test day highlight continue to use the same date-string-keyed lookups as today — no changes needed there, since they already work off `dateStr` matches against the full `workouts`/`events` arrays.

## Testing

- `__tests__/lib/calendar-helpers.test.ts`: `calendarMonthDays`'s existing null-padding tests are rewritten for the new `{date, inMonth}` shape (leading-day count assertions stay the same, now checking `inMonth: false` on those entries instead of `null`); new test cases added for trailing-day padding (e.g. a month ending mid-week) and for a full month where both leading and trailing padding are needed.
- `getWeeklySummary`'s existing tests are unaffected (its own signature doesn't change — only what `MonthStrip` passes into it changes) — no new test needed there beyond what a manual check of the new `MonthStrip` behavior covers, consistent with this codebase's existing convention of not unit-testing page components directly.
- No test changes needed for the event-ordering fix — `WeekDetail` and the Dashboard's weekly widget have no existing test files (large, stateful page components, consistent with this codebase's existing convention), verified manually.

## Global Constraints

- Adjacent-month dates must remain fully interactive (tappable, selectable) — not display-only.
- Adjacent-month dates are visually dimmed (`text-slate-300`) relative to in-month dates (`text-slate-600`), but keep the same today/race-day/test-day highlight treatment as any other date.
- Only standalone events move above workouts; an event linked to a specific completed workout stays nested beneath that workout, unchanged.
- `calendarMonthDays` is the only function whose contract changes; its single call site and test file are updated in the same change.
