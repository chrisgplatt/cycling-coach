# Decouple Progress Metrics From the AI-Brief Debounce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard Progress section's numeric stats (Rides, CTL, FTP delta, weight delta, adherence, streak) refresh on every sync, instead of sitting frozen for up to 4 hours behind the debounce that exists only to limit Claude API calls for the AI-written coaching paragraph.

**Architecture:** Split `maybeGenerateProgressBrief` (`lib/progress/brief-generator.ts`) into two independently-gated writes to the same `progress_briefs` row: an unconditional `metrics_snapshot` upsert (runs whenever a row already exists), and the existing debounce-gated `content`/`generated_at` upsert (unchanged). No schema migration — the metrics-only write never runs on a brand-new user's very first call, so it never has to satisfy the `content not null` column on insert; that first row is still always created by the content-generation path, exactly as today.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, Jest.

## Global Constraints

- `generated_at` continues to represent only the AI text's freshness; the metrics-only write path never sets or touches it.
- No database migration — the existing `content not null` constraint (`supabase/migrations/20260613_progress_brief.sql:9`) is respected by only ever creating a new row through the content-generation path, never through the metrics-only path.
- `computeProgressMetrics` (`lib/progress/metrics.ts`) is unchanged — this fix is entirely about write cadence in `brief-generator.ts`, not the metrics calculation itself.
- The debounce behavior for the AI text (`DEBOUNCE_HOURS = 4`, gating `generateProgressBrief` and the `content`/`generated_at` write) is otherwise unchanged.
- The full design doc is at `docs/superpowers/specs/2026-07-12-progress-metrics-debounce-decouple-design.md` — read it if any step below is ambiguous.

---

### Task 1: Decouple the metrics-snapshot write from the content debounce

**Files:**
- Modify: `lib/progress/brief-generator.ts`
- Modify: `__tests__/lib/brief-generator.test.ts`

**Interfaces:**
- `maybeGenerateProgressBrief(supabase: SupabaseClient, userId: string, syncData: ICUSyncData, profile: BriefProfile, client: IntervalsClient): Promise<void>` — same signature as today (from the prior fix), no changes to its exported shape. This task changes only its internal write sequencing.

- [ ] **Step 1: Write the failing tests**

Replace the full content of `__tests__/lib/brief-generator.test.ts` with:

```ts
import { maybeGenerateProgressBrief } from '@/lib/progress/brief-generator'
import { generateProgressBrief } from '@/lib/claude/progress-brief'
import type { ICUActivity, ICUSyncData } from '@/types'

jest.mock('@/lib/claude/progress-brief', () => ({
  generateProgressBrief: jest.fn(async () => 'Great progress this week.'),
}))

const mockedGenerateProgressBrief = generateProgressBrief as jest.Mock

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
  existingGeneratedAt?: string | null
}) {
  const { plan = null, upsertSpy = jest.fn(async () => ({ error: null })), existingGeneratedAt = null } = opts
  return {
    from: (table: string) => {
      if (table === 'progress_briefs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: existingGeneratedAt ? { generated_at: existingGeneratedAt } : null }),
            }),
          }),
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

beforeEach(() => {
  mockedGenerateProgressBrief.mockClear()
  mockedGenerateProgressBrief.mockResolvedValue('Great progress this week.')
})

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
    const written = (upsertSpy.mock.calls as unknown[][])[0]?.[0] as any
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
    const written = (upsertSpy.mock.calls as unknown[][])[0]?.[0] as any
    expect(written.metrics_snapshot.totalRides).toBe(1) // only the recent one — from syncData.activities directly
  })
})

describe('maybeGenerateProgressBrief — metrics/content debounce decoupling', () => {
  it('updates metrics_snapshot even within the debounce window when a brief row already exists, and skips content generation', async () => {
    const recentGeneratedAt = new Date(Date.now() - 1 * 3600000).toISOString() // 1 hour ago — within DEBOUNCE_HOURS=4
    const upsertSpy = jest.fn(async () => ({ error: null }))
    const supabase = makeSupabase({ plan: null, upsertSpy, existingGeneratedAt: recentGeneratedAt })
    const client = { getActivities: jest.fn() }

    const today = new Date()
    const recent = new Date(today); recent.setDate(today.getDate() - 5)
    const recentStr = recent.toISOString().split('T')[0]
    const localSyncData: ICUSyncData = { ...syncData, activities: [act(recentStr)] }

    await maybeGenerateProgressBrief(supabase as never, 'u1', localSyncData, profile, client as never)

    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const written = (upsertSpy.mock.calls as unknown[][])[0]?.[0] as any
    expect(written).toEqual({ user_id: 'u1', metrics_snapshot: expect.objectContaining({ totalRides: 1 }) })
    expect(mockedGenerateProgressBrief).not.toHaveBeenCalled()
  })

  it('creates no row at all when there is no existing brief and metrics are too sparse for AI text', async () => {
    mockedGenerateProgressBrief.mockResolvedValueOnce(null)
    const upsertSpy = jest.fn(async () => ({ error: null }))
    const supabase = makeSupabase({ plan: null, upsertSpy })
    const client = { getActivities: jest.fn() }

    await maybeGenerateProgressBrief(
      supabase as never, 'u1', { ...syncData, activities: [] }, profile, client as never,
    )

    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('writes content, metrics_snapshot, and generated_at together when creating the first-ever brief', async () => {
    const upsertSpy = jest.fn(async () => ({ error: null }))
    const supabase = makeSupabase({ plan: null, upsertSpy })
    const client = { getActivities: jest.fn() }

    await maybeGenerateProgressBrief(supabase as never, 'u1', syncData, profile, client as never)

    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const written = (upsertSpy.mock.calls as unknown[][])[0]?.[0] as any
    expect(written.content).toBe('Great progress this week.')
    expect(written.metrics_snapshot).toBeDefined()
    expect(written.generated_at).toEqual(expect.any(String))
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx jest __tests__/lib/brief-generator.test.ts`
Expected: the two pre-existing tests still PASS unchanged (they always exercise the "no existing row" path, which this task doesn't change). The three new tests in the second `describe` block FAIL:
- `'updates metrics_snapshot even within the debounce window...'` fails because the current implementation's debounce check runs first and returns immediately when `existing.generated_at` is recent — `upsertSpy` is never called at all, so `toHaveBeenCalledTimes(1)` fails.
- `'creates no row at all when...sparse'` — this one may already pass today (the current code also returns without upserting when `content` is `null`); keep it in this task's suite regardless, since it's the same debounce-decoupling change under test and documents the still-correct behavior going forward.
- `'writes content, metrics_snapshot, and generated_at together...'` — this one may already pass today too. Both of these "may already pass" cases are fine to include even though only one of the three is a true RED — the meaningful RED is the first one; the plan brief's job is regression coverage as much as new-behavior coverage.

- [ ] **Step 3: Update `lib/progress/brief-generator.ts`**

Replace the full content of `lib/progress/brief-generator.ts` with:

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
  const [{ data: existing }, { data: plan }, { data: rawWeightLog }] = await Promise.all([
    supabase
      .from('progress_briefs')
      .select('generated_at')
      .eq('user_id', userId)
      .maybeSingle(),
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

  // Numeric stats are cheap (no Claude call) and safe to refresh on every
  // sync, so tiles like "Rides" never sit stale behind the debounce below —
  // which exists only to limit Claude calls for the written text. Only
  // update here once a brief row already exists: the very first brief for a
  // new user is created further down, together with its AI text, so the
  // `content` column's NOT NULL constraint is always satisfied on insert.
  if (existing) {
    await supabase
      .from('progress_briefs')
      .upsert({ user_id: userId, metrics_snapshot: metrics }, { onConflict: 'user_id' })
  }

  if (existing?.generated_at) {
    const hoursSince = (Date.now() - new Date(existing.generated_at).getTime()) / 3600000
    if (hoursSince < DEBOUNCE_HOURS) return
  }

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/brief-generator.test.ts`
Expected: PASS — all 5 tests passing (2 pre-existing + 3 new).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npx jest`
Expected: all suites pass, including `__tests__/lib/brief-generator.test.ts` and the pre-existing `__tests__/lib/progress-metrics.test.ts` (unchanged — `computeProgressMetrics` itself was not touched by this task).

- [ ] **Step 7: Commit**

```bash
git add lib/progress/brief-generator.ts __tests__/lib/brief-generator.test.ts
git commit -m "fix: refresh progress metrics on every sync, decoupled from the AI-brief debounce"
```
