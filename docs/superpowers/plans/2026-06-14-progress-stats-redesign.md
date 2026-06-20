# Progress Stats Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard ProgressBrief (blue card + AI narrative + metrics strip) with a compact 6-tile stats grid (no AI text) positioned below Today and Strain panels, and move the coaching narrative to the Plan page under the active plan box.

**Architecture:** `ProgressMetrics` gains `streak` and `totalRides` fields and loses `wkg`. `computeProgressMetrics` gets two new optional params — `activities` and `minSessionsPerWeek` — for the new calculations. The new `ProgressStats` component replaces `ProgressBrief` on the dashboard (compact 6-tile grid, no narrative). The Plan page reads from the same `/api/progress-brief` endpoint and renders the AI narrative inline as a green card. No DB or API route changes needed.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS, React Testing Library, Jest.

---

## File Structure

```
cycling-coach/
├── types/index.ts                              MODIFY — add streak, totalRides; remove wkg from ProgressMetrics
├── lib/progress/
│   ├── metrics.ts                              MODIFY — add streak + rides; remove wkg; new params
│   └── brief-generator.ts                      MODIFY — pass activities + minSessionsPerWeek
├── lib/claude/
│   └── progress-brief.ts                       MODIFY — remove wkg block from prompt builder
├── app/api/sync/route.ts                       MODIFY — add min_sessions_per_week to profile SELECT
├── components/
│   ├── ProgressBrief.tsx                       DELETE
│   └── ProgressStats.tsx                       CREATE — compact 6-tile grid
├── app/dashboard/page.tsx                      MODIFY — swap component; reposition below MetricsBar
├── app/plan/page.tsx                           MODIFY — add coaching brief under active plan box
└── __tests__/
    ├── lib/progress-metrics.test.ts            MODIFY — remove wkg test; add streak + rides tests
    ├── lib/claude-progress-brief.test.ts       MODIFY — remove wkg: null from mock
    └── components/
        ├── ProgressBrief.test.tsx              DELETE
        └── ProgressStats.test.tsx              CREATE
```

---

## Task 1: Update `ProgressMetrics` type

**Files:**
- Modify: `cycling-coach/types/index.ts`

- [ ] **Step 1: Update `ProgressMetrics` interface**

Find this block in `types/index.ts`:

```typescript
export interface ProgressMetrics {
  ftp: ProgressDelta | null
  ctl: ProgressDelta | null
  wkg: ProgressDelta | null
  weight: ProgressDelta | null
  adherence: { completed: number; total: number } | null
  planPhase: string | null
  targetEvent: string | null
  targetDate: string | null
  planStartDate: string | null
}
```

Replace with:

```typescript
export interface ProgressMetrics {
  ftp: ProgressDelta | null
  ctl: ProgressDelta | null
  weight: ProgressDelta | null
  adherence: { completed: number; total: number } | null
  streak: number | null
  totalRides: number | null
  planPhase: string | null
  targetEvent: string | null
  targetDate: string | null
  planStartDate: string | null
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: type errors from files that reference `wkg` — that's fine, we'll fix those in later tasks. Confirm no *other* unexpected errors.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add streak and totalRides to ProgressMetrics, remove wkg"
```

---

## Task 2: Update `lib/progress/metrics.ts`

**Files:**
- Modify: `cycling-coach/lib/progress/metrics.ts`

- [ ] **Step 1: Replace the full file**

The new file adds `activities` and `minSessionsPerWeek` optional params, removes wkg, and adds streak + totalRides calculations.

Replace the entire contents of `cycling-coach/lib/progress/metrics.ts` with:

