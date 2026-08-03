# Plan History & Close Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an athlete close a training plan from the kebab menu (or replace it by building a new one) and see a frozen stats snapshot of it afterward in a new "History" tab.

**Architecture:** A single shared `archivePlan()` function in `lib/plan/archive.ts` computes a stats snapshot (reusing the existing `buildWeekBuckets`/`consistency`/`planHours` helpers), deletes future uncompleted workouts, and flips the plan to `archived` with the snapshot frozen into a new `archive_summary` jsonb column. Both archiving paths in the app — the explicit "Close plan" kebab action and the implicit archive-on-replace when building a new plan — call this one function. A new History tab reads `status = 'archived'` plans and renders the frozen snapshots.

**Tech Stack:** Next.js App Router (route handlers), Supabase (Postgres + `@supabase/ssr`), TypeScript, Jest + React Testing Library, Tailwind CSS.

## Global Constraints

- Run `npm run typecheck` before committing any task that touches `.ts`/`.tsx` files — Jest does not surface type errors (`AGENTS.md`).
- The migration in Task 1 is not auto-deployed. After that task, tell the user the exact SQL to run against the shared Supabase project, and to run `notify pgrst, 'reload schema';` afterward (`AGENTS.md`).
- All new/changed UI must work at ≥320px width: `items-end sm:items-center` + `max-h-[92vh] overflow-y-auto` on any modal, 44px-minimum touch targets, no hover-only interactions (`AGENTS.md`).
- Every task must leave `npm run test:ci` passing after its final commit (intermediate steps within a task may be red between a failing test and its implementation, per TDD).

---

### Task 1: Data model — migration + types

**Files:**
- Create: `supabase/migrations/20260803_plan_archive_summary.sql`
- Modify: `supabase/schema.sql:29-50`
- Modify: `types/index.ts:73-86`
- Modify: `__tests__/support/factories.ts:60-76`

**Interfaces:**
- Produces: `PlanWeekSummary`, `PlanArchiveSummary` (exported from `@/types`), and `TrainingPlan.closed_at: string | null` / `TrainingPlan.archive_summary: PlanArchiveSummary | null`. Every later task that reads or writes a plan's snapshot uses these exact shapes.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260803_plan_archive_summary.sql
alter table training_plans add column if not exists closed_at timestamptz;
alter table training_plans add column if not exists archive_summary jsonb;
```

- [ ] **Step 2: Add the columns to `supabase/schema.sql`'s fresh-install `training_plans` table, and note the migration for existing installs**

In `supabase/schema.sql`, the `training_plans` table definition currently ends:

```sql
  last_reviewed_week text,
  training_philosophy jsonb
);
```

Change to:

```sql
  last_reviewed_week text,
  training_philosophy jsonb,
  closed_at timestamptz,
  archive_summary jsonb
);
```

And in the "Migration for existing installations (training_plans)" comment block near the top of the file (`supabase/schema.sql:29-30`), add a line:

```sql
-- alter table training_plans add column if not exists closed_at timestamptz;
-- alter table training_plans add column if not exists archive_summary jsonb;
```

- [ ] **Step 3: Add the `PlanWeekSummary`/`PlanArchiveSummary` types and extend `TrainingPlan`**

In `types/index.ts`, immediately after the `TrainingPlan` interface (currently `types/index.ts:73-86`), add:

```ts
export interface PlanWeekSummary {
  weekIndex: number
  weekStart: string
  plannedSessions: number
  completedSessions: number
  plannedTss: number
  actualTss: number
  hours: number
}

