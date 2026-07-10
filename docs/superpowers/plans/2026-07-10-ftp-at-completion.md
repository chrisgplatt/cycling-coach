# FTP At Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every workout (which in this schema also covers unplanned rides) records the athlete's FTP at the moment it was completed, sourced primarily from intervals.icu's own per-activity `icu_ftp` field, with a historical-reconstruction fallback for the rare case that's missing. Already-completed workouts get a one-off backfill.

**Architecture:** A new nullable `ftp_at_completion` column on `workouts`. `ICUActivity` gains an `ftp` field (mapped from intervals.icu's `icu_ftp`). The three code paths that ever set a workout's status to `completed` — the sync-time auto-match (`app/api/sync/route.ts`), the unplanned-ride import (`lib/intervals/import-rides.ts`), and the manual confirm/select-activity actions (`components/WorkoutDetailModal.tsx` → `PATCH /api/workouts/[id]`) — all read `ftp` off the relevant activity and stamp it, falling back to `lib/ftp/resolve-ftp.ts`'s date-based reconstruction (confirmed `ftp_predictions`, then plan `baseline_ftp`) only when the activity's own value is null. A one-off admin route backfills already-completed workouts using the same two-tier logic.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, intervals.icu API. One new nullable column, no new dependencies.

## Global Constraints

- No UI for re-running the backfill from the app — one-off admin POST, invoked directly (matches `backfill-notes`/`backfill-zones`).
- No changes to how `current_ftp` itself is computed, stored, or applied.
- The fallback resolver cannot see un-timestamped manual FTP edits (e.g. direct edits on the plan/goals page) — an accepted, documented gap that only matters when intervals.icu's own `ftp` is also unavailable.
- `app/api/sync/route.ts`, `lib/intervals/import-rides.ts`, and `app/api/workouts/[id]/route.ts` currently have zero test coverage and are large multi-dependency files — this plan does not attempt full first-time coverage of them. Each task's own new logic is either covered via an already-tested pure function it delegates to, or via a narrowly-scoped new test targeting only the new code path (never the whole file).
- Migration must be run manually against the shared Supabase project before/alongside deploying (`AGENTS.md`'s "Database migrations" section) — flag the exact SQL to the user when this ships.
- Run `npm run typecheck` before every commit.

---

### Task 1: Schema, types, and activity mapping

**Files:**
- Create: `supabase/migrations/20260710_ftp_at_completion.sql`
- Modify: `types/index.ts` (add `ICUActivity.ftp`, `Workout.ftp_at_completion`)
- Modify: `lib/intervals/client.ts` (`mapActivity`, around line 216-234)
- Modify: `__tests__/support/factories.ts` (`makeWorkout`)
- Modify: `__tests__/components/WorkoutDetailModal.test.tsx` (`plannedWorkout` literal, and the top-level `activity` fixture needs `ftp` added so later tasks' tests can override it — see Task 7 for the tests themselves; this task only needs the fixture to still compile)
- Test: `__tests__/lib/intervals.test.ts` (extend)

**Interfaces:**
- Produces: `ICUActivity.ftp?: number | null` — consumed by Tasks 3, 5, 7, 8. `Workout.ftp_at_completion: number | null` — consumed by Tasks 6, 7.

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/20260710_ftp_at_completion.sql`:

```sql
alter table workouts add column if not exists ftp_at_completion integer;
```

- [ ] **Step 2: Add `ICUActivity.ftp`**

In `types/index.ts`, find the `ICUActivity` interface (starts at line 258). Immediately after the `rolling_ftp: number | null     // intervals.icu rolling FTP estimate` line, add:

```ts
  ftp?: number | null            // the FTP intervals.icu actually applied to this activity's calculations (its own FTP history) — distinct from rolling_ftp, which is intervals.icu's algorithmic estimate
```

Optional (`?:`), matching this interface's existing convention for `max_heartrate?`/`power_1min?` — avoids breaking every existing `ICUActivity` test fixture that doesn't set it.

- [ ] **Step 3: Add `Workout.ftp_at_completion`**

In the same file, find the `Workout` interface (starts at line 93). Immediately after the `tss: number | null` line, add:

```ts
  ftp_at_completion: number | null  // FTP in effect when this workout/ride was marked completed
```

Required (no `?:`), matching this interface's existing convention (every other field is required, with `| null` only for nullability).

- [ ] **Step 4: Write the failing test for the activity mapping**

In `__tests__/lib/intervals.test.ts`, add a new test right after the existing `'getActivities returns ICUActivity array'` test (after line 39):

```ts
  it('maps icu_ftp to the ftp field', async () => {
    const mockActivities = [
      { id: 'act1', start_date_local: '2026-05-01T08:00:00', type: 'Ride',
        moving_time: 3600, name: 'Morning Ride', average_watts: 200,
        max_watts: 350, weighted_average_watts: 210, average_heartrate: 145,
        icu_training_load: 85, icu_ftp: 245 },
    ]
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockActivities })

    const activities = await client.getActivities('2026-04-01', '2026-05-11')
    expect(activities[0].ftp).toBe(245)
  })
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx jest __tests__/lib/intervals.test.ts`
Expected: FAIL — `expect(activities[0].ftp).toBe(245)` fails because `mapActivity` doesn't map this field yet, so `activities[0].ftp` is `undefined`.

- [ ] **Step 6: Add the mapping**

In `lib/intervals/client.ts`, find `mapActivity` (line 216-234). Immediately after the `rolling_ftp: (a.icu_rolling_ftp ?? null) as number | null,` line, add:

```ts
      ftp: (a.icu_ftp ?? null) as number | null,
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx jest __tests__/lib/intervals.test.ts`
Expected: PASS (both the existing test and the new one)

- [ ] **Step 8: Update the `makeWorkout` test factory**

In `__tests__/support/factories.ts`, find `makeWorkout` (line 9-32). Immediately after the `tss: null,` line, add:

```ts
    ftp_at_completion: null,
```

- [ ] **Step 9: Fix the standalone `plannedWorkout` fixture**

In `__tests__/components/WorkoutDetailModal.test.tsx`, find `plannedWorkout` (line 6-16, the only `Workout` literal in the codebase that isn't built via `makeWorkout`). Find:

```ts
  tss: null, actual_duration_minutes: null, missed_reason: null,
```

Replace with:

```ts
  tss: null, actual_duration_minutes: null, missed_reason: null, ftp_at_completion: null,
```

- [ ] **Step 10: Run the full test suite and typecheck**

Run: `npx jest`
Expected: PASS, all suites (this confirms no other fixture broke)

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/20260710_ftp_at_completion.sql types/index.ts lib/intervals/client.ts __tests__/lib/intervals.test.ts __tests__/support/factories.ts __tests__/components/WorkoutDetailModal.test.tsx
git commit -m "feat: add ftp_at_completion column and map intervals.icu's icu_ftp field"
```

---

### Task 2: Fallback FTP resolver

**Files:**
- Create: `lib/ftp/resolve-ftp.ts`
- Test: Create `__tests__/lib/resolve-ftp.test.ts`

**Interfaces:**
- Consumes: `Workout.ftp_at_completion` shape (Task 1) — no direct dependency, just contextually related.
- Produces: `FtpAnchor { createdAt: string; predictedFtp: number }`, `resolveFallbackFtp(date: string, confirmedPredictions: FtpAnchor[], planBaselineFtp: number | null): number | null`, `resolveFallbackFtpForWorkout(supabase: SupabaseClient, date: string, planId: string | null): Promise<number | null>`. Consumed by Tasks 4, 5, 6, 8.

- [ ] **Step 1: Write the failing tests for the pure resolver**

Create `__tests__/lib/resolve-ftp.test.ts`:

```ts
import { resolveFallbackFtp, resolveFallbackFtpForWorkout, type FtpAnchor } from '@/lib/ftp/resolve-ftp'

describe('resolveFallbackFtp', () => {
  it('returns the latest confirmed prediction on or before the date', () => {
    const anchors: FtpAnchor[] = [
      { createdAt: '2026-05-01T00:00:00Z', predictedFtp: 220 },
      { createdAt: '2026-06-01T00:00:00Z', predictedFtp: 235 },
    ]
    expect(resolveFallbackFtp('2026-06-15', anchors, null)).toBe(235)
  })

  it('ignores predictions after the date', () => {
    const anchors: FtpAnchor[] = [
      { createdAt: '2026-05-01T00:00:00Z', predictedFtp: 220 },
      { createdAt: '2026-07-01T00:00:00Z', predictedFtp: 250 },
    ]
    expect(resolveFallbackFtp('2026-06-15', anchors, null)).toBe(220)
  })

  it('treats a prediction dated exactly on the workout date as applicable', () => {
    const anchors: FtpAnchor[] = [{ createdAt: '2026-06-15T09:00:00Z', predictedFtp: 230 }]
    expect(resolveFallbackFtp('2026-06-15', anchors, null)).toBe(230)
  })

  it('falls back to the plan baseline when no prediction applies', () => {
    const anchors: FtpAnchor[] = [{ createdAt: '2026-07-01T00:00:00Z', predictedFtp: 250 }]
    expect(resolveFallbackFtp('2026-06-15', anchors, 210)).toBe(210)
  })

  it('returns null when neither a prediction nor a baseline applies', () => {
    expect(resolveFallbackFtp('2026-06-15', [], null)).toBeNull()
  })
})

describe('resolveFallbackFtpForWorkout', () => {
  function makeSupabase({
    predictions = [] as { created_at: string; predicted_ftp: number }[],
    planRow = null as { baseline_ftp: number | null } | null,
  } = {}) {
    return {
      from: (table: string) => {
        if (table === 'ftp_predictions') {
          return { select: () => ({ eq: () => ({ data: predictions }) }) }
        }
        if (table === 'training_plans') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: planRow }) }) }) }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }
  }

  it('resolves from confirmed predictions when present', async () => {
    const supabase = makeSupabase({
      predictions: [{ created_at: '2026-06-01T00:00:00Z', predicted_ftp: 235 }],
    })
    const result = await resolveFallbackFtpForWorkout(supabase as never, '2026-06-15', null)
    expect(result).toBe(235)
  })

  it('falls back to the plan baseline when no prediction applies but a plan is given', async () => {
    const supabase = makeSupabase({ planRow: { baseline_ftp: 215 } })
    const result = await resolveFallbackFtpForWorkout(supabase as never, '2026-06-15', 'plan1')
    expect(result).toBe(215)
  })

  it('does not query training_plans when planId is null', async () => {
    const fromSpy = jest.fn((table: string) => {
      if (table === 'ftp_predictions') return { select: () => ({ eq: () => ({ data: [] }) }) }
      throw new Error(`unexpected table ${table}`)
    })
    const result = await resolveFallbackFtpForWorkout({ from: fromSpy } as never, '2026-06-15', null)
    expect(result).toBeNull()
    expect(fromSpy).not.toHaveBeenCalledWith('training_plans')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/resolve-ftp.test.ts`
Expected: FAIL with a module-not-found error — `lib/ftp/resolve-ftp.ts` doesn't exist yet.

- [ ] **Step 3: Create the resolver**

Create `lib/ftp/resolve-ftp.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface FtpAnchor {
  createdAt: string
  predictedFtp: number
}

export function resolveFallbackFtp(
  date: string,
  confirmedPredictions: FtpAnchor[],
  planBaselineFtp: number | null,
): number | null {
  const applicable = confirmedPredictions
    .filter(p => p.createdAt.slice(0, 10) <= date)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (applicable.length > 0) return applicable[0].predictedFtp
  return planBaselineFtp
}

export async function resolveFallbackFtpForWorkout(
  supabase: SupabaseClient,
  date: string,
  planId: string | null,
): Promise<number | null> {
  const { data: predictions } = await supabase
    .from('ftp_predictions')
    .select('created_at, predicted_ftp')
    .eq('confirmed', true)
  const anchors: FtpAnchor[] = (predictions ?? []).map((p: { created_at: string; predicted_ftp: number }) => ({
    createdAt: p.created_at,
    predictedFtp: p.predicted_ftp,
  }))

  let planBaselineFtp: number | null = null
  if (planId) {
    const { data: plan } = await supabase.from('training_plans').select('baseline_ftp').eq('id', planId).maybeSingle()
    planBaselineFtp = plan?.baseline_ftp ?? null
  }

  return resolveFallbackFtp(date, anchors, planBaselineFtp)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/resolve-ftp.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add lib/ftp/resolve-ftp.ts __tests__/lib/resolve-ftp.test.ts
git commit -m "feat: add resolveFallbackFtp for reconstructing historical FTP"
```

---

### Task 3: `matchWorkoutsToActivities` carries FTP through

**Files:**
- Modify: `lib/sync/match-workouts.ts`
- Test: Modify `__tests__/lib/match-workouts.test.ts`

**Interfaces:**
- Produces: `PendingWorkout.plan_id: string | null` (new field), `WorkoutMatch.ftp_at_completion: number | null`, `WorkoutMatch.date: string`, `WorkoutMatch.plan_id: string | null` (new fields). Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

In `__tests__/lib/match-workouts.test.ts`, update the `makeActivity` helper (line 4-22) to include `ftp` — add `ftp: null,` right after the `rolling_ftp: null,` line. Update the `makeWorkout` helper (line 24-31) to include `plan_id` — add `plan_id: 'plan1',` right after the `id: 'w1',` line.

Then update the first test's exact-match assertion (line 34-43) to include the new fields:

```ts
  it('matches a single pending workout to its single same-day ride as completed', () => {
    const workouts = [makeWorkout({ id: 'w1' })]
    const acts = new Map([['2026-07-06', [makeActivity({ id: 'act1', training_load: 70, moving_time: 4500, ftp: 245 })]]])

    const matches = matchWorkoutsToActivities(workouts, acts)

    expect(matches).toEqual([
      {
        id: 'w1', icu_activity_id: 'act1', tss: 70, actual_duration_minutes: 75, status: 'completed',
        ftp_at_completion: 245, date: '2026-07-06', plan_id: 'plan1',
      },
    ])
  })
```

Add one new test after it, asserting the null-passthrough case:

```ts
  it('passes ftp_at_completion through as null when the matched activity has no ftp', () => {
    const workouts = [makeWorkout({ id: 'w1' })]
    const acts = new Map([['2026-07-06', [makeActivity({ id: 'act1', ftp: null })]]])

    const matches = matchWorkoutsToActivities(workouts, acts)

    expect(matches[0].ftp_at_completion).toBeNull()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/match-workouts.test.ts`
Expected: FAIL — the first test's `toEqual` fails because the actual return value doesn't have `ftp_at_completion`/`date`/`plan_id` yet.

- [ ] **Step 3: Extend the interfaces and matching logic**

In `lib/sync/match-workouts.ts`, replace the `PendingWorkout` and `WorkoutMatch` interfaces (lines 3-15):

```ts
export interface PendingWorkout {
  id: string
  date: string
  created_at: string
  plan_id: string | null
}

export interface WorkoutMatch {
  id: string
  icu_activity_id: string
  tss: number | null
  actual_duration_minutes: number
  status: 'completed' | 'needs_review'
  ftp_at_completion: number | null
  date: string
  plan_id: string | null
}
```

Then update both places inside `matchWorkoutsToActivities` that build a `WorkoutMatch` object. Replace the single-workout branch (lines 39-48):

```ts
    if (workoutsForDate.length === 1) {
      const best = acts.reduce((a, b) => (b.training_load ?? 0) > (a.training_load ?? 0) ? b : a)
      matches.push({
        id: workoutsForDate[0].id,
        icu_activity_id: best.id,
        tss: best.training_load,
        actual_duration_minutes: Math.round(best.moving_time / 60),
        status: acts.length === 1 ? 'completed' : 'needs_review',
        ftp_at_completion: best.ftp ?? null,
        date: workoutsForDate[0].date,
        plan_id: workoutsForDate[0].plan_id,
      })
      continue
    }
```

Replace the multi-workout branch (lines 55-65):

```ts
    sortedWorkouts.forEach((w, i) => {
      const act = sortedActs[i]
      if (!act) return
      matches.push({
        id: w.id,
        icu_activity_id: act.id,
        tss: act.training_load,
        actual_duration_minutes: Math.round(act.moving_time / 60),
        status: 'completed',
        ftp_at_completion: act.ftp ?? null,
        date: w.date,
        plan_id: w.plan_id,
      })
    })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/match-workouts.test.ts`
Expected: PASS (9 tests — 7 existing + 2 new)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add lib/sync/match-workouts.ts __tests__/lib/match-workouts.test.ts
git commit -m "feat: carry ftp_at_completion, date, and plan_id through matchWorkoutsToActivities"
```

---

### Task 4: Wire `app/api/sync/route.ts`

**Files:**
- Modify: `app/api/sync/route.ts`

**Interfaces:**
- Consumes: `matchWorkoutsToActivities` (Task 3, now returns `ftp_at_completion`/`date`/`plan_id`), `resolveFallbackFtpForWorkout` (Task 2).

No new test for this task — `app/api/sync/route.ts` has zero pre-existing test coverage and building a first-time harness for its full pipeline (IntervalsClient, GarminClient, dossier generation, activity backfill) is out of scope (see Global Constraints). This task's own logic is a thin passthrough of already-tested `matchWorkoutsToActivities` output, verified by typecheck and the full regression suite in Task 9.

- [ ] **Step 1: Add the import**

In `app/api/sync/route.ts`, add to the imports (near the top, alongside the existing `matchWorkoutsToActivities` import on line 5):

```ts
import { resolveFallbackFtpForWorkout } from '@/lib/ftp/resolve-ftp'
```

- [ ] **Step 2: Select `plan_id` on the pending-workouts query**

Find (line 143-147):

```ts
    const { data: pending } = await supabase
      .from('workouts')
      .select('id, date, created_at')
      .in('status', ['planned', 'needs_review'])
      .is('icu_activity_id', null)
```

Replace with:

```ts
    const { data: pending } = await supabase
      .from('workouts')
      .select('id, date, created_at, plan_id')
      .in('status', ['planned', 'needs_review'])
      .is('icu_activity_id', null)
```

- [ ] **Step 3: Include `ftp_at_completion` in the match-update, with fallback**

Find (line 149-164):

```ts
    if (pending?.length) {
      const matches = matchWorkoutsToActivities(pending, actsByDate)
      await Promise.all(
        matches.map(m =>
          supabase
            .from('workouts')
            .update({
              icu_activity_id: m.icu_activity_id,
              tss: m.tss,
              actual_duration_minutes: m.actual_duration_minutes,
              status: m.status,
            })
            .eq('id', m.id)
        )
      )
    }
```

Replace with:

```ts
    if (pending?.length) {
      const matches = matchWorkoutsToActivities(pending, actsByDate)
      await Promise.all(
        matches.map(async m => {
          const ftpAtCompletion = m.ftp_at_completion ?? await resolveFallbackFtpForWorkout(supabase, m.date, m.plan_id)
          return supabase
            .from('workouts')
            .update({
              icu_activity_id: m.icu_activity_id,
              tss: m.tss,
              actual_duration_minutes: m.actual_duration_minutes,
              status: m.status,
              ftp_at_completion: ftpAtCompletion,
            })
            .eq('id', m.id)
        })
      )
    }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Run the full test suite for regression safety**

Run: `npx jest`
Expected: PASS, all suites (no existing test targets this route, so this just confirms nothing else broke)

- [ ] **Step 6: Commit**

```bash
git add app/api/sync/route.ts
git commit -m "feat: stamp ftp_at_completion when sync auto-matches a workout to a ride"
```

---

### Task 5: Wire `lib/intervals/import-rides.ts`

**Files:**
- Modify: `lib/intervals/import-rides.ts`
- Test: Create `__tests__/lib/import-rides.test.ts`

**Interfaces:**
- Consumes: `resolveFallbackFtp` (Task 2), `ICUActivity.ftp` (Task 1).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/import-rides.test.ts`:

```ts
import { importUnplannedRides } from '@/lib/intervals/import-rides'
import type { ICUActivity } from '@/types'

function makeActivity(overrides: Partial<ICUActivity> = {}): ICUActivity {
  return {
    id: 'act1', start_date_local: '2026-07-06T08:00:00', type: 'Ride', moving_time: 3600,
    name: 'Evening Spin', average_watts: 150, max_watts: 300, weighted_average_watts: 160,
    average_heartrate: 140, training_load: 60, rolling_ftp: null, ftp: 245,
    distance: null, total_elevation_gain: null, left_right_balance: null,
    ...overrides,
  } as ICUActivity
}

function makeSupabase({
  existingActivityIds = [] as string[],
  predictions = [] as { created_at: string; predicted_ftp: number }[],
  insertSpy = jest.fn(),
} = {}) {
  return {
    from: (table: string) => {
      if (table === 'workouts') {
        return {
          select: () => ({ in: () => ({ data: existingActivityIds.map(id => ({ icu_activity_id: id })) }) }),
          insert: (rows: unknown[]) => { insertSpy(rows); return { data: null, error: null } },
        }
      }
      if (table === 'ftp_predictions') {
        return { select: () => ({ eq: () => ({ data: predictions }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('importUnplannedRides', () => {
  it('stamps ftp_at_completion directly from the activity ftp field', async () => {
    const insertSpy = jest.fn()
    const supabase = makeSupabase({ insertSpy })
    await importUnplannedRides(supabase as never, 'u1', [makeActivity({ ftp: 245 })])
    expect(insertSpy).toHaveBeenCalledWith([expect.objectContaining({ ftp_at_completion: 245 })])
  })

  it('falls back to the confirmed ftp_predictions timeline when the activity has no ftp', async () => {
    const insertSpy = jest.fn()
    const supabase = makeSupabase({
      insertSpy,
      predictions: [{ created_at: '2026-07-01T00:00:00Z', predicted_ftp: 230 }],
    })
    await importUnplannedRides(supabase as never, 'u1', [makeActivity({ ftp: null, start_date_local: '2026-07-06T08:00:00' })])
    expect(insertSpy).toHaveBeenCalledWith([expect.objectContaining({ ftp_at_completion: 230 })])
  })

  it('leaves ftp_at_completion null when neither the activity nor any confirmed prediction has a value', async () => {
    const insertSpy = jest.fn()
    const supabase = makeSupabase({ insertSpy })
    await importUnplannedRides(supabase as never, 'u1', [makeActivity({ ftp: null })])
    expect(insertSpy).toHaveBeenCalledWith([expect.objectContaining({ ftp_at_completion: null })])
  })

  it('skips rides that already have a workout row', async () => {
    const insertSpy = jest.fn()
    const supabase = makeSupabase({ insertSpy, existingActivityIds: ['act1'] })
    const count = await importUnplannedRides(supabase as never, 'u1', [makeActivity({ id: 'act1' })])
    expect(count).toBe(0)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('ignores non-ride activities', async () => {
    const insertSpy = jest.fn()
    const supabase = makeSupabase({ insertSpy })
    const count = await importUnplannedRides(supabase as never, 'u1', [makeActivity({ type: 'Run' })])
    expect(count).toBe(0)
    expect(insertSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/import-rides.test.ts`
Expected: FAIL — the inserted rows don't have `ftp_at_completion` yet, so `objectContaining` assertions fail.

- [ ] **Step 3: Implement**

Replace the full contents of `lib/intervals/import-rides.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ICUActivity } from '@/types'
import { resolveFallbackFtp, type FtpAnchor } from '@/lib/ftp/resolve-ftp'

/**
 * Creates workout rows for ICU ride activities that have no matching row in the DB.
 * Called by the sync endpoint (recent activities) and the backfill endpoint (3-month history).
 */
export async function importUnplannedRides(
  supabase: SupabaseClient,
  userId: string,
  activities: ICUActivity[],
): Promise<number> {
  const rides = activities.filter(a => /ride/i.test(a.type))
  if (rides.length === 0) return 0

  const activityIds = rides.map(a => a.id)

  // Find which activity IDs already have a workout row
  const { data: existing } = await supabase
    .from('workouts')
    .select('icu_activity_id')
    .in('icu_activity_id', activityIds)

  const existingIds = new Set((existing ?? []).map(w => w.icu_activity_id))
  const newRides = rides.filter(a => !existingIds.has(a.id))
  if (newRides.length === 0) return 0

  // Unplanned rides never have a plan_id, so the only fallback source is the confirmed
  // predictions timeline — fetched lazily, once, only if some ride actually needs it.
  let fallbackAnchors: FtpAnchor[] | null = null
  async function resolveFtp(a: ICUActivity): Promise<number | null> {
    if (a.ftp != null) return a.ftp
    if (fallbackAnchors === null) {
      const { data: predictions } = await supabase
        .from('ftp_predictions')
        .select('created_at, predicted_ftp')
        .eq('confirmed', true)
      fallbackAnchors = (predictions ?? []).map((p: { created_at: string; predicted_ftp: number }) => ({
        createdAt: p.created_at,
        predictedFtp: p.predicted_ftp,
      }))
    }
    return resolveFallbackFtp(a.start_date_local.split('T')[0], fallbackAnchors, null)
  }

  const toInsert = await Promise.all(newRides.map(async a => ({
    user_id: userId,
    plan_id: null,
    date: a.start_date_local.split('T')[0],
    type: 'endurance' as const,
    duration_minutes: Math.max(1, Math.round(a.moving_time / 60)),
    description: a.name,
    target_zones: '',
    status: 'completed' as const,
    icu_activity_id: a.id,
    tss: a.training_load,
    steps: null,
    ftp_at_completion: await resolveFtp(a),
  })))

  const { error } = await supabase.from('workouts').insert(toInsert)
  if (error) throw new Error(`Failed to insert unplanned rides: ${error.message}`)
  return toInsert.length
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/import-rides.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add lib/intervals/import-rides.ts __tests__/lib/import-rides.test.ts
git commit -m "feat: stamp ftp_at_completion when importing unplanned rides"
```

---

### Task 6: Wire `PATCH /api/workouts/[id]`

**Files:**
- Modify: `app/api/workouts/[id]/route.ts`
- Test: Create `__tests__/api/workouts-id-ftp.test.ts`

**Interfaces:**
- Consumes: `resolveFallbackFtpForWorkout` (Task 2).
- Produces: the PATCH endpoint now accepts an optional `ftp_at_completion: number` in the request body, used when `status: 'completed'` is also present. Consumed by Task 7 (client callers).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/workouts-id-ftp.test.ts`:

```ts
/** @jest-environment node */
import { PATCH } from '@/app/api/workouts/[id]/route'

jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/ftp/resolve-ftp', () => ({ resolveFallbackFtpForWorkout: jest.fn() }))

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { resolveFallbackFtpForWorkout } from '@/lib/ftp/resolve-ftp'

function makeSupabase({
  updateSpy = jest.fn(),
  workoutRow = { date: '2026-07-06', plan_id: 'plan1' } as unknown,
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'workouts') {
        return {
          update: (fields: unknown) => { updateSpy(fields); return { eq: () => ({ error: null }) } },
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: workoutRow }) }) }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/workouts/w1', { method: 'PATCH', body: JSON.stringify(body) }) as never
}

beforeEach(() => jest.clearAllMocks())

describe('PATCH /api/workouts/[id] — ftp_at_completion', () => {
  it('writes the client-supplied ftp_at_completion directly when status is completed', async () => {
    const updateSpy = jest.fn()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ updateSpy }))
    await PATCH(makeRequest({ status: 'completed', ftp_at_completion: 245 }), ctx('w1') as never)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', ftp_at_completion: 245 }))
    expect(resolveFallbackFtpForWorkout).not.toHaveBeenCalled()
  })

  it('resolves a fallback when status is completed but no ftp_at_completion is supplied', async () => {
    const updateSpy = jest.fn()
    ;(resolveFallbackFtpForWorkout as jest.Mock).mockResolvedValue(230)
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ updateSpy }))
    await PATCH(makeRequest({ status: 'completed' }), ctx('w1') as never)
    expect(resolveFallbackFtpForWorkout).toHaveBeenCalledWith(expect.anything(), '2026-07-06', 'plan1')
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ ftp_at_completion: 230 }))
  })

  it('treats an explicit null ftp_at_completion the same as omitted — resolves a fallback', async () => {
    const updateSpy = jest.fn()
    ;(resolveFallbackFtpForWorkout as jest.Mock).mockResolvedValue(null)
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ updateSpy }))
    await PATCH(makeRequest({ status: 'completed', ftp_at_completion: null }), ctx('w1') as never)
    expect(resolveFallbackFtpForWorkout).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ ftp_at_completion: null }))
  })

  it('does not touch ftp_at_completion or fetch the workout when status is not being set to completed', async () => {
    const updateSpy = jest.fn()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ updateSpy }))
    await PATCH(makeRequest({ missed_reason: 'Illness' }), ctx('w1') as never)
    const written = updateSpy.mock.calls[0][0]
    expect(written).not.toHaveProperty('ftp_at_completion')
    expect(resolveFallbackFtpForWorkout).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/api/workouts-id-ftp.test.ts`
Expected: FAIL — `ftp_at_completion` isn't written by the route yet, so the `objectContaining` assertions fail; the "not touch" test's `not.toHaveProperty` check would still incidentally pass on its own, but the other three fail.

- [ ] **Step 3: Add the import**

In `app/api/workouts/[id]/route.ts`, add to the imports (near the top):

```ts
import { resolveFallbackFtpForWorkout } from '@/lib/ftp/resolve-ftp'
```

- [ ] **Step 4: Add the ftp_at_completion resolution**

Find the block that builds `update` and checks for empty updates (lines 55-80, ending with the `if (Object.keys(update).length === 0)` check). Immediately before that `if (Object.keys(update).length === 0) {` line, insert:

```ts
  if (body.status === 'completed') {
    if (typeof body.ftp_at_completion === 'number') {
      update.ftp_at_completion = body.ftp_at_completion
    } else {
      const { data: existing } = await supabase.from('workouts').select('date, plan_id').eq('id', id).maybeSingle()
      update.ftp_at_completion = existing
        ? await resolveFallbackFtpForWorkout(supabase, existing.date, existing.plan_id)
        : null
    }
  }

```

This is deliberately self-contained and doesn't touch the existing `body.date` reschedule-guard block below it — the two blocks each fetch the workout independently when both are needed (never happens in practice: rescheduling and completing are separate user actions), which is a harmless, YAGNI-appropriate tradeoff versus merging the two fetches.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/api/workouts-id-ftp.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 7: Run the full test suite for regression safety**

Run: `npx jest`
Expected: PASS, all suites

- [ ] **Step 8: Commit**

```bash
git add app/api/workouts/[id]/route.ts __tests__/api/workouts-id-ftp.test.ts
git commit -m "feat: accept ftp_at_completion on PATCH /api/workouts/[id], with a resolved fallback"
```

---

### Task 7: Client wiring and UI chip in `WorkoutDetailModal.tsx`

**Files:**
- Modify: `components/WorkoutDetailModal.tsx`
- Test: Modify `__tests__/components/WorkoutDetailModal.test.tsx`

**Interfaces:**
- Consumes: `PATCH /api/workouts/[id]`'s new optional `ftp_at_completion` body field (Task 6), `Workout.ftp_at_completion` (Task 1), `ICUActivity.ftp` (Task 1).

- [ ] **Step 1: Update the `activity` test fixture**

In `__tests__/components/WorkoutDetailModal.test.tsx`, find the `activity` fixture (line 61-67):

```ts
const activity: ICUActivity = {
  id: 'act456', start_date_local: '2026-05-15T08:00:00',
  type: 'Ride', moving_time: 3600, name: 'Morning Ride',
  average_watts: 220, max_watts: 350, weighted_average_watts: 225,
  average_heartrate: 155, training_load: 94, rolling_ftp: null,
  distance: null, total_elevation_gain: null, left_right_balance: null,
}
```

Replace with (adds `ftp: 245` — `ftp` is optional on `ICUActivity` so this compiles either way, but the new tests below need a concrete value):

```ts
const activity: ICUActivity = {
  id: 'act456', start_date_local: '2026-05-15T08:00:00',
  type: 'Ride', moving_time: 3600, name: 'Morning Ride',
  average_watts: 220, max_watts: 350, weighted_average_watts: 225,
  average_heartrate: 155, training_load: 94, rolling_ftp: null, ftp: 245,
  distance: null, total_elevation_gain: null, left_right_balance: null,
}
```

- [ ] **Step 2: Write the failing tests for the client PATCH bodies**

In `__tests__/components/WorkoutDetailModal.test.tsx`, add these two tests inside the `describe('WorkoutDetailModal', ...)` block, after the existing `'shows needs_review banner with matched activity name'` test (after line 127):

```ts
  it('calls PATCH with ftp_at_completion from the matched activity when confirming a match', async () => {
    const onStatusChange = jest.fn()
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({}),
    } as unknown as Response)
    render(
      <WorkoutDetailModal
        workout={reviewWorkout}
        athleteId="i12345"
        activitiesOnDate={[activity]}
        onClose={jest.fn()}
        onStatusChange={onStatusChange}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1))
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/workouts/w1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed', ftp_at_completion: 245 }),
    }))
  })

  it('calls PATCH with ftp_at_completion from the selected activity when picking a different match', async () => {
    const onStatusChange = jest.fn()
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({}),
    } as unknown as Response)
    const otherActivity: ICUActivity = { ...activity, id: 'act789', name: 'Afternoon Ride', ftp: 250 }
    render(
      <WorkoutDetailModal
        workout={reviewWorkout}
        athleteId="i12345"
        activitiesOnDate={[activity, otherActivity]}
        onClose={jest.fn()}
        onStatusChange={onStatusChange}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: /change/i }))
    fireEvent.click(screen.getByText('Afternoon Ride'))
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1))
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/workouts/w1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ icu_activity_id: 'act789', tss: 94, status: 'completed', ftp_at_completion: 250 }),
    }))
  })
