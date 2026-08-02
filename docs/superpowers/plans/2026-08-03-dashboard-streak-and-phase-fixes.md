# Dashboard Streak & Phase Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two root-caused bugs found during investigation — the dashboard's top "STREAK" tile using a stale adherence-based metric instead of the real activity streak, and the dashboard's phase pill being a hardcoded "Base phase" string never wired to real data — and reposition the streak badge alongside the now-real phase pill.

**Architecture:** No new endpoints or schema changes. The streak tile fix swaps its data source from a server-computed, plan-adherence-threshold metric (`metrics_snapshot.streak`, now confirmed unused anywhere else and dead-code-eligible) to the same client-side `computeWeeklyStreak` already powering the correct "43 wks" display. The phase fix adds one new pure function to the existing `lib/plan/phases.ts` module (reusing `buildWeekBuckets`/`resolvePhases`, which already correctly compute per-week phases on the `/plan` page) and wires it into the dashboard, which currently fetches the plan data needed but discards the relevant fields.

**Tech Stack:** Next.js App Router, React, TypeScript, Jest + React Testing Library.

## Global Constraints

- Root cause investigation for both bugs is already complete (see conversation) — this plan implements the agreed fixes, it does not re-investigate
- User's decision: the top "STREAK" tile must be changed to match the "any activity this week" definition already used everywhere else — not relabeled, not kept as a separate metric
- The old adherence-based streak computation (`lib/progress/metrics.ts`, `app/api/progress-brief/route.ts`'s fallback) becomes fully unused after this fix and must be removed, not left as dead code (confirmed via grep: `metrics_snapshot.streak` has no other consumer)
- The new phase computation must produce identical results to the `/plan` page's existing (correct) per-week phase logic — reuse `buildWeekBuckets`/`resolvePhases` directly, do not reimplement
- Run `npm run typecheck` before committing any task that touches `.ts`/`.tsx` files — Jest does not surface TypeScript errors (per `AGENTS.md`)

---

### Task 1: Fix the top STREAK tile; remove the dead adherence-based streak

**Files:**
- Modify: `components/ProgressStats.tsx:55` (hasSeasonStats), `:160-162` (Tile)
- Modify: `lib/progress/metrics.ts` (remove streak computation, `getWeekStart`, `minSessionsPerWeek` param)
- Modify: `lib/progress/brief-generator.ts:60-67` (drop the now-removed argument)
- Modify: `app/api/progress-brief/route.ts` (remove the dead fallback-recompute block and simplify the query)
- Modify: `types/index.ts:415` (remove `streak` from `ProgressMetrics`)
- Test: `__tests__/components/ProgressStats.test.tsx` (replace the streak-tile test), `__tests__/lib/progress-metrics.test.ts` (remove streak tests)

**Interfaces:**
- Consumes: `computeWeeklyStreak` (already exported, unchanged, from `lib/streak.ts`) — this task only changes *which* pre-existing local variable a Tile reads (`streakWeeks`, already computed at `ProgressStats.tsx:63`)
- Produces: nothing new for other tasks — this task is self-contained

- [ ] **Step 1: Write the failing test**

In `__tests__/components/ProgressStats.test.tsx`, add these two imports after line 1 (`import ProgressStats from '@/components/ProgressStats'`):

```typescript
import { localDateStr } from '@/lib/local-date'
import { isoWeekStart } from '@/lib/chart-helpers'
```

Remove `streak: 5,` from the `briefData.metrics_snapshot` object (currently line 14).

Replace the existing test at lines 48-52:

```typescript
  it('renders streak tile', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    render(<ProgressStats syncVersion={0} />)
    expect(await screen.findByText('🔥 5')).toBeInTheDocument()
  })
```

with:

```typescript
  it('renders streak tile using the real activity streak, not the old adherence-based one', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
    const today = localDateStr(new Date())
    const monday = isoWeekStart(today)
    function addDays(dateStr: string, n: number): string {
      const d = new Date(dateStr + 'T00:00:00Z')
      d.setUTCDate(d.getUTCDate() + n)
      return d.toISOString().slice(0, 10)
    }
    const activities = [
      { date: monday, type: 'Ride', distanceM: 20000, elevationM: 200, movingTimeSecs: 3600 },
      { date: addDays(monday, -7), type: 'Ride', distanceM: 20000, elevationM: 200, movingTimeSecs: 3600 },
      { date: addDays(monday, -14), type: 'Ride', distanceM: 20000, elevationM: 200, movingTimeSecs: 3600 },
    ]
    render(<ProgressStats syncVersion={0} activities={activities} />)
    await screen.findByText('245W')
    expect(await screen.findByText('🔥 3')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/ProgressStats.test.tsx -t "real activity streak"`
Expected: FAIL — the tile still reads `m.streak` (undefined, since the fixture no longer has it), so the text `🔥 3` is never rendered

- [ ] **Step 3: Fix the Tile and its visibility condition**

In `components/ProgressStats.tsx`, replace line 55:

```typescript
  const hasSeasonStats = data && (data.metrics_snapshot.ftp || data.metrics_snapshot.ctl || data.metrics_snapshot.adherence || data.metrics_snapshot.streak != null || data.metrics_snapshot.weight || data.metrics_snapshot.totalRides != null)
```

with:

```typescript
  const hasSeasonStats = data && (data.metrics_snapshot.ftp || data.metrics_snapshot.ctl || data.metrics_snapshot.adherence || (activities?.length ?? 0) > 0 || data.metrics_snapshot.weight || data.metrics_snapshot.totalRides != null)
```

Replace lines 160-162:

```tsx
          {m.streak != null && (
            <Tile label="Streak" value={m.streak > 0 ? `🔥 ${m.streak}` : `${m.streak}`} sub="weeks" />
          )}
```

with:

```tsx
          {activities && activities.length > 0 && (
            <Tile label="Streak" value={streakWeeks > 0 ? `🔥 ${streakWeeks}` : `${streakWeeks}`} sub="weeks" />
          )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/ProgressStats.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Remove the dead adherence-based streak computation**

In `lib/progress/metrics.ts`, remove the `getWeekStart` function (currently lines 18-23, including the blank line after it):

```typescript
function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const dow = d.getDay() // 0=Sun, 1=Mon…6=Sat
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  return d.toISOString().split('T')[0]
}