export interface PlanArchiveSummary {
  startDate: string
  closedAt: string
  plannedEndDate: string
  closedEarly: boolean
  totalPlannedSessions: number
  totalCompletedSessions: number
  totalHours: number
  totalTss: number
  ctlStart: number | null
  ctlEnd: number | null
  fitnessChange: number | null
  consistencyPct: number
  weeks: PlanWeekSummary[]
}
```

Then add two fields to the end of the existing `TrainingPlan` interface:

```ts
export interface TrainingPlan {
  id: string
  name: string
  status: PlanStatus
  target_event_name: string
  target_event_date: string
  phase: PlanPhase
  rationale: string
  last_reviewed_week: string | null
  plan_weeks: number | null
  week_phases: PlanPhase[] | null
  created_at: string
  updated_at: string
  closed_at: string | null
  archive_summary: PlanArchiveSummary | null
}
```

- [ ] **Step 4: Update the `makeTrainingPlan` factory and add a `makeArchiveSummary` factory**

In `__tests__/support/factories.ts`, add `PlanArchiveSummary` to the type import at the top of the file:

```ts
import type {
  Workout,
  ActivityMetrics,
  TrainingPlan,
  RidingStats,
  GeneratedPlan,
  PlanArchiveSummary,
} from '@/types'
```

Update `makeTrainingPlan`'s returned object to include the two new fields:

```ts
export function makeTrainingPlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    id: 'plan1',
    name: 'Test Plan',
    status: 'active',
    target_event_name: 'Target Event',
    target_event_date: '2026-07-01',
    phase: 'build',
    rationale: 'Progressive build towards the A event.',
    last_reviewed_week: null,
    plan_weeks: 8,
    week_phases: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    closed_at: null,
    archive_summary: null,
    ...overrides,
  }
}
```

Add a new factory directly after it:

```ts
export function makeArchiveSummary(overrides: Partial<PlanArchiveSummary> = {}): PlanArchiveSummary {
  return {
    startDate: '2026-05-01',
    closedAt: '2026-06-26',
    plannedEndDate: '2026-06-26',
    closedEarly: false,
    totalPlannedSessions: 24,
    totalCompletedSessions: 20,
    totalHours: 30,
    totalTss: 1800,
    ctlStart: 40,
    ctlEnd: 48,
    fitnessChange: 8,
    consistencyPct: 83,
    weeks: [],
    ...overrides,
  }
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors (nothing consumes the new fields yet, so this only confirms the type additions themselves are valid).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260803_plan_archive_summary.sql supabase/schema.sql types/index.ts __tests__/support/factories.ts
git commit -m "feat: add plan closure/archive-summary columns and types"
```

Tell the user: run the following against the shared Supabase project (SQL editor, or `supabase db push` if linked locally), then reload PostgREST's schema cache:

```sql
alter table training_plans add column if not exists closed_at timestamptz;
alter table training_plans add column if not exists archive_summary jsonb;
notify pgrst, 'reload schema';
```

---

### Task 2: Per-week hours in `buildWeekBuckets`

**Files:**
- Modify: `lib/plan/progress.ts:4-75`
- Modify: `__tests__/lib/plan-progress.test.ts:27-38`

**Interfaces:**
- Consumes: nothing new.
- Produces: `WeekBucket.hours: number` — every later consumer of `buildWeekBuckets` (Task 3's `buildArchiveSummary`, and the existing `LoadComparisonChart`/`ConsistencyStrip`, which use `toMatchObject`-style destructuring and are unaffected by the extra field) can now read total activity hours for a given plan week.

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('buildWeekBuckets', ...)` block in `__tests__/lib/plan-progress.test.ts` (after the existing two `it(...)` blocks, before the closing `})` at line 56):

```ts
  it('sums activity moving time into hours per week', () => {
    const activities = [
      activity({ id: 'a1', start_date_local: '2026-05-03T08:00:00', moving_time: 3600 }),
      activity({ id: 'a2', start_date_local: '2026-05-04T08:00:00', moving_time: 1800 }),
    ]
    const buckets = buildWeekBuckets([], activities, planStart, 1)
    expect(buckets[0].hours).toBe(1.5)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest plan-progress -t "sums activity moving time"`
Expected: FAIL — `buckets[0].hours` is `undefined`, not `1.5`.

- [ ] **Step 3: Implement**

In `lib/plan/progress.ts`, update the `WeekBucket` interface:

```ts
export interface WeekBucket {
  weekIndex: number
  plannedTss: number
  actualTss: number
  plannedSessions: number
  completedSessions: number
  hours: number
}
```

Update the bucket initializer inside `buildWeekBuckets`:

```ts
  const buckets: WeekBucket[] = Array.from({ length: totalWeeks }, (_, i) => ({
    weekIndex: i, plannedTss: 0, actualTss: 0, plannedSessions: 0, completedSessions: 0, hours: 0,
  }))
```

Update the activities loop to accumulate hours alongside `actualTss`:

```ts
  for (const a of activities) {
    const i = weekIndexOf(a.start_date_local, planStart)
    if (i < 0 || i >= totalWeeks) continue
    buckets[i].actualTss += a.training_load ?? 0
    buckets[i].hours += (a.moving_time ?? 0) / 3600
  }
```

Update the final rounding loop:

```ts
  for (const b of buckets) {
    b.plannedTss = Math.round(b.plannedTss)
    b.actualTss = Math.round(b.actualTss)
    b.hours = Math.round(b.hours * 10) / 10
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest plan-progress -t "sums activity moving time"`
Expected: PASS

- [ ] **Step 5: Run the full progress test file to confirm no regressions**

Run: `npx jest plan-progress`
Expected: all tests PASS (the pre-existing `buildWeekBuckets` tests use `toMatchObject`, which ignores the new `hours` key, so they still pass unchanged).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add lib/plan/progress.ts __tests__/lib/plan-progress.test.ts
git commit -m "feat: track per-week hours in buildWeekBuckets"
```

---

### Task 3: `buildArchiveSummary` (pure snapshot computation)

**Files:**
- Create: `lib/plan/archive.ts`
- Create: `__tests__/lib/plan-archive.test.ts`

**Interfaces:**
- Consumes: `buildWeekBuckets`, `consistency`, `planHours` from `@/lib/plan/progress` (`WeekBucket.hours` from Task 2); `addDaysUtc` from `@/lib/plan/forecast`; `Workout`, `ICUActivity`, `ICUWellness`, `PlanArchiveSummary` from `@/types`.
- Produces: `buildArchiveSummary(workouts, activities, wellness, planStart, totalWeeks, closureDate): PlanArchiveSummary`. Task 4's `archivePlan` calls this directly.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/plan-archive.test.ts`:

```ts
import { buildArchiveSummary } from '@/lib/plan/archive'
import { makeWorkout } from '../support/factories'
import type { ICUActivity, ICUWellness } from '@/types'

function activity(over: Partial<ICUActivity>): ICUActivity {
  return {
    id: 'a', start_date_local: '2026-05-01T08:00:00', type: 'Ride', moving_time: 3600,
    name: 'Ride', average_watts: 200, max_watts: 500, weighted_average_watts: 210,
    average_heartrate: 150, training_load: 50, rolling_ftp: null, distance: null,
    total_elevation_gain: null, left_right_balance: null, ...over,
  }
}

function wellness(over: Partial<ICUWellness>): ICUWellness {
  return {
    id: '2026-05-01', ctl: null, atl: null, form: null, hrv: null, resting_hr: null,
    sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null,
    stress_high: null, garmin_training_load: null, sleep_score: null, ...over,
  }
}

describe('buildArchiveSummary', () => {
  const planStart = '2026-05-01'

  it('summarises a fully-completed 2-week plan closed on schedule', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-05-02', status: 'completed', steps: [{ label: 's', duration_minutes: 60, power_pct_ftp: 100 }] }),
      makeWorkout({ id: 'w2', date: '2026-05-09', status: 'completed', steps: [{ label: 's', duration_minutes: 60, power_pct_ftp: 100 }] }),
    ]
    const activities = [
      activity({ id: 'a1', start_date_local: '2026-05-02T08:00:00', training_load: 100, moving_time: 3600 }),
      activity({ id: 'a2', start_date_local: '2026-05-09T08:00:00', training_load: 100, moving_time: 3600 }),
    ]
    const wellnessRows = [
      wellness({ id: '2026-05-01', ctl: 40 }),
      wellness({ id: '2026-05-14', ctl: 48 }),
    ]
    const closureDate = '2026-05-15' // exactly 2 weeks after planStart
    const summary = buildArchiveSummary(workouts, activities, wellnessRows, planStart, 2, closureDate)

    expect(summary).toMatchObject({
      startDate: '2026-05-01',
      closedAt: '2026-05-15',
      plannedEndDate: '2026-05-15',
      closedEarly: false,
      totalPlannedSessions: 2,
      totalCompletedSessions: 2,
      totalHours: 2,
      totalTss: 200,
      ctlStart: 40,
      ctlEnd: 48,
      fitnessChange: 8,
    })
    expect(summary.weeks).toHaveLength(2)
    expect(summary.weeks[0]).toMatchObject({ weekIndex: 0, weekStart: '2026-05-01', completedSessions: 1, hours: 1 })
  })

  it('flags an early closure', () => {
    const closureDate = '2026-05-10' // 9 days in, plan is 4 weeks
    const summary = buildArchiveSummary([], [], [], planStart, 4, closureDate)
    expect(summary.closedEarly).toBe(true)
    expect(summary.plannedEndDate).toBe('2026-05-29')
  })

  it('reports null fitness fields when no wellness data is available', () => {
    const summary = buildArchiveSummary([], [], [], planStart, 1, '2026-05-08')
    expect(summary.ctlStart).toBeNull()
    expect(summary.ctlEnd).toBeNull()
    expect(summary.fitnessChange).toBeNull()
  })

  it('reports zero counts for a plan closed with no completed workouts', () => {
    const summary = buildArchiveSummary([], [], [], planStart, 1, '2026-05-08')
    expect(summary.totalPlannedSessions).toBe(0)
    expect(summary.totalCompletedSessions).toBe(0)
    expect(summary.totalHours).toBe(0)
    expect(summary.totalTss).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest plan-archive`
Expected: FAIL with "Cannot find module '@/lib/plan/archive'"

- [ ] **Step 3: Implement `buildArchiveSummary`**

Create `lib/plan/archive.ts`:

```ts
import { buildWeekBuckets, consistency, planHours } from '@/lib/plan/progress'
import { addDaysUtc } from '@/lib/plan/forecast'
import type { Workout, ICUActivity, ICUWellness, PlanArchiveSummary } from '@/types'

function ctlNearestOnOrBefore(wellness: ICUWellness[], date: string): number | null {
  const rows = wellness
    .filter(w => w.ctl != null && w.id <= date)
    .sort((a, b) => a.id.localeCompare(b.id))
  return rows.length ? rows[rows.length - 1].ctl : null
}

export function buildArchiveSummary(
  workouts: Workout[],
  activities: ICUActivity[],
  wellness: ICUWellness[],
  planStart: string,
  totalWeeks: number,
  closureDate: string,
): PlanArchiveSummary {
  const buckets = buildWeekBuckets(workouts, activities, planStart, totalWeeks)
  const { hitPct } = consistency(buckets, totalWeeks - 1)
  const plannedEndDate = addDaysUtc(planStart, totalWeeks * 7)
  const ctlStart = ctlNearestOnOrBefore(wellness, planStart)
  const ctlEnd = ctlNearestOnOrBefore(wellness, closureDate)

  return {
    startDate: planStart,
    closedAt: closureDate,
    plannedEndDate,
    closedEarly: closureDate < plannedEndDate,
    totalPlannedSessions: buckets.reduce((s, b) => s + b.plannedSessions, 0),
    totalCompletedSessions: buckets.reduce((s, b) => s + b.completedSessions, 0),
    totalHours: planHours(workouts, activities),
    totalTss: buckets.reduce((s, b) => s + b.actualTss, 0),
    ctlStart,
    ctlEnd,
    fitnessChange: ctlStart != null && ctlEnd != null ? Math.round((ctlEnd - ctlStart) * 10) / 10 : null,
    consistencyPct: hitPct,
    weeks: buckets.map(b => ({
      weekIndex: b.weekIndex,
      weekStart: addDaysUtc(planStart, b.weekIndex * 7),
      plannedSessions: b.plannedSessions,
      completedSessions: b.completedSessions,
      plannedTss: b.plannedTss,
      actualTss: b.actualTss,
      hours: b.hours,
    })),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest plan-archive`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add lib/plan/archive.ts __tests__/lib/plan-archive.test.ts
git commit -m "feat: compute frozen per-plan archive stats summary"
```

---

### Task 4: `archivePlan` (orchestration)

**Files:**
- Modify: `lib/plan/archive.ts` (append)
- Modify: `__tests__/lib/plan-archive.test.ts` (append)

**Interfaces:**
- Consumes: `buildArchiveSummary` (this file, Task 3); `IntervalsClient` from `@/lib/intervals/client` (`getActivities(oldest, newest)`, `getWellness(start, end)`, `deleteEvent(eventId)` — all already exist); `SupabaseClient` from `@supabase/supabase-js`.
- Produces: `archivePlan(supabase, client, planId, closureDate): Promise<{ archived: boolean; deleted: number; failed: number }>`. Task 5 (`/api/plan/close`) and Task 7 (refactored `/api/plan` PATCH) both call this exact signature.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/plan-archive.test.ts` (new top-level `describe`, after the closing `})` of `describe('buildArchiveSummary', ...)`):

```ts
describe('archivePlan', () => {
  function makeSupabase({
    plan = { id: 'plan1', created_at: '2026-05-01T00:00:00Z', plan_weeks: 1 } as unknown,
    workouts = [] as unknown[],
    deleteSpy = jest.fn(async (_ids: string[]) => ({ error: null })),
    updateSpy = jest.fn(async (_fields: unknown) => ({ data: [{ id: 'plan1' }] })),
  } = {}) {
    return {
      from: (table: string) => {
        if (table === 'training_plans') {
          return {
            select: () => ({ eq: () => ({ single: async () => ({ data: plan }) }) }),
            update: (fields: unknown) => ({
              eq: () => ({ eq: () => ({ select: () => updateSpy(fields) }) }),
            }),
          }
        }
        if (table === 'workouts') {
          return {
            select: () => ({ eq: async () => ({ data: workouts }) }),
            delete: () => ({ in: (_col: string, ids: string[]) => deleteSpy(ids) }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }
  }

  it('deletes future planned workouts, archives the plan, and freezes a summary', async () => {
    const workouts = [
      { id: 'w1', status: 'completed', date: '2026-05-02', plan_id: 'plan1', icu_activity_id: null, duration_minutes: 60, type: 'endurance', steps: null, optional: false },
      { id: 'w2', status: 'planned', date: '2026-05-06', plan_id: 'plan1', icu_activity_id: 'evt-2', duration_minutes: 60, type: 'endurance', steps: null, optional: false },
    ]
    const deleteSpy = jest.fn(async (_ids: string[]) => ({ error: null }))
    const updateSpy = jest.fn(async (fields: unknown) => ({ data: [{ id: 'plan1' }] }))
    const supabase = makeSupabase({ workouts, deleteSpy, updateSpy }) as never
    const deleteEvent = jest.fn(async () => undefined)
    const client = { getActivities: jest.fn(async () => []), getWellness: jest.fn(async () => []), deleteEvent } as never

    const result = await archivePlan(supabase, client, 'plan1', '2026-05-05')

    expect(deleteEvent).toHaveBeenCalledWith('evt-2')
    expect(deleteSpy).toHaveBeenCalledWith(['w2'])
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      status: 'archived',
      closed_at: '2026-05-05',
      archive_summary: expect.objectContaining({ closedAt: '2026-05-05' }),
    }))
    expect(result).toEqual({ archived: true, deleted: 1, failed: 0 })
  })

  it('counts a failed intervals.icu event deletion without blocking the archive', async () => {
    const workouts = [
      { id: 'w1', status: 'planned', date: '2026-05-06', plan_id: 'plan1', icu_activity_id: 'evt-1', duration_minutes: 60, type: 'endurance', steps: null, optional: false },
    ]
    const supabase = makeSupabase({ workouts }) as never
    const client = {
      getActivities: jest.fn(async () => []),
      getWellness: jest.fn(async () => []),
      deleteEvent: jest.fn(async () => { throw new Error('404') }),
    } as never

    const result = await archivePlan(supabase, client, 'plan1', '2026-05-05')
    expect(result).toEqual({ archived: true, deleted: 1, failed: 1 })
  })

  it('degrades gracefully when intervals.icu is not configured (client is null)', async () => {
    const workouts = [
      { id: 'w1', status: 'completed', date: '2026-05-02', plan_id: 'plan1', icu_activity_id: null, duration_minutes: 60, type: 'endurance', steps: null, optional: false },
    ]
    const updateSpy = jest.fn(async (fields: unknown) => ({ data: [{ id: 'plan1' }] }))
    const supabase = makeSupabase({ workouts, updateSpy }) as never

    const result = await archivePlan(supabase, null, 'plan1', '2026-05-05')

    expect(result).toEqual({ archived: true, deleted: 0, failed: 0 })
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      archive_summary: expect.objectContaining({ ctlStart: null, ctlEnd: null, fitnessChange: null }),
    }))
  })

  it('returns archived: false when the plan was already archived by a concurrent call', async () => {
    const updateSpy = jest.fn(async () => ({ data: [] }))
    const supabase = makeSupabase({ updateSpy }) as never
    const result = await archivePlan(supabase, null, 'plan1', '2026-05-05')
    expect(result.archived).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest plan-archive -t archivePlan`
Expected: FAIL with "archivePlan is not a function" (not yet exported)

- [ ] **Step 3: Implement `archivePlan`**

Append to `lib/plan/archive.ts`. First, add these imports to the top of the file (alongside the existing ones):

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { IntervalsClient } from '@/lib/intervals/client'
```

Then append the function:

```ts
export async function archivePlan(
  supabase: SupabaseClient,
  client: IntervalsClient | null,
  planId: string,
  closureDate: string,
): Promise<{ archived: boolean; deleted: number; failed: number }> {
  const { data: plan } = await supabase
    .from('training_plans')
    .select('id, created_at, plan_weeks')
    .eq('id', planId)
    .single()
  if (!plan) return { archived: false, deleted: 0, failed: 0 }

  const planStart = (plan.created_at as string).split('T')[0]
  const totalWeeks = (plan.plan_weeks as number | null) ?? 1

  const { data: allWorkouts } = await supabase
    .from('workouts')
    .select('*')
    .eq('plan_id', planId)
  const workouts = (allWorkouts ?? []) as Workout[]

  let activities: ICUActivity[] = []
  let wellness: ICUWellness[] = []
  if (client) {
    try {
      ;[activities, wellness] = await Promise.all([
        client.getActivities(planStart, closureDate),
        client.getWellness(planStart, closureDate),
      ])
    } catch { /* archive proceeds using local workout data only */ }
  }

  const summary = buildArchiveSummary(workouts, activities, wellness, planStart, totalWeeks, closureDate)

  const toDelete = workouts.filter(w => w.status === 'planned' && w.date >= closureDate)
  let failed = 0
  if (client) {
    for (const w of toDelete) {
      if (!w.intervals_icu_event_id) continue
      try { await client.deleteEvent(w.intervals_icu_event_id) } catch { failed++ }
    }
  }
  const deleteIds = toDelete.map(w => w.id)
  if (deleteIds.length > 0) {
    await supabase.from('workouts').delete().in('id', deleteIds)
  }

  const { data: updated } = await supabase
    .from('training_plans')
    .update({ status: 'archived', closed_at: closureDate, archive_summary: summary })
    .eq('id', planId)
    .eq('status', 'active')
    .select('id')

  return { archived: (updated?.length ?? 0) > 0, deleted: deleteIds.length, failed }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest plan-archive`
Expected: PASS (all 8 tests — 4 from Task 3, 4 new)

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add lib/plan/archive.ts __tests__/lib/plan-archive.test.ts
git commit -m "feat: add archivePlan orchestration (delete future workouts, freeze summary, flip status)"
```

---

### Task 5: `POST /api/plan/close` — explicit close action

**Files:**
- Create: `app/api/plan/close/route.ts`
- Create: `__tests__/api/plan-close.test.ts`
- Delete: `app/api/workouts/clear-future/route.ts`

**Interfaces:**
- Consumes: `archivePlan` from `@/lib/plan/archive` (Task 4); `IntervalsClient` from `@/lib/intervals/client`; `createSupabaseServerClient` from `@/lib/supabase-server`.
- Produces: `POST /api/plan/close` → `200 { deleted: number, failed: number }` on success, `400 { error: string }` when there's no active plan (or it was already closed).

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/plan-close.test.ts`:

```ts
/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({})),
}))
const mockArchivePlan = jest.fn()
jest.mock('@/lib/plan/archive', () => ({ archivePlan: (...args: unknown[]) => mockArchivePlan(...args) }))

