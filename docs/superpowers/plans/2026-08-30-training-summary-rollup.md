# Training Summary Rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rollup summary — rides completed, hours trained, weeks trained, fitness built, FTP progress — to the top of the History tab (`/plan`), covering a 6mo/12mo window across both closed and the currently active plan.

**Architecture:** A pure aggregation function (`lib/plan/summary.ts`) combines already-frozen per-plan week data from closed plans (`training_plans.archive_summary.weeks`) with the active plan's live per-week buckets (computed the same way `lib/plan/archive.ts` already does for closures), clips both to a rolling calendar window, and derives CTL/FTP deltas from wellness and confirmed FTP predictions. A new `GET /api/plan/summary` route does all the fetching and calls this function server-side. A new `PlanSummaryRollup` component renders the result as a tile grid with a 6mo/12mo toggle, mounted at the top of the existing `PlanHistoryTab`.

**Tech Stack:** Next.js App Router (route handlers), Supabase (Postgres + `@supabase/ssr`), TypeScript, Jest + React Testing Library, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-08-30-training-summary-rollup-design.md`

## Global Constraints

- Run `npm run typecheck` before committing any task that touches `.ts`/`.tsx` files — Jest does not surface type errors (`AGENTS.md`).
- All new/changed UI must work at ≥320px width: `grid-cols-2` only where each column is at least ~130px wide, 44px-minimum touch targets, no hover-only interactions (`AGENTS.md`).
- No database migration is needed — this feature only reads existing columns/tables (`training_plans.archive_summary`, `training_plans.plan_weeks`/`created_at`, `workouts`, `ftp_predictions`, `user_profile.current_ftp`).
- Every task must leave `npm run test:ci` passing after its final commit (intermediate steps within a task may be red between a failing test and its implementation, per TDD).

---

### Task 1: `buildTrainingSummary` (pure aggregation function)

**Files:**
- Modify: `lib/plan/archive.ts` (export the existing private `ctlNearestOnOrBefore`)
- Create: `lib/plan/summary.ts`
- Create: `__tests__/lib/plan-summary.test.ts`

**Interfaces:**
- Consumes: `ctlNearestOnOrBefore(wellness, date): number | null` (this task exports it from `lib/plan/archive.ts:7-12`, no behavior change); `addDaysUtc(dateStr, n): string` and `daysBetweenUtc(from, to): number` from `@/lib/plan/forecast`; `WeekBucket` from `@/lib/plan/progress`; `PlanWeekSummary`, `ICUWellness` from `@/types`.
- Produces: `TrainingSummary` interface and `buildTrainingSummary(input): TrainingSummary` (exported from `@/lib/plan/summary`). Task 2's API route and Task 3's component both consume this exact shape:
  ```ts
  export interface TrainingSummary {
    windowMonths: 6 | 12
    windowStart: string
    ridesCompleted: number
    hoursTrained: number
    weeksWithPlan: number
    weeksInWindow: number
    ctlStart: number | null
    ctlEnd: number | null
    fitnessChange: number | null
    ftpStart: number | null
    ftpEnd: number | null
    ftpChange: number | null
    ftpStartIsPartial: boolean
  }
  ```

- [ ] **Step 1: Export `ctlNearestOnOrBefore`**

In `lib/plan/archive.ts`, change the function declaration (currently unexported, `lib/plan/archive.ts:7`):

```ts
export function ctlNearestOnOrBefore(wellness: ICUWellness[], date: string): number | null {
```

(No other change — this is a pure export, its callers inside `archive.ts` are unaffected.)

- [ ] **Step 2: Write the failing tests**

Create `__tests__/lib/plan-summary.test.ts`:

```ts
import { buildTrainingSummary } from '@/lib/plan/summary'
import type { PlanWeekSummary, ICUWellness } from '@/types'
import type { WeekBucket } from '@/lib/plan/progress'

function week(over: Partial<PlanWeekSummary>): PlanWeekSummary {
  return {
    weekIndex: 0, weekStart: '2026-01-01', plannedSessions: 0, completedSessions: 0,
    plannedTss: 0, actualTss: 0, hours: 0, ...over,
  }
}

function bucket(over: Partial<WeekBucket>): WeekBucket {
  return { weekIndex: 0, plannedTss: 0, actualTss: 0, plannedSessions: 0, completedSessions: 0, hours: 0, ...over }
}

function wellness(over: Partial<ICUWellness>): ICUWellness {
  return {
    id: '2026-01-01', ctl: null, atl: null, form: null, hrv: null, resting_hr: null,
    sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null,
    stress_high: null, garmin_training_load: null, sleep_score: null, ...over,
  }
}

const baseInput = {
  windowMonths: 6 as const,
  today: '2026-08-30',
  archivedPlanWeeks: [] as PlanWeekSummary[],
  activePlan: null as { planStart: string; buckets: WeekBucket[] } | null,
  wellness: [] as ICUWellness[],
  confirmedPredictions: [] as Array<{ predicted_ftp: number; created_at: string }>,
  currentFtp: null as number | null,
}

describe('buildTrainingSummary', () => {
  it('sums completed sessions and hours from weeks within the window across closed and active plans, excluding weeks before the window', () => {
    const summary = buildTrainingSummary({
      ...baseInput,
      archivedPlanWeeks: [
        week({ weekStart: '2026-01-01', plannedSessions: 3, completedSessions: 3, hours: 5 }), // before window (starts 2026-03-03)
        week({ weekStart: '2026-03-10', plannedSessions: 3, completedSessions: 3, hours: 5 }),  // in window
      ],
      activePlan: {
        planStart: '2026-07-01',
        buckets: [bucket({ weekIndex: 0, plannedSessions: 3, completedSessions: 2, hours: 4 })], // weekStart 2026-07-01, in window
      },
    })
    expect(summary.windowStart).toBe('2026-03-03')
    expect(summary.ridesCompleted).toBe(5)
    expect(summary.hoursTrained).toBe(9)
  })

  it('counts weeksWithPlan only for weeks with plannedSessions > 0, distinct from weeksInWindow\'s calendar span', () => {
    const summary = buildTrainingSummary({
      ...baseInput,
      archivedPlanWeeks: [
        week({ weekStart: '2026-03-10', plannedSessions: 3, completedSessions: 3, hours: 5 }),
        week({ weekStart: '2026-04-01', plannedSessions: 0, completedSessions: 0, hours: 0 }), // rest week, in window, not counted
      ],
    })
    expect(summary.weeksWithPlan).toBe(1)
    expect(summary.weeksInWindow).toBe(26)
  })

  it('computes CTL start/end from the nearest wellness reading on or before each boundary', () => {
    const summary = buildTrainingSummary({
      ...baseInput,
      wellness: [wellness({ id: '2026-02-01', ctl: 40 }), wellness({ id: '2026-08-25', ctl: 55 })],
    })
    expect(summary.ctlStart).toBe(40)
    expect(summary.ctlEnd).toBe(55)
    expect(summary.fitnessChange).toBe(15)
  })

  it('reports null CTL fields when there is no wellness data', () => {
    const summary = buildTrainingSummary({ ...baseInput, wellness: [] })
    expect(summary.ctlStart).toBeNull()
    expect(summary.ctlEnd).toBeNull()
    expect(summary.fitnessChange).toBeNull()
  })

  it('computes FTP change from the latest confirmed prediction on or before the window start', () => {
    const summary = buildTrainingSummary({
      ...baseInput,
      confirmedPredictions: [
        { predicted_ftp: 220, created_at: '2026-01-15T10:00:00Z' }, // before window (starts 2026-03-03)
        { predicted_ftp: 245, created_at: '2026-06-01T10:00:00Z' }, // after window start
      ],
      currentFtp: 250,
    })
    expect(summary.ftpStart).toBe(220)
    expect(summary.ftpStartIsPartial).toBe(false)
    expect(summary.ftpEnd).toBe(250)
    expect(summary.ftpChange).toBe(30)
  })

  it('flags a partial FTP start when no confirmed prediction exists before the window', () => {
    const summary = buildTrainingSummary({
      ...baseInput,
      confirmedPredictions: [{ predicted_ftp: 230, created_at: '2026-04-01T00:00:00Z' }],
      currentFtp: 250,
    })
    expect(summary.ftpStart).toBe(230)
    expect(summary.ftpStartIsPartial).toBe(true)
    expect(summary.ftpChange).toBe(20)
  })

  it('returns zero counts and null fitness/FTP fields when there is no plan and no data in the window', () => {
    const summary = buildTrainingSummary({ ...baseInput, windowMonths: 12, today: '2026-08-30' })
    expect(summary.ridesCompleted).toBe(0)
    expect(summary.hoursTrained).toBe(0)
    expect(summary.weeksWithPlan).toBe(0)
    expect(summary.ctlStart).toBeNull()
    expect(summary.ftpStart).toBeNull()
    expect(summary.ftpChange).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest plan-summary`
Expected: FAIL with "Cannot find module '@/lib/plan/summary'"

- [ ] **Step 4: Implement `buildTrainingSummary`**

Create `lib/plan/summary.ts`:

```ts
import { addDaysUtc, daysBetweenUtc } from '@/lib/plan/forecast'
import { ctlNearestOnOrBefore } from '@/lib/plan/archive'
import type { PlanWeekSummary, ICUWellness } from '@/types'
import type { WeekBucket } from '@/lib/plan/progress'

export interface TrainingSummary {
  windowMonths: 6 | 12
  windowStart: string
  ridesCompleted: number
  hoursTrained: number
  weeksWithPlan: number
  weeksInWindow: number
  ctlStart: number | null
  ctlEnd: number | null
  fitnessChange: number | null
  ftpStart: number | null
  ftpEnd: number | null
  ftpChange: number | null
  ftpStartIsPartial: boolean
}

export function buildTrainingSummary(input: {
  windowMonths: 6 | 12
  today: string
  archivedPlanWeeks: PlanWeekSummary[]
  activePlan: { planStart: string; buckets: WeekBucket[] } | null
  wellness: ICUWellness[]
  confirmedPredictions: Array<{ predicted_ftp: number; created_at: string }>
  currentFtp: number | null
}): TrainingSummary {
  const { windowMonths, today, archivedPlanWeeks, activePlan, wellness, confirmedPredictions, currentFtp } = input
  const windowStart = addDaysUtc(today, -windowMonths * 30)

  const activeWeeks: PlanWeekSummary[] = activePlan
    ? activePlan.buckets.map(b => ({
        weekIndex: b.weekIndex,
        weekStart: addDaysUtc(activePlan.planStart, b.weekIndex * 7),
        plannedSessions: b.plannedSessions,
        completedSessions: b.completedSessions,
        plannedTss: b.plannedTss,
        actualTss: b.actualTss,
        hours: b.hours,
      }))
    : []

  const clippedWeeks = [...archivedPlanWeeks, ...activeWeeks]
    .filter(w => w.weekStart >= windowStart && w.weekStart <= today)

  const ridesCompleted = clippedWeeks.reduce((sum, w) => sum + w.completedSessions, 0)
  const hoursTrained = Math.round(clippedWeeks.reduce((sum, w) => sum + w.hours, 0) * 10) / 10
  const weeksWithPlan = clippedWeeks.filter(w => w.plannedSessions > 0).length
  const weeksInWindow = Math.max(1, Math.round(daysBetweenUtc(windowStart, today) / 7))

  const ctlStart = ctlNearestOnOrBefore(wellness, windowStart)
  const ctlEnd = ctlNearestOnOrBefore(wellness, today)
  const fitnessChange = ctlStart != null && ctlEnd != null ? Math.round((ctlEnd - ctlStart) * 10) / 10 : null

  const sortedConfirmed = [...confirmedPredictions].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const beforeWindow = sortedConfirmed.filter(p => p.created_at.split('T')[0] <= windowStart)
  let ftpStart: number | null = null
  let ftpStartIsPartial = false
  if (beforeWindow.length) {
    ftpStart = beforeWindow[beforeWindow.length - 1].predicted_ftp
  } else if (sortedConfirmed.length) {
    ftpStart = sortedConfirmed[0].predicted_ftp
    ftpStartIsPartial = true
  }
  const ftpEnd = currentFtp
  const ftpChange = ftpStart != null && ftpEnd != null ? ftpEnd - ftpStart : null

  return {
    windowMonths, windowStart, ridesCompleted, hoursTrained, weeksWithPlan, weeksInWindow,
    ctlStart, ctlEnd, fitnessChange, ftpStart, ftpEnd, ftpChange, ftpStartIsPartial,
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest plan-summary`
Expected: PASS (all 7 tests)

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add lib/plan/archive.ts lib/plan/summary.ts __tests__/lib/plan-summary.test.ts
git commit -m "feat: add buildTrainingSummary to roll up training stats across plans"
```

---

### Task 2: `GET /api/plan/summary`

**Files:**
- Create: `app/api/plan/summary/route.ts`
- Create: `__tests__/api/plan-summary.test.ts`

**Interfaces:**
- Consumes: `buildTrainingSummary` (Task 1, `@/lib/plan/summary`); `buildWeekBuckets(workouts, activities, planStart, totalWeeks): WeekBucket[]` from `@/lib/plan/progress` (existing); `addDaysUtc` from `@/lib/plan/forecast` (existing); `IntervalsClient` (`getWellness(start, end)`, `getActivities(oldest, newest)`, both existing) from `@/lib/intervals/client`; `createSupabaseServerClient` from `@/lib/supabase-server`.
- Produces: `GET /api/plan/summary?months=6|12` returning a `TrainingSummary` JSON body (200), or `{ error }` (401 unauthenticated). Task 3's `PlanSummaryRollup` fetches this exact route/shape.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/plan-summary.test.ts`:

```ts
/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

const mockGetWellness = jest.fn()
const mockGetActivities = jest.fn()
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getWellness: mockGetWellness,
    getActivities: mockGetActivities,
  })),
}))

import { GET } from '@/app/api/plan/summary/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { ICUWellness } from '@/types'

function wellness(over: Partial<ICUWellness>): ICUWellness {
  return {
    id: '2026-01-01', ctl: null, atl: null, form: null, hrv: null, resting_hr: null,
    sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null,
    stress_high: null, garmin_training_load: null, sleep_score: null, ...over,
  }
}

function makeSupabase({
  archivedPlans = [] as unknown[],
  activePlanRow = null as unknown,
  profile = null as unknown,
  predictions = [] as unknown[],
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'training_plans') {
        return {
          select: () => ({
            eq: (col1: string) => {
              if (col1 === 'user_id') {
                return { eq: async () => ({ data: archivedPlans, error: null }) }
              }
              return { order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: activePlanRow }) }) }) }
            },
          }),
        }
      }
      if (table === 'user_profile') {
        return { select: () => ({ maybeSingle: async () => ({ data: profile }) }) }
      }
      if (table === 'ftp_predictions') {
        return { select: () => ({ eq: async () => ({ data: predictions }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

function makeRequest(months?: string) {
  return new Request(`http://localhost/api/plan/summary${months ? `?months=${months}` : ''}`) as never
}

describe('GET /api/plan/summary', () => {
  // Pinned so every test's hardcoded fixture dates clip against the same, known
  // "today" — without this, window-clipping assertions would silently depend on
  // whatever real date the test happens to run on.
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers().setSystemTime(new Date('2026-08-30T12:00:00Z'))
  })
  afterEach(() => jest.useRealTimers())

  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    })
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('defaults to a 12-month window when months is missing or invalid', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res1 = await GET(makeRequest())
    expect((await res1.json()).windowMonths).toBe(12)

    const res2 = await GET(makeRequest('99'))
    expect((await res2.json()).windowMonths).toBe(12)
  })

  it('uses a 6-month window when months=6', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await GET(makeRequest('6'))
    expect((await res.json()).windowMonths).toBe(6)
  })

  it("combines archived-plan weeks, the active plan's live progress, and confirmed FTP predictions into one summary", async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({
      archivedPlans: [{
        archive_summary: {
          weeks: [{ weekIndex: 0, weekStart: '2026-01-01', plannedSessions: 2, completedSessions: 2, plannedTss: 100, actualTss: 100, hours: 3 }],
        },
      }],
      activePlanRow: { id: 'p2', created_at: '2026-07-01T00:00:00Z', plan_weeks: 4, workouts: [] },
      profile: { current_ftp: 250, intervals_icu_athlete_id: 'ath1', intervals_icu_api_key: 'key1' },
      predictions: [{ predicted_ftp: 230, created_at: '2025-01-01T00:00:00Z' }],
    }))
    mockGetWellness.mockResolvedValue([wellness({ id: '2025-09-01', ctl: 40 }), wellness({ id: '2026-08-25', ctl: 52 })])
    mockGetActivities.mockResolvedValue([])

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ridesCompleted).toBe(2)
    expect(body.hoursTrained).toBe(3)
    expect(body.weeksWithPlan).toBe(1)
    expect(body.ctlStart).toBe(40)
    expect(body.ctlEnd).toBe(52)
    expect(body.fitnessChange).toBe(12)
    expect(body.ftpStart).toBe(230)
    expect(body.ftpEnd).toBe(250)
    expect(body.ftpChange).toBe(20)
    expect(mockGetWellness).toHaveBeenCalledWith('2025-09-04', '2026-08-30')
    expect(mockGetActivities).toHaveBeenCalledWith('2026-07-01', '2026-08-30')
  })

  it('returns nulled CTL fields and skips intervals.icu calls when it is not configured', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({
      archivedPlans: [{ archive_summary: { weeks: [{ weekIndex: 0, weekStart: '2026-06-01', plannedSessions: 1, completedSessions: 1, plannedTss: 50, actualTss: 50, hours: 1 }] } }],
      profile: { current_ftp: 250, intervals_icu_athlete_id: '', intervals_icu_api_key: '' },
    }))

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ridesCompleted).toBe(1)
    expect(body.ctlStart).toBeNull()
    expect(body.ctlEnd).toBeNull()
    expect(mockGetWellness).not.toHaveBeenCalled()
  })

  it('degrades to nulled CTL fields (still 200) when intervals.icu throws', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({
      archivedPlans: [{ archive_summary: { weeks: [{ weekIndex: 0, weekStart: '2026-06-01', plannedSessions: 1, completedSessions: 1, plannedTss: 50, actualTss: 50, hours: 1 }] } }],
      profile: { current_ftp: 250, intervals_icu_athlete_id: 'ath1', intervals_icu_api_key: 'key1' },
    }))
    mockGetWellness.mockRejectedValue(new Error('ICU down'))
    mockGetActivities.mockResolvedValue([])

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ridesCompleted).toBe(1)
    expect(body.ctlStart).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest plan-summary.test.ts --testPathPattern api`
Expected: FAIL with "Cannot find module '@/app/api/plan/summary/route'"

- [ ] **Step 3: Implement the route**

Create `app/api/plan/summary/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { buildWeekBuckets } from '@/lib/plan/progress'
import { buildTrainingSummary } from '@/lib/plan/summary'
import { addDaysUtc } from '@/lib/plan/forecast'
import type { Workout, ICUActivity, ICUWellness, PlanArchiveSummary } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const monthsParam = new URL(req.url).searchParams.get('months')
  const windowMonths: 6 | 12 = monthsParam === '6' ? 6 : 12
  const today = new Date().toISOString().split('T')[0]
  const windowStart = addDaysUtc(today, -windowMonths * 30)

  const [{ data: archivedPlans }, { data: activePlanRow }, { data: profile }, { data: predictions }] = await Promise.all([
    supabase.from('training_plans').select('archive_summary').eq('user_id', user.id).eq('status', 'archived'),
    supabase.from('training_plans').select('id, created_at, plan_weeks, workouts(*)').eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('user_profile').select('current_ftp, intervals_icu_athlete_id, intervals_icu_api_key').maybeSingle(),
    supabase.from('ftp_predictions').select('predicted_ftp, created_at').eq('confirmed', true),
  ])

  const archivedPlanWeeks = (archivedPlans ?? [])
    .map(p => p.archive_summary as PlanArchiveSummary | null)
    .filter((s): s is PlanArchiveSummary => s != null)
    .flatMap(s => s.weeks)

  const planStart = activePlanRow ? (activePlanRow.created_at as string).split('T')[0] : null
  const hasIcu = !!profile?.intervals_icu_athlete_id && !!profile?.intervals_icu_api_key

  let wellness: ICUWellness[] = []
  let activities: ICUActivity[] = []

  if (hasIcu) {
    const client = new IntervalsClient(profile!.intervals_icu_athlete_id as string, profile!.intervals_icu_api_key as string)
    const wellnessFrom = planStart && planStart < windowStart ? planStart : windowStart
    try {
      ;[wellness, activities] = await Promise.all([
        client.getWellness(wellnessFrom, today),
        planStart ? client.getActivities(planStart, today) : Promise.resolve([] as ICUActivity[]),
      ])
    } catch {
      // intervals.icu unreachable — CTL fields fall back to null, active-plan hours fall
      // back to zero (no activities to sum); everything else is unaffected.
      wellness = []
      activities = []
    }
  }

  const activePlan = activePlanRow && planStart
    ? {
        planStart,
        buckets: buildWeekBuckets(
          (activePlanRow.workouts ?? []) as Workout[],
          activities,
          planStart,
          (activePlanRow.plan_weeks as number | null) ?? 1,
        ),
      }
    : null

  const summary = buildTrainingSummary({
    windowMonths,
    today,
    archivedPlanWeeks,
    activePlan,
    wellness,
    confirmedPredictions: (predictions ?? []) as Array<{ predicted_ftp: number; created_at: string }>,
    currentFtp: (profile?.current_ftp as number | null) ?? null,
  })

  return NextResponse.json(summary)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest plan-summary.test.ts --testPathPattern api`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add app/api/plan/summary/route.ts __tests__/api/plan-summary.test.ts
git commit -m "feat: add GET /api/plan/summary endpoint"
```

