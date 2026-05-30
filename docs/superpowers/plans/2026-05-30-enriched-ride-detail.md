# Enriched Completed-Ride Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every coaching prompt (dossier, chat, briefing, feedback) access to rich completed-ride detail — NP/power/HR/terrain, power-curve best efforts, and planned-vs-actual interval execution — by persisting it at sync time and reading it from the DB.

**Architecture:** A new `workouts.activity_metrics` JSONB column is populated by a single self-healing backfill pass inside `/api/sync` (newest-first, capped at 25 rides/run) that enriches any completed ride in the last 90 days missing metrics. The enrichment fetches data already partly in the sync payload plus two per-ride intervals.icu calls (power curve + detected intervals). A dependency-free formatter module turns the blob into prompt text; Claude does the planned-vs-actual comparison rather than alignment code.

**Tech Stack:** Next.js 16 App Router (route handlers), TypeScript, Supabase (server client), intervals.icu REST API, Jest (SWC, no type-check — `npm run build` is the type-check gate), Anthropic SDK.

**Baseline note:** This repo has a known pre-existing test baseline of 6 failing suites / 20 failing tests unrelated to this feature (email-allowlist, review, WorkoutCard, AddEventModal, WorkoutDetailModal, SettingsPage). "All green" below means no *new* failures beyond this baseline. `npm run build` must exit 0.

**Design consolidation (vs spec):** The spec described enriching newly-attached rides in the sync match/import path *and* a separate backfill. To stay DRY, this plan implements enrichment in **one place only** — the backfill pass, ordered newest-first — which runs at the end of every sync. A ride completed today has `activity_metrics = null` and is therefore enriched by the same sync's backfill pass (newest first, so it is prioritised over old backlog). End state is identical; there is a single enrichment code path. The `ActivityMetrics`/`ActivityInterval` interfaces live in `types/index.ts` (not inside `activity-metrics.ts` as the spec sketched) so that `lib/intervals/client.ts` can reference the interval type without importing from `lib/claude`.

---

## File Structure

- **Create** `supabase/migrations/20260530_activity_metrics.sql` — adds the JSONB column.
- **Modify** `supabase/schema.sql` — add the column to the canonical schema for fresh environments.
- **Modify** `types/index.ts` — add `ActivityInterval` and `ActivityMetrics` interfaces.
- **Create** `lib/claude/activity-metrics.ts` — pure formatters: `extractActivityMetrics`, `formatActivityMetrics`, `formatRideExecution`. Dependency-free (like `lib/claude/zones.ts`).
- **Create** `__tests__/lib/activity-metrics.test.ts` — unit tests for the three functions.
- **Modify** `lib/intervals/client.ts` — add `getActivity` and `getActivityIntervals`; extract a shared `mapActivity` private mapper.
- **Modify** `__tests__/lib/intervals.test.ts` — tests for the two new methods.
- **Create** `lib/intervals/enrich.ts` — `enrichActivity`, `enrichActivityById`, `backfillActivityMetrics`.
- **Create** `__tests__/lib/enrich.test.ts` — unit tests for the backfill pass.
- **Modify** `app/api/sync/route.ts` — call `backfillActivityMetrics` after match/import.
- **Modify** `lib/claude/synthesize-dossier.ts` + `lib/claude/dossier.ts` — surface metrics in the 90-day dossier input.
- **Modify** `lib/claude/chat.ts` + `app/api/chat/route.ts` — add a "Recent rides" block.
- **Modify** `lib/claude/briefing.ts` + `app/api/briefing/today/route.ts` + `types/index.ts` (`CompletedRideData`) — elevation + execution in the post-ride note.
- **Modify** `lib/claude/feedback.ts` + `app/api/feedback/route.ts` — execution block in the adaptation prompt.

---

## Task 1: Migration + schema column

**Files:**
- Create: `supabase/migrations/20260530_activity_metrics.sql`
- Modify: `supabase/schema.sql:51-67` (workouts table)

This task has no automated test (it is a DB schema change applied manually in the Supabase SQL editor). Verification is by `npm run build` staying green and the column being present after the migration is run.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260530_activity_metrics.sql`:

```sql
-- Enriched completed-ride detail captured at sync time.
-- Holds NP/power/HR/terrain scalars, power-curve best efforts, and detected intervals.
-- Shape: see ActivityMetrics in types/index.ts. Null until the sync backfill pass fills it.
alter table workouts add column if not exists activity_metrics jsonb;
```

- [ ] **Step 2: Add the column to the canonical schema**

In `supabase/schema.sql`, inside the `create table if not exists workouts (...)` block, add the column after the `steps jsonb,` line (currently line 64):

```sql
  steps jsonb,
  activity_metrics jsonb,
```

- [ ] **Step 3: Verify the build still compiles**

Run: `npm run build`
Expected: `✓ Compiled successfully`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260530_activity_metrics.sql supabase/schema.sql
git commit -m "feat: add activity_metrics column to workouts"
```

**Note for the operator:** Apply the migration to the live Supabase project (SQL editor or migration tooling) before deploying code that writes the column. Writing JSONB to a non-existent column fails silently-ish via PostgREST error; the backfill logs and skips, so an unmigrated DB simply leaves metrics null.

---

## Task 2: ActivityMetrics types + extract/format scalars

**Files:**
- Modify: `types/index.ts` (add interfaces after `ICUPowerCurvePoint`, line 246-249)
- Create: `lib/claude/activity-metrics.ts`
- Test: `__tests__/lib/activity-metrics.test.ts`

- [ ] **Step 1: Add the interfaces to `types/index.ts`**

After the `ICUPowerCurvePoint` interface (line 249), add:

```ts
export interface ActivityInterval {
  label: string | null
  duration_secs: number
  avg_watts: number | null
  avg_hr: number | null
}

export interface ActivityMetrics {
  // Tier 1 — already in the sync payload
  np: number | null            // weighted_average_watts
  avg_power: number | null
  max_power: number | null
  avg_hr: number | null
  distance_m: number | null
  elevation_m: number | null   // total_elevation_gain
  lr_balance: number | null    // left %
  // Tier 2 — power-curve best efforts, sampled to canonical durations
  best_efforts: Array<{ secs: number; watts: number }> | null
  // Tier 3 — detected intervals (laps)
  intervals: ActivityInterval[] | null
  synced_at: string
}
```

- [ ] **Step 2: Write the failing test for `extractActivityMetrics`**

Create `__tests__/lib/activity-metrics.test.ts`:

```ts
/** @jest-environment node */
import { extractActivityMetrics, formatActivityMetrics } from '@/lib/claude/activity-metrics'
import type { ICUActivity, ICUPowerCurvePoint, ActivityInterval } from '@/types'

const act: ICUActivity = {
  id: 'a1', start_date_local: '2026-05-28T08:00:00', type: 'Ride',
  moving_time: 3600, name: 'Threshold', average_watts: 231, max_watts: 612,
  weighted_average_watts: 248, average_heartrate: 152, training_load: 78,
  rolling_ftp: 250, distance: 32500, total_elevation_gain: 84, left_right_balance: 51,
}

const curve: ICUPowerCurvePoint[] = [
  { secs: 5, watts: 600 }, { secs: 15, watts: 520 }, { secs: 60, watts: 400 },
  { secs: 300, watts: 312 }, { secs: 1200, watts: 264 },
]

const intervals: ActivityInterval[] = [
  { label: 'Work', duration_secs: 480, avg_watts: 248, avg_hr: 161 },
]

describe('extractActivityMetrics', () => {
  it('maps tier-1 scalars from the activity', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.np).toBe(248)
    expect(m.avg_power).toBe(231)
    expect(m.max_power).toBe(612)
    expect(m.avg_hr).toBe(152)
    expect(m.distance_m).toBe(32500)
    expect(m.elevation_m).toBe(84)
    expect(m.lr_balance).toBe(51)
    expect(typeof m.synced_at).toBe('string')
  })

  it('samples best efforts at canonical durations present in the curve', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.best_efforts).toEqual([
      { secs: 5, watts: 600 }, { secs: 15, watts: 520 }, { secs: 60, watts: 400 },
      { secs: 300, watts: 312 }, { secs: 1200, watts: 264 },
    ])
  })

  it('omits canonical durations with no nearby curve point (no fabricated 60min best)', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    // 3600s target has no point within 20% (nearest is 1200) → excluded
    expect(m.best_efforts?.some(e => e.secs === 3600)).toBe(false)
  })

  it('sets best_efforts and intervals to null when not provided', () => {
    const m = extractActivityMetrics(act, null, null)
    expect(m.best_efforts).toBeNull()
    expect(m.intervals).toBeNull()
  })

  it('passes intervals through', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.intervals).toEqual(intervals)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest __tests__/lib/activity-metrics.test.ts -t extractActivityMetrics`
Expected: FAIL — `Cannot find module '@/lib/claude/activity-metrics'`.

- [ ] **Step 4: Implement `extractActivityMetrics` (and the canonical sampling)**

Create `lib/claude/activity-metrics.ts`:

```ts
// Pure, dependency-free formatters for enriched completed-ride detail.
// Kept free of the intervals.icu and Anthropic clients so prompt builders can
// import it without dragging in network/SDK code (mirrors lib/claude/zones.ts).
import type { ICUActivity, ICUPowerCurvePoint, ActivityInterval, ActivityMetrics, WorkoutStep } from '@/types'

// Best-effort durations we sample the power curve down to (seconds).
const CANONICAL_SECS = [5, 15, 60, 300, 1200, 3600]

function sampleBest(curve: ICUPowerCurvePoint[], target: number): { secs: number; watts: number } | null {
  if (!curve.length) return null
  let nearest = curve[0]
  for (const p of curve) {
    if (Math.abs(p.secs - target) < Math.abs(nearest.secs - target)) nearest = p
  }
  // Reject if the nearest available point is more than 20% from the target,
  // so a 20-minute ride never reports a fabricated 60-minute best.
  if (Math.abs(nearest.secs - target) > target * 0.2) return null
  return { secs: target, watts: Math.round(nearest.watts) }
}

export function extractActivityMetrics(
  act: ICUActivity,
  curve: ICUPowerCurvePoint[] | null,
  intervals: ActivityInterval[] | null,
): ActivityMetrics {
  const best = curve?.length
    ? CANONICAL_SECS.map(t => sampleBest(curve, t)).filter((e): e is { secs: number; watts: number } => e !== null)
    : []
  return {
    np: act.weighted_average_watts ?? null,
    avg_power: act.average_watts ?? null,
    max_power: act.max_watts ?? null,
    avg_hr: act.average_heartrate ?? null,
    distance_m: act.distance ?? null,
    elevation_m: act.total_elevation_gain ?? null,
    lr_balance: act.left_right_balance ?? null,
    best_efforts: best.length ? best : null,
    intervals: intervals?.length ? intervals : null,
    synced_at: new Date().toISOString(),
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest __tests__/lib/activity-metrics.test.ts -t extractActivityMetrics`
Expected: PASS (5 tests).

- [ ] **Step 6: Write the failing test for `formatActivityMetrics`**

Append to `__tests__/lib/activity-metrics.test.ts`:

```ts
describe('formatActivityMetrics', () => {
  const base = {
    np: 248, avg_power: 231, max_power: 612, avg_hr: 152,
    distance_m: 32500, elevation_m: 84, lr_balance: 51,
    best_efforts: [{ secs: 300, watts: 312 }, { secs: 1200, watts: 264 }],
    intervals: null, synced_at: '2026-05-28T09:00:00Z',
  }

  it('formats a compact summary line with present fields', () => {
    const s = formatActivityMetrics(base)
    expect(s).toContain('NP 248W')
    expect(s).toContain('avg 231W')
    expect(s).toContain('max 612W')
    expect(s).toContain('32.5km')
    expect(s).toContain('84m climb')
    expect(s).toContain('HR 152')
    expect(s).toContain('5min best 312W')
    expect(s).toContain('20min best 264W')
    expect(s).toContain(' · ')
  })

  it('omits null fields', () => {
    const s = formatActivityMetrics({ ...base, max_power: null, avg_hr: null, best_efforts: null })
    expect(s).not.toContain('max')
    expect(s).not.toContain('HR')
    expect(s).not.toContain('best')
  })

  it('returns a fallback when nothing is present', () => {
    const s = formatActivityMetrics({
      np: null, avg_power: null, max_power: null, avg_hr: null, distance_m: null,
      elevation_m: null, lr_balance: null, best_efforts: null, intervals: null,
      synced_at: '2026-05-28T09:00:00Z',
    })
    expect(s).toBe('no power data')
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx jest __tests__/lib/activity-metrics.test.ts -t formatActivityMetrics`
Expected: FAIL — `formatActivityMetrics is not a function`.

- [ ] **Step 8: Implement `formatActivityMetrics`**

Append to `lib/claude/activity-metrics.ts`:

```ts
function findBest(m: ActivityMetrics, secs: number): number | null {
  return m.best_efforts?.find(e => e.secs === secs)?.watts ?? null
}

export function formatActivityMetrics(m: ActivityMetrics): string {
  const parts: string[] = []
  if (m.np !== null) parts.push(`NP ${Math.round(m.np)}W`)
  if (m.avg_power !== null) parts.push(`avg ${Math.round(m.avg_power)}W`)
  if (m.max_power !== null) parts.push(`max ${Math.round(m.max_power)}W`)
  if (m.distance_m !== null) parts.push(`${(m.distance_m / 1000).toFixed(1)}km`)
  if (m.elevation_m !== null) parts.push(`${Math.round(m.elevation_m)}m climb`)
  if (m.avg_hr !== null) parts.push(`HR ${Math.round(m.avg_hr)}`)
  const fiveMin = findBest(m, 300)
  if (fiveMin !== null) parts.push(`5min best ${fiveMin}W`)
  const twentyMin = findBest(m, 1200)
  if (twentyMin !== null) parts.push(`20min best ${twentyMin}W`)
  return parts.length ? parts.join(' · ') : 'no power data'
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx jest __tests__/lib/activity-metrics.test.ts`
Expected: PASS (all `extractActivityMetrics` + `formatActivityMetrics` tests).

- [ ] **Step 10: Commit**

```bash
git add types/index.ts lib/claude/activity-metrics.ts __tests__/lib/activity-metrics.test.ts
git commit -m "feat: ActivityMetrics type and scalar formatters"
```

---

## Task 3: formatRideExecution (planned-vs-actual)

**Files:**
- Modify: `lib/claude/activity-metrics.ts`
- Test: `__tests__/lib/activity-metrics.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/lib/activity-metrics.test.ts`:

```ts
import { formatRideExecution } from '@/lib/claude/activity-metrics'
import type { WorkoutStep, ActivityMetrics } from '@/types'

describe('formatRideExecution', () => {
  const steps: WorkoutStep[] = [
    { label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 },
    { label: 'Work', duration_minutes: 8, power_pct_ftp: 95 },
    { label: 'Recovery', duration_minutes: 4, power_pct_ftp: 55 },
  ]
  const metricsWithIntervals: ActivityMetrics = {
    np: 248, avg_power: 231, max_power: 612, avg_hr: 152, distance_m: 32500,
    elevation_m: 84, lr_balance: 51, best_efforts: null,
    intervals: [
      { label: 'Warm Up', duration_secs: 602, avg_watts: 142, avg_hr: 120 },
      { label: 'Work', duration_secs: 480, avg_watts: 244, avg_hr: 161 },
    ],
    synced_at: '2026-05-28T09:00:00Z',
  }

  it('lays planned steps and actual intervals side by side', () => {
    const s = formatRideExecution(steps, metricsWithIntervals)
    expect(s).toContain('Planned steps:')
    expect(s).toContain('Warm Up 10min @ 60%')
    expect(s).toContain('Work 8min @ 95%')
    expect(s).toContain('Actual intervals:')
    expect(s).toContain('Work 8:00 avg 244W HR 161')
  })

  it('returns empty string when there are no planned steps', () => {
    expect(formatRideExecution(null, metricsWithIntervals)).toBe('')
    expect(formatRideExecution([], metricsWithIntervals)).toBe('')
  })

  it('returns empty string when there are no detected intervals', () => {
    expect(formatRideExecution(steps, { ...metricsWithIntervals, intervals: null })).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/lib/activity-metrics.test.ts -t formatRideExecution`
Expected: FAIL — `formatRideExecution is not a function`.

- [ ] **Step 3: Implement `formatRideExecution`**

Append to `lib/claude/activity-metrics.ts`:

```ts
function mmss(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatRideExecution(
  plannedSteps: WorkoutStep[] | null,
  m: ActivityMetrics | null,
): string {
  if (!plannedSteps?.length) return ''
  if (!m?.intervals?.length) return ''
  const planned = plannedSteps
    .map(s => `${s.label} ${s.duration_minutes}min @ ${s.power_pct_ftp}%`)
    .join(' | ')
  const actual = m.intervals
    .map(iv => {
      const bits = [iv.label ?? 'Interval', mmss(iv.duration_secs)]
      if (iv.avg_watts !== null) bits.push(`avg ${Math.round(iv.avg_watts)}W`)
      if (iv.avg_hr !== null) bits.push(`HR ${Math.round(iv.avg_hr)}`)
      return bits.join(' ')
    })
    .join(' | ')
  return `Planned steps: ${planned}\nActual intervals: ${actual}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/lib/activity-metrics.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add lib/claude/activity-metrics.ts __tests__/lib/activity-metrics.test.ts