import { POST } from '@/app/api/plan/close/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase({
  activePlan = { id: 'plan1' } as unknown,
  profile = { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1' } as unknown,
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'training_plans') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: activePlan }) }) }) }) }
      }
      if (table === 'user_profile') {
        return { select: () => ({ maybeSingle: async () => ({ data: profile }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

beforeEach(() => { jest.clearAllMocks() })

describe('POST /api/plan/close', () => {
  it('archives the active plan and returns the deleted/failed counts', async () => {
    mockArchivePlan.mockResolvedValue({ archived: true, deleted: 3, failed: 1 })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())

    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ deleted: 3, failed: 1 })
    expect(mockArchivePlan).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'plan1', expect.any(String))
  })

  it('returns 400 when there is no active plan', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ activePlan: null }))

    const res = await POST()
    expect(res.status).toBe(400)
  })

  it('returns 400 when archivePlan reports the plan was already closed', async () => {
    mockArchivePlan.mockResolvedValue({ archived: false, deleted: 0, failed: 0 })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())

    const res = await POST()
    expect(res.status).toBe(400)
  })

  it('archives with a null intervals.icu client when the athlete has not configured it', async () => {
    mockArchivePlan.mockResolvedValue({ archived: true, deleted: 0, failed: 0 })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ profile: { intervals_icu_athlete_id: '', intervals_icu_api_key: '' } })
    )

    const res = await POST()
    expect(res.status).toBe(200)
    expect(mockArchivePlan).toHaveBeenCalledWith(expect.anything(), null, 'plan1', expect.any(String))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest plan-close`
Expected: FAIL with "Cannot find module '@/app/api/plan/close/route'"

- [ ] **Step 3: Implement the route**

Create `app/api/plan/close/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { archivePlan } from '@/lib/plan/archive'

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: activePlan } = await supabase
    .from('training_plans')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!activePlan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()
  const client = profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key
    ? new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    : null

  const today = new Date().toISOString().split('T')[0]
  const result = await archivePlan(supabase, client, activePlan.id, today)
  if (!result.archived) return NextResponse.json({ error: 'Plan already closed' }, { status: 400 })

  return NextResponse.json({ deleted: result.deleted, failed: result.failed })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest plan-close`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Delete the superseded route**

```bash
git rm app/api/workouts/clear-future/route.ts
```

(Its behavior now lives inside `archivePlan`, invoked from `/api/plan/close`. Confirmed in Task-planning research that no test file references this route today.)

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add app/api/plan/close/route.ts __tests__/api/plan-close.test.ts
git commit -m "feat: add POST /api/plan/close, retire /api/workouts/clear-future"
```