---

### Task 3: `PlanSummaryRollup` component

**Files:**
- Create: `components/plan/PlanSummaryRollup.tsx`
- Create: `__tests__/components/PlanSummaryRollup.test.tsx`

**Interfaces:**
- Consumes: `GET /api/plan/summary?months=6|12` (Task 2), `TrainingSummary` type from `@/lib/plan/summary` (Task 1).
- Produces: `<PlanSummaryRollup />` (no props) — a self-contained card with its own fetch, range toggle, loading/error states. Task 4 mounts it inside `PlanHistoryTab`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/PlanSummaryRollup.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PlanSummaryRollup from '@/components/plan/PlanSummaryRollup'
import type { TrainingSummary } from '@/lib/plan/summary'

const SUMMARY: TrainingSummary = {
  windowMonths: 12, windowStart: '2025-09-04',
  ridesCompleted: 42, hoursTrained: 63.5, weeksWithPlan: 30, weeksInWindow: 52,
  ctlStart: 40, ctlEnd: 55, fitnessChange: 15,
  ftpStart: 230, ftpEnd: 250, ftpChange: 20, ftpStartIsPartial: false,
}

const originalFetch = global.fetch
afterEach(() => { global.fetch = originalFetch; jest.resetAllMocks() })

function mockFetch(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({ json: async () => body }) as never
}