```

Also add these two tests for the display chip, in the same `describe` block:

```ts
  it('shows the FTP chip for a completed workout with ftp_at_completion set', async () => {
    const withFtp = { ...matchedWorkout, ftp_at_completion: 245 }
    render(<WorkoutDetailModal workout={withFtp} athleteId="i12345" onClose={jest.fn()} />)
    expect(await screen.findByText('245W FTP')).toBeInTheDocument()
  })

  it('does not show the FTP chip when ftp_at_completion is null', async () => {
    render(<WorkoutDetailModal workout={matchedWorkout} athleteId="i12345" onClose={jest.fn()} />)
    await screen.findByText('✓ Completed')
    expect(screen.queryByText(/W FTP/)).not.toBeInTheDocument()
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest __tests__/components/WorkoutDetailModal.test.tsx`
Expected: FAIL — the two PATCH-body tests fail because the current bodies don't include `ftp_at_completion`; the chip tests fail because the chip doesn't exist yet.

- [ ] **Step 4: Update `confirmMatch`**

In `components/WorkoutDetailModal.tsx`, find `confirmMatch` (line 172-192). Replace the `body: JSON.stringify({ status: 'completed' }),` line (179) with:

```ts
        body: JSON.stringify({ status: 'completed', ftp_at_completion: matchedActivity?.ftp ?? null }),
```

- [ ] **Step 5: Update `selectActivity`**

In the same file, find `selectActivity` (line 194 onward). Replace the `body: JSON.stringify({ icu_activity_id: act.id, tss: act.training_load, status: 'completed' }),` line (201) with:

```ts
        body: JSON.stringify({ icu_activity_id: act.id, tss: act.training_load, status: 'completed', ftp_at_completion: act.ftp ?? null }),
```

- [ ] **Step 6: Add the FTP chip**

Find the TSS chip block (lines 340-348):

```tsx
              {workout.status === 'completed' && workout.tss !== null ? (
                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                  ~{estimateTss(workout.type, workout.duration_minutes)} → {workout.tss} TSS
                </span>
              ) : workout.tss !== null ? (
                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                  TSS {workout.tss}
                </span>
              ) : null}
```

Immediately after this block (still inside the same wrapping `<div>`), add:

```tsx
              {workout.status === 'completed' && workout.ftp_at_completion !== null && (
                <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                  {workout.ftp_at_completion}W FTP
                </span>
              )}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest __tests__/components/WorkoutDetailModal.test.tsx`
Expected: PASS, all tests (existing + 4 new)

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add components/WorkoutDetailModal.tsx __tests__/components/WorkoutDetailModal.test.tsx
git commit -m "feat: send ftp_at_completion from matched/selected activities and show it as a chip"
```

---

### Task 8: Backfill route for already-completed workouts

**Files:**
- Create: `app/api/workouts/backfill-ftp/route.ts`
- Test: Create `__tests__/api/backfill-ftp.test.ts`

**Interfaces:**
- Consumes: `resolveFallbackFtp` (Task 2), `ICUActivity.ftp` (Task 1).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/backfill-ftp.test.ts`:

```ts
/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

const mockGetActivities = jest.fn()
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getActivities: mockGetActivities,
  })),
}))