git commit -m "feat: formatRideExecution for planned-vs-actual intervals"
```

---

## Task 4: intervals.icu client — getActivity + getActivityIntervals

**Files:**
- Modify: `lib/intervals/client.ts:125-145` (extract `mapActivity`, add methods)
- Test: `__tests__/lib/intervals.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/intervals.test.ts` (inside the existing `describe('IntervalsClient', ...)` block, before its closing `})`):

```ts
  it('getActivity maps a single activity by id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'act9', start_date_local: '2026-05-20T07:00:00', type: 'Ride',
        moving_time: 5400, name: 'Long Z2', icu_average_watts: 180,
        icu_weighted_avg_watts: 195, total_elevation_gain: 420, icu_training_load: 110,
      }),
    })

    const a = await client.getActivity('act9')

    expect(a.id).toBe('act9')
    expect(a.weighted_average_watts).toBe(195)
    expect(a.total_elevation_gain).toBe(420)
    expect(mockFetch.mock.calls[0][0]).toBe('https://intervals.icu/api/v1/athlete/i12345/activities/act9')
  })

  it('getActivityIntervals maps icu_intervals to ActivityInterval[]', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        icu_intervals: [
          { label: 'Warm Up', elapsed_time: 600, average_watts: 140, average_heartrate: 118 },
          { label: 'Work', elapsed_time: 480, average_watts: 248, average_heartrate: 161 },
        ],
      }),
    })

    const ivs = await client.getActivityIntervals('act9')

    expect(ivs).toHaveLength(2)
    expect(ivs[1]).toEqual({ label: 'Work', duration_secs: 480, avg_watts: 248, avg_hr: 161 })
    expect(mockFetch.mock.calls[0][0]).toBe('https://intervals.icu/api/v1/athlete/i12345/activities/act9/intervals')
  })

  it('getActivityIntervals returns [] on a malformed payload', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ unexpected: true }) })
    const ivs = await client.getActivityIntervals('act9')
    expect(ivs).toEqual([])
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/intervals.test.ts -t getActivity`
Expected: FAIL — `client.getActivity is not a function`.

- [ ] **Step 3: Refactor `getActivities` to use a shared mapper, and add the methods**

In `lib/intervals/client.ts`, replace the existing `getActivities` method (lines 125-145) with a private mapper plus `getActivities`, `getActivity`, and `getActivityIntervals`. Add `ActivityInterval` to the type import on line 1.

Change line 1 from:
```ts
import type { ICUActivity, ICUWellness, ICUSyncData, WorkoutStep, ICUEvent, ICUPowerCurvePoint } from '@/types'
```
to:
```ts
import type { ICUActivity, ICUWellness, ICUSyncData, WorkoutStep, ICUEvent, ICUPowerCurvePoint, ActivityInterval } from '@/types'
```

Replace the `getActivities` method body (lines 125-145) with:

```ts
  private mapActivity(a: Record<string, unknown>): ICUActivity {
    return {
      id: a.id as string,
      start_date_local: a.start_date_local as string,
      type: a.type as string,
      moving_time: a.moving_time as number,
      name: a.name as string,
      average_watts: (a.icu_average_watts ?? null) as number | null,
      max_watts: (a.p_max ?? null) as number | null,
      weighted_average_watts: (a.icu_weighted_avg_watts ?? null) as number | null,
      average_heartrate: (a.average_heartrate ?? null) as number | null,
      training_load: (a.icu_training_load ?? null) as number | null,
      rolling_ftp: (a.icu_rolling_ftp ?? null) as number | null,
      distance: (a.distance ?? null) as number | null,
      total_elevation_gain: (a.total_elevation_gain ?? null) as number | null,
      left_right_balance: (a.avg_lr_balance ?? null) as number | null,
    }
  }

  async getActivities(oldest: string, newest: string): Promise<ICUActivity[]> {
    const raw = await this.request<Record<string, unknown>[]>(
      `/athlete/${this.athleteId}/activities?oldest=${oldest}&newest=${newest}`
    )
    return raw.map(a => this.mapActivity(a))
  }

  async getActivity(activityId: string): Promise<ICUActivity> {
    const raw = await this.request<Record<string, unknown>>(
      `/athlete/${this.athleteId}/activities/${activityId}`
    )
    return this.mapActivity(raw)
  }

  // Detected intervals (laps) for one activity. Field names per intervals.icu
  // activity intervals endpoint; returns [] on any unexpected shape so a flaky
  // or schema-changed response never aborts a sync.
  async getActivityIntervals(activityId: string): Promise<ActivityInterval[]> {
    const data = await this.request<{ icu_intervals?: Array<Record<string, unknown>> }>(
      `/athlete/${this.athleteId}/activities/${activityId}/intervals`
    )
    if (!Array.isArray(data?.icu_intervals)) return []
    return data.icu_intervals.map(iv => ({
      label: (iv.label ?? null) as string | null,
      duration_secs: (iv.elapsed_time ?? 0) as number,
      avg_watts: (iv.average_watts ?? null) as number | null,
      avg_hr: (iv.average_heartrate ?? null) as number | null,
    }))
  }
```

**Note:** The `icu_intervals` field names (`label`, `elapsed_time`, `average_watts`, `average_heartrate`) should be confirmed against a real intervals.icu activity-intervals response during manual testing. If they differ, adjust the mapper only — the `[]`-on-mismatch guard keeps sync safe in the meantime.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/intervals.test.ts`
Expected: PASS (existing tests + 3 new ones).

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: `✓ Compiled successfully`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/intervals/client.ts __tests__/lib/intervals.test.ts
git commit -m "feat: getActivity and getActivityIntervals on IntervalsClient"
```

---

## Task 5: Enrichment + self-healing backfill

**Files:**
- Create: `lib/intervals/enrich.ts`
- Test: `__tests__/lib/enrich.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/enrich.test.ts`:

```ts
/** @jest-environment node */
import { backfillActivityMetrics } from '@/lib/intervals/enrich'

function makeClient(opts: { throwOn?: string } = {}) {
  return {
    getActivity: jest.fn(async (id: string) => {
      if (opts.throwOn === id) throw new Error('ICU 500')
      return {
        id, start_date_local: '2026-05-20T07:00:00', type: 'Ride', moving_time: 3600,
        name: 'Ride', average_watts: 200, max_watts: 500, weighted_average_watts: 210,
        average_heartrate: 140, training_load: 80, rolling_ftp: 250, distance: 30000,
        total_elevation_gain: 300, left_right_balance: 50,
      }
    }),
    getActivityPowerCurve: jest.fn(async () => []),
    getActivityIntervals: jest.fn(async () => []),
  }
}

// Minimal chainable Supabase stub: select/eq/in/gte/not/order/limit resolve to { data }.
function makeSupabase(rows: Array<{ id: string; icu_activity_id: string }>, updateSpy: jest.Mock) {
  const query: Record<string, unknown> = {}
  const self = () => query
  Object.assign(query, {
    select: self, eq: self, in: self, gte: self, not: self, order: self,
    limit: () => Promise.resolve({ data: rows, error: null }),
  })
  return {
    from: (table: string) => {
      if (table === 'workouts') {
        return {
          ...query,
          update: (patch: unknown) => ({ eq: (_c: string, id: string) => { updateSpy(id, patch); return Promise.resolve({ error: null }) } }),
        }
      }
      return query
    },
  }
}

beforeEach(() => jest.clearAllMocks())

