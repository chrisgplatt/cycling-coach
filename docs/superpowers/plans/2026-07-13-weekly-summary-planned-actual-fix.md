# Weekly Summary Planned/Actual Calculation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `getWeeklySummary` so a week's "planned" totals reflect its original schedule regardless of whether those sessions have since completed (currently they reset to `0` once completed), and so "actual" minutes reflect the truly-completed duration rather than the originally-planned one.

**Architecture:** `getWeeklySummary` (`lib/calendar-helpers.ts`) changes its `planned*` computation from "sum of workouts still in `status: 'planned'`" to "sum of every non-skipped workout's original scheduled fields, regardless of current status" — using the existing `estimateTss` heuristic for TSS (since `Workout.tss` only ever holds the achieved value once completed, never a stored target). `actualMins` switches from `duration_minutes` to `actual_duration_minutes` (falling back to `duration_minutes` only if null).

**Tech Stack:** TypeScript, Jest.

## Global Constraints

- `Workout.tss` is never read for the planned bucket — it exclusively represents the achieved value once completed, never a target.
- Skipped workouts remain excluded from both `planned*` and `actual*` fields.
- The `WeeklySummary` return shape is unchanged (`{ actualTss, actualMins, plannedTss, plannedMins }`, all `number`) — this is a pure calculation fix, not an interface change.
- No changes to `app/calendar/page.tsx` — both call sites already consume whatever `getWeeklySummary` returns correctly; they need no edits.
- The full design doc is at `docs/superpowers/specs/2026-07-13-weekly-summary-planned-actual-fix-design.md` — read it if any step below is ambiguous.

---

### Task 1: Fix planned/actual calculation in `getWeeklySummary`

**Files:**
- Modify: `lib/calendar-helpers.ts`
- Modify: `__tests__/lib/calendar-helpers.test.ts`