```typescript
import type { ICUActivity, ICUWellness, ProgressMetrics, WeightEntry, WorkoutStatus } from '@/types'

interface PlanInfo {
  created_at: string
  baseline_ftp: number | null
  phase: string
  target_event_name: string
  target_event_date: string
}

interface PlanWorkout {
  status: WorkoutStatus
  date: string
}

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const dow = d.getDay() // 0=Sun, 1=Mon…6=Sat
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  return d.toISOString().split('T')[0]
}

export function computeProgressMetrics(
  wellness: ICUWellness[],
  currentFTP: number,
  currentWeightKg: number,
  plan: PlanInfo | null,
  weightLog: WeightEntry[],
  planWorkouts: PlanWorkout[],
  activities: ICUActivity[] = [],
  minSessionsPerWeek: number = 3,
): ProgressMetrics {
  const today = new Date().toISOString().split('T')[0]
  const planStartDate = plan ? plan.created_at.split('T')[0] : null

  // FTP delta
  let ftp: ProgressMetrics['ftp'] = null
  if (plan?.baseline_ftp && plan.baseline_ftp > 0) {
    ftp = {
      current: currentFTP,
      baseline: plan.baseline_ftp,
      delta: currentFTP - plan.baseline_ftp,
    }
  }

  // CTL delta
  let ctl: ProgressMetrics['ctl'] = null
  if (wellness.length > 0) {
    const sorted = [...wellness].sort((a, b) => a.id.localeCompare(b.id))
    const latest = sorted[sorted.length - 1]
    if (latest.ctl !== null) {
      let baselineEntry = sorted[0]
      if (planStartDate) {
        const onOrAfter = sorted.find(w => w.id >= planStartDate)
        if (onOrAfter) baselineEntry = onOrAfter
      }
      if (baselineEntry.ctl !== null) {
        ctl = {
          current: Math.round(latest.ctl),
          baseline: Math.round(baselineEntry.ctl),
          delta: Math.round(latest.ctl - baselineEntry.ctl),
        }
      }
    }
  }

  // Weight delta
  let weight: ProgressMetrics['weight'] = null
  if (weightLog.length > 0) {
    const sorted = [...weightLog].sort((a, b) => a.date.localeCompare(b.date))
    const latest = sorted[sorted.length - 1]
    let baselineWeight: number | null = null
    if (planStartDate) {
      const before = sorted.filter(w => w.date <= planStartDate)
      const after = sorted.filter(w => w.date > planStartDate)
      if (before.length) baselineWeight = before[before.length - 1].weight_kg
      // fallback: use earliest post-plan entry if no pre-plan weight exists
      else if (after.length) baselineWeight = after[0].weight_kg
    } else {
      baselineWeight = sorted[0].weight_kg
    }
    if (baselineWeight !== null) {
      weight = {
        current: latest.weight_kg,
        baseline: baselineWeight,
        delta: Math.round((latest.weight_kg - baselineWeight) * 10) / 10,
      }
    }
  }

  // Adherence
  let adherence: ProgressMetrics['adherence'] = null
  if (plan && planWorkouts.length > 0) {
    // includes today — a planned session today counts until it's marked completed
    const pastAndToday = planWorkouts.filter(w => w.date <= today)
    const completed = pastAndToday.filter(w => w.status === 'completed').length
    const total = pastAndToday.length
    if (total > 0) adherence = { completed, total }
  }

  // Streak — consecutive weeks (Mon-Sun) ending before current week where completed >= minSessionsPerWeek
  let streak: number | null = null
  if (plan && planWorkouts.length > 0) {
    const currentWeekStart = getWeekStart(today)
    const weekMap = new Map<string, number>()
    for (const w of planWorkouts) {
      const ws = getWeekStart(w.date)
      if (ws >= currentWeekStart) continue // exclude current (in-progress) week
      if (!weekMap.has(ws)) weekMap.set(ws, 0)
      if (w.status === 'completed') weekMap.set(ws, weekMap.get(ws)! + 1)
    }
    if (weekMap.size > 0) {
      const weeks = [...weekMap.keys()].sort((a, b) => b.localeCompare(a)) // newest first
      let count = 0
      for (const ws of weeks) {
        if (weekMap.get(ws)! >= minSessionsPerWeek) count++
        else break
      }
      streak = count
    }
  }

  // Total rides since plan start (fallback: last 6 weeks)
  let totalRides: number | null = null
  if (activities.length > 0) {
    let baseline: string
    if (planStartDate) {
      baseline = planStartDate
    } else {
      const d = new Date()
      d.setDate(d.getDate() - 42)
      baseline = d.toISOString().split('T')[0]
    }
    const count = activities.filter(a => a.start_date_local.substring(0, 10) >= baseline).length
    if (count > 0) totalRides = count
  }

  return {
    ftp,
    ctl,
    weight,
    adherence,
    streak,
    totalRides,
    planPhase: plan?.phase ?? null,
    targetEvent: plan?.target_event_name ?? null,
    targetDate: plan?.target_event_date ?? null,
    planStartDate,
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles (metrics.ts only)**

```bash
npx tsc --noEmit 2>&1 | grep "lib/progress/metrics"
```

Expected: no errors from `lib/progress/metrics.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/progress/metrics.ts
git commit -m "feat: add streak and totalRides to computeProgressMetrics, remove wkg"
```

---

## Task 3: Update `lib/progress/metrics.ts` tests

**Files:**
- Modify: `cycling-coach/__tests__/lib/progress-metrics.test.ts`

- [ ] **Step 1: Replace the test file**

Replace the entire contents of `cycling-coach/__tests__/lib/progress-metrics.test.ts` with:

```typescript
import { computeProgressMetrics } from '@/lib/progress/metrics'
import type { ICUActivity, ICUWellness, WeightEntry } from '@/types'