describe('backfillActivityMetrics', () => {
  it('enriches each missing ride and writes activity_metrics', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase(
      [{ id: 'w1', icu_activity_id: 'a1' }, { id: 'w2', icu_activity_id: 'a2' }],
      updateSpy,
    )
    const client = makeClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = await backfillActivityMetrics(supabase as any, client as any, 'u1')

    expect(count).toBe(2)
    expect(client.getActivity).toHaveBeenCalledTimes(2)
    expect(updateSpy).toHaveBeenCalledTimes(2)
    const [, patch] = updateSpy.mock.calls[0]
    expect(patch.activity_metrics.np).toBe(210)
    expect(patch.activity_metrics.elevation_m).toBe(300)
  })

  it('skips a ride whose enrichment throws, without aborting the rest', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase(
      [{ id: 'w1', icu_activity_id: 'a1' }, { id: 'w2', icu_activity_id: 'a2' }],
      updateSpy,
    )
    const client = makeClient({ throwOn: 'a1' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = await backfillActivityMetrics(supabase as any, client as any, 'u1')

    expect(count).toBe(1)            // only a2 succeeded
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.mock.calls[0][0]).toBe('w2')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/lib/enrich.test.ts`
Expected: FAIL — `Cannot find module '@/lib/intervals/enrich'`.

- [ ] **Step 3: Implement `lib/intervals/enrich.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ICUActivity, ActivityMetrics } from '@/types'
import type { IntervalsClient } from './client'
import { extractActivityMetrics } from '@/lib/claude/activity-metrics'

// Build the full metrics blob for an activity already in hand. The two extra
// per-activity calls degrade gracefully — a failure leaves that tier null.
export async function enrichActivity(client: IntervalsClient, activity: ICUActivity): Promise<ActivityMetrics> {
  const [curve, intervals] = await Promise.all([
    client.getActivityPowerCurve(activity.id).catch(() => null),
    client.getActivityIntervals(activity.id).catch(() => null),
  ])
  return extractActivityMetrics(activity, curve, intervals)
}

// Fetch an activity by id (for historical rides outside the windowed list) and enrich it.
export async function enrichActivityById(client: IntervalsClient, activityId: string): Promise<ActivityMetrics> {
  const activity = await client.getActivity(activityId)
  return enrichActivity(client, activity)
}

const BACKFILL_LIMIT = 25

// Self-healing pass: enrich up to BACKFILL_LIMIT completed rides in the last 90
// days that have an icu_activity_id but no activity_metrics yet. Newest first, so
// a ride finished today is prioritised over old backlog. Per-ride failures are
// logged and skipped. Returns the number of rides successfully enriched.
export async function backfillActivityMetrics(
  supabase: SupabaseClient,
  client: IntervalsClient,
  userId: string,
): Promise<number> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0]

  const { data: rows, error } = await supabase
    .from('workouts')
    .select('id, icu_activity_id')
    .eq('user_id', userId)
    .in('status', ['completed', 'needs_review'])
    .gte('date', ninetyDaysAgo)
    .not('icu_activity_id', 'is', null)
    .is('activity_metrics', null)
    .order('date', { ascending: false })
    .limit(BACKFILL_LIMIT)

  if (error) {
    console.error('[backfill] query failed:', error.message)
    return 0
  }

  let count = 0
  for (const row of (rows ?? []) as Array<{ id: string; icu_activity_id: string }>) {
    try {
      const metrics = await enrichActivityById(client, row.icu_activity_id)
      const { error: updateError } = await supabase
        .from('workouts')
        .update({ activity_metrics: metrics })
        .eq('id', row.id)
      if (updateError) throw new Error(updateError.message)
      count++
    } catch (err) {
      console.error(`[backfill] failed to enrich workout ${row.id}:`, err)
    }
  }
  return count
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/lib/enrich.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify the build compiles**

Run: `npm run build`
Expected: `✓ Compiled successfully`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/intervals/enrich.ts __tests__/lib/enrich.test.ts
git commit -m "feat: self-healing activity-metrics backfill"
```

---

## Task 6: Wire the backfill into the sync route

**Files:**
- Modify: `app/api/sync/route.ts:62-65`

No new unit test (the route orchestrates already-tested units; a route test would require mocking the full Supabase + ICU stack for little marginal value). Verification is by build + the enrich unit tests.

- [ ] **Step 1: Import the backfill helper**

In `app/api/sync/route.ts`, add to the imports (after line 4):

```ts
import { backfillActivityMetrics } from '@/lib/intervals/enrich'
```

- [ ] **Step 2: Call the backfill after match + import**

Replace lines 62-65:

```ts
    // Create workout rows for unplanned rides not already in the DB
    await importUnplannedRides(supabase, user.id, syncData.activities)

    return NextResponse.json({ ...syncData, athlete_id: profile.intervals_icu_athlete_id })
```

with:

```ts
    // Create workout rows for unplanned rides not already in the DB
    await importUnplannedRides(supabase, user.id, syncData.activities)

    // Self-healing: enrich completed rides (incl. those just imported/matched) with
    // power/terrain/interval detail. Capped per run; newest first. Non-fatal.
    try {
      await backfillActivityMetrics(supabase, client, user.id)
    } catch (err) {
      console.error('[sync] activity-metrics backfill failed:', err)
    }

    return NextResponse.json({ ...syncData, athlete_id: profile.intervals_icu_athlete_id })
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: `✓ Compiled successfully`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/api/sync/route.ts
git commit -m "feat: run activity-metrics backfill on sync"
```

---

## Task 7: Surface metrics in the dossier

**Files:**
- Modify: `lib/claude/synthesize-dossier.ts:28-33` (select), `:55-67` (generateDossier call)
- Modify: `lib/claude/dossier.ts:73-96` (generateDossier signature + workout line)
- Test: extend `__tests__/lib/synthesize-dossier.test.ts`

- [ ] **Step 1: Write the failing test**

In `__tests__/lib/synthesize-dossier.test.ts`, the `generateDossier` mock currently ignores its args. Add a test that asserts the workout payload passed to `generateDossier` carries the metrics summary. Replace the mock setup line `jest.mock('@/lib/claude/dossier', () => ({ generateDossier: jest.fn() }))` — it already lets us inspect calls. Add this test inside `describe('synthesizeDossier', ...)`:

```ts
  it('passes per-session activity_metrics summary into generateDossier', async () => {
    (generateDossier as jest.Mock).mockResolvedValue(fakeContent)
    const upsertSpy = jest.fn(() => Promise.resolve({ error: null }))
    const workouts = [{
      date: '2026-05-20', type: 'intervals', duration_minutes: 60, tss: 78,
      status: 'completed', missed_reason: null,
      activity_metrics: {
        np: 248, avg_power: 231, max_power: 612, avg_hr: 152, distance_m: 32500,
        elevation_m: 84, lr_balance: 51, best_efforts: [{ secs: 1200, watts: 264 }],
        intervals: null, synced_at: '2026-05-20T09:00:00Z',
      },
      steps: null,
    }]
    const supabase = makeSupabase({ workouts, upsertSpy })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await synthesizeDossier(supabase as any, profile as any)

    const passedWorkouts = (generateDossier as jest.Mock).mock.calls[0][4] as Array<{ metrics_summary?: string }>
    expect(passedWorkouts[0].metrics_summary).toContain('NP 248W')
    expect(passedWorkouts[0].metrics_summary).toContain('84m climb')
  })
```

The existing `makeSupabase` returns `chain({ data: opts.workouts ?? [] })` for the `workouts` table — the new `activity_metrics`/`steps` fields ride along in `data` automatically.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/lib/synthesize-dossier.test.ts -t "activity_metrics summary"`
Expected: FAIL — `passedWorkouts[0].metrics_summary` is `undefined`.

- [ ] **Step 3: Extend the dossier select and the generateDossier call**

In `lib/claude/synthesize-dossier.ts`, change the workouts select (line 29) from:

```ts
        .select('date, type, duration_minutes, tss, status, missed_reason')
```
to:
```ts
        .select('date, type, duration_minutes, tss, status, missed_reason, activity_metrics')
```

Then change the `completedWorkouts` argument passed to `generateDossier` (lines 60-63). Replace:

```ts
      (workouts ?? []) as Array<{
        date: string; type: string; duration_minutes: number
        tss: number | null; status: string; missed_reason: string | null
      }>,
```
with:
```ts
      ((workouts ?? []) as Array<{
        date: string; type: string; duration_minutes: number
        tss: number | null; status: string; missed_reason: string | null
        activity_metrics: import('@/types').ActivityMetrics | null
      }>).map(w => ({
        date: w.date, type: w.type, duration_minutes: w.duration_minutes,
        tss: w.tss, status: w.status, missed_reason: w.missed_reason,
        metrics_summary: w.activity_metrics ? formatActivityMetrics(w.activity_metrics) : null,
      })),
```

Add the import at the top of `lib/claude/synthesize-dossier.ts` (after line 3):

```ts
import { formatActivityMetrics } from './activity-metrics'
```

- [ ] **Step 4: Update `generateDossier` to accept and render the summary**

In `lib/claude/dossier.ts`, change the `completedWorkouts` parameter type (lines 78-85) from:

```ts
  completedWorkouts: Array<{
    date: string
    type: string
    duration_minutes: number
    tss: number | null
    status: string
    missed_reason: string | null
  }>,
```
to:
```ts
  completedWorkouts: Array<{
    date: string
    type: string
    duration_minutes: number
    tss: number | null
    status: string
    missed_reason: string | null
    metrics_summary?: string | null
  }>,
```

Change the `workoutsSection` builder (lines 90-96) from:

```ts
  const workoutsSection = completedWorkouts.length
    ? completedWorkouts
        .map(w =>
          `${w.date} | ${w.type} | ${w.duration_minutes}min | TSS ${w.tss ?? '?'} | ${w.status}${w.missed_reason ? ` (${w.missed_reason})` : ''}`
        )
        .join('\n')
    : 'No completed sessions recorded.'
```
to:
```ts
  const workoutsSection = completedWorkouts.length
    ? completedWorkouts
        .map(w =>
          `${w.date} | ${w.type} | ${w.duration_minutes}min | TSS ${w.tss ?? '?'} | ${w.status}${w.missed_reason ? ` (${w.missed_reason})` : ''}${w.metrics_summary ? ` | ${w.metrics_summary}` : ''}`
        )
        .join('\n')
    : 'No completed sessions recorded.'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest __tests__/lib/synthesize-dossier.test.ts`
Expected: PASS (existing tests + the new one).

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`
Expected: `✓ Compiled successfully`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/claude/synthesize-dossier.ts lib/claude/dossier.ts __tests__/lib/synthesize-dossier.test.ts
git commit -m "feat: surface ride metrics in dossier synthesis"
```

---

## Task 8: Surface recent rides in coach chat

**Files:**
- Modify: `lib/claude/chat.ts:15-71` (signature + new block)
- Modify: `app/api/chat/route.ts:31-60` (fetch recent rides, pass through)
- Test: extend `__tests__/lib/chat-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

In `__tests__/lib/chat-prompt.test.ts`, add a recent-rides fixture and test. After the `events` fixture (line 27), add:

```ts
const recentRides = [{
  id: 'r1', date: '2026-05-28', type: 'intervals', duration_minutes: 60,
  steps: [
    { label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 },
    { label: 'Work', duration_minutes: 8, power_pct_ftp: 95 },
  ],
  activity_metrics: {
    np: 248, avg_power: 231, max_power: 612, avg_hr: 152, distance_m: 32500,
    elevation_m: 84, lr_balance: 51, best_efforts: [{ secs: 1200, watts: 264 }],
    intervals: [{ label: 'Work', duration_secs: 480, avg_watts: 244, avg_hr: 161 }],
    synced_at: '2026-05-28T09:00:00Z',
  },
}]
```

Then add a test inside `describe('buildChatSystemPrompt', ...)`:

```ts
  it('includes a recent rides block with metrics and execution', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = buildChatSystemPrompt(plan, upcoming, wellness, 240, events, '', recentRides as any)
    expect(p).toContain('Recent rides')
    expect(p).toContain('NP 248W')
    expect(p).toContain('Actual intervals:')
    expect(p).toContain('Work 8:00 avg 244W HR 161')
  })
