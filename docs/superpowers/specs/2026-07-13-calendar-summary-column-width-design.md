# Calendar Mini-Month Summary Column Width Fix Design

## Goal

Fix the mini month-calendar's per-week summary column (`app/calendar/page.tsx`, `MonthStrip`) so its planned/actual TSS and time text no longer overflows past the card's left edge on mobile, as reported via screenshot.

## Background

The recently-shipped planned-vs-actual weekly summary (`docs/superpowers/plans/2026-07-12-calendar-planned-vs-actual.md`) displays two stacked lines of `actual/planned` values in a `w-10` (40px) column to the left of each week's 7 day cells. For weeks with larger totals (e.g. `480/398` and `476m/478m`), the right-aligned text is wider than the column, so it visually bleeds left past the card's border — confirmed via a screenshot showing exactly this on an iPhone.

## Fix

Widen the column from `w-10` (40px) to `w-14` (56px), reclaiming the extra 16px from the day grid's `flex-1` share (a ~2px-per-column reduction across the 7 day cells, not perceptible). Two occurrences in `MonthStrip` must change together, since they form one aligned visual column:

- `app/calendar/page.tsx:156` — the day-of-week header's blank spacer cell (keeps `M T W T F S S` aligned with the day grid below it).
- `app/calendar/page.tsx:171` — the week-row summary column itself (`WeeklySummaryStack`'s wrapper).

A third `w-10` at `app/calendar/page.tsx:327` is an unrelated date-badge column in `WeekDetail` (the day-by-day list further down the page) and must not be touched.

No other changes — same component, same content, same colors, same font sizes. This is a pure spacing fix.

## Testing

`app/calendar/page.tsx` has no automated test coverage for layout/spacing (its one test file, `__tests__/pages/CalendarPage.test.tsx`, tests content/text, not CSS classes or pixel widths), so this fix isn't testable via the existing suite. Verification is manual: open the Calendar page on a mobile-width viewport and confirm a high-volume week's summary numbers no longer overflow the card's left edge.

## Global Constraints

- Only the two `MonthStrip` occurrences of `w-10` (lines 156, 171) change to `w-14`; the unrelated `WeekDetail` occurrence (line 327) stays `w-10`.
- No changes to `WeeklySummaryStack`'s content, formatting, or colors — this fix is spacing-only.
