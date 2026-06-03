# Plan Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the "My Plan" tab with a Plan-journey hero (phase bands + week completion), a consistency strip, a planned-vs-actual weekly load chart, and a fitness trend — driven by data we already hold, plus per-week phases stored at generation with a heuristic fallback.

**Architecture:** Two pure logic modules (`lib/plan/phases.ts`, `lib/plan/progress.ts`) compute everything from the already-fetched plan workouts + sync data. Four presentational components under `components/plan/` render the results. `app/plan/page.tsx` assembles the data once and feeds the components. Per-week phases are added to the plan-generation JSON, persisted on `training_plans.week_phases`, and fall back to a deterministic heuristic when absent.

**Tech Stack:** Next.js App Router (React 19, TS strict), Tailwind v4, Jest + React Testing Library, Supabase, Anthropic SDK.

---

## Reference facts (verified against the codebase)

- `WorkoutType = 'endurance' | 'threshold' | 'intervals' | 'recovery'` (`types/index.ts:1`).
- `WorkoutStatus = 'planned' | 'completed' | 'skipped' | 'needs_review'` — "completed" for our purposes means `completed` or `needs_review`.
- `PlanPhase = 'base' | 'build' | 'peak' | 'taper'` (`types/index.ts:9`).
- `parsePlanText` (`lib/claude/plan.ts:205`) is `JSON.parse` after fence-stripping → any new JSON field (e.g. `week_phases`) flows through untouched.
- The plan is **saved in the PATCH handler** of `app/api/plan/route.ts` (insert at lines 198–211), not POST. POST only streams generation.
- `GET /api/plan` uses `.select('*, workouts(*)')` (`app/api/plan/route.ts:18`) so a new column on `training_plans` is returned automatically.
- Chart helper: `normalizeY(value, min, max, svgTop, svgBottom)` (`lib/chart-helpers.ts:1`).
- The "My Plan" hero card and the hardcoded `Phase: Base` / week bar live at `app/plan/page.tsx:475-502`.
- Test fetch-mock pattern for the page: `__tests__/pages/PlanPage.test.tsx` (routes by URL string).
- Factories: `__tests__/support/factories.ts` (`makeWorkout`).

## File structure

**Create:**
- `lib/plan/phases.ts` — `derivePhases`, `resolvePhases` (per-week phase logic).
- `lib/plan/progress.ts` — `plannedTss`, `buildWeekBuckets`, `weekState`, `consistency`, `planHours`, types `WeekBucket`/`WeekState`.
- `components/plan/PlanJourney.tsx` — phase bands + week-completion blocks (hero graphic).
- `components/plan/ConsistencyStrip.tsx` — hit% / streak / hours.
- `components/plan/LoadComparisonChart.tsx` — weekly planned-vs-actual TSS bars.
- `components/plan/FitnessTrendChart.tsx` — CTL/Form lines + delta.
- `supabase/migrations/20260603_plan_week_phases.sql` — add the column.
- Tests: `__tests__/lib/plan-phases.test.ts`, `__tests__/lib/plan-progress.test.ts`, `__tests__/components/PlanJourney.test.tsx`, `__tests__/components/ConsistencyStrip.test.tsx`, `__tests__/components/LoadComparisonChart.test.tsx`, `__tests__/components/FitnessTrendChart.test.tsx`, `__tests__/pages/PlanProgress.test.tsx`.

**Modify:**
- `types/index.ts` — `TrainingPlan.week_phases`, `GeneratedPlan.week_phases`.
- `lib/claude/plan.ts` — prompt JSON schema + instruction line for `week_phases`.
- `app/api/plan/route.ts` — persist `week_phases` in the PATCH insert.
- `app/plan/page.tsx` — read `week_phases`; compute progress; render the four modules.

---

## Task 1: Per-week phase logic (`lib/plan/phases.ts`)

**Files:**
- Create: `lib/plan/phases.ts`
- Test: `__tests__/lib/plan-phases.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/plan-phases.test.ts
import { derivePhases, resolvePhases } from '@/lib/plan/phases'

describe('derivePhases', () => {
  it('produces base→build→peak→taper for a ramp-then-taper load series', () => {
    const tss = [50, 60, 70, 80, 90, 100, 70, 40]
    expect(derivePhases(tss, 8)).toEqual([
      'base', 'base', 'build', 'build', 'peak', 'peak', 'taper', 'taper',
    ])
  })

  it('returns all base when there is no load', () => {
    expect(derivePhases([0, 0, 0], 3)).toEqual(['base', 'base', 'base'])
  })

  it('forces a final taper week on a long plan that never drops off', () => {
    const phases = derivePhases([60, 70, 80, 90, 100], 5)
    expect(phases[4]).toBe('taper')
  })
})

describe('resolvePhases', () => {
  it('prefers valid stored phases', () => {
    const stored = ['base', 'build', 'peak', 'taper'] as const
    expect(resolvePhases([...stored], [10, 20, 30, 5], 4)).toEqual([...stored])
  })

  it('falls back to derivation when stored is missing or wrong length', () => {
    expect(resolvePhases(null, [0, 0], 2)).toEqual(['base', 'base'])
    expect(resolvePhases(['base'], [0, 0], 2)).toEqual(['base', 'base'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/plan-phases.test.ts`