```

Note the new 7th argument. The existing calls (6 args) must still work — give the new param a default.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/lib/chat-prompt.test.ts -t "recent rides block"`
Expected: FAIL — `Recent rides` not found (param ignored / undefined).

- [ ] **Step 3: Extend `buildChatSystemPrompt`**

In `lib/claude/chat.ts`, change the imports (lines 1-2):

```ts
import type { TrainingPlan, Workout, ICUWellness, TrainingEvent, ActivityMetrics, WorkoutStep } from '@/types'
import { formatZones } from './zones'
import { formatActivityMetrics, formatRideExecution } from './activity-metrics'
```

Add a type for a recent ride above the function (after line 13):

```ts
export interface RecentRide {
  date: string
  type: string
  duration_minutes: number
  steps: WorkoutStep[] | null
  activity_metrics: ActivityMetrics | null
}
```

Change the function signature (lines 15-22) to add the parameter:

```ts
export function buildChatSystemPrompt(
  plan: TrainingPlan | null,
  upcomingWorkouts: Workout[],
  latestWellness: ICUWellness | null,
  currentFTP: number,
  events: TrainingEvent[],
  dossierSection = '',
  recentRides: RecentRide[] = [],
): string {
```

Build the block — after the `workoutSection` const (line 32), add:

```ts
  const recentRidesSection = recentRides.length
    ? recentRides.map(r => {
        const summary = r.activity_metrics ? formatActivityMetrics(r.activity_metrics) : 'no power data'
        const execution = formatRideExecution(r.steps, r.activity_metrics)
        return `- ${r.date} ${r.type} ${r.duration_minutes}min: ${summary}${execution ? `\n  ${execution.replace('\n', '\n  ')}` : ''}`
      }).join('\n')
    : 'No recent rides with detail.'
```

Insert it into the prompt template — after the "Current fitness" block (after line 64, before `Athlete FTP`):