describe('PlanSummaryRollup', () => {
  it('renders tiles from the fetched summary', async () => {
    mockFetch(SUMMARY)
    render(<PlanSummaryRollup />)
    expect(await screen.findByText('42')).toBeInTheDocument()
    expect(screen.getByText('63.5')).toBeInTheDocument()
    expect(screen.getByText('30/52')).toBeInTheDocument()
    expect(screen.getByText('+15')).toBeInTheDocument()
    expect(screen.getByText('+20W')).toBeInTheDocument()
  })

  it('shows "Not available" for null fitness and FTP fields', async () => {
    mockFetch({ ...SUMMARY, fitnessChange: null, ftpChange: null })
    render(<PlanSummaryRollup />)
    expect(await screen.findAllByText('Not available')).toHaveLength(2)
  })

  it('shows a caveat note when the FTP start is partial', async () => {
    mockFetch({ ...SUMMARY, ftpStartIsPartial: true })
    render(<PlanSummaryRollup />)
    expect(await screen.findByText(/since your first recorded FTP/)).toBeInTheDocument()
  })

  it('fetches with months=12 by default and refetches with months=6 when the 6mo button is tapped', async () => {
    mockFetch(SUMMARY)
    render(<PlanSummaryRollup />)
    await screen.findByText('42')
    expect(global.fetch).toHaveBeenCalledWith('/api/plan/summary?months=12')

    fireEvent.click(screen.getByText('6mo'))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/plan/summary?months=6'))
  })

  it('shows a loading skeleton before the fetch resolves', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    global.fetch = jest.fn().mockReturnValue(new Promise(resolve => { resolveFetch = resolve })) as never
    render(<PlanSummaryRollup />)
    expect(screen.getByTestId('plan-summary-skeleton')).toBeInTheDocument()
    resolveFetch({ json: async () => SUMMARY })
    await screen.findByText('42')
  })

  it('shows an error message when the fetch fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error')) as never
    render(<PlanSummaryRollup />)
    expect(await screen.findByText("Couldn't load your training summary.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest PlanSummaryRollup`
Expected: FAIL with "Cannot find module '@/components/plan/PlanSummaryRollup'"

- [ ] **Step 3: Implement the component**

Create `components/plan/PlanSummaryRollup.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import type { TrainingSummary } from '@/lib/plan/summary'

const RANGE_OPTIONS: Array<{ label: string; months: 6 | 12 }> = [
  { label: '6mo', months: 6 },
  { label: '12mo', months: 12 },
]

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="text-center">
      <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold text-slate-900">{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function fmtDelta(value: number | null, unit: string): string {
  if (value == null) return 'Not available'
  return `${value >= 0 ? '+' : ''}${value}${unit}`
}

export default function PlanSummaryRollup() {
  const [months, setMonths] = useState<6 | 12>(12)
  const [summary, setSummary] = useState<TrainingSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSummary(null)
    setError(null)
    fetch(`/api/plan/summary?months=${months}`)
      .then(res => res.json())
      .then(data => { if (!cancelled) setSummary(data) })
      .catch(() => { if (!cancelled) setError("Couldn't load your training summary.") })
    return () => { cancelled = true }
  }, [months])

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Training summary</h3>
        <div className="flex gap-1">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.months}
              onClick={() => setMonths(opt.months)}
              className={`text-[11px] font-semibold px-2 py-1.5 rounded min-h-[44px] ${
                months === opt.months ? 'bg-blue-50 text-blue-700' : 'text-slate-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && !summary && (
        <div className="h-20 bg-slate-100 rounded-lg animate-pulse" data-testid="plan-summary-skeleton" />
      )}
      {!error && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Tile label="Rides" value={String(summary.ridesCompleted)} />
          <Tile label="Hours" value={summary.hoursTrained.toFixed(1)} />
          <Tile label="Weeks trained" value={`${summary.weeksWithPlan}/${summary.weeksInWindow}`} />
          <Tile label="Fitness" value={fmtDelta(summary.fitnessChange, '')} />
          <Tile
            label="FTP"
            value={fmtDelta(summary.ftpChange, 'W')}
            sub={summary.ftpStartIsPartial ? 'since your first recorded FTP' : undefined}
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest PlanSummaryRollup`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add components/plan/PlanSummaryRollup.tsx __tests__/components/PlanSummaryRollup.test.tsx
git commit -m "feat: add PlanSummaryRollup component"
```

---

### Task 4: Wire into `PlanHistoryTab`

**Files:**
- Modify: `components/plan/PlanHistoryTab.tsx`
- Modify: `__tests__/components/PlanHistoryTab.test.tsx`

**Interfaces:**
- Consumes: `PlanSummaryRollup` (Task 3).
- Produces: nothing new — this is the last task, wiring everything into the existing History tab.

This is a single-step task (not TDD): the rollup must render regardless of the history list's own loading/error/empty state, which means restructuring `PlanHistoryTab`'s current early-return pattern into one JSX tree. There's no meaningful "write a failing test first" here beyond re-running the existing suite red, since this is a structural reorganization of an existing component, not new pure logic — matches how Task 10 of the prior plan-history plan handled its own final wiring task.

- [ ] **Step 1: Update `PlanHistoryTab`**

Replace the full contents of `components/plan/PlanHistoryTab.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import PlanHistoryCard from '@/components/plan/PlanHistoryCard'
import PlanSummaryRollup from '@/components/plan/PlanSummaryRollup'
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

  return (
    <div className="space-y-3">
      <PlanSummaryRollup />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && plans === null && <p className="text-sm text-slate-400">Loading…</p>}
      {!error && plans !== null && plans.length === 0 && (
        <p className="text-sm text-slate-500">No closed plans yet — plans you close or replace will show up here.</p>
      )}
      {!error && plans !== null && plans.length > 0 && (
        <div className="space-y-3" data-testid="plan-history-list">
          {plans.map(p => <PlanHistoryCard key={p.id} plan={p} />)}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update the test's fetch mock to route by URL, and add a rollup-rendering assertion**

Replace the full contents of `__tests__/components/PlanHistoryTab.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import PlanHistoryTab from '@/components/plan/PlanHistoryTab'
import { makeArchiveSummary } from '../support/factories'
import type { TrainingSummary } from '@/lib/plan/summary'

const originalFetch = global.fetch

afterEach(() => { global.fetch = originalFetch; jest.resetAllMocks() })

const SUMMARY: TrainingSummary = {
  windowMonths: 12, windowStart: '2025-09-04',
  ridesCompleted: 0, hoursTrained: 0, weeksWithPlan: 0, weeksInWindow: 52,
  ctlStart: null, ctlEnd: null, fitnessChange: null,
  ftpStart: null, ftpEnd: null, ftpChange: null, ftpStartIsPartial: false,
}

function mockFetch(historyBody: unknown, summaryBody: unknown = SUMMARY) {
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.includes('/api/plan/summary') ? summaryBody : historyBody
    return Promise.resolve({ json: async () => body })
  }) as never
}