**Interfaces:**
- `getWeeklySummary(dates: string[], workouts: Workout[], activities: ICUActivity[] = []): WeeklySummary` — same signature and return shape as today; only the values it produces change.
- Consumes: `estimateTss(type: WorkoutType, durationMinutes: number): number` — already exists in `lib/estimate-tss.ts`, unchanged. For `type: 'endurance'` (the default in this test file's `w()` fixture helper), the exact values used below are: `estimateTss('endurance', 30) = 23`, `estimateTss('endurance', 35) = 27`, `estimateTss('endurance', 45) = 35`, `estimateTss('endurance', 50) = 39`, `estimateTss('endurance', 60) = 46`.

- [ ] **Step 1: Write the failing/updated tests**

Find the `getWeeklySummary` describe block in `__tests__/lib/calendar-helpers.test.ts` (currently lines 210-295):

```ts
// ─── getWeeklySummary ──────────────────────────────────────────────────────────

describe('getWeeklySummary', () => {
  const DATES = ['2026-06-16', '2026-06-17', '2026-06-18']

  it('returns actual TSS and minutes from completed/needs_review; ignores planned', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'completed', tss: 80, duration_minutes: 60 }),
      w({ date: '2026-06-17', status: 'needs_review', tss: 40, duration_minutes: 30 }),
      w({ date: '2026-06-18', status: 'planned', tss: 50, duration_minutes: 45 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result.actualTss).toBe(120)
    expect(result.actualMins).toBe(90)
    expect(result.plannedTss).toBe(50)
    expect(result.plannedMins).toBe(45)
  })

  it('returns planned values when no completed workouts exist', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'planned', tss: 60, duration_minutes: 50 }),
      w({ date: '2026-06-17', status: 'planned', tss: 40, duration_minutes: 35 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result.actualTss).toBe(0)
    expect(result.actualMins).toBe(0)
    expect(result.plannedTss).toBe(100)
    expect(result.plannedMins).toBe(85)
  })

  it('returns zeros for both buckets when week has no workouts', () => {
    const result = getWeeklySummary(DATES, [])
    expect(result).toEqual({ actualTss: 0, actualMins: 0, plannedTss: 0, plannedMins: 0 })
  })

  it('excludes skipped workouts from both actual and planned', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'skipped', tss: 50, duration_minutes: 45 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result).toEqual({ actualTss: 0, actualMins: 0, plannedTss: 0, plannedMins: 0 })
  })

  it('adds unlinked activities TSS and minutes to the actual bucket', () => {
    const activity: ICUActivity = {
      id: 'a1', start_date_local: '2026-06-16T07:00:00', type: 'Ride',
      moving_time: 3600, name: 'Morning ride', training_load: 55,
      average_watts: null, max_watts: null, weighted_average_watts: null,
      average_heartrate: null, max_heartrate: null, rolling_ftp: null,
      distance: null, total_elevation_gain: null, left_right_balance: null,
    } as unknown as ICUActivity
    const result = getWeeklySummary(DATES, [], [activity])
    expect(result.actualTss).toBe(55)
    expect(result.actualMins).toBe(60)
    expect(result.plannedTss).toBe(0)
    expect(result.plannedMins).toBe(0)
  })

  it('combines planned workout actuals with unlinked activity actuals', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'completed', tss: 80, duration_minutes: 60 }),
    ]
    const activity: ICUActivity = {
      id: 'a1', start_date_local: '2026-06-17T08:00:00', type: 'Ride',
      moving_time: 1800, name: 'Easy spin', training_load: 30,
      average_watts: null, max_watts: null, weighted_average_watts: null,
      average_heartrate: null, max_heartrate: null, rolling_ftp: null,
      distance: null, total_elevation_gain: null, left_right_balance: null,
    } as unknown as ICUActivity
    const result = getWeeklySummary(DATES, workouts, [activity])
    expect(result.actualTss).toBe(110)
    expect(result.actualMins).toBe(90)
  })

  it('ignores unlinked activities outside the date range', () => {
    const activity: ICUActivity = {
      id: 'a1', start_date_local: '2026-06-19T07:00:00', type: 'Ride',
      moving_time: 3600, name: 'Outside week', training_load: 60,
      average_watts: null, max_watts: null, weighted_average_watts: null,
      average_heartrate: null, max_heartrate: null, rolling_ftp: null,
      distance: null, total_elevation_gain: null, left_right_balance: null,
    } as unknown as ICUActivity
    const result = getWeeklySummary(DATES, [], [activity])
    expect(result).toEqual({ actualTss: 0, actualMins: 0, plannedTss: 0, plannedMins: 0 })
  })
})
```

Replace it with:

```ts
// ─── getWeeklySummary ──────────────────────────────────────────────────────────

describe('getWeeklySummary', () => {
  const DATES = ['2026-06-16', '2026-06-17', '2026-06-18']

  it('computes actual from completed/needs_review, and planned from every non-skipped workout\'s original schedule', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'completed', tss: 80, duration_minutes: 60 }),
      w({ date: '2026-06-17', status: 'needs_review', tss: 40, duration_minutes: 30 }),
      w({ date: '2026-06-18', status: 'planned', tss: 50, duration_minutes: 45 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result.actualTss).toBe(120)
    expect(result.actualMins).toBe(90)
    // estimateTss('endurance', 60) + estimateTss('endurance', 30) + estimateTss('endurance', 45) = 46 + 23 + 35
    expect(result.plannedTss).toBe(104)
    expect(result.plannedMins).toBe(135) // 60 + 30 + 45 — every non-skipped workout's own scheduled duration, regardless of status
  })

  it('computes planned TSS from estimateTss, not the tss field, when workouts are still planned', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'planned', tss: 60, duration_minutes: 50 }),
      w({ date: '2026-06-17', status: 'planned', tss: 40, duration_minutes: 35 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result.actualTss).toBe(0)
    expect(result.actualMins).toBe(0)
    // estimateTss('endurance', 50) + estimateTss('endurance', 35) = 39 + 27 — NOT the fixture's tss field (60 + 40 = 100)
    expect(result.plannedTss).toBe(66)
    expect(result.plannedMins).toBe(85)
  })

  it('shows nonzero planned totals for a fully-completed week (the reported bug)', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'completed', tss: 80, duration_minutes: 60 }),
      w({ date: '2026-06-17', status: 'completed', tss: 40, duration_minutes: 30 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result.plannedMins).toBe(90) // 60 + 30 — not 0, even though nothing is still status: 'planned'
    expect(result.plannedTss).toBe(69) // estimateTss('endurance', 60) + estimateTss('endurance', 30) = 46 + 23
  })

  it('uses actual_duration_minutes, not duration_minutes, for actualMins when a completed workout has both', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'completed', tss: 80, duration_minutes: 45, actual_duration_minutes: 51 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result.actualMins).toBe(51) // the real synced duration, not the 45-minute plan
    expect(result.plannedMins).toBe(45) // planned bucket still uses the original scheduled duration
  })

  it('returns zeros for both buckets when week has no workouts', () => {
    const result = getWeeklySummary(DATES, [])
    expect(result).toEqual({ actualTss: 0, actualMins: 0, plannedTss: 0, plannedMins: 0 })
  })

  it('excludes skipped workouts from both actual and planned', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'skipped', tss: 50, duration_minutes: 45 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result).toEqual({ actualTss: 0, actualMins: 0, plannedTss: 0, plannedMins: 0 })
  })

  it('adds unlinked activities TSS and minutes to the actual bucket', () => {
    const activity: ICUActivity = {
      id: 'a1', start_date_local: '2026-06-16T07:00:00', type: 'Ride',
      moving_time: 3600, name: 'Morning ride', training_load: 55,
      average_watts: null, max_watts: null, weighted_average_watts: null,
      average_heartrate: null, max_heartrate: null, rolling_ftp: null,
      distance: null, total_elevation_gain: null, left_right_balance: null,
    } as unknown as ICUActivity
    const result = getWeeklySummary(DATES, [], [activity])
    expect(result.actualTss).toBe(55)
    expect(result.actualMins).toBe(60)
    expect(result.plannedTss).toBe(0)
    expect(result.plannedMins).toBe(0)
  })

  it('combines planned workout actuals with unlinked activity actuals', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'completed', tss: 80, duration_minutes: 60 }),
    ]
    const activity: ICUActivity = {
      id: 'a1', start_date_local: '2026-06-17T08:00:00', type: 'Ride',
      moving_time: 1800, name: 'Easy spin', training_load: 30,
      average_watts: null, max_watts: null, weighted_average_watts: null,
      average_heartrate: null, max_heartrate: null, rolling_ftp: null,
      distance: null, total_elevation_gain: null, left_right_balance: null,
    } as unknown as ICUActivity
    const result = getWeeklySummary(DATES, workouts, [activity])
    expect(result.actualTss).toBe(110)
    expect(result.actualMins).toBe(90)
  })

  it('ignores unlinked activities outside the date range', () => {
    const activity: ICUActivity = {
      id: 'a1', start_date_local: '2026-06-19T07:00:00', type: 'Ride',
      moving_time: 3600, name: 'Outside week', training_load: 60,
      average_watts: null, max_watts: null, weighted_average_watts: null,
      average_heartrate: null, max_heartrate: null, rolling_ftp: null,
      distance: null, total_elevation_gain: null, left_right_balance: null,
    } as unknown as ICUActivity
    const result = getWeeklySummary(DATES, [], [activity])
    expect(result).toEqual({ actualTss: 0, actualMins: 0, plannedTss: 0, plannedMins: 0 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/calendar-helpers.test.ts`
Expected: FAIL — the 4 new/rewritten tests in the `getWeeklySummary` block fail against the current implementation:
- `'computes actual from completed/needs_review, and planned...'` fails: current code gives `plannedTss: 50, plannedMins: 45` (only the still-`planned` workout), not the expected `104`/`135`.
- `'computes planned TSS from estimateTss, not the tss field...'` fails: current code gives `plannedTss: 100` (sum of the fixture's `tss` field), not the expected `66`.
- `'shows nonzero planned totals for a fully-completed week...'` fails: current code gives `plannedMins: 0, plannedTss: 0` (the reported bug — nothing is left in `status: 'planned'`), not `90`/`69`.
- `'uses actual_duration_minutes, not duration_minutes, for actualMins...'` fails: current code gives `actualMins: 45` (uses `duration_minutes`), not the expected `51`.
The other existing tests (`'returns zeros...'`, `'excludes skipped...'`, the three unlinked-activity tests) continue to PASS unchanged — they're unaffected by this fix.

- [ ] **Step 3: Update `lib/calendar-helpers.ts`**

Find (near the top of the file):

```ts
import { getWeekBounds } from '@/lib/week-bounds'
import type { Workout, ICUActivity } from '@/types'
```

Replace with:

```ts
import { getWeekBounds } from '@/lib/week-bounds'
import { estimateTss } from '@/lib/estimate-tss'
import type { Workout, ICUActivity } from '@/types'
```

Then find (the `getWeeklySummary` function body, currently around lines 129-142):

```ts
export function getWeeklySummary(dates: string[], workouts: Workout[], activities: ICUActivity[] = []): WeeklySummary {
  const week = workouts.filter(w => dates.includes(w.date))
  const actual = week.filter(w => w.status === 'completed' || w.status === 'needs_review')
  const planned = week.filter(w => w.status === 'planned')
  const unlinked = activities.filter(a => dates.some(d => a.start_date_local.startsWith(d)))
  return {
    actualTss:  actual.reduce((sum, w) => sum + (w.tss ?? 0), 0)
              + unlinked.reduce((sum, a) => sum + (a.training_load ?? 0), 0),
    actualMins: actual.reduce((sum, w) => sum + w.duration_minutes, 0)
              + unlinked.reduce((sum, a) => sum + Math.round(a.moving_time / 60), 0),
    plannedTss:  planned.reduce((sum, w) => sum + (w.tss ?? 0), 0),
    plannedMins: planned.reduce((sum, w) => sum + w.duration_minutes, 0),
  }
}
```

Replace with:

```ts
export function getWeeklySummary(dates: string[], workouts: Workout[], activities: ICUActivity[] = []): WeeklySummary {
  const week = workouts.filter(w => dates.includes(w.date) && w.status !== 'skipped')
  const actual = week.filter(w => w.status === 'completed' || w.status === 'needs_review')
  const unlinked = activities.filter(a => dates.some(d => a.start_date_local.startsWith(d)))
  return {
    actualTss:  actual.reduce((sum, w) => sum + (w.tss ?? 0), 0)
              + unlinked.reduce((sum, a) => sum + (a.training_load ?? 0), 0),
    actualMins: actual.reduce((sum, w) => sum + (w.actual_duration_minutes ?? w.duration_minutes), 0)
              + unlinked.reduce((sum, a) => sum + Math.round(a.moving_time / 60), 0),
    // Planned reflects the week's original schedule regardless of what happened to
    // it — every non-skipped workout counts, not just ones still in status 'planned'.
    // Workout.tss only ever holds the achieved value once completed, never a target,
    // so estimateTss (the same heuristic WorkoutCard uses for its own planned figure)
    // is used unconditionally here instead.
    plannedTss:  week.reduce((sum, w) => sum + estimateTss(w.type, w.duration_minutes), 0),
    plannedMins: week.reduce((sum, w) => sum + w.duration_minutes, 0),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/calendar-helpers.test.ts`
Expected: PASS — all tests in the file passing (10 tests in the `getWeeklySummary` block: 4 new/rewritten + 6 unchanged, plus all other describe blocks in this file unaffected).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npx jest`
Expected: all suites pass. This confirms nothing else in the codebase depends on the old `getWeeklySummary` behavior — `lib/calendar-helpers.ts` and `app/calendar/page.tsx` are the only production consumers (verified during design: `getWeeklySummary` has no other call sites in `app/` or `lib/`).

- [ ] **Step 7: Manual verification**

`app/calendar/page.tsx` has no changes in this task, so no new UI states to check beyond confirming the fix is visible. Start the dev server (`npm run dev`), open the Calendar page, and confirm a past week (fully completed) now shows a nonzero gray "planned" number next to the green "actual" number, both in the mini month-calendar's summary column and in the week-list header — matching what was reported as showing `0` before this fix.

- [ ] **Step 8: Commit**

```bash
git add lib/calendar-helpers.ts __tests__/lib/calendar-helpers.test.ts
git commit -m "fix: compute weekly planned totals from original schedule, not current status"
```