```

Remove the `minSessionsPerWeek` parameter from `computeProgressMetrics`'s signature — replace:

```typescript
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
```

with:

```typescript
export function computeProgressMetrics(
  wellness: ICUWellness[],
  currentFTP: number,
  currentWeightKg: number,
  plan: PlanInfo | null,
  weightLog: WeightEntry[],
  planWorkouts: PlanWorkout[],
  activities: ICUActivity[] = [],
): ProgressMetrics {
```

Remove the streak computation block (the comment through its closing brace, plus the trailing blank line before the next comment):

```typescript
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

```

Remove `streak,` from the returned object (currently in the `return { ftp, ctl, weight, adherence, streak, totalRides, ... }` statement) — replace:

```typescript
  return {
    ftp,
    ctl,
    weight,
    adherence,
    streak,
    totalRides,
```

with:

```typescript
  return {
    ftp,
    ctl,
    weight,
    adherence,
    totalRides,
```

- [ ] **Step 6: Update the one caller of `computeProgressMetrics`**

In `lib/progress/brief-generator.ts`, replace the call (currently lines 60-67):

```typescript
  const metrics = computeProgressMetrics(
    syncData.wellness,
    profile.current_ftp,
    profile.weight_kg,
    plan ?? null,
    weightLog,
    planWorkouts,
    ridesActivities,
    profile.min_sessions_per_week,
  )
```

with:

```typescript
  const metrics = computeProgressMetrics(
    syncData.wellness,
    profile.current_ftp,
    profile.weight_kg,
    plan ?? null,
    weightLog,
    planWorkouts,
    ridesActivities,
  )
```

- [ ] **Step 7: Remove `streak` from the `ProgressMetrics` type**

In `types/index.ts`, replace line 415:

```typescript
  streak: number | null
```

by deleting it entirely (remove the line; `adherence` on the line above and `totalRides` on the line below remain, now adjacent).

- [ ] **Step 8: Simplify the now-dead fallback in the progress-brief route**

Replace the entire content of `app/api/progress-brief/route.ts` with:

```typescript
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('progress_briefs')
    .select('content, metrics_snapshot, generated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data) return NextResponse.json(null)

  return NextResponse.json(data)
}
```

(This removes the `plan`/`profile` fetches, the `computeStreak`/`getWeekStart` helpers, and the fallback-recompute block — all were solely in service of the now-removed `streak` field, confirmed via grep to have no other use in this file.)

- [ ] **Step 9: Remove the dead streak tests**

In `__tests__/lib/progress-metrics.test.ts`, remove lines 142-191 (from the `// Streak tests` comment through the blank line after `'returns null streak when there are no planWorkouts'`'s closing `})`), leaving the `// Rides tests` comment (currently line 192) as the next section.

Also update the two remaining calls that passed the now-removed 8th argument — search this file for `plan, [], workouts, [], 3)` and `plan, [], [], [], 3)`; these only existed within the block just removed, so no other call sites in this file pass an 8th argument (verify with `grep -n ", 3)" __tests__/lib/progress-metrics.test.ts` — expect no matches after the removal).

- [ ] **Step 10: Run the full test suite for this task's files**

Run: `npx jest __tests__/components/ProgressStats.test.tsx __tests__/lib/progress-metrics.test.ts`
Expected: PASS (all tests)

- [ ] **Step 11: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 12: Commit**

```bash
git add components/ProgressStats.tsx lib/progress/metrics.ts lib/progress/brief-generator.ts app/api/progress-brief/route.ts types/index.ts __tests__/components/ProgressStats.test.tsx __tests__/lib/progress-metrics.test.ts
git commit -m "Fix the STREAK tile to use the real activity streak; remove the dead adherence-based one"
```

---

### Task 2: Add a shared `getCurrentPhase` helper

**Files:**
- Modify: `lib/plan/phases.ts` (add new exported function)
- Test: `__tests__/lib/plan-phases.test.ts` (add new describe block)

**Interfaces:**
- Consumes: `buildWeekBuckets` (already exported, unchanged, from `lib/plan/progress.ts`), `resolvePhases` (already exported, unchanged, in this same file)
- Produces: `export function getCurrentPhase(workouts: Workout[], activities: ICUActivity[], weekPhases: PlanPhase[] | null | undefined, totalWeeks: number, planStart: string, today: string): PlanPhase` — Task 3 calls this directly

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block to the end of `__tests__/lib/plan-phases.test.ts`:

```typescript

describe('getCurrentPhase', () => {
  const PLAN_START = '2026-01-01T00:00:00Z' // a Thursday

  function workout(date: string): Workout {
    return {
      id: `w-${date}`, plan_id: 'p1', date, type: 'endurance', duration_minutes: 60,
      description: '', target_zones: '', intervals_icu_event_id: null, status: 'planned',
      icu_activity_id: null, tss: null, ftp_at_completion: null, actual_duration_minutes: null,
      missed_reason: null, optional: false, name: null, steps: null, activity_metrics: null,
      coaching_notes: null, created_at: '2026-01-01T00:00:00Z',
    }
  }

  it('returns the phase for the current week using Claude-supplied week_phases', () => {
    // 4-week plan, stored phases base/build/peak/taper. Jan 22 falls in week 4 (Jan 22-28).
    const result = getCurrentPhase(
      [workout('2026-01-01')],
      [],
      ['base', 'build', 'peak', 'taper'],
      4,
      PLAN_START,
      '2026-01-22',
    )
    expect(result).toBe('taper')
  })

  it('clamps to the last week when today is past the plan end', () => {
    const result = getCurrentPhase(
      [workout('2026-01-01')],
      [],
      ['base', 'build', 'peak', 'taper'],
      4,
      PLAN_START,
      '2026-06-01',
    )
    expect(result).toBe('taper')
  })

  it('clamps to the first week when today is before the plan start', () => {
    const result = getCurrentPhase(
      [workout('2026-01-01')],
      [],
      ['base', 'build', 'peak', 'taper'],
      4,
      PLAN_START,
      '2025-12-01',
    )
    expect(result).toBe('base')
  })

  it('falls back to TSS-derived phases when week_phases length does not match totalWeeks', () => {
    // week_phases has only 2 entries for a 4-week plan — resolvePhases falls back to derivePhases.
    // No workouts at all means every week's plannedTss bucket is 0, so derivePhases' peak-detection
    // sees an all-zero profile and returns 'base' for every week (see derivePhases: "if (peak === 0)
    // return phases" where phases defaults to all-'base').
    const result = getCurrentPhase(
      [],
      [],
      ['base', 'build'],
      4,
      PLAN_START,
      '2026-01-08',
    )
    expect(result).toBe('base')
  })
})
```

Add these imports to the top of `__tests__/lib/plan-phases.test.ts` — replace line 1:

```typescript
import { derivePhases, resolvePhases } from '@/lib/plan/phases'
```

with:

```typescript
import { derivePhases, resolvePhases, getCurrentPhase } from '@/lib/plan/phases'
import type { Workout } from '@/types'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/plan-phases.test.ts -t "getCurrentPhase"`
Expected: FAIL — `getCurrentPhase is not a function` (or a TypeScript error that the import doesn't exist)

- [ ] **Step 3: Implement `getCurrentPhase`**

In `lib/plan/phases.ts`, replace line 1:

```typescript
import type { PlanPhase } from '@/types'
```

with:

```typescript
import type { PlanPhase, Workout, ICUActivity } from '@/types'
import { buildWeekBuckets } from './progress'
```

Add this function at the end of the file (after the existing `resolvePhases` function):

```typescript

/** Resolves which phase the current calendar week falls in, for a plan that may not have
 * a live UI displaying every week (unlike the /plan page, which already shows this via
 * buildWeekBuckets + resolvePhases inline). Reuses those same two functions so results are
 * guaranteed identical to the /plan page's own phase display — never reimplement this math
 * separately, that divergence is exactly what caused a previous hardcoded-phase bug. */
export function getCurrentPhase(
  workouts: Workout[],
  activities: ICUActivity[],
  weekPhases: PlanPhase[] | null | undefined,
  totalWeeks: number,
  planStart: string,
  today: string,
): PlanPhase {
  const start = new Date(planStart)
  const now = new Date(today)
  const current = Math.max(1, Math.min(totalWeeks, Math.floor((now.getTime() - start.getTime()) / (7 * 864e5)) + 1))
  const currentWeek = current - 1
  const buckets = buildWeekBuckets(workouts, activities, planStart, totalWeeks)
  const phases = resolvePhases(weekPhases, buckets.map(b => b.plannedTss), totalWeeks)
  return phases[currentWeek] ?? 'base'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/plan-phases.test.ts`
Expected: PASS (all tests in the file, including the new `getCurrentPhase` block)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add lib/plan/phases.ts __tests__/lib/plan-phases.test.ts
git commit -m "Add getCurrentPhase helper, reusing the /plan page's existing phase logic"
```

---

### Task 3: Wire the dashboard's phase pill to real data; reposition the streak badge alongside it

**Files:**
- Modify: `app/dashboard/page.tsx` (capture plan fields, compute phase, replace hardcoded pill, move `StreakBadge`)
- Test: `__tests__/app/dashboard/page.test.tsx` (add new test, extend shared mock fixture)

**Interfaces:**
- Consumes: `getCurrentPhase` (Task 2, `lib/plan/phases.ts`), `StreakBadge` (already exists, unchanged, from `components/StreakBadge.tsx`)
- Produces: nothing further downstream — this is the final task

- [ ] **Step 1: Write the failing test**

In `__tests__/app/dashboard/page.test.tsx`, the shared `mockFetch()`'s `/api/plan` response (currently lines 52-61) needs the new fields the phase computation reads. Replace:

```typescript
    if (u === '/api/plan') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          workouts: [lastWeekWorkout, currentWeekWorkout, nextWeekWorkout, nextWeekWorkout2],
          name: '',
          last_reviewed_week: '9999-W53',
        }),
      })
    }