const baseWellness = {
  atl: 60, form: -5, hrv: null, resting_hr: null, sleep_secs: null,
  body_battery_low: null, body_battery_high: null, stress_avg: null,
  stress_high: null, garmin_training_load: null, sleep_score: null,
}

const wellness: ICUWellness[] = [
  { id: '2026-04-01', ctl: 55, ...baseWellness },
  { id: '2026-06-13', ctl: 70, ...baseWellness },
]

const weightLog: WeightEntry[] = [
  { id: 'w1', date: '2026-04-01', weight_kg: 75.0 },
  { id: 'w2', date: '2026-06-13', weight_kg: 73.5 },
]

const plan = {
  created_at: '2026-04-01T00:00:00Z',
  baseline_ftp: 230,
  phase: 'build',
  target_event_name: 'Dragon Ride',
  target_event_date: '2026-09-01',
}

// Helper to build a minimal ICUActivity fixture
function act(date: string): ICUActivity {
  return { start_date_local: `${date}T09:00:00`, category: 'WORKOUT', name: 'Ride' } as ICUActivity
}

describe('computeProgressMetrics', () => {
  it('computes FTP delta from baseline_ftp', () => {
    const result = computeProgressMetrics([], 245, 73.5, plan, [], [])
    expect(result.ftp).toEqual({ current: 245, baseline: 230, delta: 15 })
  })

  it('returns null ftp when plan has no baseline_ftp', () => {
    const result = computeProgressMetrics([], 245, 73.5, { ...plan, baseline_ftp: null }, [], [])
    expect(result.ftp).toBeNull()
  })

  it('returns null ftp when there is no plan', () => {
    const result = computeProgressMetrics([], 245, 73.5, null, [], [])
    expect(result.ftp).toBeNull()
  })

  it('computes CTL delta from wellness array relative to plan start', () => {
    const result = computeProgressMetrics(wellness, 245, 73.5, plan, [], [])
    expect(result.ctl).toEqual({ current: 70, baseline: 55, delta: 15 })
  })

  it('computes CTL delta using oldest entry when no plan', () => {
    const result = computeProgressMetrics(wellness, 245, 73.5, null, [], [])
    expect(result.ctl).toEqual({ current: 70, baseline: 55, delta: 15 })
  })

  it('returns null CTL when wellness is empty', () => {
    const result = computeProgressMetrics([], 245, 73.5, plan, [], [])
    expect(result.ctl).toBeNull()
  })

  it('computes weight delta against plan start entry', () => {
    const result = computeProgressMetrics([], 245, 73.5, plan, weightLog, [])
    expect(result.weight).toEqual({ current: 73.5, baseline: 75.0, delta: -1.5 })
  })

  it('computes adherence from completed workouts up to today', () => {
    const workouts = [
      { status: 'completed' as const, date: '2026-05-01' },
      { status: 'completed' as const, date: '2026-05-03' },
      { status: 'skipped' as const, date: '2026-05-05' },
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], workouts)
    expect(result.adherence).toEqual({ completed: 2, total: 3 })
  })

  it('returns null adherence when there is no plan', () => {
    const result = computeProgressMetrics([], 245, 73.5, null, [], [])
    expect(result.adherence).toBeNull()
  })

  it('exposes planPhase and targetEvent from plan', () => {
    const result = computeProgressMetrics([], 245, 73.5, plan, [], [])
    expect(result.planPhase).toBe('build')
    expect(result.targetEvent).toBe('Dragon Ride')
    expect(result.targetDate).toBe('2026-09-01')
    expect(result.planStartDate).toBe('2026-04-01')
  })

  it('does not expose wkg', () => {
    const result = computeProgressMetrics([], 245, 73.5, plan, weightLog, [])
    expect(result).not.toHaveProperty('wkg')
  })

  // Streak tests
  // Weeks below use Mon-Sun. Mar 2 2026 is a Monday.
  it('computes streak of consecutive hit weeks, stopping at a miss', () => {
    const workouts = [
      // Week of Mar 2 — HIT (3 completed)
      { status: 'completed' as const, date: '2026-03-02' },
      { status: 'completed' as const, date: '2026-03-03' },
      { status: 'completed' as const, date: '2026-03-04' },
      // Week of Mar 9 — MISS (2 completed)
      { status: 'completed' as const, date: '2026-03-09' },
      { status: 'completed' as const, date: '2026-03-10' },
      { status: 'skipped' as const, date: '2026-03-12' },
      // Week of Mar 16 — HIT (3 completed)
      { status: 'completed' as const, date: '2026-03-16' },
      { status: 'completed' as const, date: '2026-03-17' },
      { status: 'completed' as const, date: '2026-03-18' },
      // Week of Mar 23 — HIT (3 completed)
      { status: 'completed' as const, date: '2026-03-23' },
      { status: 'completed' as const, date: '2026-03-24' },
      { status: 'completed' as const, date: '2026-03-25' },
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], workouts, [], 3)
    expect(result.streak).toBe(2) // Mar 16 + Mar 23 consecutive; Mar 9 breaks it
  })

  it('returns 0 streak when most recent past week was a miss', () => {
    const workouts = [
      // Week of Mar 9 — HIT
      { status: 'completed' as const, date: '2026-03-09' },
      { status: 'completed' as const, date: '2026-03-10' },
      { status: 'completed' as const, date: '2026-03-11' },
      // Week of Mar 16 — MISS (only 1 completed)
      { status: 'completed' as const, date: '2026-03-16' },
      { status: 'skipped' as const, date: '2026-03-17' },
      { status: 'skipped' as const, date: '2026-03-18' },
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], workouts, [], 3)
    expect(result.streak).toBe(0)
  })

  it('returns null streak when there is no plan', () => {
    const result = computeProgressMetrics([], 245, 73.5, null, [], [], [], 3)
    expect(result.streak).toBeNull()
  })

  it('returns null streak when there are no planWorkouts', () => {
    const result = computeProgressMetrics([], 245, 73.5, plan, [], [], [], 3)
    expect(result.streak).toBeNull()
  })

  // Rides tests
  it('counts activities since plan start', () => {
    const activities = [
      act('2026-04-02'), // after plan start (2026-04-01) → counted
      act('2026-04-15'), // after → counted
      act('2026-03-15'), // before → not counted
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], [], activities, 3)
    expect(result.totalRides).toBe(2)
  })

  it('returns null totalRides when activities array is empty', () => {
    const result = computeProgressMetrics([], 245, 73.5, plan, [], [], [], 3)
    expect(result.totalRides).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
npm test -- --testPathPatterns=progress-metrics
```

Expected: all tests pass (13 tests total).

- [ ] **Step 3: Commit**

```bash
git add __tests__/lib/progress-metrics.test.ts
git commit -m "test: update metrics tests — remove wkg, add streak and rides"
```

---

## Task 4: Remove `wkg` from `lib/claude/progress-brief.ts` and its tests

**Files:**
- Modify: `cycling-coach/lib/claude/progress-brief.ts`
- Modify: `cycling-coach/__tests__/lib/claude-progress-brief.test.ts`

- [ ] **Step 1: Remove the wkg block from progress-brief.ts**

In `lib/claude/progress-brief.ts`, find and remove these lines from the `generateProgressBrief` function:

```typescript
  if (metrics.wkg) {
    const dir = metrics.wkg.delta >= 0 ? '+' : ''
    lines.push(`Power-to-weight: ${metrics.wkg.current} w/kg (was ${metrics.wkg.baseline}, ${dir}${metrics.wkg.delta})`)
  }
```

- [ ] **Step 2: Remove `wkg: null` from the test mock**

In `__tests__/lib/claude-progress-brief.test.ts`, find the `metrics` const and remove the `wkg: null,` line:

```typescript
const metrics = {
  ftp: { current: 245, baseline: 230, delta: 15 },
  ctl: { current: 70, baseline: 55, delta: 15 },
  // wkg: null, ← remove this line
  weight: null,
  adherence: { completed: 14, total: 16 },
  streak: null,        // ← add this
  totalRides: null,    // ← add this
  planPhase: 'build',
  targetEvent: 'Dragon Ride',
  targetDate: '2026-09-01',
  planStartDate: '2026-04-01',
}
```

- [ ] **Step 3: Run the tests**

```bash
npm test -- --testPathPatterns=claude-progress-brief
```

Expected: 4 tests pass.

- [ ] **Step 4: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: `lib/claude/progress-brief.ts` error on `metrics.wkg` is gone. Only remaining `wkg` errors should be in `ProgressBrief.tsx` (to be deleted) and `ProgressBrief.test.tsx` (to be deleted).

- [ ] **Step 5: Commit**

```bash
git add lib/claude/progress-brief.ts __tests__/lib/claude-progress-brief.test.ts
git commit -m "feat: remove wkg from progress brief prompt and tests"
```

---

## Task 5: Update `lib/progress/brief-generator.ts` and sync route

**Files:**
- Modify: `cycling-coach/lib/progress/brief-generator.ts`
- Modify: `cycling-coach/app/api/sync/route.ts`

- [ ] **Step 1: Update `BriefProfile` and `maybeGenerateProgressBrief`**

In `lib/progress/brief-generator.ts`, update `BriefProfile` to include `min_sessions_per_week`:

```typescript
interface BriefProfile {
  current_ftp: number
  weight_kg: number
  goals: string
  min_sessions_per_week: number
}
```

Then update the `computeProgressMetrics` call to pass the new params. Find:

```typescript
  const metrics = computeProgressMetrics(
    syncData.wellness,
    profile.current_ftp,
    profile.weight_kg,
    plan ?? null,
    weightLog,
    planWorkouts,
  )
```

Replace with:

```typescript
  const metrics = computeProgressMetrics(
    syncData.wellness,
    profile.current_ftp,
    profile.weight_kg,
    plan ?? null,
    weightLog,
    planWorkouts,
    syncData.activities,
    profile.min_sessions_per_week,
  )
```

- [ ] **Step 2: Update the profile SELECT in `app/api/sync/route.ts`**

In `app/api/sync/route.ts`, find the profile SELECT:

```typescript
  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp, weight_kg, goals')
    .maybeSingle()
```

Replace with:

```typescript
  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp, weight_kg, goals, min_sessions_per_week')
    .maybeSingle()
```

- [ ] **Step 3: Update the `maybeGenerateProgressBrief` call in sync route**

Find the brief generation block:

```typescript
      await maybeGenerateProgressBrief(supabase, user.id, syncData, {
        current_ftp: profile.current_ftp,
        weight_kg: profile.weight_kg,
        goals: profile.goals ?? '',
      })
```

Replace with:

```typescript
      await maybeGenerateProgressBrief(supabase, user.id, syncData, {
        current_ftp: profile.current_ftp,
        weight_kg: profile.weight_kg,
        goals: profile.goals ?? '',
        min_sessions_per_week: profile.min_sessions_per_week ?? 3,
      })
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "ProgressBrief"
```

Expected: no errors outside of the ProgressBrief files (which are being deleted in Task 6).

- [ ] **Step 5: Commit**

```bash
git add lib/progress/brief-generator.ts app/api/sync/route.ts
git commit -m "feat: pass activities and min_sessions_per_week to computeProgressMetrics"
```

---

## Task 6: Create `ProgressStats` component (TDD) and delete `ProgressBrief`

**Files:**
- Create: `cycling-coach/components/ProgressStats.tsx`
- Create: `cycling-coach/__tests__/components/ProgressStats.test.tsx`
- Delete: `cycling-coach/components/ProgressBrief.tsx`
- Delete: `cycling-coach/__tests__/components/ProgressBrief.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `cycling-coach/__tests__/components/ProgressStats.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import ProgressStats from '@/components/ProgressStats'

const mockFetch = jest.fn()
global.fetch = mockFetch

const briefData = {
  content: 'Your CTL has grown 15 points since starting this plan.',
  metrics_snapshot: {
    ftp: { current: 245, baseline: 230, delta: 15 },
    ctl: { current: 70, baseline: 55, delta: 15 },
    weight: { current: 73.5, baseline: 75.0, delta: -1.5 },
    adherence: { completed: 14, total: 16 },
    streak: 5,
    totalRides: 47,
    planPhase: 'build',
    targetEvent: 'Dragon Ride',
    targetDate: '2026-09-01',
    planStartDate: '2026-04-01',
  },
  generated_at: new Date(Date.now() - 600000).toISOString(),
}

beforeEach(() => mockFetch.mockReset())

describe('ProgressStats', () => {
  it('renders FTP tile with positive delta', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} />)
    expect(await screen.findByText('245W')).toBeInTheDocument()
    expect(await screen.findByText('+15W')).toBeInTheDocument()
  })

  it('renders fitness (CTL) tile', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} />)
    expect(await screen.findByText('70')).toBeInTheDocument()
    expect(await screen.findByText('+15pts')).toBeInTheDocument()
  })

  it('renders sessions adherence tile', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} />)
    expect(await screen.findByText('14/16')).toBeInTheDocument()
    expect(await screen.findByText('88%')).toBeInTheDocument()
  })

  it('renders streak tile', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} />)
    expect(await screen.findByText('🔥 5')).toBeInTheDocument()
  })

  it('renders rides tile', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} />)
    expect(await screen.findByText('47')).toBeInTheDocument()
  })

  it('renders weight tile with negative delta (green)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} />)
    expect(await screen.findByText('73.5kg')).toBeInTheDocument()
    expect(await screen.findByText('-1.5')).toBeInTheDocument()
  })

  it('does not render the coaching narrative text', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} />)
    await screen.findByText('245W') // wait for data to load
    expect(screen.queryByText(/CTL has grown 15 points/)).not.toBeInTheDocument()
  })

  it('renders nothing when API returns null', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => null })
    const { container } = render(<ProgressStats syncVersion={0} />)
    await waitFor(() => expect(container.firstChild).toBeNull())
  })

  it('re-fetches when syncVersion changes', async () => {
    const updated = { ...briefData, metrics_snapshot: { ...briefData.metrics_snapshot, ftp: { current: 250, baseline: 230, delta: 20 } } }
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => briefData })
      .mockResolvedValueOnce({ ok: true, json: async () => updated })

    const { rerender } = render(<ProgressStats syncVersion={0} />)
    await screen.findByText('245W')
    rerender(<ProgressStats syncVersion={1} />)
    expect(await screen.findByText('250W')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPatterns=components/ProgressStats
```

Expected: FAIL — `Cannot find module '@/components/ProgressStats'`

- [ ] **Step 3: Create `components/ProgressStats.tsx`**

Create `cycling-coach/components/ProgressStats.tsx`:

```tsx
'use client'
import { useState, useEffect } from 'react'
import type { ProgressMetrics } from '@/types'

interface StatsData {
  metrics_snapshot: ProgressMetrics
}

interface Props {
  syncVersion: number
}

export default function ProgressStats({ syncVersion }: Props) {
  const [data, setData] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    fetch('/api/progress-brief', { signal: ac.signal })
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { if (e.name !== 'AbortError') setLoading(false) })
    return () => ac.abort()
  }, [syncVersion])

  if (loading) return <div className="h-16 bg-gray-100 rounded-xl animate-pulse" />
  if (!data) return null

  const m = data.metrics_snapshot
  if (!m.ftp && !m.ctl && !m.adherence && m.streak == null && m.totalRides == null && !m.weight) return null

  return (
    <div className="grid grid-cols-3 gap-1">
      {m.ftp && (
        <Tile label="FTP" value={`${m.ftp.current}W`} delta={m.ftp.delta} deltaSuffix="W" goodWhenPositive />
      )}
      {m.ctl && (
        <Tile label="Fitness" value={String(m.ctl.current)} delta={m.ctl.delta} deltaSuffix="pts" goodWhenPositive />
      )}
      {m.adherence && m.adherence.total > 0 && (
        <Tile
          label="Sessions"
          value={`${m.adherence.completed}/${m.adherence.total}`}
          pct={Math.round((m.adherence.completed / m.adherence.total) * 100)}
        />
      )}
      {m.streak != null && (
        <Tile label="Streak" value={`🔥 ${m.streak}`} sub="weeks" />
      )}
      {m.totalRides != null && (
        <Tile label="Rides" value={String(m.totalRides)} sub="since plan" />
      )}
      {m.weight && (
        <Tile label="Weight" value={`${m.weight.current}kg`} delta={m.weight.delta} goodWhenPositive={false} />
      )}
    </div>
  )
}

interface TileProps {
  label: string
  value: string
  delta?: number
  goodWhenPositive?: boolean
  pct?: number
  sub?: string
  deltaSuffix?: string
}

function Tile({ label, value, delta, goodWhenPositive, pct, sub, deltaSuffix = '' }: TileProps) {
  let badge = ''
  let badgeColour = 'text-gray-400'

  if (pct !== undefined) {
    badge = `${pct}%`
    badgeColour = pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-500' : 'text-red-500'
  } else if (sub) {
    badge = sub
  } else if (delta !== undefined && delta !== 0) {
    badge = `${delta > 0 ? '+' : ''}${delta}${deltaSuffix}`
    const isGood = goodWhenPositive ? delta > 0 : delta < 0
    badgeColour = isGood ? 'text-emerald-600' : 'text-amber-500'
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 px-2 py-1.5 text-center">
      <div className="text-[8px] font-medium text-gray-400 uppercase tracking-wide truncate">{label}</div>
      <div className="text-[13px] font-bold text-gray-900 leading-tight">{value}</div>
      {badge && <div className={`text-[9px] font-semibold ${badgeColour}`}>{badge}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPatterns=components/ProgressStats
```

Expected: PASS — 9 tests pass. Fix implementation if any fail; do not modify test file.

- [ ] **Step 5: Delete the old component and tests**

```bash
rm "components/ProgressBrief.tsx"
rm "__tests__/components/ProgressBrief.test.tsx"
```

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
npm test
```

Expected: all tests pass (the deleted ProgressBrief tests are gone; 9 new ProgressStats tests pass).

- [ ] **Step 7: Commit**

```bash
git add components/ProgressStats.tsx __tests__/components/ProgressStats.test.tsx
git rm components/ProgressBrief.tsx __tests__/components/ProgressBrief.test.tsx
git commit -m "feat: add ProgressStats component, remove ProgressBrief"
```

---

## Task 7: Update `app/dashboard/page.tsx`

**Files:**
- Modify: `cycling-coach/app/dashboard/page.tsx`

- [ ] **Step 1: Replace the ProgressBrief import**

Find at the top of `app/dashboard/page.tsx`:

```typescript
import ProgressBrief from '@/components/ProgressBrief'
```

Replace with:

```typescript
import ProgressStats from '@/components/ProgressStats'
```

- [ ] **Step 2: Remove ProgressBrief from the top of the JSX return**

In the `return` block, find and remove:

```tsx
<ProgressBrief syncVersion={syncVersion} />
```

(This is the first child inside `<div className="max-w-3xl mx-auto space-y-6">`)

- [ ] **Step 3: Add ProgressStats below the MetricsBar section**

Find the MetricsBar section closing brace (the `)}` that closes `{latestWellnessWithLoad && (...`):

```tsx
      {latestWellnessWithLoad && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden divide-y divide-gray-200">
          <MetricsBar ... />
          <HrvStatusChip embedded />
          <CtlTrendStrip embedded chartsData={chartsData} />
        </div>
      )}
```

Add `<ProgressStats syncVersion={syncVersion} />` immediately after the closing `)}` of that block, before the `<div>` for "This week":

```tsx
      {latestWellnessWithLoad && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden divide-y divide-gray-200">
          <MetricsBar ... />
          <HrvStatusChip embedded />
          <CtlTrendStrip embedded chartsData={chartsData} />
        </div>
      )}

      <ProgressStats syncVersion={syncVersion} />

      <div>
        <div className="flex items-baseline justify-between mb-0.5">
          <h2 className="text-lg font-bold tracking-tight text-gray-900">This week</h2>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: move ProgressStats below Today and Strain on dashboard"
