# Progress "Rides Since Start" Count Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the dashboard Progress section's "Rides" tile so it correctly counts every ride since an active plan's start date, for plans of any length, instead of silently being capped at the trailing 6-week sync window.

**Architecture:** `maybeGenerateProgressBrief` (`lib/progress/brief-generator.ts`) gains an `IntervalsClient` parameter and, whenever a plan is active, fetches a plan-scoped activities range (`plan.created_at` → today) directly from intervals.icu instead of relying on the fixed 6-week `syncData.activities` for the rides count. `app/api/sync/route.ts` passes its already-authenticated `client` through to the new parameter. `computeProgressMetrics` (`lib/progress/metrics.ts`) needs no changes — it already accepts whatever activities array it's given.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, intervals.icu REST API, Jest.

## Global Constraints

- `syncData.activities` (the 6-week sync window) continues to drive every other dashboard consumer unchanged — this fix touches only the progress-brief's rides calculation.
- The no-plan fallback (42 days back, using `syncData.activities` directly) is unchanged.
- No new persistent storage of activity history is introduced — the fix is a second, precisely-scoped live fetch, not a cache or database table.
- The full design doc is at `docs/superpowers/specs/2026-07-11-progress-rides-count-since-plan-start-design.md` — read it if any step below is ambiguous.

---

### Task 1: Fetch a plan-scoped activities range for the rides count

**Files:**
- Modify: `lib/progress/brief-generator.ts`
- Modify: `app/api/sync/route.ts:187` (the `maybeGenerateProgressBrief` call site)
- Test: `__tests__/lib/brief-generator.test.ts` (new)

**Interfaces:**
- Modifies: `maybeGenerateProgressBrief(supabase: SupabaseClient, userId: string, syncData: ICUSyncData, profile: BriefProfile, client: IntervalsClient): Promise<void>` — same as today, plus a new required 5th parameter `client`. Every existing caller (there is exactly one, in `app/api/sync/route.ts`) must be updated in this same task or the build fails to typecheck.
- Consumes: `IntervalsClient.getActivities(oldest: string, newest: string): Promise<ICUActivity[]>` (already exists, unchanged, in `lib/intervals/client.ts`). `computeProgressMetrics(...)` (already exists, unchanged, in `lib/progress/metrics.ts`) — this task changes only which `activities` array gets passed as its 7th argument, not the function itself.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/brief-generator.test.ts`:

```ts
import { maybeGenerateProgressBrief } from '@/lib/progress/brief-generator'
import type { ICUActivity, ICUSyncData } from '@/types'

jest.mock('@/lib/claude/progress-brief', () => ({
  generateProgressBrief: jest.fn(async () => 'Great progress this week.'),
}))

function act(date: string, type: string = 'Ride'): ICUActivity {
  return { start_date_local: `${date}T09:00:00`, category: 'WORKOUT', name: 'Ride', type } as unknown as ICUActivity
}

const baseWellness = {
  atl: 60, form: -5, hrv: null, resting_hr: null, sleep_secs: null,
  body_battery_low: null, body_battery_high: null, stress_avg: null,
  stress_high: null, garmin_training_load: null, sleep_score: null,
}

const syncData: ICUSyncData = {
  // Within the trailing 6-week sync window this array always represents.
  activities: [act('2026-06-01'), act('2026-06-15')],
  wellness: [{ id: '2026-06-15', ctl: 60, ...baseWellness }],
  athlete_ftp: null,
  athlete_weight: null,
}

const profile = {
  current_ftp: 245,
  weight_kg: 73.5,
  goals: 'Dragon Ride',
  min_sessions_per_week: 3,
}