```

with:

```typescript
    if (u === '/api/plan') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          workouts: [lastWeekWorkout, currentWeekWorkout, nextWeekWorkout, nextWeekWorkout2],
          name: '',
          last_reviewed_week: '9999-W53',
          created_at: shiftDateStr(todayStr, -35), // exactly 5 weeks ago, landing in week 6 of 12 — mid-build
          plan_weeks: 12,
          week_phases: ['base', 'base', 'base', 'base', 'build', 'build', 'build', 'build', 'build', 'peak', 'taper', 'taper'],
        }),
      })
    }
```

Add a new test to the `describe('DashboardPage week navigation', ...)` block, after the existing `it('navigating to a different week does not change the weekly progress stats above the day list', ...)` test (after its closing `})`, before the describe block's closing `})`):

```typescript

  it('shows the real current-week phase, not a hardcoded value', async () => {
    render(<DashboardPage />)
    await screen.findByText('Current week ride')
    expect(screen.getByText('Build phase')).toBeInTheDocument()
    expect(screen.queryByText('Base phase')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/app/dashboard/page.test.tsx -t "real current-week phase"`
Expected: FAIL — the pill still renders the hardcoded text "Base phase", so `getByText('Build phase')` throws "Unable to find an element"

- [ ] **Step 3: Capture the new plan fields into state**

In `app/dashboard/page.tsx`, find the existing `const [planName, setPlanName] = useState('')` declaration (around line 97) and add three new state declarations immediately after it:

```typescript
  const [planName, setPlanName] = useState('')
  const [planWeekPhases, setPlanWeekPhases] = useState<PlanPhase[] | null>(null)
  const [planTotalWeeks, setPlanTotalWeeks] = useState<number | null>(null)
  const [planCreatedAt, setPlanCreatedAt] = useState<string | null>(null)
```

Add the import for `PlanPhase` and `getCurrentPhase`. Replace line 7:

```typescript
import type { ICUSyncData, Workout, ICUWellness, TrainingEvent, ICUActivity, WeightEntry, WeeklyProgress, EventCountdown, WeatherSummary, ActivityWeather } from '@/types'
```

with:

```typescript
import type { ICUSyncData, Workout, ICUWellness, TrainingEvent, ICUActivity, WeightEntry, WeeklyProgress, EventCountdown, WeatherSummary, ActivityWeather, PlanPhase } from '@/types'
import { getCurrentPhase } from '@/lib/plan/phases'
```

In the `loadPlan()` function, find `if (plan.name) setPlanName(plan.name)` (around line 251) and add the three new captures immediately after it:

```typescript
    if (plan.name) setPlanName(plan.name)
    if (plan.week_phases) setPlanWeekPhases(plan.week_phases)
    if (plan.plan_weeks) setPlanTotalWeeks(plan.plan_weeks)
    if (plan.created_at) setPlanCreatedAt(plan.created_at)
```

- [ ] **Step 4: Compute the current phase**

Find the `weeksRemainingInPlan` computation (around line 557-559):

```typescript
  const weeksRemainingInPlan = lastPlannedDate
    ? Math.ceil((new Date(lastPlannedDate).getTime() - new Date(todayStr).getTime()) / (7 * 86400000))
    : null
```

Add immediately after it:

```typescript
  const currentPhase = planCreatedAt && planTotalWeeks
    ? getCurrentPhase(workouts, syncData?.activities ?? [], planWeekPhases, planTotalWeeks, planCreatedAt, todayStr)
    : null
```

- [ ] **Step 5: Replace the hardcoded pill and move the streak badge**

Replace lines 628-645 (the header row containing the plan name, Chat button, and hardcoded phase pill):

```tsx
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {planName && <span className="text-sm text-gray-500">{planName}</span>}
            {planName && (
              <button
                onClick={() => setPlanChatOpen(true)}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-400 rounded-full px-2.5 py-1 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                </svg>
                Chat
              </button>
            )}
            <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              Base phase
            </span>
          </div>
```

with:

```tsx
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {planName && <span className="text-sm text-gray-500">{planName}</span>}
            {planName && (
              <button
                onClick={() => setPlanChatOpen(true)}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-400 rounded-full px-2.5 py-1 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                </svg>
                Chat
              </button>
            )}
            {currentPhase && (
              <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                {currentPhase.charAt(0).toUpperCase() + currentPhase.slice(1)} phase
              </span>
            )}
            <StreakBadge activities={chartsData?.activities} today={todayStr} />
          </div>
```

- [ ] **Step 6: Remove the old badge position above Today's card**

Find the block added by the previous plan (currently lines 680-684):

```tsx
      <div className="space-y-3">
        <StreakBadge activities={chartsData?.activities} today={todayStr} />
        {!notificationsEnabled && (
          <NotificationBanner onEnabled={() => setNotificationsEnabled(true)} />
        )}
```

Replace with (removing just the `<StreakBadge .../>` line, leaving everything else unchanged):

```tsx
      <div className="space-y-3">
        {!notificationsEnabled && (
          <NotificationBanner onEnabled={() => setNotificationsEnabled(true)} />
        )}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest __tests__/app/dashboard/page.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: PASS (no regressions)

- [ ] **Step 10: Commit**

```bash
git add app/dashboard/page.tsx __tests__/app/dashboard/page.test.tsx
git commit -m "Wire the dashboard phase pill to real data and move the streak badge alongside it"
```