Expected: FAIL — cannot find module `@/lib/plan/phases`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/plan/phases.ts
import type { PlanPhase } from '@/types'

const PHASES: PlanPhase[] = ['base', 'build', 'peak', 'taper']

/**
 * Deterministic per-week phase labels from a plan's weekly planned-TSS profile.
 * Yields base → build → peak → taper. Used as a fallback when the plan has no
 * Claude-supplied phases (current/legacy plans).
 */
export function derivePhases(weeklyPlannedTss: number[], totalWeeks: number): PlanPhase[] {
  const n = totalWeeks
  const tss = Array.from({ length: n }, (_, i) => weeklyPlannedTss[i] ?? 0)
  const phases: PlanPhase[] = Array.from({ length: n }, () => 'base')
  const peak = Math.max(0, ...tss)
  if (peak === 0) return phases

  // Taper: trailing weeks under 80% of peak, capped at 2. Force the last week on
  // a long plan if nothing qualified (a plan always eases into its end/event).
  const isTaper = Array.from({ length: n }, () => false)
  let taperCount = 0
  for (let i = n - 1; i >= 0 && taperCount < 2; i--) {
    if (tss[i] < 0.8 * peak) { isTaper[i] = true; taperCount++ } else break
  }
  if (taperCount === 0 && n >= 4) isTaper[n - 1] = true

  // Peak: highest non-taper week, plus one adjacent non-taper week >= 90% of peak.
  let peakIdx = -1
  let peakVal = -1
  for (let i = 0; i < n; i++) {
    if (!isTaper[i] && tss[i] > peakVal) { peakVal = tss[i]; peakIdx = i }
  }
  const isPeak = Array.from({ length: n }, () => false)
  if (peakIdx >= 0) {
    isPeak[peakIdx] = true
    for (const j of [peakIdx - 1, peakIdx + 1]) {
      if (isPeak.filter(Boolean).length >= 2) break
      if (j >= 0 && j < n && !isTaper[j] && tss[j] >= 0.9 * peak) isPeak[j] = true
    }
  }

  const firstPeak = isPeak.indexOf(true)
  for (let i = 0; i < n; i++) {
    if (isTaper[i]) { phases[i] = 'taper'; continue }
    if (isPeak[i]) { phases[i] = 'peak'; continue }
    if (firstPeak === -1) { phases[i] = 'base'; continue }
    if (i > firstPeak) { phases[i] = 'build'; continue }
    // Pre-peak weeks: split first-half base, second-half build (<=2 weeks → all base).
    phases[i] = firstPeak <= 2 ? 'base' : (i < Math.ceil(firstPeak / 2) ? 'base' : 'build')
  }
  return phases
}

/** Use Claude-supplied phases when present and length-correct, else derive. */
export function resolvePhases(
  stored: PlanPhase[] | null | undefined,
  weeklyPlannedTss: number[],
  totalWeeks: number,
): PlanPhase[] {
  if (Array.isArray(stored) && stored.length === totalWeeks && stored.every(p => PHASES.includes(p))) {
    return stored
  }
  return derivePhases(weeklyPlannedTss, totalWeeks)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/plan-phases.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/plan/phases.ts __tests__/lib/plan-phases.test.ts
git commit -m "feat: per-week plan phase derivation"
```

---

## Task 2: Weekly progress maths (`lib/plan/progress.ts`)

**Files:**
- Create: `lib/plan/progress.ts`
- Test: `__tests__/lib/plan-progress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/plan-progress.test.ts
import { plannedTss, buildWeekBuckets, weekState, consistency, planHours } from '@/lib/plan/progress'
import { makeWorkout } from '../support/factories'
import type { ICUActivity } from '@/types'

function activity(over: Partial<ICUActivity>): ICUActivity {
  return {
    id: 'a', start_date_local: '2026-05-01T08:00:00', type: 'Ride', moving_time: 3600,
    name: 'Ride', average_watts: 200, max_watts: 500, weighted_average_watts: 210,
    average_heartrate: 150, training_load: 50, rolling_ftp: null, distance: null,
    total_elevation_gain: null, left_right_balance: null, ...over,
  }
}

describe('plannedTss', () => {
  it('sums TSS from steps (duration × intensity²)', () => {
    // 60 min @ 100% FTP = 1.0² × 1h × 100 = 100 TSS
    const w = makeWorkout({ steps: [{ label: 'FTP', duration_minutes: 60, power_pct_ftp: 100 }] })
    expect(plannedTss(w)).toBe(100)
  })

  it('falls back to a type intensity factor when there are no steps', () => {
    // recovery IF 0.55 → 60min: 0.55² × 100 = ~30
    expect(plannedTss(makeWorkout({ type: 'recovery', steps: null }))).toBe(30)
  })
})

describe('buildWeekBuckets', () => {
  const planStart = '2026-05-01'
  it('buckets planned workouts and actual activity TSS by plan week', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-05-02', status: 'completed', steps: [{ label: 's', duration_minutes: 60, power_pct_ftp: 100 }] }),
      makeWorkout({ id: 'w2', date: '2026-05-10', status: 'planned', steps: [{ label: 's', duration_minutes: 60, power_pct_ftp: 100 }] }),
    ]
    const activities = [activity({ id: 'a1', start_date_local: '2026-05-03T08:00:00', training_load: 70 })]
    const buckets = buildWeekBuckets(workouts, activities, planStart, 2)
    expect(buckets[0]).toMatchObject({ weekIndex: 0, plannedTss: 100, actualTss: 70, plannedSessions: 1, completedSessions: 1 })
    expect(buckets[1]).toMatchObject({ weekIndex: 1, plannedTss: 100, plannedSessions: 1, completedSessions: 0 })
  })
})