---

### Task 6: `GET /api/plan/history`

**Files:**
- Create: `app/api/plan/history/route.ts`
- Create: `__tests__/api/plan-history.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient` from `@/lib/supabase-server`.
- Produces: `GET /api/plan/history` → `200 { plans: Array<{ id, name, target_event_name, target_event_date, closed_at, archive_summary }> }`, ordered `closed_at desc`. Task 9 (`PlanHistoryTab`) consumes this exact shape.

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/plan-history.test.ts`:

```ts
/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

import { GET } from '@/app/api/plan/history/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase(plans: unknown[]) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({ data: plans, error: null }),
          }),
        }),
      }),
    }),
  }
}

describe('GET /api/plan/history', () => {
  it('returns archived plans', async () => {
    const plans = [{ id: 'p1', name: 'Base Build', closed_at: '2026-06-01', archive_summary: null }]
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(plans))

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.plans).toEqual(plans)
  })

  it('returns an empty list when there are no archived plans', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase([]))
    const res = await GET()
    const body = await res.json()
    expect(body.plans).toEqual([])
  })

  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    })
    const res = await GET()
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest plan-history`
Expected: FAIL with "Cannot find module '@/app/api/plan/history/route'"

- [ ] **Step 3: Implement the route**

Create `app/api/plan/history/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plans, error } = await supabase
    .from('training_plans')
    .select('id, name, target_event_name, target_event_date, closed_at, archive_summary')
    .eq('user_id', user.id)
    .eq('status', 'archived')
    .order('closed_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'Failed to load plan history' }, { status: 500 })
  return NextResponse.json({ plans: plans ?? [] })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest plan-history`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add app/api/plan/history/route.ts __tests__/api/plan-history.test.ts
git commit -m "feat: add GET /api/plan/history"
```

---

### Task 7: Route building a new plan through `archivePlan`

**Files:**
- Modify: `app/api/plan/route.ts:212-249`
- Create: `__tests__/api/plan-patch-archive.test.ts`

**Interfaces:**
- Consumes: `archivePlan` from `@/lib/plan/archive` (Task 4).
- Produces: no new exports — this task changes the *existing* `PATCH /api/plan` handler's internal behavior so building a new plan now also produces a history snapshot for the plan it replaces.

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/plan-patch-archive.test.ts`. This test exercises only the archive-related branch of the PATCH handler — it stubs `archivePlan` and the plan/workout inserts so it can assert the call happens with the right arguments, without needing to model intervals.icu event creation in depth.

```ts
/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/workout-names', () => ({ nameForWorkout: () => 'Test Ride' }))
const mockArchivePlan = jest.fn()
jest.mock('@/lib/plan/archive', () => ({ archivePlan: (...args: unknown[]) => mockArchivePlan(...args) }))
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    createEvent: jest.fn(async () => 'evt-1'),
  })),
}))

