# Weekly Summary Planned/Actual Calculation Fix Design

## Goal

Fix `getWeeklySummary` (`lib/calendar-helpers.ts`) so the "planned" bucket reflects each week's originally-scheduled target regardless of whether those sessions have since completed, and so the "actual" time bucket reflects the truly-completed duration rather than the originally-planned one.

## Background

This function feeds the calendar page's weekly planned-vs-actual summaries (shipped in `docs/superpowers/plans/2026-07-12-calendar-planned-vs-actual.md`). A user report showed the "planned" side of a fully-elapsed past week reading `0`, even though the week clearly had a plan (its "actual" side had real numbers).

Root cause, confirmed by reading the current implementation and its test file (`__tests__/lib/calendar-helpers.test.ts:212-295`):

```ts
export function getWeeklySummary(dates: string[], workouts: Workout[], activities: ICUActivity[] = []): WeeklySummary {
  const week = workouts.filter(w => dates.includes(w.date))
  const actual = week.filter(w => w.status === 'completed' || w.status === 'needs_review')
  const planned = week.filter(w => w.status === 'planned')
  ...
}
```

`planned` only ever includes workouts *currently still sitting in* `status: 'planned'`. The moment a workout completes, it moves entirely into `actual` and disappears from `planned` — so a week where everything has already resolved (the normal state for any past week) always shows `plannedTss`/`plannedMins` as `0`. This was invisible before this feature shipped, because the old calendar UI never displayed "planned" for a past week (it only ever showed one value, chosen by week status) — showing both together is what exposed it.

A second, related inaccuracy found while investigating: `actualMins` sums `w.duration_minutes` (the *planned* duration, which never changes after scheduling) for completed workouts, instead of `w.actual_duration_minutes` (the real duration once synced from the completed ride). `Workout` (`types/index.ts:93-114`) already stores both fields separately — `duration_minutes` is the original scheduled figure; `actual_duration_minutes` is populated once completed and is what individual workout cards already display (`components/WorkoutCard.tsx:54-56`: `{workout.duration_minutes} → {workout.actual_duration_minutes} min`). The weekly aggregate should use the same distinction.

## Fix

**"Planned" means the week's original target, independent of what happened to those sessions.** Compute it from every non-skipped workout in the week — regardless of current status — using each workout's own scheduled fields:

- `plannedMins` = sum of `duration_minutes` (unchanged after scheduling, always present) across every non-skipped workout in the week.
- `plannedTss` = sum of `estimateTss(type, duration_minutes)` across the same set. `estimateTss` (`lib/estimate-tss.ts:16`, already exists, unchanged) is the same estimate `WorkoutCard.tsx` already uses for a workout's own "planned" TSS figure — there is no stored "planned TSS" column; `Workout.tss` only ever holds the *achieved* value once a session completes (confirmed via `WorkoutCard.tsx:6-9`: `if (workout.tss !== null) return {value: workout.tss, estimated: false}` else falls back to `estimateTss`). Using `w.tss` for the planned bucket would silently substitute the achieved value for completed workouts, which is wrong — `estimateTss` must be used unconditionally for the planned bucket, never `w.tss`.

**"Actual" means what genuinely happened**, unchanged in spirit but corrected for duration:

- `actualMins` = sum of `actual_duration_minutes ?? duration_minutes` (falling back to planned duration only in the edge case where a completed row somehow still has a null `actual_duration_minutes`) across completed/needs_review workouts, plus unlinked activities' moving time — unchanged from today.
- `actualTss` = unchanged: sum of `tss ?? 0` across completed/needs_review workouts, plus unlinked activities' training load.

Skipped workouts remain excluded from both buckets (unchanged behavior, already tested) — the week's base filter becomes `workouts.filter(w => dates.includes(w.date) && w.status !== 'skipped')`, since "planned" is no longer status-filtered down to only `'planned'` and needs its own explicit skip-exclusion.

## New Import

`lib/calendar-helpers.ts` gains `import { estimateTss } from '@/lib/estimate-tss'`.

## Call Sites

No changes needed anywhere else — both `MonthStrip` and `WeekHeader` (`app/calendar/page.tsx`) already just consume the `WeeklySummary` object `getWeeklySummary` returns and pass it to `WeeklySummaryStack`; the shape (`{ actualTss, actualMins, plannedTss, plannedMins }`) is unchanged, only the values are now correct.

## Testing

`getWeeklySummary`'s existing test suite (`__tests__/lib/calendar-helpers.test.ts:212-295`) needs updating for the new semantics — several existing cases assert the old (incorrect) behavior and must change:

- The test currently titled `'returns actual TSS and minutes from completed/needs_review; ignores planned'` asserts `plannedTss: 50, plannedMins: 45` from only the one still-`planned` workout in its fixture — under the fix, `plannedMins`/`plannedTss` must include the completed and needs_review workouts' original scheduled figures too (all three non-skipped workouts in the fixture), computed via `duration_minutes` and `estimateTss`, not their stored `.tss`. This test's title and assertions both need rewriting to describe and verify the new behavior.
- The test currently titled `'returns planned values when no completed workouts exist'` sets `tss: 60`/`tss: 40` directly on still-planned workout fixtures and expects `plannedTss: 100` (the sum of those stored values) — under the fix, planned TSS must come from `estimateTss(type, duration_minutes)`, not the fixture's `tss` field (which a real still-planned workout would never have populated anyway — `tss` only exists on a row once it's completed). This test needs its expected values recomputed from `estimateTss`.
- A new test is needed asserting the core reported bug is fixed: a fully-completed week (all workouts `status: 'completed'`) must show nonzero `plannedTss`/`plannedMins` reflecting the original schedule, not `0`.
- A new test is needed asserting the `actualMins` fix: a completed workout with `duration_minutes` and `actual_duration_minutes` set to different values must contribute its `actual_duration_minutes` to `actualMins`, not `duration_minutes`.
- The `'excludes skipped workouts from both actual and planned'` test is unaffected — skipped workouts remain excluded from both buckets under the fix, verified structurally (the base `week` filter still excludes `'skipped'`).
- The unlinked-activity tests (`'adds unlinked activities...'`, `'combines planned workout actuals with unlinked activity actuals'`, `'ignores unlinked activities outside the date range'`) are unaffected in their assertions — none of them assert on `plannedTss`/`plannedMins`, only `actualTss`/`actualMins`, which are unchanged by this fix except for the `actual_duration_minutes` correction (none of these fixtures set that field, so `?? duration_minutes` fallback keeps their expected values identical).

## Global Constraints

- `Workout.tss` is never read for the planned bucket — it exclusively represents the achieved value once completed, never a target.
- Skipped workouts remain excluded from both `planned*` and `actual*` fields.
- The `WeeklySummary` return shape is unchanged — this is a pure calculation fix, not an interface change.
- No changes to `app/calendar/page.tsx` — both call sites already consume whatever `getWeeklySummary` returns correctly.