describe('weekState', () => {
  it('classifies current, done, partial, missed and upcoming', () => {
    expect(weekState({ weekIndex: 2, plannedTss: 0, actualTss: 0, plannedSessions: 3, completedSessions: 1 }, 2)).toBe('current')
    expect(weekState({ weekIndex: 0, plannedTss: 0, actualTss: 0, plannedSessions: 3, completedSessions: 3 }, 2)).toBe('done')
    expect(weekState({ weekIndex: 0, plannedTss: 0, actualTss: 0, plannedSessions: 3, completedSessions: 1 }, 2)).toBe('partial')
    expect(weekState({ weekIndex: 0, plannedTss: 0, actualTss: 0, plannedSessions: 3, completedSessions: 0 }, 2)).toBe('missed')
    expect(weekState({ weekIndex: 5, plannedTss: 0, actualTss: 0, plannedSessions: 3, completedSessions: 0 }, 2)).toBe('upcoming')
  })
})

describe('consistency', () => {
  it('computes hit % over due weeks and a streak that stops below 80%', () => {
    const buckets = [
      { weekIndex: 0, plannedTss: 0, actualTss: 0, plannedSessions: 4, completedSessions: 4 },
      { weekIndex: 1, plannedTss: 0, actualTss: 0, plannedSessions: 4, completedSessions: 2 }, // 50% → breaks streak
      { weekIndex: 2, plannedTss: 0, actualTss: 0, plannedSessions: 4, completedSessions: 4 },
    ]
    const res = consistency(buckets, 3)
    expect(res.hitPct).toBe(83) // 10/12
    expect(res.streak).toBe(1)  // week 2 only (week 1 breaks it)
  })
})