import { PATCH } from '@/app/api/plan/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const validPlan = {
  target_event_name: 'A Race', target_event_date: '2026-08-01', phase: 'build', rationale: 'r',
  workouts: [{ date: '2026-05-02', type: 'endurance', duration_minutes: 60, description: 'd', target_zones: 'z2', steps: null }],
}

function makeSupabase({ activePlan = null as unknown } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'user_profile') {
        return {
          select: () => ({
            maybeSingle: async () => ({
              data: { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1', events: [], current_ftp: 200 },
            }),
          }),
        }
      }
      if (table === 'training_plans') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: activePlan }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'plan2' }, error: null }) }) }),
        }
      }
      if (table === 'workouts') {
        return { insert: async () => ({ error: null }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/plan', { method: 'PATCH', body: JSON.stringify(body) }) as never
}

beforeEach(() => jest.clearAllMocks())

describe('PATCH /api/plan — archive-on-replace', () => {
  it('archives the existing active plan via archivePlan before saving the new one', async () => {
    mockArchivePlan.mockResolvedValue({ archived: true, deleted: 0, failed: 0 })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ activePlan: { id: 'plan1' } }))

    const res = await PATCH(makeRequest({ plan: validPlan, name: 'New Plan' }))

    expect(res.status).toBe(200)
    expect(mockArchivePlan).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'plan1', expect.any(String))
  })

  it('does not call archivePlan when there is no existing active plan', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ activePlan: null }))

    const res = await PATCH(makeRequest({ plan: validPlan, name: 'New Plan' }))

    expect(res.status).toBe(200)
    expect(mockArchivePlan).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest plan-patch-archive`
Expected: FAIL — `archivePlan` is never called because the route doesn't import/use it yet (the first test's `toHaveBeenCalledWith` assertion fails).

- [ ] **Step 3: Refactor the route**

In `app/api/plan/route.ts`, add the import alongside the existing ones at the top of the file:

```ts
import { archivePlan } from '@/lib/plan/archive'
```

Replace the block currently at `app/api/plan/route.ts:219-249`:

```ts
  const today = new Date().toISOString().split('T')[0]
  const { data: activePlan } = await supabase
    .from('training_plans')
    .select('id')
    .eq('status', 'active')
    .maybeSingle()

  if (activePlan) {
    const { data: futureWorkouts } = await supabase
      .from('workouts')
      .select('intervals_icu_event_id')
      .eq('plan_id', activePlan.id)
      .eq('status', 'planned')
      .gte('date', today)
      .not('intervals_icu_event_id', 'is', null)

    for (const w of futureWorkouts ?? []) {
      if (w.intervals_icu_event_id) {
        try { await client.deleteEvent(w.intervals_icu_event_id) } catch { /* already deleted */ }
      }
    }
  }

  const { error: archiveError } = await supabase
    .from('training_plans')
    .update({ status: 'archived' })
    .eq('status', 'active')

  if (archiveError) {
    return NextResponse.json({ error: 'Failed to archive existing plan' }, { status: 500 })
  }
```

with:

```ts
  const today = new Date().toISOString().split('T')[0]
  const { data: activePlan } = await supabase
    .from('training_plans')
    .select('id')
    .eq('status', 'active')
    .maybeSingle()

  if (activePlan) {
    await archivePlan(supabase, client, activePlan.id, today)
  }
```

This removes the route's own future-event-deletion loop and archive-update call (both now live inside `archivePlan`, which also freezes the stats snapshot — the one behavior this route never had before).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest plan-patch-archive`
Expected: PASS (both tests)

- [ ] **Step 5: Run the full test suite to confirm no regressions elsewhere in this file's dependents**

Run: `npx jest plan-close plan-history plan-archive plan-patch-archive plan-progress`
Expected: all PASS

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add app/api/plan/route.ts __tests__/api/plan-patch-archive.test.ts
git commit -m "refactor: route archive-on-replace through the shared archivePlan function"
```

---

### Task 8: `PlanHistoryCard` component

**Files:**
- Create: `components/plan/PlanHistoryCard.tsx`
- Create: `__tests__/components/PlanHistoryCard.test.tsx`

**Interfaces:**
- Consumes: `PlanArchiveSummary` from `@/types`.
- Produces: `PlanHistoryCard({ plan: { id, name, target_event_name, target_event_date, closed_at, archive_summary } })` — a self-contained card with an expand/collapse per-week table. Task 9 (`PlanHistoryTab`) renders one of these per archived plan.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/PlanHistoryCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import PlanHistoryCard from '@/components/plan/PlanHistoryCard'
import { makeArchiveSummary } from '../support/factories'

const basePlan = {
  id: 'p1',
  name: 'Spring Build',
  target_event_name: 'Sportive',
  target_event_date: '2026-06-26',
  closed_at: '2026-06-26',
  archive_summary: makeArchiveSummary({
    weeks: [
      { weekIndex: 0, weekStart: '2026-05-01', plannedSessions: 4, completedSessions: 3, plannedTss: 300, actualTss: 250, hours: 5.5 },
    ],
  }),
}

describe('PlanHistoryCard', () => {
  it('renders name, sessions, hours, TSS, and fitness change', () => {
    render(<PlanHistoryCard plan={basePlan} />)
    expect(screen.getByText('Spring Build')).toBeInTheDocument()
    expect(screen.getByText('20/24')).toBeInTheDocument()
    expect(screen.getByText('30.0')).toBeInTheDocument()
    expect(screen.getByText('1800')).toBeInTheDocument()
    expect(screen.getByText('CTL +8')).toBeInTheDocument()
  })

  it('shows a "Closed early" badge when the plan was closed before its planned end', () => {
    const plan = { ...basePlan, archive_summary: makeArchiveSummary({ closedEarly: true }) }
    render(<PlanHistoryCard plan={plan} />)
    expect(screen.getByText('Closed early')).toBeInTheDocument()
  })

  it('does not show the badge for a plan that ran its full course', () => {
    render(<PlanHistoryCard plan={basePlan} />)
    expect(screen.queryByText('Closed early')).not.toBeInTheDocument()
  })

  it('shows "Fitness data unavailable" instead of a CTL figure when fitnessChange is null', () => {
    const plan = { ...basePlan, archive_summary: makeArchiveSummary({ fitnessChange: null }) }
    render(<PlanHistoryCard plan={plan} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('expands to show the per-week table on tap', () => {
    render(<PlanHistoryCard plan={basePlan} />)
    expect(screen.queryByText(/Wk 1/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Spring Build'))
    expect(screen.getByText(/Wk 1/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest PlanHistoryCard`