```

---

## Task 8: Add coaching brief to `app/plan/page.tsx`

**Files:**
- Modify: `cycling-coach/app/plan/page.tsx`

- [ ] **Step 1: Add state and fetch for the coaching brief**

In `app/plan/page.tsx`, find the block where other `useState` declarations live near the top of the component function (look for lines like `const [planChatOpen, setPlanChatOpen] = useState(false)`). Add after the last `useState` in that group:

```typescript
const [coachBrief, setCoachBrief] = useState<{ content: string; generated_at: string } | null>(null)
```

Then find the block where `useEffect` calls live (look for effects that fetch plan data). Add a new effect after them:

```typescript
useEffect(() => {
  fetch('/api/progress-brief')
    .then(r => r.ok ? r.json() : null)
    .then(d => setCoachBrief(d ? { content: d.content, generated_at: d.generated_at } : null))
    .catch(() => {})
}, [])
```

- [ ] **Step 2: Add the `formatTimeAgo` helper**

Add this function near the bottom of the file, before the `return` statement of the page component (or as a module-level function after the component):

```typescript
function formatTimeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
```

- [ ] **Step 3: Render the coaching brief between active plan box and ConsistencyStrip**

In the JSX inside the `return`, find the closing `</div>` of the blue gradient active plan box (the one ending with `</div>` just before the `{totalPlanned > 0 && (<ConsistencyStrip` line). Add the coaching brief immediately after that closing tag:

```tsx
              </div>  {/* ← end of blue active plan box */}

              {coachBrief && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="text-sm text-green-900 leading-relaxed">{coachBrief.content}</p>
                  <p className="text-xs text-green-500 mt-2">Updated {formatTimeAgo(coachBrief.generated_at)}</p>
                </div>
              )}

              {totalPlanned > 0 && (
                <ConsistencyStrip hitPct={cons.hitPct} streak={cons.streak} hours={hours} />
              )}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass. No regressions.

- [ ] **Step 6: Commit**

```bash
git add app/plan/page.tsx
git commit -m "feat: add coaching brief to plan page under active plan box"
```

---

## Self-Review

**Spec coverage:**
- ✅ `wkg` removed from `ProgressMetrics`
- ✅ `streak` and `totalRides` added to `ProgressMetrics`
- ✅ `computeProgressMetrics` gets `activities` and `minSessionsPerWeek` optional params
- ✅ Streak = consecutive weeks hitting ≥ `min_sessions_per_week`; current week excluded; null if no plan
- ✅ Rides = count activities since plan start (6-week fallback); null if no activities
- ✅ `ProgressBrief.tsx` deleted; `ProgressStats.tsx` created (compact 6-tile grid, no narrative)
- ✅ Dashboard: ProgressStats below Today + MetricsBar section; above This Week
- ✅ Plan page: green coaching brief card between active plan box and ConsistencyStrip
- ✅ Tile order: FTP, Fitness, Sessions (row 1) / Streak, Rides, Weight (row 2)
- ✅ Compact sizing: `text-[8px]` labels, `text-[13px]` values, `px-2 py-1.5` padding
- ✅ `min_sessions_per_week` fetched from `user_profile` in sync route and passed through

**Type consistency:**
- `ProgressMetrics.streak: number | null` ✅ — set in metrics.ts, read in ProgressStats.tsx
- `ProgressMetrics.totalRides: number | null` ✅ — set in metrics.ts, read in ProgressStats.tsx
- FTP delta badge rendered as `+15W` (deltaSuffix="W") ✅ — matches test expectation `+15W`
- CTL delta badge rendered as `+15pts` (deltaSuffix="pts") ✅ — matches test expectation `+15pts`

**Placeholder scan:** None found.