```ts
Recent rides (last ${recentRides.length} completed, most recent first):
${recentRidesSection}

```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/lib/chat-prompt.test.ts`
Expected: PASS (all existing + new test).

- [ ] **Step 5: Fetch recent rides in the chat route and pass them**

In `app/api/chat/route.ts`, add a query to the `Promise.all` (lines 31-40). Change it to include a sixth query:

```ts
  const [{ data: plan }, { data: recentMessages }, { data: upcomingWorkouts }, { data: profileData }, dossier, { data: recentRides }] = await Promise.all([
    supabase.from('training_plans').select('*').eq('status', 'active').maybeSingle(),
    supabase.from('chat_messages').select('*').order('created_at', { ascending: false }).limit(20),
    supabase.from('workouts').select('*').eq('status', 'planned')
      .gte('date', new Date().toISOString().split('T')[0])
      .lte('date', new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0])
      .order('date'),
    supabase.from('user_profile').select('events').maybeSingle(),
    fetchDossier(supabase, user.id),
    supabase.from('workouts')
      .select('date, type, duration_minutes, steps, activity_metrics')
      .eq('status', 'completed')
      .not('activity_metrics', 'is', null)
      .order('date', { ascending: false })
      .limit(5),
  ])
```

Pass them into the prompt builder. Change lines 53-60:

```ts
  const systemPrompt = buildChatSystemPrompt(
    plan as TrainingPlan | null,
    (upcomingWorkouts ?? []) as Workout[],
    latestWellness,
    currentFTP,
    events,
    formatDossier(dossier as AthleteDossier | null),
    (recentRides ?? []) as import('@/lib/claude/chat').RecentRide[],
  )
```

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`
Expected: `✓ Compiled successfully`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/claude/chat.ts app/api/chat/route.ts __tests__/lib/chat-prompt.test.ts
git commit -m "feat: recent rides with metrics in coach chat prompt"
```

---

## Task 9: Elevation + execution in the post-ride briefing

**Files:**
- Modify: `types/index.ts:275-281` (`CompletedRideData`)
- Modify: `lib/claude/briefing.ts:123-166` (rideDataString + post-ride prompt)
- Modify: `app/api/briefing/today/route.ts:108-122` (populate enriched fields)
- Create: `__tests__/lib/claude-briefing.test.ts` (no briefing test exists yet)

- [ ] **Step 1: Extend `CompletedRideData`**

In `types/index.ts`, change the `CompletedRideData` interface (lines 275-281) to add two fields:

```ts
export interface CompletedRideData {
  name: string
  avg_power: number | null
  weighted_avg_power: number | null
  tss: number | null
  moving_time: number
  elevation_m: number | null
  execution: string | null
}
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/lib/claude-briefing.test.ts`, mirroring the `@/lib/claude/client` mock convention from `__tests__/lib/claude-feedback.test.ts`. The post-ride note path uses `anthropic.messages.create`, so mock that. `generateBriefing` routes to the post-ride note when `ctx.workoutCompleted` is true and there is no `todayEvent.result_tss`:

```ts
import { generateBriefing } from '@/lib/claude/briefing'
import type { BriefingContext } from '@/types'

jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-sonnet-4-6',
  anthropic: {
    messages: {
      create: jest.fn(),
      stream: jest.fn(),
    },
  },
}))

import { anthropic } from '@/lib/claude/client'
const mockCreate = anthropic.messages.create as jest.Mock

beforeEach(() => mockCreate.mockReset())

const basePostRideCtx: BriefingContext = {
  today: '2026-05-28',
  todayWorkout: {
    id: 'w1', plan_id: 'p1', date: '2026-05-28', type: 'intervals',
    duration_minutes: 60, description: '4x8', target_zones: 'Z4',
    intervals_icu_event_id: null, status: 'completed', icu_activity_id: 'a1',
    tss: 78, missed_reason: null, steps: null, created_at: '',
  },
  todayWorkouts: [],
  todayEvent: null,
  workoutCompleted: true,
  completedRide: null,
  completedRides: null,
  ctl: 65, atl: 70, tsb: -5,
  readinessLabel: 'Moderate',
  hrv: 50,
  recentWorkouts: [],
  upcomingEvents: [],
}