Expected: FAIL with "Cannot find module '@/components/plan/PlanHistoryCard'"

- [ ] **Step 3: Implement the component**

Create `components/plan/PlanHistoryCard.tsx`:

```tsx
'use client'
import { useState } from 'react'
import type { PlanArchiveSummary } from '@/types'

interface HistoryPlan {
  id: string
  name: string
  target_event_name: string
  target_event_date: string
  closed_at: string | null
  archive_summary: PlanArchiveSummary | null
}

interface Props {
  plan: HistoryPlan
}

function fmtDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-bold text-slate-900">{value}</div>
    </div>
  )
}

export default function PlanHistoryCard({ plan }: Props) {
  const [expanded, setExpanded] = useState(false)
  const s = plan.archive_summary

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left p-4 space-y-2 min-h-[44px]"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-slate-900">{plan.name}</p>
          {s?.closedEarly && (
            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
              Closed early
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500">
          {plan.target_event_name}{s ? ` · ${fmtDate(s.startDate)} → ${fmtDate(s.closedAt)}` : ''}
        </p>
        {s && (
          <div className="grid grid-cols-4 gap-2 pt-1">
            <Stat label="Sessions" value={`${s.totalCompletedSessions}/${s.totalPlannedSessions}`} />
            <Stat label="Hours" value={s.totalHours.toFixed(1)} />
            <Stat label="TSS" value={String(s.totalTss)} />
            <Stat
              label="Fitness"
              value={s.fitnessChange != null ? `CTL ${s.fitnessChange >= 0 ? '+' : ''}${s.fitnessChange}` : '—'}
            />
          </div>
        )}
      </button>
      {expanded && s && (
        <div className="border-t border-slate-100 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="text-left font-semibold px-4 py-2">Week</th>
                <th className="text-right font-semibold px-2 py-2">Rides</th>
                <th className="text-right font-semibold px-2 py-2">Hours</th>
                <th className="text-right font-semibold px-2 py-2">TSS</th>
              </tr>
            </thead>
            <tbody>
              {s.weeks.map(w => (
                <tr key={w.weekIndex} className="border-t border-slate-50">
                  <td className="px-4 py-2 text-slate-700">Wk {w.weekIndex + 1} · {fmtDate(w.weekStart)}</td>
                  <td className="px-2 py-2 text-right text-slate-700">{w.completedSessions}/{w.plannedSessions}</td>
                  <td className="px-2 py-2 text-right text-slate-700">{w.hours.toFixed(1)}</td>
                  <td className="px-2 py-2 text-right text-slate-700">{w.actualTss}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

(The 4-column stat-cell grid mirrors the existing `grid-cols-4` short-numeric-stat row already shipped in `components/ActivityStatsPanel.tsx` — short numeric cells fit comfortably at ~90px each on a 320px screen, unlike the ~130px-per-column guidance for text-heavy content.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest PlanHistoryCard`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add components/plan/PlanHistoryCard.tsx __tests__/components/PlanHistoryCard.test.tsx
git commit -m "feat: add PlanHistoryCard with expandable per-week table"
```

---

### Task 9: `PlanHistoryTab` component

**Files:**
- Create: `components/plan/PlanHistoryTab.tsx`
- Create: `__tests__/components/PlanHistoryTab.test.tsx`

**Interfaces:**
- Consumes: `PlanHistoryCard` (Task 8); `GET /api/plan/history` (Task 6) via `fetch`.
- Produces: `<PlanHistoryTab />` — no props, self-fetching. Task 10 (Part C) renders this inside the plan page's new "History" tab.

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/PlanHistoryTab.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import PlanHistoryTab from '@/components/plan/PlanHistoryTab'
import { makeArchiveSummary } from '../support/factories'

const originalFetch = global.fetch

afterEach(() => { global.fetch = originalFetch; jest.resetAllMocks() })

function mockFetch(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({ json: async () => body }) as never
}

describe('PlanHistoryTab', () => {
  it('renders a card per archived plan', async () => {
    mockFetch({
      plans: [
        { id: 'p1', name: 'Spring Build', target_event_name: 'Sportive', target_event_date: '2026-06-26', closed_at: '2026-06-26', archive_summary: makeArchiveSummary() },
      ],
    })
    render(<PlanHistoryTab />)
    await waitFor(() => expect(screen.getByText('Spring Build')).toBeInTheDocument())
  })

  it('shows an empty state when there are no closed plans', async () => {
    mockFetch({ plans: [] })
    render(<PlanHistoryTab />)
    await waitFor(() => expect(screen.getByText(/No closed plans yet/)).toBeInTheDocument())
  })

  it('shows an error message when the fetch fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error')) as never
    render(<PlanHistoryTab />)
    await waitFor(() => expect(screen.getByText(/Failed to load plan history/)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest PlanHistoryTab`
Expected: FAIL with "Cannot find module '@/components/plan/PlanHistoryTab'"

- [ ] **Step 3: Implement the component**

Create `components/plan/PlanHistoryTab.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import PlanHistoryCard from '@/components/plan/PlanHistoryCard'
import type { PlanArchiveSummary } from '@/types'

interface HistoryPlan {
  id: string
  name: string
  target_event_name: string
  target_event_date: string
  closed_at: string | null
  archive_summary: PlanArchiveSummary | null
}

export default function PlanHistoryTab() {
  const [plans, setPlans] = useState<HistoryPlan[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/plan/history')
      .then(res => res.json())
      .then(data => { if (!cancelled) setPlans(data.plans ?? []) })
      .catch(() => { if (!cancelled) setError('Failed to load plan history') })
    return () => { cancelled = true }
  }, [])

  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (plans === null) return <p className="text-sm text-slate-400">Loading…</p>
  if (plans.length === 0) {
    return <p className="text-sm text-slate-500">No closed plans yet — plans you close or replace will show up here.</p>
  }

  return (
    <div className="space-y-3" data-testid="plan-history-list">
      {plans.map(p => <PlanHistoryCard key={p.id} plan={p} />)}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest PlanHistoryTab`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add components/plan/PlanHistoryTab.tsx __tests__/components/PlanHistoryTab.test.tsx