import { POST } from '@/app/api/workouts/backfill-ftp/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const goodProfile = {
  is_admin: true,
  intervals_icu_athlete_id: 'i1',
  intervals_icu_api_key: 'k',
}

function makeSupabase({
  profile = goodProfile as unknown,
  workouts = [] as Array<{ id: string; date: string; plan_id: string | null; icu_activity_id: string | null }>,
  predictions = [] as { created_at: string; predicted_ftp: number }[],
  planRows = {} as Record<string, { baseline_ftp: number | null }>,
  updateSpy = jest.fn(),
} = {}) {
  return {
    from: (table: string) => {
      if (table === 'user_profile') {
        return { select: () => ({ maybeSingle: async () => ({ data: profile }) }) }
      }
      if (table === 'workouts') {
        return {
          select: () => ({ eq: () => ({ is: () => ({ data: workouts }) }) }),
          update: (fields: unknown) => { updateSpy(fields); return { eq: async () => ({ error: null }) } },
        }
      }
      if (table === 'ftp_predictions') {
        return { select: () => ({ eq: () => ({ data: predictions }) }) }
      }
      if (table === 'training_plans') {
        return { select: () => ({ in: () => ({ data: Object.entries(planRows).map(([id, row]) => ({ id, ...row })) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/workouts/backfill-ftp', () => {
  it('returns 403 for a non-admin', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ profile: { ...goodProfile, is_admin: false } }))
    const res = await POST()
    expect(res.status).toBe(403)
  })

  it('backfills from the linked activity\'s ftp when present', async () => {
    const updateSpy = jest.fn()
    mockGetActivities.mockResolvedValue([
      { id: 'act1', start_date_local: '2026-06-10T08:00:00', type: 'Ride', moving_time: 3600, name: 'r', ftp: 240 },
    ])
    const supabase = makeSupabase({
      updateSpy,
      workouts: [{ id: 'w1', date: '2026-06-10', plan_id: null, icu_activity_id: 'act1' }],
    })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabase)
    const res = await POST()
    const body = await res.json()
    expect(body.updated).toBe(1)
    expect(updateSpy).toHaveBeenCalledWith({ ftp_at_completion: 240 })
  })

  it('falls back to a confirmed prediction when the linked activity has no ftp', async () => {
    const updateSpy = jest.fn()
    mockGetActivities.mockResolvedValue([
      { id: 'act1', start_date_local: '2026-06-10T08:00:00', type: 'Ride', moving_time: 3600, name: 'r', ftp: null },
    ])
    const supabase = makeSupabase({
      updateSpy,
      workouts: [{ id: 'w1', date: '2026-06-10', plan_id: null, icu_activity_id: 'act1' }],
      predictions: [{ created_at: '2026-06-01T00:00:00Z', predicted_ftp: 225 }],
    })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabase)
    const res = await POST()
    const body = await res.json()
    expect(body.updated).toBe(1)
    expect(updateSpy).toHaveBeenCalledWith({ ftp_at_completion: 225 })
  })

  it('falls back to the plan baseline_ftp when there is no activity value and no earlier prediction', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase({
      updateSpy,
      workouts: [{ id: 'w1', date: '2026-06-10', plan_id: 'plan1', icu_activity_id: null }],
      planRows: { plan1: { baseline_ftp: 210 } },
    })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabase)
    const res = await POST()
    const body = await res.json()
    expect(body.updated).toBe(1)
    expect(updateSpy).toHaveBeenCalledWith({ ftp_at_completion: 210 })
  })

  it('skips a workout when none of the three sources have a value', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase({
      updateSpy,
      workouts: [{ id: 'w1', date: '2026-06-10', plan_id: null, icu_activity_id: null }],
    })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabase)
    const res = await POST()
    const body = await res.json()
    expect(body.updated).toBe(0)
    expect(body.skipped).toBe(1)
    expect(updateSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/api/backfill-ftp.test.ts`
Expected: FAIL with a module-not-found error — the route doesn't exist yet.

- [ ] **Step 3: Create the route**

Create `app/api/workouts/backfill-ftp/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { resolveFallbackFtp, type FtpAnchor } from '@/lib/ftp/resolve-ftp'
import type { ICUActivity } from '@/types'

// Admin-only one-off: backfill ftp_at_completion for completed workouts that predate
// this feature. Primary source is intervals.icu's own per-activity `ftp` (its FTP
// history); falls back to our confirmed ftp_predictions timeline, then to the
// workout's plan baseline_ftp, then leaves it null.
export async function POST() {
  const supabase = await createSupabaseServerClient()

  const { data: profile } = await supabase
    .from('user_profile')
    .select('is_admin, intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: rows } = await supabase
    .from('workouts')
    .select('id, date, plan_id, icu_activity_id')
    .eq('status', 'completed')
    .is('ftp_at_completion', null)

  const workouts = (rows ?? []) as Array<{ id: string; date: string; plan_id: string | null; icu_activity_id: string | null }>
  if (!workouts.length) {
    return NextResponse.json({ total: 0, updated: 0, skipped: 0, failed: 0 })
  }

  // Bulk-fetch intervals.icu activities for every linked workout, once, spanning the
  // full date range in this batch — a single wide fetch is fine for a one-off admin action.
  const activityById = new Map<string, ICUActivity>()
  const linkedIds = workouts.map(w => w.icu_activity_id).filter((id): id is string => id !== null)
  if (linkedIds.length && profile.intervals_icu_athlete_id && profile.intervals_icu_api_key) {
    const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    const dates = workouts.map(w => w.date).sort()
    const activities = await client.getActivities(dates[0], dates[dates.length - 1])
    for (const a of activities) activityById.set(a.id, a)
  }

  // Fallback sources, fetched once and reused across the whole batch.
  const { data: predictions } = await supabase
    .from('ftp_predictions')
    .select('created_at, predicted_ftp')
    .eq('confirmed', true)
  const anchors: FtpAnchor[] = (predictions ?? []).map((p: { created_at: string; predicted_ftp: number }) => ({
    createdAt: p.created_at,
    predictedFtp: p.predicted_ftp,
  }))

  const planIds = [...new Set(workouts.map(w => w.plan_id).filter((id): id is string => id !== null))]
  const planBaselineById = new Map<string, number | null>()
  if (planIds.length) {
    const { data: plans } = await supabase.from('training_plans').select('id, baseline_ftp').in('id', planIds)
    for (const p of plans ?? []) planBaselineById.set(p.id, p.baseline_ftp)
  }

  let updated = 0, skipped = 0, failed = 0
  for (const w of workouts) {
    const linkedActivity = w.icu_activity_id ? activityById.get(w.icu_activity_id) : undefined
    const ftpFromActivity = linkedActivity?.ftp ?? null
    const ftp = ftpFromActivity ?? resolveFallbackFtp(w.date, anchors, w.plan_id ? planBaselineById.get(w.plan_id) ?? null : null)

    if (ftp === null) { skipped++; continue }

    const { error } = await supabase.from('workouts').update({ ftp_at_completion: ftp }).eq('id', w.id)
    if (error) failed++; else updated++
  }

  return NextResponse.json({ total: workouts.length, updated, skipped, failed })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/api/backfill-ftp.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add app/api/workouts/backfill-ftp/route.ts __tests__/api/backfill-ftp.test.ts
git commit -m "feat: add admin backfill route for ftp_at_completion on existing workouts"
```

---

### Task 9: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx jest`
Expected: PASS, all suites

- [ ] **Step 2: Full typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Confirm the migration file is present and matches the plan**

Run: `cat supabase/migrations/20260710_ftp_at_completion.sql`
Expected: `alter table workouts add column if not exists ftp_at_completion integer;`

Remind the user (per this repo's `AGENTS.md` "Database migrations" convention) that this SQL must be run manually against the shared Supabase project before this branch's app code reaches users who complete a workout — otherwise every completion write will fail with a missing-column error until it's run.

---

## Self-Review

**Spec coverage:**
- `icu_ftp` as primary source, mapped onto `ICUActivity` → Task 1. ✓
- Fallback resolver (confirmed predictions → plan baseline → null) → Task 2. ✓
- Sync-time auto-match stamping → Tasks 3 (pure carry-through) + 4 (route wiring). ✓
- Unplanned-ride import stamping (covers the 3-month `app/api/workouts/import-rides/route.ts` caller too, since it shares `importUnplannedRides`) → Task 5. ✓
- Manual confirm/select-activity stamping → Tasks 6 (server) + 7 (client). ✓
- Backfill for already-completed workouts, using linked-activity `ftp` first → Task 8. ✓
- UI chip → Task 7. ✓
- Migration → Task 1. ✓
- No new coverage attempted for `app/api/sync/route.ts` (explicitly out of scope per Global Constraints) → honored in Task 4.

**Placeholder scan:** No TBD/TODO; every step has complete, runnable code.

**Type consistency:** `WorkoutMatch.ftp_at_completion`/`date`/`plan_id` (Task 3) match exactly what Task 4's route reads (`m.ftp_at_completion`, `m.date`, `m.plan_id`). `resolveFallbackFtp(date, confirmedPredictions, planBaselineFtp)` and `resolveFallbackFtpForWorkout(supabase, date, planId)` (Task 2) are called with matching argument order and types in Tasks 4, 5, 6, and 8. `ICUActivity.ftp` (Task 1) is read consistently as `a.ftp`/`act.ftp`/`linkedActivity?.ftp` everywhere it's consumed (Tasks 3, 5, 7, 8) — no field-name drift.