describe('planHours', () => {
  it('uses linked activity moving time, else planned duration, for completed sessions', () => {
    const workouts = [
      makeWorkout({ id: 'w1', status: 'completed', icu_activity_id: 'a1', duration_minutes: 60 }),
      makeWorkout({ id: 'w2', status: 'completed', icu_activity_id: null, duration_minutes: 30 }),
      makeWorkout({ id: 'w3', status: 'planned', duration_minutes: 90 }),
    ]
    const activities = [activity({ id: 'a1', moving_time: 5400 })] // 1.5h
    expect(planHours(workouts, activities)).toBe(2) // 1.5h + 0.5h
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/plan-progress.test.ts`
Expected: FAIL — cannot find module `@/lib/plan/progress`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/plan/progress.ts
import type { Workout, ICUActivity, WorkoutType } from '@/types'

export interface WeekBucket {
  weekIndex: number
  plannedTss: number
  actualTss: number
  plannedSessions: number
  completedSessions: number
}

export type WeekState = 'done' | 'partial' | 'missed' | 'current' | 'upcoming'

// Fallback intensity factor per workout type, used only when a workout has no steps.
const IF_BY_TYPE: Record<WorkoutType, number> = {
  recovery: 0.55,
  endurance: 0.68,
  threshold: 0.95,
  intervals: 1.0,
}

function isDone(status: Workout['status']): boolean {
  return status === 'completed' || status === 'needs_review'
}

function weekIndexOf(dateStr: string, planStart: string): number {
  const d = Date.parse(dateStr.split('T')[0] + 'T00:00:00Z')
  const s = Date.parse(planStart.split('T')[0] + 'T00:00:00Z')
  return Math.floor((d - s) / (7 * 86_400_000))
}

/** Target training stress for a session: from steps if present, else a type estimate. */
export function plannedTss(workout: Workout): number {
  if (workout.steps && workout.steps.length) {
    const tss = workout.steps.reduce(
      (sum, st) => sum + (st.duration_minutes / 60) * Math.pow(st.power_pct_ftp / 100, 2) * 100,
      0,
    )
    return Math.round(tss)
  }
  const intf = IF_BY_TYPE[workout.type] ?? 0.7
  return Math.round((workout.duration_minutes / 60) * intf * intf * 100)
}

/** Per-week planned/actual load and session counts across the plan window. */
export function buildWeekBuckets(
  workouts: Workout[],
  activities: ICUActivity[],
  planStart: string,
  totalWeeks: number,
): WeekBucket[] {
  const buckets: WeekBucket[] = Array.from({ length: totalWeeks }, (_, i) => ({
    weekIndex: i, plannedTss: 0, actualTss: 0, plannedSessions: 0, completedSessions: 0,
  }))
  for (const w of workouts) {
    if (!w.plan_id) continue
    const i = weekIndexOf(w.date, planStart)
    if (i < 0 || i >= totalWeeks) continue
    buckets[i].plannedTss += plannedTss(w)
    buckets[i].plannedSessions += 1
    if (isDone(w.status)) buckets[i].completedSessions += 1
  }
  for (const a of activities) {
    const i = weekIndexOf(a.start_date_local, planStart)
    if (i < 0 || i >= totalWeeks) continue
    buckets[i].actualTss += a.training_load ?? 0
  }
  for (const b of buckets) {
    b.plannedTss = Math.round(b.plannedTss)
    b.actualTss = Math.round(b.actualTss)
  }
  return buckets
}

export function weekState(bucket: WeekBucket, currentWeek: number): WeekState {
  if (bucket.weekIndex === currentWeek) return 'current'
  if (bucket.weekIndex > currentWeek) return 'upcoming'
  if (bucket.plannedSessions === 0) return 'upcoming'
  if (bucket.completedSessions >= bucket.plannedSessions) return 'done'
  if (bucket.completedSessions > 0) return 'partial'
  return 'missed'
}

export function consistency(
  buckets: WeekBucket[],
  currentWeek: number,
): { hitPct: number; streak: number } {
  let planned = 0
  let completed = 0
  for (const b of buckets) {
    if (b.weekIndex <= currentWeek && b.plannedSessions > 0) {
      planned += b.plannedSessions
      completed += b.completedSessions
    }
  }
  const hitPct = planned === 0 ? 0 : Math.round((completed / planned) * 100)

  let streak = 0
  for (let i = currentWeek - 1; i >= 0; i--) {
    const b = buckets[i]
    if (!b || b.plannedSessions === 0) break
    if (b.completedSessions / b.plannedSessions >= 0.8) streak++
    else break
  }
  return { hitPct, streak }
}

/** Hours trained across the plan: linked activity moving time, else planned duration. */
export function planHours(workouts: Workout[], activities: ICUActivity[]): number {
  const byId = new Map(activities.map(a => [a.id, a]))
  let secs = 0
  for (const w of workouts) {
    if (!w.plan_id || !isDone(w.status)) continue
    const act = w.icu_activity_id ? byId.get(w.icu_activity_id) : undefined
    secs += act?.moving_time ?? w.duration_minutes * 60
  }
  return Math.round(secs / 360) / 10
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/plan-progress.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/plan/progress.ts __tests__/lib/plan-progress.test.ts
git commit -m "feat: weekly plan progress computations"
```

---

## Task 3: Persist per-week phases at generation

**Files:**
- Create: `supabase/migrations/20260603_plan_week_phases.sql`
- Modify: `types/index.ts` (`TrainingPlan`, `GeneratedPlan`), `lib/claude/plan.ts` (prompt), `app/api/plan/route.ts` (PATCH insert)
- Test: `__tests__/lib/plan-parse-phases.test.ts`

- [ ] **Step 1: Write the failing test** (round-trip that `week_phases` survives parsing)

```ts
// __tests__/lib/plan-parse-phases.test.ts
import { parsePlanText } from '@/lib/claude/plan'

it('preserves week_phases through plan parsing', () => {
  const json = JSON.stringify({
    rationale: 'r', target_event_name: 'E', target_event_date: '2026-07-01',
    phase: 'build', week_phases: ['base', 'build', 'peak', 'taper'], workouts: [],
  })
  expect(parsePlanText(json).week_phases).toEqual(['base', 'build', 'peak', 'taper'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lib/plan-parse-phases.test.ts`
Expected: FAIL — TS error: `week_phases` does not exist on `GeneratedPlan`.

- [ ] **Step 3: Add the type fields**

In `types/index.ts`, add to `TrainingPlan` (after `plan_weeks: number | null` at line 71):

```ts
  week_phases: PlanPhase[] | null
```

And to `GeneratedPlan` (after `phase: PlanPhase` at line 317):

```ts
  week_phases?: PlanPhase[]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lib/plan-parse-phases.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the migration**

```sql
-- supabase/migrations/20260603_plan_week_phases.sql
-- Per-week phase labels for the active plan (base|build|peak|taper, one per plan
-- week). Generated by Claude at plan time; null for legacy plans (a heuristic
-- fallback derives phases client-side). Shape: jsonb array of strings.
alter table training_plans add column if not exists week_phases jsonb;
```

- [ ] **Step 6: Add `week_phases` to the generation prompt**

In `lib/claude/plan.ts`, in the JSON schema inside `buildPrompt` (after the `"phase": "base|build|peak|taper",` line at line 164), add:

```ts
  "week_phases": ["base|build|peak|taper for week 1", "… week 2 …", "… one entry per plan week, in order …"],
```

And add this instruction line immediately before `Return ONLY this JSON:` (line 159):

```ts
WEEK PHASES: also return "week_phases" — an array with exactly ${weeks} entries, one phase per plan week in chronological order (base|build|peak|taper), consistent with the periodization you applied.
```

(Place it after the `${coachingNotesGuidance()}` line so it sits with the other output instructions.)

- [ ] **Step 7: Persist on save**

In `app/api/plan/route.ts`, the PATCH insert (lines 198–209), add `week_phases` to the inserted object:

```ts
  const { data: savedPlan, error: planError } = await supabase
    .from('training_plans')
    .insert({
      name,
      status: 'active',
      target_event_name: plan.target_event_name,
      target_event_date: plan.target_event_date,
      phase: plan.phase,
      week_phases: plan.week_phases ?? null,
      rationale: plan.rationale,
      plan_weeks: planWeeks,
      user_id: user.id,
    })
    .select()
    .single()
```

- [ ] **Step 8: Verify the suite + types**

Run: `npx jest __tests__/lib/plan-parse-phases.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add types/index.ts lib/claude/plan.ts app/api/plan/route.ts supabase/migrations/20260603_plan_week_phases.sql __tests__/lib/plan-parse-phases.test.ts
git commit -m "feat: store per-week plan phases at generation"
```

> **Note for the integrator:** the migration `20260603_plan_week_phases.sql` must be applied to the live database before stored phases persist (the heuristic fallback works regardless). This mirrors the `20260602_coaching_notes.sql` manual step.

---

## Task 4: `PlanJourney` component

**Files:**
- Create: `components/plan/PlanJourney.tsx`
- Test: `__tests__/components/PlanJourney.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/PlanJourney.test.tsx
import { render, screen } from '@testing-library/react'
import PlanJourney from '@/components/plan/PlanJourney'

const states = ['done', 'done', 'current', 'upcoming'] as const
const phases = ['base', 'build', 'peak', 'taper'] as const

describe('PlanJourney', () => {
  it('renders one block per week and a single current marker', () => {
    const { container } = render(
      <PlanJourney states={[...states]} phases={[...phases]} weekLabel="Wk 3 of 4"
        phaseLabel="Peak" eventName="Dragon Ride" daysToEvent={35} />,
    )
    expect(container.querySelectorAll('[data-week-block]')).toHaveLength(4)
    expect(container.querySelectorAll('[data-state="current"]')).toHaveLength(1)
  })

  it('shows the week label, phase and event countdown', () => {
    render(
      <PlanJourney states={[...states]} phases={[...phases]} weekLabel="Wk 3 of 4"
        phaseLabel="Peak" eventName="Dragon Ride" daysToEvent={35} />,
    )
    expect(screen.getByText(/Wk 3 of 4/)).toBeInTheDocument()
    expect(screen.getByText(/Peak/)).toBeInTheDocument()
    expect(screen.getByText(/35 days to Dragon Ride/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/PlanJourney.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```tsx
// components/plan/PlanJourney.tsx
import type { PlanPhase } from '@/types'
import type { WeekState } from '@/lib/plan/progress'

// Phase band styles tuned to read on the blue hero background.
const PHASE_BAND: Record<PlanPhase, string> = {
  base: 'bg-blue-200 text-blue-900',
  build: 'bg-blue-400 text-white',
  peak: 'bg-blue-900 text-white',
  taper: 'bg-amber-400 text-amber-900',
}
const PHASE_LABEL: Record<PlanPhase, string> = { base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper' }

// Week block fills (on blue): completion read via white opacity, current = yellow ring.
const BLOCK: Record<WeekState, string> = {
  done: 'bg-white',
  partial: 'bg-white/60',
  missed: 'bg-red-300',
  current: 'bg-white ring-2 ring-yellow-300',
  upcoming: 'bg-white/25',
}

interface PlanJourneyProps {
  states: WeekState[]
  phases: PlanPhase[]
  weekLabel: string
  phaseLabel: string
  eventName: string | null
  daysToEvent: number | null
}

export default function PlanJourney({ states, phases, weekLabel, phaseLabel, eventName, daysToEvent }: PlanJourneyProps) {
  // Collapse consecutive same-phase weeks into bands; each band grows by its week-span.
  const bands: { phase: PlanPhase; span: number }[] = []
  for (const p of phases) {
    const last = bands[bands.length - 1]
    if (last && last.phase === p) last.span++
    else bands.push({ phase: p, span: 1 })
  }

  return (
    <div data-testid="plan-journey" className="mt-3">
      <div className="flex gap-0.5 mb-1.5">
        {bands.map((b, i) => (
          <div
            key={i}
            style={{ flexGrow: b.span }}
            className={`h-3.5 flex items-center justify-center rounded-sm text-[8px] font-extrabold tracking-wide ${PHASE_BAND[b.phase]}`}
          >
            {b.span > 1 ? PHASE_LABEL[b.phase].toUpperCase() : PHASE_LABEL[b.phase][0]}
          </div>
        ))}
      </div>
      <div className="flex gap-[3px]">
        {states.map((s, i) => (
          <div key={i} data-week-block data-state={s} className={`flex-1 h-6 rounded ${BLOCK[s]}`} />
        ))}
      </div>
      <p className="mt-2 text-[11px] opacity-90">
        {weekLabel} · {phaseLabel}
        {eventName && daysToEvent != null && (
          <> · 🏁 {daysToEvent} day{daysToEvent !== 1 ? 's' : ''} to {eventName}</>
        )}
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/PlanJourney.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/plan/PlanJourney.tsx __tests__/components/PlanJourney.test.tsx
git commit -m "feat: PlanJourney hero graphic"
```

---

## Task 5: `ConsistencyStrip` component

**Files:**
- Create: `components/plan/ConsistencyStrip.tsx`
- Test: `__tests__/components/ConsistencyStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/ConsistencyStrip.test.tsx
import { render, screen } from '@testing-library/react'
import ConsistencyStrip from '@/components/plan/ConsistencyStrip'

it('shows hit %, streak and hours', () => {
  render(<ConsistencyStrip hitPct={86} streak={5} hours={11} />)
  expect(screen.getByText('86%')).toBeInTheDocument()
  expect(screen.getByText('🔥5')).toBeInTheDocument()
  expect(screen.getByText('11h')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/ConsistencyStrip.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```tsx
// components/plan/ConsistencyStrip.tsx
interface ConsistencyStripProps {
  hitPct: number
  streak: number
  hours: number
}

export default function ConsistencyStrip({ hitPct, streak, hours }: ConsistencyStripProps) {
  const stats = [
    { v: `${hitPct}%`, l: 'sessions hit' },
    { v: `🔥${streak}`, l: 'week streak' },
    { v: `${hours}h`, l: 'this plan' },
  ]
  return (
    <div data-testid="consistency-strip" className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex gap-3">
      {stats.map((s, i) => (
        <div key={i} className="flex-1 text-center">
          <div className="text-xl font-extrabold text-blue-600 leading-tight">{s.v}</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">{s.l}</div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/ConsistencyStrip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/plan/ConsistencyStrip.tsx __tests__/components/ConsistencyStrip.test.tsx
git commit -m "feat: ConsistencyStrip module"
```

---

## Task 6: `LoadComparisonChart` component

**Files:**
- Create: `components/plan/LoadComparisonChart.tsx`
- Test: `__tests__/components/LoadComparisonChart.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/LoadComparisonChart.test.tsx
import { render } from '@testing-library/react'
import LoadComparisonChart from '@/components/plan/LoadComparisonChart'

it('renders a planned and actual bar per week', () => {
  const weeks = [
    { plannedTss: 300, actualTss: 280 },
    { plannedTss: 350, actualTss: 360 },
    { plannedTss: 400, actualTss: 180 },
  ]
  const { container } = render(<LoadComparisonChart weeks={weeks} currentWeek={2} />)
  expect(container.querySelectorAll('[data-week-col]')).toHaveLength(3)
  expect(container.querySelectorAll('[data-bar]')).toHaveLength(6)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/LoadComparisonChart.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```tsx
// components/plan/LoadComparisonChart.tsx
interface LoadComparisonChartProps {
  weeks: { plannedTss: number; actualTss: number }[]
  currentWeek: number
}

export default function LoadComparisonChart({ weeks, currentWeek }: LoadComparisonChartProps) {
  const max = Math.max(1, ...weeks.flatMap(w => [w.plannedTss, w.actualTss]))
  return (
    <div data-testid="load-chart" className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">Load — planned vs actual</p>
      <div className="flex items-end gap-1.5 h-20">
        {weeks.map((w, i) => (
          <div key={i} data-week-col className="flex-1 flex items-end gap-0.5 h-full">
            <span data-bar className="flex-1 bg-slate-300 rounded-t" style={{ height: `${(w.plannedTss / max) * 100}%` }} />
            <span data-bar className={`flex-1 rounded-t ${i === currentWeek ? 'bg-blue-300' : 'bg-blue-600'}`} style={{ height: `${(w.actualTss / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 mt-2">▥ planned · █ actual TSS, by week</p>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/LoadComparisonChart.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/plan/LoadComparisonChart.tsx __tests__/components/LoadComparisonChart.test.tsx
git commit -m "feat: LoadComparisonChart module"
```

---

## Task 7: `FitnessTrendChart` component

**Files:**
- Create: `components/plan/FitnessTrendChart.tsx`
- Test: `__tests__/components/FitnessTrendChart.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/FitnessTrendChart.test.tsx
import { render, screen } from '@testing-library/react'
import FitnessTrendChart from '@/components/plan/FitnessTrendChart'

const points = [
  { date: '2026-05-01', ctl: 40, form: 2 },
  { date: '2026-05-08', ctl: 44, form: -3 },
  { date: '2026-05-15', ctl: 48, form: -6 },
]

it('renders two trend lines and the CTL delta when enough data', () => {
  const { container } = render(<FitnessTrendChart points={points} />)
  expect(container.querySelectorAll('polyline')).toHaveLength(2)
  expect(screen.getByText(/\+8/)).toBeInTheDocument() // 48 − 40
})

it('shows an empty state with fewer than three points', () => {
  render(<FitnessTrendChart points={points.slice(0, 2)} />)
  expect(screen.getByText('Not enough data yet.')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/FitnessTrendChart.test.tsx`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```tsx
// components/plan/FitnessTrendChart.tsx
import { normalizeY } from '@/lib/chart-helpers'

interface FitnessPoint {
  date: string
  ctl: number
  form: number
}

interface FitnessTrendChartProps {
  points: FitnessPoint[]
}

const CARD = 'bg-white rounded-xl border border-slate-100 shadow-sm p-4'
const HEADING = 'text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2'

export default function FitnessTrendChart({ points }: FitnessTrendChartProps) {
  if (points.length < 3) {
    return (
      <div data-testid="fitness-trend" className={CARD}>
        <p className={HEADING}>Fitness trend</p>
        <p className="text-sm text-slate-400">Not enough data yet.</p>
      </div>
    )
  }

  const W = 300
  const H = 70
  const values = points.flatMap(p => [p.ctl, p.form])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const x = (i: number) => (i / (points.length - 1)) * W
  const line = (key: 'ctl' | 'form') =>
    points.map((p, i) => `${x(i).toFixed(1)},${normalizeY(p[key], min, max, 8, H - 8).toFixed(1)}`).join(' ')

  const delta = Math.round(points[points.length - 1].ctl - points[0].ctl)
  const form = Math.round(points[points.length - 1].form)

  return (
    <div data-testid="fitness-trend" className={CARD}>
      <p className={HEADING}>Fitness trend</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
        <polyline points={line('ctl')} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" />
        <polyline points={line('form')} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 4" />
      </svg>
      <p className="text-[10px] text-slate-500 mt-2">
        Fitness (CTL){' '}
        <span className={delta >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
          {delta >= 0 ? '+' : ''}{delta}
        </span>{' '}
        since start · Form {form}
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/FitnessTrendChart.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/plan/FitnessTrendChart.tsx __tests__/components/FitnessTrendChart.test.tsx
git commit -m "feat: FitnessTrendChart module"
```

---

## Task 8: Wire the modules into the My Plan tab

**Files:**
- Modify: `app/plan/page.tsx`
- Test: `__tests__/pages/PlanProgress.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/pages/PlanProgress.test.tsx
import { render, screen } from '@testing-library/react'
import PlanPage from '@/app/plan/page'

const profileData = {
  id: 1, goals: '', current_ftp: 250, weight_kg: 72, weekly_availability: [],
  min_sessions_per_week: 3, max_sessions_per_week: 5,
  events: [{ name: 'Dragon Ride', date: '2026-07-01', type: 'sportive', priority: 'A' }],
  unavailability: [],
}

// Active plan: created 2026-05-01, 3 weeks, with a couple of workouts.
const planResponse = {
  id: 'plan1', name: 'Road to Dragon Ride', status: 'active',
  target_event_name: 'Dragon Ride', target_event_date: '2026-07-01',
  phase: 'build', plan_weeks: 3, week_phases: ['base', 'build', 'peak'],
  created_at: '2026-05-01T00:00:00Z',
  workouts: [
    { id: 'w1', plan_id: 'plan1', date: '2026-05-02', type: 'endurance', duration_minutes: 60,
      description: '', target_zones: '', intervals_icu_event_id: null, status: 'completed',
      icu_activity_id: null, tss: null, missed_reason: null,
      steps: [{ label: 's', duration_minutes: 60, power_pct_ftp: 70 }],
      activity_metrics: null, coaching_notes: null, created_at: '2026-05-01T00:00:00Z' },
    { id: 'w2', plan_id: 'plan1', date: '2026-05-09', type: 'threshold', duration_minutes: 60,
      description: '', target_zones: '', intervals_icu_event_id: null, status: 'planned',
      icu_activity_id: null, tss: null, missed_reason: null,
      steps: [{ label: 's', duration_minutes: 60, power_pct_ftp: 95 }],
      activity_metrics: null, coaching_notes: null, created_at: '2026-05-01T00:00:00Z' },
  ],
}

const syncResponse = {
  activities: [{ id: 'a1', start_date_local: '2026-05-02T08:00:00', type: 'Ride', moving_time: 3600,
    name: 'Ride', average_watts: 200, max_watts: 500, weighted_average_watts: 210,
    average_heartrate: 150, training_load: 55, rolling_ftp: null, distance: null,
    total_elevation_gain: null, left_right_balance: null }],
  wellness: [
    { id: '2026-05-01', ctl: 40, atl: 38, form: 2, hrv: null, resting_hr: null, sleep_secs: null },
    { id: '2026-05-08', ctl: 44, atl: 50, form: -6, hrv: null, resting_hr: null, sleep_secs: null },
    { id: '2026-05-15', ctl: 48, atl: 54, form: -6, hrv: null, resting_hr: null, sleep_secs: null },
  ],
  athlete_ftp: 250, athlete_weight: 72,
}

beforeEach(() => {
  jest.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/profile') return Promise.resolve({ ok: true, json: async () => profileData } as Response)
    if (url === '/api/plan') return Promise.resolve({ ok: true, json: async () => planResponse } as Response)
    if (url === '/api/sync') return Promise.resolve({ ok: true, json: async () => syncResponse } as Response)
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
  })
})
afterEach(() => jest.restoreAllMocks())

it('renders the progress modules for an active plan', async () => {
  render(<PlanPage />)
  expect(await screen.findByTestId('plan-journey')).toBeInTheDocument()
  expect(await screen.findByTestId('consistency-strip')).toBeInTheDocument()
  expect(await screen.findByTestId('load-chart')).toBeInTheDocument()
  expect(await screen.findByTestId('fitness-trend')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/pages/PlanProgress.test.tsx`
Expected: FAIL — `plan-journey` testid not found (modules not wired in).

- [ ] **Step 3: Add imports** at the top of `app/plan/page.tsx` (after the existing component imports, before the type import on line 11):

```ts
import PlanJourney from '@/components/plan/PlanJourney'
import ConsistencyStrip from '@/components/plan/ConsistencyStrip'
import LoadComparisonChart from '@/components/plan/LoadComparisonChart'
import FitnessTrendChart from '@/components/plan/FitnessTrendChart'
import { resolvePhases } from '@/lib/plan/phases'
import { buildWeekBuckets, weekState, consistency, planHours } from '@/lib/plan/progress'
```

And extend the existing type import on line 11 to include `PlanPhase`:

```ts
import type { TrainingEvent, Workout, GeneratedPlan, ICUSyncData, UnavailabilityPeriod, PlanPhase } from '@/types'
```

- [ ] **Step 4: Add phase state and load it.** After the `planTotalWeeks` state declaration (`app/plan/page.tsx:75`), add:

```ts
  const [planWeekPhases, setPlanWeekPhases] = useState<PlanPhase[] | null>(null)
```

In `loadPlan()` (inside the `.then(data => { … })`, alongside the other setters around line 117), add:

```ts
        setPlanWeekPhases(data?.week_phases ?? null)
```

- [ ] **Step 5: Compute progress inside the active-plan branch.** In the `planName ? (() => { … })()` block, replace the opening of the IIFE (currently lines 470–473):

```tsx
        {planName ? (() => {
          const wk = weekNumber()
          const next = nextEvent()
          return (
```

with:

```tsx
        {planName ? (() => {
          const wk = weekNumber()
          const next = nextEvent()
          const planStart = planCreatedAt ? planCreatedAt.split('T')[0] : ''
          const totalWeeks = wk?.total ?? 0
          const currentWeek = wk ? wk.current - 1 : 0
          const buckets = planStart && totalWeeks > 0
            ? buildWeekBuckets(planWorkouts, syncData?.activities ?? [], planStart, totalWeeks)
            : []
          const phases = resolvePhases(planWeekPhases, buckets.map(b => b.plannedTss), totalWeeks)
          const states = buckets.map(b => weekState(b, currentWeek))
          const cons = consistency(buckets, currentWeek)
          const hours = planHours(planWorkouts, syncData?.activities ?? [])
          const totalPlanned = buckets.reduce((sum, b) => sum + b.plannedSessions, 0)
          const currentPhase = phases[currentWeek] ?? 'base'
          const phaseLabel = currentPhase.charAt(0).toUpperCase() + currentPhase.slice(1)
          const fitPoints = (syncData?.wellness ?? [])
            .filter(w => planStart && w.id >= planStart && w.ctl != null)
            .map(w => ({ date: w.id, ctl: w.ctl as number, form: w.form ?? 0 }))
          return (
```

- [ ] **Step 6: Replace the hero's week bar + hardcoded phase with `PlanJourney`.** In the hero card, replace the stats row and week-bar block (currently lines 489–501):

```tsx
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  {wk && <span>Week <strong>{wk.current}</strong> of <strong>{wk.total}</strong></span>}
                  {next !== null && <span>🏁 {next.name} in <strong>{next.days} day{next.days !== 1 ? 's' : ''}</strong></span>}
                  <span>Phase: <strong>Base</strong></span>
                </div>
                {wk && (
                  <div className="mt-4 h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white/80 rounded-full transition-all"
                      style={{ width: `${(wk.current / wk.total) * 100}%` }}
                    />
                  </div>
                )}
```

with:

```tsx
                {wk && (
                  <PlanJourney
                    states={states}
                    phases={phases}
                    weekLabel={`Wk ${wk.current} of ${wk.total}`}
                    phaseLabel={phaseLabel}
                    eventName={next?.name ?? null}
                    daysToEvent={next?.days ?? null}
                  />
                )}
```

- [ ] **Step 7: Render the three module cards** between the hero card's closing `</div>` and the "Plan actions" card (i.e. immediately after the hero card block that ends at line 502, before the `<div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">` plan-actions card on line 504):

```tsx
              {totalPlanned > 0 && (
                <ConsistencyStrip hitPct={cons.hitPct} streak={cons.streak} hours={hours} />
              )}
              {buckets.length > 0 && (
                <LoadComparisonChart weeks={buckets} currentWeek={currentWeek} />
              )}
              <FitnessTrendChart points={fitPoints} />
```

- [ ] **Step 8: Run the integration test**

Run: `npx jest __tests__/pages/PlanProgress.test.tsx`
Expected: PASS (modules render).

- [ ] **Step 9: Run the full suite + typecheck**

Run: `npx jest && npm run typecheck`
Expected: All suites pass; typecheck clean. (Confirm `__tests__/pages/PlanPage.test.tsx` still passes — it uses `workouts: []` with no `planName`, so the new branch is not exercised there.)

- [ ] **Step 10: Commit**

```bash
git add app/plan/page.tsx __tests__/pages/PlanProgress.test.tsx
git commit -m "feat: surface plan progress modules on the My Plan tab"
```

---

## Final verification (after all tasks)

- [ ] `npx jest` — entire suite green.
- [ ] `npm run typecheck` — clean.
- [ ] Manual: apply `supabase/migrations/20260603_plan_week_phases.sql` to the live DB.
- [ ] Manual (mobile 375px): open Plan tab with the active plan — journey bands render via the heuristic, consistency/load/fitness modules show, nothing overflows.

## Self-review notes (done during planning)

- **Spec coverage:** journey (Task 4 + 8), consistency (Task 5 + 8), load (Task 6 + 8), fitness (Task 7 + 8), stored phases + heuristic (Tasks 1 & 3), week model & computations (Task 2), migration (Task 3). All spec sections mapped.
- **Corrected from spec:** the IF fallback table now uses only the four real `WorkoutType` values; the save path is **PATCH** (not POST); `plannedTss` drops the unused `ftp` argument.
- **Type consistency:** `WeekBucket`/`WeekState` defined in Task 2 are reused verbatim in Tasks 4/6/8; `resolvePhases(stored, weeklyPlannedTss, totalWeeks)` and component prop names match across tasks.