git commit -m "feat: add self-fetching PlanHistoryTab"
```

---

### Task 10: Rename the kebab menu action, rename the confirm modal, and wire the History tab into the plan page

This task merges what were originally three separate tasks (kebab menu rename, modal rename, page wiring). They are inseparable: `PlanKebabMenu`'s prop rename and `ClearWorkoutsModal`'s rename each break `app/plan/page.tsx`'s single call site until the page is updated too, so splitting them would mean committing with `npm run typecheck` red — which conflicts with this plan's own Global Constraints. Do the renames and the page wiring together, and commit once at the end with everything green.

**Files:**
- Modify: `components/PlanKebabMenu.tsx`
- Modify: `__tests__/components/PlanKebabMenu.test.tsx`
- Create: `components/ClosePlanModal.tsx`
- Create: `__tests__/components/ClosePlanModal.test.tsx`
- Delete: `components/ClearWorkoutsModal.tsx`
- Modify: `app/plan/page.tsx`

**Interfaces:**
- Consumes: `PlanHistoryTab` (Task 9), `POST /api/plan/close` (Task 5).
- Produces: `PlanKebabMenu`'s prop renamed from `onDelete` to `onClosePlan`; `ClosePlanModal({ onConfirm: () => Promise<string>, onClose: () => void })` (same three-phase confirm → closing → done contract as the old `ClearWorkoutsModal`, new copy); the plan page's new "History" tab rendering `<PlanHistoryTab />`. Nothing later in the plan depends on these — this is the last task.

#### Part A: Rename `PlanKebabMenu`'s close action

- [ ] **Step 1: Update the failing test first**

In `__tests__/components/PlanKebabMenu.test.tsx`, rename `onDelete` to `onClosePlan` in the `handlers` object:

```ts
const handlers = {
  onExtend: jest.fn(),
  onRegenerate: jest.fn(),
  onRename: jest.fn(),
  onClearFuture: jest.fn(),
  onClosePlan: jest.fn(),
}
```

Update the two assertions that reference the old label/handler (the "opens menu" test and the delete-specific test):

```ts
  it('opens menu on button click', () => {
    render(<PlanKebabMenu {...handlers} />)
    expect(screen.getByText('Extend plan')).toBeInTheDocument()
    expect(screen.getByText('Regenerate plan')).toBeInTheDocument()
    expect(screen.getByText('Rename plan')).toBeInTheDocument()
    expect(screen.getByText('Clear future workouts')).toBeInTheDocument()
    expect(screen.getByText('Close plan')).toBeInTheDocument()
  })
