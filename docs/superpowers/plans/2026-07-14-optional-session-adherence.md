# Optional Session Adherence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop counting a still-pending or skipped optional workout in either "Sessions" total shown on the dashboard, while leaving every other metric (streak, planned TSS/time) untouched.

**Architecture:** A small shared helper module (`lib/progress/session-counting.ts`) exports two pure predicates — `isSessionCountable` and `isSessionCompleted` — that encode the counting rule once. Both existing "Sessions" computations (`computeProgressMetrics`'s `adherence` in `lib/progress/metrics.ts`, and `weeklyProgress.sessionsTotal`/`sessionsCompleted` in `app/dashboard/page.tsx`) are rewired to use these predicates instead of their current inline `status === 'completed'` checks. `lib/progress/brief-generator.ts`'s `workouts` query is extended to select the `optional` column so it reaches `computeProgressMetrics`.

**Tech Stack:** TypeScript, Jest, Next.js App Router, Supabase.

## Global Constraints

- Counted in the total when `!w.optional || w.status === 'completed' || w.status === 'needs_review'`.
- Counted in the numerator (completed count) when `w.status === 'completed' || (w.optional && w.status === 'needs_review')`.
- Non-optional workouts are unaffected: always counted in the total; only literal `'completed'` status counts as completed (a non-optional `needs_review` workout does **not** count as completed — this is existing, unchanged behavior).
- `streak` (`lib/progress/metrics.ts`) is out of scope — no changes.
- `weeklyProgress.tssPlanned`, `timePlannedMins`, and every stat derived from `completedWP` other than `sessionsCompleted` (`tssActual`, `distanceKm`, `elevationM`, `timeActualMins`) are out of scope — they keep reading from the full, unfiltered `weekWorkoutsWP`/`completedWP` exactly as today.
- No schema changes. `workouts.optional` already exists as a `boolean` column.

---

### Task 1: Shared session-counting predicates

**Files:**
- Create: `lib/progress/session-counting.ts`
- Test: `__tests__/lib/session-counting.test.ts`

**Interfaces:**
- Produces: `isSessionCountable(w: { status: WorkoutStatus; optional?: boolean }): boolean` and `isSessionCompleted(w: { status: WorkoutStatus; optional?: boolean }): boolean` — both pure functions, no side effects. `optional` is typed as optional (`optional?: boolean`) rather than required so callers with older/partial data shapes (and existing test fixtures elsewhere in this codebase that build workout-like objects without an `optional` field) still type-check; an absent `optional` is treated identically to `optional: false`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/session-counting.test.ts`:

```typescript
import { isSessionCountable, isSessionCompleted } from '@/lib/progress/session-counting'

describe('isSessionCountable', () => {
  it('always counts a non-optional workout regardless of status', () => {
    expect(isSessionCountable({ status: 'planned' })).toBe(true)
    expect(isSessionCountable({ status: 'skipped' })).toBe(true)
    expect(isSessionCountable({ status: 'completed' })).toBe(true)
    expect(isSessionCountable({ status: 'needs_review' })).toBe(true)
  })

  it('excludes a pending or skipped optional workout', () => {
    expect(isSessionCountable({ status: 'planned', optional: true })).toBe(false)
    expect(isSessionCountable({ status: 'skipped', optional: true })).toBe(false)
  })

  it('counts a completed or needs_review optional workout', () => {
    expect(isSessionCountable({ status: 'completed', optional: true })).toBe(true)
    expect(isSessionCountable({ status: 'needs_review', optional: true })).toBe(true)
  })
})

describe('isSessionCompleted', () => {
  it('counts a completed workout regardless of optional', () => {
    expect(isSessionCompleted({ status: 'completed' })).toBe(true)
    expect(isSessionCompleted({ status: 'completed', optional: true })).toBe(true)
  })

  it('counts an optional needs_review workout as completed', () => {
    expect(isSessionCompleted({ status: 'needs_review', optional: true })).toBe(true)
  })

  it('does not count a non-optional needs_review workout as completed', () => {
    expect(isSessionCompleted({ status: 'needs_review' })).toBe(false)
  })

  it('does not count a planned or skipped workout as completed', () => {
    expect(isSessionCompleted({ status: 'planned' })).toBe(false)
    expect(isSessionCompleted({ status: 'skipped' })).toBe(false)
    expect(isSessionCompleted({ status: 'planned', optional: true })).toBe(false)
    expect(isSessionCompleted({ status: 'skipped', optional: true })).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/session-counting.test.ts`
Expected: FAIL — `Cannot find module '@/lib/progress/session-counting'`

- [ ] **Step 3: Write the implementation**

Create `lib/progress/session-counting.ts`:

```typescript
import type { WorkoutStatus } from '@/types'

interface CountableSession {
  status: WorkoutStatus
  optional?: boolean
}

export function isSessionCountable(w: CountableSession): boolean {
  return !w.optional || w.status === 'completed' || w.status === 'needs_review'
}

export function isSessionCompleted(w: CountableSession): boolean {
  return w.status === 'completed' || (!!w.optional && w.status === 'needs_review')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/session-counting.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/progress/session-counting.ts __tests__/lib/session-counting.test.ts
git commit -m "feat: add shared session-counting predicates for optional workouts"
```

---

### Task 2: Wire the predicates into `computeProgressMetrics`'s adherence calc

**Files:**
- Modify: `lib/progress/metrics.ts:1,11-14,92-99`
- Test: `__tests__/lib/progress-metrics.test.ts`

**Interfaces:**
- Consumes: `isSessionCountable`, `isSessionCompleted` from `lib/progress/session-counting.ts` (Task 1).
- Produces: no change to `computeProgressMetrics`'s exported signature or the shape of `ProgressMetrics['adherence']` (`{ completed: number; total: number } | null`) — only the counting rule inside changes.

- [ ] **Step 1: Write the failing tests**

Open `__tests__/lib/progress-metrics.test.ts`. Immediately after the existing test block ending at line 82 (`it('returns null adherence when there is no plan', ...)`), insert these five new tests:

```typescript
  it('excludes a pending optional workout from adherence total', () => {
    const workouts = [
      { status: 'completed' as const, date: '2026-05-01' },
      { status: 'planned' as const, date: '2026-05-03', optional: true },
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], workouts)
    expect(result.adherence).toEqual({ completed: 1, total: 1 })
  })

  it('excludes a skipped optional workout from adherence total', () => {
    const workouts = [
      { status: 'completed' as const, date: '2026-05-01' },
      { status: 'skipped' as const, date: '2026-05-03', optional: true },
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], workouts)
    expect(result.adherence).toEqual({ completed: 1, total: 1 })
  })

  it('counts a needs_review optional workout as done in both total and completed', () => {
    const workouts = [
      { status: 'completed' as const, date: '2026-05-01' },
      { status: 'needs_review' as const, date: '2026-05-03', optional: true },
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], workouts)
    expect(result.adherence).toEqual({ completed: 2, total: 2 })
  })

  it('counts a completed optional workout the same as a non-optional one', () => {
    const workouts = [
      { status: 'completed' as const, date: '2026-05-01', optional: true },
      { status: 'completed' as const, date: '2026-05-03' },
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], workouts)
    expect(result.adherence).toEqual({ completed: 2, total: 2 })
  })

  it('does not count a non-optional needs_review workout as completed', () => {
    const workouts = [
      { status: 'completed' as const, date: '2026-05-01' },
      { status: 'needs_review' as const, date: '2026-05-03' },
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], workouts)
    expect(result.adherence).toEqual({ completed: 1, total: 2 })
  })
```

Note: the pre-existing test `'computes adherence from completed workouts up to today'` (lines 69-77) builds workout literals without an `optional` field at all — that continues to compile and pass unchanged, because `PlanWorkout.optional` (below) is optional and an absent value is treated as non-optional.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/progress-metrics.test.ts`
Expected: FAIL — the 5 new tests fail because `PlanWorkout` has no `optional` field yet and the adherence calc doesn't apply the new rule (e.g. `'excludes a pending optional workout from adherence total'` gets `{ completed: 1, total: 2 }` instead of `{ completed: 1, total: 1 }`).

- [ ] **Step 3: Write the implementation**

In `lib/progress/metrics.ts`, change the import at line 1 from:

```typescript
import type { ICUActivity, ICUWellness, ProgressMetrics, WeightEntry, WorkoutStatus } from '@/types'
```

to:

```typescript
import type { ICUActivity, ICUWellness, ProgressMetrics, WeightEntry, WorkoutStatus } from '@/types'
import { isSessionCountable, isSessionCompleted } from './session-counting'
```

Change the `PlanWorkout` interface (lines 11-14) from:

```typescript
interface PlanWorkout {
  status: WorkoutStatus
  date: string
}
```

to:

```typescript
interface PlanWorkout {
  status: WorkoutStatus
  date: string
  optional?: boolean
}
```

Change the adherence block (lines 92-99) from:

```typescript
  // Adherence
  let adherence: ProgressMetrics['adherence'] = null
  if (plan && planWorkouts.length > 0) {
    // includes today — a planned session today counts until it's marked completed
    const pastAndToday = planWorkouts.filter(w => w.date <= today)
    const completed = pastAndToday.filter(w => w.status === 'completed').length
    const total = pastAndToday.length
    if (total > 0) adherence = { completed, total }
  }
```

to:

```typescript
  // Adherence
  let adherence: ProgressMetrics['adherence'] = null
  if (plan && planWorkouts.length > 0) {
    // includes today — a planned session today counts until it's marked completed
    const pastAndToday = planWorkouts.filter(w => w.date <= today)
    const countable = pastAndToday.filter(isSessionCountable)
    const completed = countable.filter(isSessionCompleted).length
    const total = countable.length
    if (total > 0) adherence = { completed, total }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/progress-metrics.test.ts`
Expected: PASS (all tests, including the 5 new ones and every pre-existing test in the file unchanged)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add lib/progress/metrics.ts __tests__/lib/progress-metrics.test.ts
git commit -m "feat: exclude pending optional workouts from adherence total"
```

---

### Task 3: Select `optional` in the plan-workouts query and prove the plumbing end-to-end

**Files:**
- Modify: `lib/progress/brief-generator.ts:5,43,51,53`
- Test: `__tests__/lib/brief-generator.test.ts`

**Interfaces:**
- Consumes: `computeProgressMetrics` (Task 2's updated behavior, unchanged signature).
- Produces: no change to `maybeGenerateProgressBrief`'s exported signature.

- [ ] **Step 1: Write the failing test**

Open `__tests__/lib/brief-generator.test.ts`. The `makeSupabase` helper (lines 36-66) currently hardcodes an empty array for the `workouts` table and ignores whatever string is passed to `select()`:

```typescript
      if (table === 'workouts') {
        return { select: () => ({ eq: async () => ({ data: [] }) }) }
      }
```

Change `makeSupabase`'s signature (line 36-41) from:

```typescript
function makeSupabase(opts: {
  plan?: { id: string; created_at: string; baseline_ftp: number | null; phase: string; target_event_name: string; target_event_date: string } | null
  upsertSpy?: jest.Mock
  existingGeneratedAt?: string | null
}) {
  const { plan = null, upsertSpy = jest.fn(async () => ({ error: null })), existingGeneratedAt = null } = opts
```

to:

```typescript
function makeSupabase(opts: {
  plan?: { id: string; created_at: string; baseline_ftp: number | null; phase: string; target_event_name: string; target_event_date: string } | null
  upsertSpy?: jest.Mock
  existingGeneratedAt?: string | null
  workoutsData?: Array<{ status: string; date: string; optional: boolean }>
  workoutsSelectSpy?: jest.Mock
}) {
  const {
    plan = null,
    upsertSpy = jest.fn(async () => ({ error: null })),
    existingGeneratedAt = null,
    workoutsData = [],
    workoutsSelectSpy = jest.fn(),
  } = opts
```

and the `workouts` branch (inside the `from` function) from:

```typescript
      if (table === 'workouts') {
        return { select: () => ({ eq: async () => ({ data: [] }) }) }
      }
```

to:

```typescript
      if (table === 'workouts') {
        return { select: (cols: string) => { workoutsSelectSpy(cols); return { eq: async () => ({ data: workoutsData }) } } }
      }
```

This is additive — the default `workoutsData = []` and a throwaway default `workoutsSelectSpy` preserve every existing test's behavior unchanged.

Then add a new describe block at the end of the file, after the closing `})` of `'maybeGenerateProgressBrief — metrics/content debounce decoupling'` (the last line of the file, currently line 172-173):

```typescript

describe('maybeGenerateProgressBrief — optional workouts excluded from adherence until done', () => {
  it('selects the optional column so it reaches the adherence calculation', async () => {
    const plan = {
      id: 'p1',
      created_at: '2026-04-01T00:00:00Z',
      baseline_ftp: 230,
      phase: 'build',
      target_event_name: 'Dragon Ride',
      target_event_date: '2026-09-01',
    }
    const workoutsSelectSpy = jest.fn()
    const supabase = makeSupabase({ plan, workoutsSelectSpy })
    const client = { getActivities: jest.fn(async () => []) }

    await maybeGenerateProgressBrief(supabase as never, 'u1', syncData, profile, client as never)

    expect(workoutsSelectSpy).toHaveBeenCalledWith('status, date, optional')
  })

  it('excludes a pending optional workout from the adherence total end-to-end', async () => {
    const today = new Date()
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
    const twoDaysAgo = new Date(today); twoDaysAgo.setDate(today.getDate() - 2)
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    const plan = {
      id: 'p1',
      created_at: twoDaysAgo.toISOString(),
      baseline_ftp: 230,
      phase: 'build',
      target_event_name: 'Dragon Ride',
      target_event_date: '2026-09-01',
    }
    const upsertSpy = jest.fn(async () => ({ error: null }))
    const workoutsData = [
      { status: 'completed', date: yesterdayStr, optional: false },
      { status: 'planned', date: yesterdayStr, optional: true },
    ]
    const supabase = makeSupabase({ plan, upsertSpy, workoutsData })
    const client = { getActivities: jest.fn(async () => []) }

    await maybeGenerateProgressBrief(supabase as never, 'u1', syncData, profile, client as never)

    const written = (upsertSpy.mock.calls as unknown[][])[0]?.[0] as any
    expect(written.metrics_snapshot.adherence).toEqual({ completed: 1, total: 1 })
  })
})
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `npx jest __tests__/lib/brief-generator.test.ts`
Expected: FAIL — `'selects the optional column...'` fails because `brief-generator.ts` still calls `.select('status, date')`, not `'status, date, optional'`. (`'excludes a pending optional workout...'` may already pass at this point since the mock directly injects `workoutsData` regardless of the select string and Task 2's adherence logic is already correct — that test is here to lock in the full end-to-end behavior, not to prove Task 3's specific change; the select-spy test is the one that actually gates Task 3.)

- [ ] **Step 3: Write the implementation**

In `lib/progress/brief-generator.ts`, change line 43 from:

```typescript
  let planWorkouts: Array<{ status: WorkoutStatus; date: string }> = []
```

to:

```typescript
  let planWorkouts: Array<{ status: WorkoutStatus; date: string; optional: boolean }> = []
```

Change line 51 from:

```typescript
      .select('status, date')
```

to:

```typescript
      .select('status, date, optional')
```

Change line 53 from:

```typescript
    planWorkouts = (workouts ?? []) as Array<{ status: WorkoutStatus; date: string }>
```

to:

```typescript
    planWorkouts = (workouts ?? []) as Array<{ status: WorkoutStatus; date: string; optional: boolean }>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/brief-generator.test.ts`
Expected: PASS (all tests, including both new ones)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add lib/progress/brief-generator.ts __tests__/lib/brief-generator.test.ts
git commit -m "feat: select optional column for plan workouts adherence query"
```

---

### Task 4: Wire the predicates into the dashboard's weekly Sessions count

**Files:**
- Modify: `app/dashboard/page.tsx:17,486-503`

**Interfaces:**
- Consumes: `isSessionCountable`, `isSessionCompleted` from `lib/progress/session-counting.ts` (Task 1).
- Produces: no change to `WeeklyProgress`'s shape or any other field on it.

This component has no dedicated test file — consistent with this codebase's established convention for large interactive page components (`app/dashboard/page.tsx`, `app/calendar/page.tsx`, `app/plan/page.tsx`, `components/WorkoutDetailModal.tsx`). Verification is typecheck plus manual reasoning about the derivation, not a new automated test.

- [ ] **Step 1: Add the import**

In `app/dashboard/page.tsx`, change line 17 from:

```typescript
import { estimateTss } from '@/lib/estimate-tss'
```

to:

```typescript
import { estimateTss } from '@/lib/estimate-tss'
import { isSessionCountable, isSessionCompleted } from '@/lib/progress/session-counting'
```

- [ ] **Step 2: Rewire the weekly Sessions calculation**

Change lines 486-503 from:

```typescript
  const weekWorkoutsWP = workouts.filter(w => weekDates.includes(w.date))
  const completedWP = weekWorkoutsWP.filter(w => w.status === 'completed')
  const linkedActivityIds = new Set(weekWorkoutsWP.map(w => w.icu_activity_id).filter((id): id is string => id != null))
  const recentCtl = [...(syncData?.wellness ?? [])].sort((a, b) => b.id.localeCompare(a.id)).find(w => w.ctl != null)?.ctl ?? null
  const weeklyProgress: WeeklyProgress | null = weekWorkoutsWP.length > 0 ? {
    sessionsCompleted: completedWP.length,
    sessionsTotal: weekWorkoutsWP.length,
    tssActual: Math.round(completedWP.filter(w => w.tss !== null).reduce((s, w) => s + (w.tss ?? 0), 0)),
    tssPlanned: weekWorkoutsWP.reduce((s, w) => s + estimateTss(w.type, w.duration_minutes), 0),
    distanceKm: Math.round(completedWP.reduce((s, w) => s + ((w.activity_metrics?.distance_m ?? 0) / 1000), 0) * 10) / 10,
    elevationM: Math.round(completedWP.reduce((s, w) => s + (w.activity_metrics?.elevation_m ?? 0), 0)),
    timePlannedMins: weekWorkoutsWP.reduce((s, w) => s + w.duration_minutes, 0),
    timeActualMins: completedWP.reduce((s, w) => s + (w.actual_duration_minutes ?? w.duration_minutes), 0),
    fitnessCtl: recentCtl !== null ? Math.round(recentCtl) : null,
    otherActivitiesCount: (syncData?.activities ?? [])
      .filter(a => weekDates.some(d => a.start_date_local.startsWith(d)) && !linkedActivityIds.has(a.id))
      .length,
  } : null
```

to:

```typescript
  const weekWorkoutsWP = workouts.filter(w => weekDates.includes(w.date))
  const completedWP = weekWorkoutsWP.filter(w => w.status === 'completed')
  const countableSessionsWP = weekWorkoutsWP.filter(isSessionCountable)
  const linkedActivityIds = new Set(weekWorkoutsWP.map(w => w.icu_activity_id).filter((id): id is string => id != null))
  const recentCtl = [...(syncData?.wellness ?? [])].sort((a, b) => b.id.localeCompare(a.id)).find(w => w.ctl != null)?.ctl ?? null
  const weeklyProgress: WeeklyProgress | null = weekWorkoutsWP.length > 0 ? {
    sessionsCompleted: countableSessionsWP.filter(isSessionCompleted).length,
    sessionsTotal: countableSessionsWP.length,
    tssActual: Math.round(completedWP.filter(w => w.tss !== null).reduce((s, w) => s + (w.tss ?? 0), 0)),
    tssPlanned: weekWorkoutsWP.reduce((s, w) => s + estimateTss(w.type, w.duration_minutes), 0),
    distanceKm: Math.round(completedWP.reduce((s, w) => s + ((w.activity_metrics?.distance_m ?? 0) / 1000), 0) * 10) / 10,
    elevationM: Math.round(completedWP.reduce((s, w) => s + (w.activity_metrics?.elevation_m ?? 0), 0)),
    timePlannedMins: weekWorkoutsWP.reduce((s, w) => s + w.duration_minutes, 0),
    timeActualMins: completedWP.reduce((s, w) => s + (w.actual_duration_minutes ?? w.duration_minutes), 0),
    fitnessCtl: recentCtl !== null ? Math.round(recentCtl) : null,
    otherActivitiesCount: (syncData?.activities ?? [])
      .filter(a => weekDates.some(d => a.start_date_local.startsWith(d)) && !linkedActivityIds.has(a.id))
      .length,
  } : null
```

Note `weekWorkoutsWP`, `completedWP`, `tssActual`, `tssPlanned`, `distanceKm`, `elevationM`, `timePlannedMins`, `timeActualMins`, `linkedActivityIds`, and `otherActivitiesCount` are all untouched — only `sessionsCompleted` and `sessionsTotal` now derive from `countableSessionsWP` instead of `weekWorkoutsWP`/`completedWP` directly.

- [ ] **Step 3: Manual verification checklist**

Trace through by reading the code (no dev server needed for this):
1. A non-optional planned workout today: `isSessionCountable` returns `true` (first clause `!w.optional`) → included in `sessionsTotal`. Matches today's existing behavior.
2. An optional workout still `status: 'planned'` today: `isSessionCountable` returns `false` (optional, and status isn't completed/needs_review) → excluded from `countableSessionsWP`, so it does not add to `sessionsTotal`. This is the requested fix.
3. That same optional workout once completed: `isSessionCountable` returns `true` (status is now `'completed'`) and `isSessionCompleted` also returns `true` → it now counts in both `sessionsTotal` and `sessionsCompleted`.
4. `weeklyProgress` itself stays non-null as long as `weekWorkoutsWP.length > 0` (unchanged guard) — even in the edge case where every workout this week is a still-pending optional one and `sessionsTotal` computes to `0`, `components/ProgressStats.tsx`'s existing `hasWeek = weeklyProgress && weeklyProgress.sessionsTotal > 0` guard already hides the weekly section correctly in that case — no change needed in `ProgressStats.tsx`.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Run the full test suite**

Run: `npx jest`
Expected: all suites pass, no regressions (this component has no dedicated test file, so this run is confirming nothing elsewhere broke)

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: exclude pending optional workouts from weekly sessions count"
```