describe('generatePostRideNote — enriched detail', () => {
  it('includes elevation and execution detail in the post-ride prompt', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Solid work.' }] })
    const ctx: BriefingContext = {
      ...basePostRideCtx,
      completedRides: [{
        name: 'Threshold', avg_power: 231, weighted_avg_power: 248, tss: 78,
        moving_time: 3600, elevation_m: 84,
        execution: 'Planned steps: Work 8min @ 95%\nActual intervals: Work 8:00 avg 244W HR 161',
      }],
    }
    await generateBriefing(ctx)
    const prompt = mockCreate.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('84m climb')
    expect(prompt).toContain('Actual intervals:')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest __tests__/lib/claude-briefing.test.ts -t "elevation and execution"`
Expected: FAIL — prompt lacks `84m climb` / `Actual intervals:`.

- [ ] **Step 4: Render the new fields in `briefing.ts`**

In `lib/claude/briefing.ts`, change `rideDataString` (lines 123-131) to include elevation:

```ts
function rideDataString(ride: { name: string; moving_time: number; avg_power: number | null; weighted_avg_power: number | null; tss: number | null; elevation_m: number | null }): string {
  return [
    `"${ride.name}"`,
    ride.moving_time ? `${Math.round(ride.moving_time / 60)} min` : null,
    ride.avg_power !== null ? `avg ${Math.round(ride.avg_power)}W` : null,
    ride.weighted_avg_power !== null ? `NP ${Math.round(ride.weighted_avg_power)}W` : null,
    ride.tss !== null ? `TSS ${Math.round(ride.tss)}` : null,
    ride.elevation_m !== null ? `${Math.round(ride.elevation_m)}m climb` : null,
  ].filter(Boolean).join(', ')
}
```

In `generatePostRideNote` (lines 133-166), after the `rideStats` const (line 146), add an execution block and include it in the prompt. Replace the `prompt` template (lines 156-163) with:

```ts
  const execution = rides
    .map(r => r.execution)
    .filter((e): e is string => !!e)
    .join('\n')

  const prompt = `Today's date: ${ctx.today}
Sessions today: ${sessionSummary}
Ride data: ${rideStats}
${execution ? `Planned vs actual:\n${execution}\n` : ''}Training load after ride: ${buildLoadString(ctx)}
Next 5 days planned sessions: ${upcomingPlan}
Upcoming events: ${buildEventsString(ctx)}

Write the post-ride note.`
```

- [ ] **Step 5: Populate the enriched fields in the briefing route**

In `app/api/briefing/today/route.ts`, the `completedRides` are built from live ICU activities (lines 113-119). Enrich each from the matching workout row's stored `activity_metrics`/`steps`. Replace lines 113-120:

```ts
      completedRides = rides.map((ride: ICUActivity) => ({
        name: ride.name,
        avg_power: ride.average_watts,
        weighted_avg_power: ride.weighted_average_watts,
        tss: ride.training_load,
        moving_time: ride.moving_time,
      }))
      completedRide = completedRides[0] ?? null
```

with:

```ts
      const { formatRideExecution } = await import('@/lib/claude/activity-metrics')
      completedRides = rides.map((ride: ICUActivity) => {
        const match = todayWorkouts.find(w => w.icu_activity_id === ride.id)
        const metrics = (match?.activity_metrics ?? null) as import('@/types').ActivityMetrics | null
        const steps = (match?.steps ?? null) as import('@/types').WorkoutStep[] | null
        return {
          name: ride.name,
          avg_power: ride.average_watts,
          weighted_avg_power: ride.weighted_average_watts,
          tss: ride.training_load,
          moving_time: ride.moving_time,
          elevation_m: metrics?.elevation_m ?? ride.total_elevation_gain ?? null,
          execution: formatRideExecution(steps, metrics) || null,
        }
      })
      completedRide = completedRides[0] ?? null
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest __tests__/lib/claude-briefing.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify the build compiles**

Run: `npm run build`
Expected: `✓ Compiled successfully`, exit 0.

- [ ] **Step 8: Commit**

```bash
git add types/index.ts lib/claude/briefing.ts app/api/briefing/today/route.ts __tests__/lib/claude-briefing.test.ts
git commit -m "feat: elevation and execution detail in post-ride briefing"
```

---

## Task 10: Execution block in feedback analysis

**Files:**
- Modify: `lib/claude/feedback.ts:7-43` (signature + prompt)
- Modify: `app/api/feedback/route.ts:56-65` (pass execution string)
- Test: extend `__tests__/lib/claude-feedback.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/lib/claude-feedback.test.ts` already mocks `@/lib/claude/client` and exposes `mockStream` (the `anthropic.messages.stream` jest.fn) and `mockFinalMessage` (its `.finalMessage()` resolver). `analyseFeedback` calls `anthropic.messages.stream({ ...messages })`, so the prompt is `mockStream.mock.calls[N][0].messages[0].content`. Add this test at the end of the file:

```ts
describe('analyseFeedback — ride execution', () => {
  it('includes the ride execution block in the feedback prompt when provided', async () => {
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"summary":"ok","changes":[],"workout_steps":[]}' }],
    })
    const execution = 'Planned steps: Work 8min @ 95%\nActual intervals: Work 8:00 avg 244W HR 161'
    await analyseFeedback(
      { ...workout, steps: [{ label: 'Work', duration_minutes: 8, power_pct_ftp: 95 }] },
      'felt hard', 78, 244, 161, [], [], '', execution,
    )
    const lastCall = mockStream.mock.calls[mockStream.mock.calls.length - 1]
    const prompt = lastCall[0].messages[0].content
    expect(prompt).toContain('Actual intervals:')
    expect(prompt).toContain('Work 8:00 avg 244W')
  })
})
```

(`workout`, `mockStream`, `mockFinalMessage`, and the `analyseFeedback` import already exist at the top of the file.)

Note the new 9th argument `execution`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/lib/claude-feedback.test.ts -t "ride execution"`
Expected: FAIL — prompt lacks `Actual intervals:` (param not yet accepted).

- [ ] **Step 3: Add the parameter and render it in `feedback.ts`**

In `lib/claude/feedback.ts`, change the `analyseFeedback` signature (lines 7-16) to add a trailing parameter:

```ts
export async function analyseFeedback(
  plannedWorkout: Workout,
  feedbackText: string,
  actualTSS: number | null,
  actualAvgPower: number | null,
  actualAvgHR: number | null,
  upcomingWorkouts: Workout[],
  events: TrainingEvent[] = [],
  dossierSection = '',
  rideExecution = '',
): Promise<ProposedAdjustment> {
```

In the `prompt` template, insert the execution block after the `Actual:` line (line 33). Change:

```ts
Actual: TSS ${actualTSS ?? 'unknown'}, Avg power ${actualAvgPower ?? 'unknown'}W, Avg HR ${actualAvgHR ?? 'unknown'}bpm

Athlete feedback: "${feedbackText}"
```
to:
```ts
Actual: TSS ${actualTSS ?? 'unknown'}, Avg power ${actualAvgPower ?? 'unknown'}W, Avg HR ${actualAvgHR ?? 'unknown'}bpm
${rideExecution ? `\n${rideExecution}\n` : ''}
Athlete feedback: "${feedbackText}"
```

- [ ] **Step 4: Pass the execution string from the feedback route**

In `app/api/feedback/route.ts`, the `workout` row (fetched at line 37-41 with `select('*')`) already holds `activity_metrics` and `steps`. Build the execution string and pass it. After the `events` const (line 54), add:

```ts
    const { formatRideExecution } = await import('@/lib/claude/activity-metrics')
    const rideExecution = formatRideExecution(
      (workout.steps ?? null) as import('@/types').WorkoutStep[] | null,
      (workout.activity_metrics ?? null) as import('@/types').ActivityMetrics | null,
    )
```

Change the `analyseFeedback` call (lines 56-65) to pass it as the 9th argument:

```ts
    proposed = await analyseFeedback(
      workout as Workout,
      feedbackText,
      activityTSS ?? null,
      activityAvgPower ?? null,
      activityAvgHR ?? null,
      (upcomingWorkouts ?? []) as Workout[],
      events,
      formatDossier(dossier as AthleteDossier | null),
      rideExecution,
    )
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest __tests__/lib/claude-feedback.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`
Expected: `✓ Compiled successfully`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/claude/feedback.ts app/api/feedback/route.ts __tests__/lib/claude-feedback.test.ts
git commit -m "feat: include ride execution in feedback analysis"
```

---

## Final Verification

- [ ] **Run the full test suite**

Run: `npx jest`
Expected: No *new* failures beyond the known baseline (6 failing suites / 20 failing tests). New suites `activity-metrics`, `enrich`, and the extended `intervals`, `synthesize-dossier`, `chat-prompt`, `briefing`, `feedback` tests all pass.

- [ ] **Run the production type-check / build**

Run: `npm run build`
Expected: `✓ Compiled successfully`, exit 0.

- [ ] **Manual smoke (operator)**

1. Apply `supabase/migrations/20260530_activity_metrics.sql` to the live DB.
2. Trigger a sync; confirm `workouts.activity_metrics` populates for recent completed rides (newest first, ≤25/run; repeat syncs fill the 90-day history).
3. Validate the `getActivityIntervals` field mapping against a real intervals.icu response; adjust the mapper in `lib/intervals/client.ts` if field names differ.
4. Open coach chat and ask about a recent structured ride — confirm it can speak to execution.