function makeSupabase(opts: {
  plan?: { id: string; created_at: string; baseline_ftp: number | null; phase: string; target_event_name: string; target_event_date: string } | null
  upsertSpy?: jest.Mock
}) {
  const { plan = null, upsertSpy = jest.fn(async () => ({ error: null })) } = opts
  return {
    from: (table: string) => {
      if (table === 'progress_briefs') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          upsert: upsertSpy,
        }
      }
      if (table === 'training_plans') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: plan }) }) }) }
      }
      if (table === 'weight_log') {
        return { select: () => ({ eq: () => ({ order: async () => ({ data: [] }) }) }) }
      }
      if (table === 'workouts') {
        return { select: () => ({ eq: async () => ({ data: [] }) }) }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

describe('maybeGenerateProgressBrief — rides count source', () => {
  it('fetches a plan-scoped activities range and uses it for the rides count when a plan is active', async () => {
    const plan = {
      id: 'p1',
      created_at: '2026-04-01T00:00:00Z', // well before the trailing 6-week sync window
      baseline_ftp: 230,
      phase: 'build',
      target_event_name: 'Dragon Ride',
      target_event_date: '2026-09-01',
    }
    const upsertSpy = jest.fn(async () => ({ error: null }))
    const supabase = makeSupabase({ plan, upsertSpy })

    // Includes a ride from before the trailing 6-week sync window (2026-04-10),
    // which syncData.activities does NOT contain — proves the fetched range,
    // not syncData.activities, drives the count.
    const client = {
      getActivities: jest.fn(async () => [act('2026-04-10'), act('2026-06-01'), act('2026-06-15')]),
    }

    await maybeGenerateProgressBrief(supabase as never, 'u1', syncData, profile, client as never)

    expect(client.getActivities).toHaveBeenCalledWith('2026-04-01', expect.any(String))
    expect(upsertSpy).toHaveBeenCalled()
    const [[written]] = upsertSpy.mock.calls
    expect(written.metrics_snapshot.totalRides).toBe(3)
  })

  it('does not call getActivities and uses syncData.activities directly when there is no active plan', async () => {
    // Build activity dates relative to the real "today" so this test can't
    // rot with the calendar — a hardcoded absolute date would eventually
    // fall outside the 42-day no-plan fallback window computeProgressMetrics uses.
    const today = new Date()
    const recent = new Date(today); recent.setDate(today.getDate() - 5)
    const old = new Date(today); old.setDate(today.getDate() - 100)
    const recentStr = recent.toISOString().split('T')[0]
    const oldStr = old.toISOString().split('T')[0]

    const localSyncData: ICUSyncData = { ...syncData, activities: [act(recentStr), act(oldStr)] }

    const upsertSpy = jest.fn(async () => ({ error: null }))
    const supabase = makeSupabase({ plan: null, upsertSpy })
    const client = { getActivities: jest.fn() }

    await maybeGenerateProgressBrief(supabase as never, 'u1', localSyncData, profile, client as never)

    expect(client.getActivities).not.toHaveBeenCalled()
    expect(upsertSpy).toHaveBeenCalled()
    const [[written]] = upsertSpy.mock.calls
    expect(written.metrics_snapshot.totalRides).toBe(1) // only the recent one — from syncData.activities directly
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/brief-generator.test.ts`
Expected: FAIL — Jest transpiles but does not type-check (per this repo's `AGENTS.md`, `tsc --noEmit` is the separate type-check step), so the extra 5th `client` argument is silently accepted at runtime; the failures are behavioral. Test 1 fails because the current implementation never calls `client.getActivities`, so `expect(client.getActivities).toHaveBeenCalledWith(...)` fails, and `totalRides` comes out as 2 (from `syncData.activities`) instead of the expected 3. Test 2 passes coincidentally today (nothing calls `getActivities` yet either way) but will start failing once Step 3 is implemented if the no-plan branch is wired wrong — keep it in the same failing/passing cycle for symmetry.

- [ ] **Step 3: Update `lib/progress/brief-generator.ts`**

Read the file first — it currently looks like this in full:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeProgressMetrics } from './metrics'
import { generateProgressBrief } from '@/lib/claude/progress-brief'
import type { ICUSyncData, WeightEntry, WorkoutStatus } from '@/types'

const DEBOUNCE_HOURS = 4

interface BriefProfile {
  current_ftp: number
  weight_kg: number
  goals: string
  min_sessions_per_week: number
}

export async function maybeGenerateProgressBrief(
  supabase: SupabaseClient,
  userId: string,
  syncData: ICUSyncData,
  profile: BriefProfile,
): Promise<void> {
  // Check debounce
  const { data: existing } = await supabase
    .from('progress_briefs')
    .select('generated_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing?.generated_at) {
    const hoursSince = (Date.now() - new Date(existing.generated_at).getTime()) / 3600000
    if (hoursSince < DEBOUNCE_HOURS) return
  }

  // Fetch plan and weight log
  const [{ data: plan }, { data: rawWeightLog }] = await Promise.all([
    supabase
      .from('training_plans')
      .select('id, created_at, baseline_ftp, phase, target_event_name, target_event_date')
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('weight_log')
      .select('id, date, weight_kg')
      .eq('user_id', userId)
      .order('date', { ascending: false }),
  ])

  const weightLog: WeightEntry[] = (rawWeightLog ?? []) as WeightEntry[]

  let planWorkouts: Array<{ status: WorkoutStatus; date: string }> = []
  if (plan) {
    const { data: workouts } = await supabase
      .from('workouts')
      .select('status, date')
      .eq('plan_id', plan.id)
    planWorkouts = (workouts ?? []) as Array<{ status: WorkoutStatus; date: string }>
  }

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

  const content = await generateProgressBrief({ metrics, goals: profile.goals ?? '' })
  if (!content) return

  await supabase
    .from('progress_briefs')
    .upsert(
      {
        user_id: userId,
        content,
        metrics_snapshot: metrics,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
}
```

Replace the whole file with:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeProgressMetrics } from './metrics'
import { generateProgressBrief } from '@/lib/claude/progress-brief'
import type { IntervalsClient } from '@/lib/intervals/client'
import type { ICUSyncData, WeightEntry, WorkoutStatus } from '@/types'

const DEBOUNCE_HOURS = 4

interface BriefProfile {
  current_ftp: number
  weight_kg: number
  goals: string
  min_sessions_per_week: number
}

export async function maybeGenerateProgressBrief(
  supabase: SupabaseClient,
  userId: string,
  syncData: ICUSyncData,
  profile: BriefProfile,
  client: IntervalsClient,
): Promise<void> {
  // Check debounce
  const { data: existing } = await supabase
    .from('progress_briefs')
    .select('generated_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing?.generated_at) {
    const hoursSince = (Date.now() - new Date(existing.generated_at).getTime()) / 3600000
    if (hoursSince < DEBOUNCE_HOURS) return
  }

  // Fetch plan and weight log
  const [{ data: plan }, { data: rawWeightLog }] = await Promise.all([
    supabase
      .from('training_plans')
      .select('id, created_at, baseline_ftp, phase, target_event_name, target_event_date')
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('weight_log')
      .select('id, date, weight_kg')
      .eq('user_id', userId)
      .order('date', { ascending: false }),
  ])

  const weightLog: WeightEntry[] = (rawWeightLog ?? []) as WeightEntry[]

  let planWorkouts: Array<{ status: WorkoutStatus; date: string }> = []
  // syncData.activities is always just the trailing 6-week sync window, which
  // undercounts "rides since start" once a plan has run longer than that — so
  // whenever a plan is active, fetch its full actual duration directly instead.
  let ridesActivities = syncData.activities
  if (plan) {
    const { data: workouts } = await supabase
      .from('workouts')
      .select('status, date')
      .eq('plan_id', plan.id)
    planWorkouts = (workouts ?? []) as Array<{ status: WorkoutStatus; date: string }>

    const planStartDate = plan.created_at.split('T')[0]
    const todayStr = new Date().toISOString().split('T')[0]
    ridesActivities = await client.getActivities(planStartDate, todayStr)
  }

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

  const content = await generateProgressBrief({ metrics, goals: profile.goals ?? '' })
  if (!content) return

  await supabase
    .from('progress_briefs')
    .upsert(
      {
        user_id: userId,
        content,
        metrics_snapshot: metrics,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
}
```

- [ ] **Step 4: Update the call site in `app/api/sync/route.ts`**

Find (around line 184-194):

```ts
    // Generate progress brief (4h debounce, non-fatal)
    if (profile.current_ftp && profile.weight_kg) {
      try {
        await maybeGenerateProgressBrief(supabase, user.id, syncData, {
          current_ftp: profile.current_ftp,
          weight_kg: profile.weight_kg,
          goals: profile.goals ?? '',
          min_sessions_per_week: profile.min_sessions_per_week ?? 3,
        })
      } catch { /* non-fatal — brief generation failure must not block sync */ }
    }
```

Replace with:

```ts
    // Generate progress brief (4h debounce, non-fatal)
    if (profile.current_ftp && profile.weight_kg) {
      try {
        await maybeGenerateProgressBrief(supabase, user.id, syncData, {
          current_ftp: profile.current_ftp,
          weight_kg: profile.weight_kg,
          goals: profile.goals ?? '',
          min_sessions_per_week: profile.min_sessions_per_week ?? 3,
        }, client)
      } catch { /* non-fatal — brief generation failure must not block sync */ }
    }
```

(`client` is already in scope in this function — it's the `IntervalsClient` instance constructed earlier in the same `POST` handler. No new import is needed in this file.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/brief-generator.test.ts`
Expected: PASS — 2 tests passing.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms the new required `client` parameter is satisfied at its one call site, and the test file's mock casts are accepted).

- [ ] **Step 7: Run the full test suite**

Run: `npx jest`
Expected: all suites pass, including the new `__tests__/lib/brief-generator.test.ts` and the pre-existing `__tests__/lib/progress-metrics.test.ts` (unchanged — `computeProgressMetrics` itself was not touched).

- [ ] **Step 8: Commit**

```bash
git add lib/progress/brief-generator.ts app/api/sync/route.ts __tests__/lib/brief-generator.test.ts
git commit -m "fix: count rides for the plan's full duration, not just the trailing 6-week sync window"
```