describe('PlanHistoryTab', () => {
  it('renders the training summary rollup above the plan list', async () => {
    mockFetch({ plans: [] })
    render(<PlanHistoryTab />)
    await waitFor(() => expect(screen.getByText('Training summary')).toBeInTheDocument())
  })

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

- [ ] **Step 3: Run the test file to verify it passes**

Run: `npx jest PlanHistoryTab`
Expected: PASS (all 4 tests)

- [ ] **Step 4: Typecheck and run the full suite**

```bash
npm run typecheck
npm run test:ci
```

Expected: no type errors; all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add components/plan/PlanHistoryTab.tsx __tests__/components/PlanHistoryTab.test.tsx
git commit -m "feat: mount the training summary rollup at the top of the History tab"
```

- [ ] **Step 6: Manual mobile verification**

Per `AGENTS.md`, drive the actual flow before calling this done:
1. Start the dev server, open `/plan` → "History" tab at a 375px-wide viewport (or emulate one).
2. Confirm the "Training summary" card renders above the plan list (or above the empty state, if you have no closed plans), with both "6mo" and "12mo" buttons reachable and ≥44px tall.
3. Tap "6mo" — confirm the tiles refresh (network tab shows a new request with `months=6`) and the button's highlighted state moves.
4. If you have at least one closed plan and an active plan with some completed sessions, sanity-check the numbers roughly match what you'd expect versus the per-plan cards below.
5. If intervals.icu isn't connected (or temporarily disconnect it in Settings), confirm the Fitness tile shows "Not available" rather than an error, and the rest of the card still renders.

---

## Self-Review

**Spec coverage:**
- Aggregation logic (clip closed + active plan weeks to a rolling window, sum sessions/hours, weeksWithPlan/weeksInWindow, CTL delta via `ctlNearestOnOrBefore`, FTP delta via confirmed predictions with partial-start flag) → Task 1.
- `GET /api/plan/summary?months=6|12` (auth, months validation/default, archived+active+profile+predictions fetch, intervals.icu range selection, graceful degradation on fetch failure) → Task 2.
- UI (tile grid, 6mo/12mo toggle, loading skeleton, error state, "Not available" and partial-FTP-caveat rendering) → Task 3.
- Placement at the top of the History tab, above the existing per-plan card list, in every list state (loading/empty/populated/error) → Task 4.
- Manual mobile check → Task 4, Step 6.
- Edge cases from the spec: no plans/data in window (Task 1 test 6), intervals.icu not connected (Task 2 test 5), intervals.icu fetch throws (Task 2 test 6), no confirmed FTP predictions before window start (Task 1 test 6), FTP predictions all after window start / partial flag (Task 1 test 6, `flags a partial FTP start...`), window boundary mid-plan / clipping (Task 1 test 1), invalid/missing `months` param (Task 2 test 2) — all covered.

**Placeholder scan:** no TBD/TODO/"add appropriate handling"-style steps; every step has literal code or an exact command.

**Type consistency:** `TrainingSummary` (Task 1) is used identically in Task 2's route return value, Task 3's component props/state, and Task 4's test fixture — same field names throughout (`ridesCompleted`, `hoursTrained`, `weeksWithPlan`, `weeksInWindow`, `ctlStart`/`ctlEnd`/`fitnessChange`, `ftpStart`/`ftpEnd`/`ftpChange`/`ftpStartIsPartial`, `windowMonths`, `windowStart`). `buildTrainingSummary`'s input shape (`archivedPlanWeeks: PlanWeekSummary[]`, `activePlan: { planStart, buckets: WeekBucket[] } | null`, `wellness`, `confirmedPredictions`, `currentFtp`) is constructed identically by Task 2's route and by Task 1's own tests. `ctlNearestOnOrBefore`'s export (Task 1, Step 1) is the only change to `lib/plan/archive.ts`, and Task 1's `buildTrainingSummary` is the only new consumer.