```

```ts
  it('calls onClosePlan and closes', () => {
    render(<PlanKebabMenu {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /plan options/i }))
    fireEvent.click(screen.getByText('Close plan'))
    expect(handlers.onClosePlan).toHaveBeenCalled()
    expect(screen.queryByText('Close plan')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest PlanKebabMenu`
Expected: FAIL — the component still renders "Delete plan" and takes an `onDelete` prop, so `screen.getByText('Close plan')` throws.

- [ ] **Step 3: Update the component**

In `components/PlanKebabMenu.tsx`, rename the prop in the interface and function signature:

```tsx
interface Props {
  onExtend: () => void
  onRegenerate: () => void
  onRename: () => void
  onClearFuture: () => void
  onClosePlan: () => void
}

export default function PlanKebabMenu({ onExtend, onRegenerate, onRename, onClearFuture, onClosePlan }: Props) {
```

Update the button's handler and label:

```tsx
          <button
            onClick={() => pick(onClosePlan)}
            className="w-full text-left px-4 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50 transition-colors min-h-[44px]"
          >
            Close plan
          </button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest PlanKebabMenu`
Expected: PASS (all 7 tests)

Do not typecheck or commit yet — `app/plan/page.tsx` still passes the old `onDelete` prop, and this task fixes that in Part C. Continue directly to Part B.

#### Part B: Rename `ClearWorkoutsModal` to `ClosePlanModal`

- [ ] **Step 5: Write the failing test**

Create `__tests__/components/ClosePlanModal.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ClosePlanModal from '@/components/ClosePlanModal'

describe('ClosePlanModal', () => {
  it('shows the close-plan confirmation copy', () => {
    render(<ClosePlanModal onConfirm={jest.fn()} onClose={jest.fn()} />)
    expect(screen.getByText('Close plan?')).toBeInTheDocument()
    expect(screen.getByText(/saves its stats to your plan history/)).toBeInTheDocument()
  })

  it('calls onConfirm and shows the result on "Yes, close"', async () => {
    const onConfirm = jest.fn().mockResolvedValue('Plan closed and saved to history. 3 workouts removed.')
    render(<ClosePlanModal onConfirm={onConfirm} onClose={jest.fn()} />)

    fireEvent.click(screen.getByText('Yes, close'))
    expect(screen.getByText('Closing plan…')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByText(/3 workouts removed/)).toBeInTheDocument())
    expect(onConfirm).toHaveBeenCalled()
  })

  it('calls onClose from the cancel button', () => {
    const onClose = jest.fn()
    render(<ClosePlanModal onConfirm={jest.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx jest ClosePlanModal`
Expected: FAIL with "Cannot find module '@/components/ClosePlanModal'"

- [ ] **Step 7: Implement the component**

Create `components/ClosePlanModal.tsx` (copy of `components/ClearWorkoutsModal.tsx` with updated strings only):

```tsx
'use client'
import { useState } from 'react'

interface Props {
  onConfirm: () => Promise<string>
  onClose: () => void
}

export default function ClosePlanModal({ onConfirm, onClose }: Props) {
  const [phase, setPhase] = useState<'confirm' | 'closing' | 'done'>('confirm')
  const [result, setResult] = useState('')
  const isError = result.startsWith('Error')

  async function handleConfirm() {
    setPhase('closing')
    const msg = await onConfirm()
    setResult(msg)
    setPhase('done')
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5 max-h-[92vh] overflow-y-auto">
        {phase === 'confirm' && (
          <>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Close plan?</h2>
              <p className="text-sm text-slate-500 mt-1">
                This closes your plan, deletes upcoming planned workouts (from both this app and intervals.icu), and saves its stats to your plan history. Past completed workouts are not affected.
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-50 transition-colors min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="bg-red-600 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-red-700 transition-colors shadow-sm min-h-[44px]"
              >
                Yes, close
              </button>
            </div>
          </>
        )}

        {phase === 'closing' && (
          <div className="flex items-center gap-3 py-2">
            <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin shrink-0" />
            <p className="text-sm text-slate-600">Closing plan…</p>
          </div>
        )}

        {phase === 'done' && (
          <>
            <div>
              <h2 className="text-lg font-bold text-slate-900">{isError ? 'Something went wrong' : 'Done'}</h2>
              <p className={`text-sm mt-1 ${isError ? 'text-red-600' : 'text-slate-500'}`}>{result}</p>
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="bg-slate-800 text-white text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-slate-900 transition-colors shadow-sm min-h-[44px]"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx jest ClosePlanModal`
Expected: PASS (all 3 tests)

- [ ] **Step 9: Delete the old component**

```bash
git rm components/ClearWorkoutsModal.tsx
```

(No test file exists for it today, so nothing else references it besides `app/plan/page.tsx`, updated next in Part C.)

Do not typecheck or commit yet — `app/plan/page.tsx` still imports `ClearWorkoutsModal`. Continue directly to Part C.

#### Part C: Wire the History tab and renamed components into the plan page

- [ ] **Step 10: Update imports**

In `app/plan/page.tsx`, replace:

```ts
import ClearWorkoutsModal from '@/components/ClearWorkoutsModal'
```

with:

```ts
import ClosePlanModal from '@/components/ClosePlanModal'
```

Add a new import alongside the other `@/components/plan/*` imports:

```ts
import PlanHistoryTab from '@/components/plan/PlanHistoryTab'
```

- [ ] **Step 11: Extend the `Tab` type and tab bar**

Replace:

```ts
type Tab = 'plan' | 'profile' | 'events'
```

with:

```ts
type Tab = 'plan' | 'profile' | 'events' | 'history'
```

Replace the tab-bar array (currently):

```tsx
        {([['plan', 'My Plan'], ['profile', 'Profile & Schedule'], ['events', 'Events']] as [Tab, string][]).map(([id, label]) => (
```

with:

```tsx
        {([['plan', 'My Plan'], ['profile', 'Profile & Schedule'], ['events', 'Events'], ['history', 'History']] as [Tab, string][]).map(([id, label]) => (
```

- [ ] **Step 12: Rename the close-plan state and handler**

Replace:

```ts
  const [showClearModal, setShowClearModal] = useState(false)
```

with:

```ts
  const [showClosePlanModal, setShowClosePlanModal] = useState(false)
```

Replace the `clearFutureWorkouts` function:

```ts
  async function clearFutureWorkouts(): Promise<string> {
    try {
      const res = await fetch('/api/workouts/clear-future', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) return `Error: ${data.error ?? 'Failed'}`
      return `Plan archived and ${data.deleted} workout${data.deleted !== 1 ? 's' : ''} deleted${data.failed ? ` (${data.failed} failed to remove from intervals.icu)` : ''}`
    } catch { return 'Error: Network error' }
  }
```

with:

```ts
  async function closePlan(): Promise<string> {
    try {
      const res = await fetch('/api/plan/close', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) return `Error: ${data.error ?? 'Failed'}`
      return `Plan closed and saved to history. ${data.deleted} workout${data.deleted !== 1 ? 's' : ''} removed${data.failed ? ` (${data.failed} failed to remove from intervals.icu)` : ''}.`
    } catch { return 'Error: Network error' }
  }
```

- [ ] **Step 13: Update the kebab menu and modal wiring**

Replace:

```tsx
                      <PlanKebabMenu
                        onExtend={() => setShowExtendModal(true)}
                        onRegenerate={() => setShowReplaceConfirm(true)}
                        onRename={handleRename}
                        onClearFuture={() => setShowClearFutureConfirm(true)}
                        onDelete={() => setShowClearModal(true)}
                      />
```

with:

```tsx
                      <PlanKebabMenu
                        onExtend={() => setShowExtendModal(true)}
                        onRegenerate={() => setShowReplaceConfirm(true)}
                        onRename={handleRename}
                        onClearFuture={() => setShowClearFutureConfirm(true)}
                        onClosePlan={() => setShowClosePlanModal(true)}
                      />
```

Replace:

```tsx
        {showClearModal && (
          <ClearWorkoutsModal onConfirm={clearFutureWorkouts} onClose={() => { setShowClearModal(false); loadPlan() }} />
        )}
```

with:

```tsx
        {showClosePlanModal && (
          <ClosePlanModal onConfirm={closePlan} onClose={() => { setShowClosePlanModal(false); loadPlan() }} />
        )}
```

- [ ] **Step 14: Add the History tab content block**

The `tab-events` content div currently closes just before the (tab-independent) review modal:

```tsx
        )}

      </div>

      {showReviewModal && (
```

Insert a new tab block between the `tab-events` div's closing `</div>` and the review modal:

```tsx
        )}

      </div>

      {/* HISTORY TAB */}
      <div data-testid="tab-history" style={{ display: tab === 'history' ? 'block' : 'none' }}>
        <PlanHistoryTab />
      </div>

      {showReviewModal && (
```

- [ ] **Step 15: Typecheck**

Run: `npm run typecheck`
Expected: no errors — this is the first point in the task where the tree is expected to typecheck cleanly (Parts A and B intentionally left it red; `app/plan/page.tsx` now matches both renamed components).

- [ ] **Step 16: Run the full test suite**

Run: `npm run test:ci`
Expected: all PASS

- [ ] **Step 17: Commit everything as one task-level commit**

```bash
git add components/PlanKebabMenu.tsx __tests__/components/PlanKebabMenu.test.tsx \
        components/ClosePlanModal.tsx __tests__/components/ClosePlanModal.test.tsx \
        app/plan/page.tsx
git commit -m "feat: rename close-plan action/modal and wire the History tab into the plan screen"
```

(`git rm components/ClearWorkoutsModal.tsx` from Step 9 already staged that deletion; nothing in Steps 10–16 unstages it, so it commits together with these `git add` paths in this same commit.)

- [ ] **Step 18: Manual mobile verification**

Per `AGENTS.md`, drive the actual flow before calling this done:
1. Start the dev server, open the Training Plan screen at a 375px-wide viewport (or emulate one).
2. Open the kebab menu on an active plan → confirm it now reads "Close plan" (red).
3. Tap it → confirm the modal reads "Close plan?" with the new copy, "Cancel" and "Yes, close" buttons are both ≥44px tall and reachable without scrolling on a short screen.
4. Confirm → verify the "Closing plan…" spinner, then a done message mentioning workouts removed and history.
5. Close the modal → open the "History" tab → confirm the just-closed plan appears as a card with its stats; tap it to confirm the per-week table expands.
6. Separately, build a new plan while one is already active → after it saves, check the History tab again and confirm the replaced plan now also appears there with a snapshot.

---

## Self-Review

**Spec coverage:**
- Data model (`closed_at`, `archive_summary`) → Task 1.
- Shared `archivePlan` (summary computation + event/row cleanup + status flip + compare-and-swap guard) → Tasks 3–4.
- Both archiving paths route through `archivePlan` → Tasks 5 (explicit close) and 7 (build-new-plan replace).
- Kebab menu rename + confirm modal re-copy (three phases retained) → Task 10 (Parts A–B).
- History tab, card, per-week table, empty state → Tasks 8–9, wired in Task 10 (Part C).
- Error handling: no-completed-workouts (Task 3 test), ICU-unavailable degraded path (Task 4 test), no-active-plan 400 (Task 5 test), partial ICU-deletion failures (Task 4 test), concurrent-close race via compare-and-swap (Task 4 test) — all covered.
- Manual mobile check → Task 10, Step 18.

**Placeholder scan:** no TBD/TODO/"add appropriate handling"-style steps; every step has literal code or an exact command.

**Type consistency:** `archivePlan(supabase, client, planId, closureDate): Promise<{ archived, deleted, failed }>` is identical across Task 4 (definition), Task 5 (`/api/plan/close`), and Task 7 (PATCH refactor). `PlanArchiveSummary`/`PlanWeekSummary` field names introduced in Task 1 are used identically in Task 3 (`buildArchiveSummary`), Task 8 (`PlanHistoryCard`), and Task 9 (`PlanHistoryTab`)'s `HistoryPlan` interface. `WeekBucket.hours` (Task 2) is read by `buildArchiveSummary` (Task 3) under the same name.
