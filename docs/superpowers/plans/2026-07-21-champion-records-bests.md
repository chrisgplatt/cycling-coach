# Champion-Records Storage & Deep-History Bests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the live `workouts`-scan bests aggregation with a small, incrementally-maintained "champion records" table, and add a deep-history batch job that extends bests coverage back through a user's full intervals.icu ride history — without ever persisting ride data locally.

**Architecture:** A new `best_records` table stores only the current best per (period, category, sub-key) — never per-ride data. All three write paths (one-time/re-runnable resync from local rides, incremental update on every future ride enrichment, and the new deep-history scan) funnel through the *same* already-shipped `computeAllTimeBests()` reducer, fed small "synthetic ride" reconstructions of the currently-stored champions plus one new candidate. `/api/bests` reads from the table instead of scanning `workouts`. The deep-history job walks intervals.icu directly (streams + power curve per ride, same primitives `enrichActivity` already uses), computing candidates in memory and discarding the ride data immediately after merging.

**Tech Stack:** Next.js App Router, TypeScript, React, Supabase, Jest + Testing Library.

## Global Constraints

- `computeAllTimeBests`/`computeAllTimeBestsByPeriod` (already shipped, reviewed, merged) are reused, not rewritten. Only their input/output *types* widen (nullable `workoutId`, new `icuActivityId`, `max_speed_ms` alongside `speed_kmh`) — the comparison logic itself is untouched.
- `best_records.sub_key` must be `not null default ''` (never nullable) — Postgres unique constraints treat `NULL` as distinct from every other `NULL`, so a nullable `sub_key` would silently fail to deduplicate rows for the categories that don't use it (climbs, max speed).
- `maxSpeed` entries store both `speed_kmh` (display) and `max_speed_ms` (the raw value) — never derive one from the other after the fact. Reversing `speed_kmh / 3.6` to reconstruct `max_speed_ms` would introduce avoidable rounding risk; storing both at computation time is exact and free.
- The deep-history job never writes a `workouts` row, never fetches `getActivityIntervals` (laps aren't a bests category), and never needs FTP or planned-step context (none of the bests-relevant detections use them) — it is deliberately leaner than full ride enrichment.
- Disassociating a workout does **not** automatically trigger a resync — accepted, documented limitation (see spec). The resync route must be safe to call repeatedly at any time as the manual correction path.
- No admin UI beyond the two new Settings buttons (resync, deep-history) — matching the existing backfill-button convention exactly in style and behavior.

---

### Task 1: `best_records` table + deep-history cursor column

**Files:**
- Create: `supabase/migrations/20260721_best_records.sql`

**Interfaces:**
- Produces: the `best_records` table and `user_profile.deep_history_bests_cursor` column that every later task reads/writes.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260721_best_records.sql`:

```sql
-- best_records: incrementally-maintained "champion" store for the all-time
-- bests feature — one row per (period, category, sub_key) combination,
-- holding only the current best value and enough detail to display/link it.
-- Replaces the old workouts.activity_metrics live-scan aggregation. Run in
-- the Supabase SQL editor before deploying the matching app version.

create table if not exists best_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null,               -- 'all' or a 4-digit year, e.g. '2024'
  category text not null,              -- 'biggest_climb' | 'longest_climb' | 'power' | 'speed' | 'max_speed'
  sub_key text not null default '',    -- e.g. '300' (secs) for power, '10' (km) for speed; '' for climbs/max_speed
  value numeric not null,              -- the comparable metric (elev_gain_m / length_km / watts / speed_kmh)
  detail jsonb not null,               -- date, workoutId, icuActivityId, and category-specific fields
  updated_at timestamptz not null default now(),
  unique(user_id, period, category, sub_key)
);

alter table best_records enable row level security;
create policy "users manage own best records"
  on best_records for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table user_profile
  add column if not exists deep_history_bests_cursor date;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260721_best_records.sql
git commit -m "feat: add best_records table and deep-history cursor column"
```

Tell the user the exact SQL above needs to be run manually against the shared Supabase project (SQL editor, or `supabase db push` if linked locally) before or as part of deploying this branch, then `notify pgrst, 'reload schema';` to force PostgREST to pick up the change immediately. No test file for this task — matches the existing convention that migration files in this repo don't carry their own tests (e.g. `20260718_strain_trimp.sql`, `20260618_daily_wellness.sql`).

---

### Task 2: Widen `AllTimeBests`/`BestsRide` types for workoutless rides and intervals.icu links

**Files:**
- Modify: `lib/ride/all-time-bests.ts`
- Modify: `app/api/bests/route.ts`
- Modify: `__tests__/components/AllTimeBestsTab.test.tsx` (its `makeResponse()` fixture is explicitly typed `: AllTimeBestsResponse` — it fails to compile the moment `icuActivityId`/`max_speed_ms` become required, so this fixture must be fixed in this task, not deferred to Task 9)
- Test: `__tests__/lib/all-time-bests.test.ts`
- Test: `__tests__/api/bests.test.ts`

**Interfaces:**
- Produces: `BestsRide.id: string | null` (null = no local `workouts` row), `BestsRide.icu_activity_id: string` (always present), every `AllTimeBests` entry gains `workoutId: string | null` (renamed from the old non-nullable `workoutId: string`) and `icuActivityId: string`; `maxSpeed` additionally gains `max_speed_ms: number`. Task 3 (the reconstruction/merge module) and Task 9 (the UI link, which only adds a new test — the fixture itself is already fixed here) both consume these widened shapes.

- [ ] **Step 1: Write the failing tests**

Update `__tests__/lib/all-time-bests.test.ts`'s fixtures. Replace the `ride()` helper (currently):
```typescript
function ride(id: string, date: string, metrics: ActivityMetrics | null) {
  return { id, date, activity_metrics: metrics }
}
```
with:
```typescript
function ride(id: string, date: string, metrics: ActivityMetrics | null, icuActivityId = `icu-${id}`) {
  return { id, icu_activity_id: icuActivityId, date, activity_metrics: metrics }
}
```

Update every existing assertion that checks a `biggestClimb`/`longestClimb`/`powerBests`/`speedBests`/`maxSpeed` entry to also expect `icuActivityId`. For example, the existing test:
```typescript
  it('finds the biggest climb by elev_gain_m across rides', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400, length_km: 5 })] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900, length_km: 3 })] })),
      ride('w3', '2026-03-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 600, length_km: 4 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb).toEqual({ workoutId: 'w2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 })
  })
```
becomes:
```typescript
  it('finds the biggest climb by elev_gain_m across rides', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400, length_km: 5 })] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900, length_km: 3 })] })),
      ride('w3', '2026-03-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 600, length_km: 4 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb).toEqual({ workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 })
  })
```
Apply the same `icuActivityId: 'icu-<id>'` addition to every other `toEqual` assertion on a bests entry in this file (the longest-climb, power-bests, speed-bests tests, and both `computeAllTimeBestsByPeriod` tests that check `.biggestClimb?.elev_gain_m` don't need changes since they only check one field, but the two full-object `toEqual` tests — "skips rides with null activity_metrics" and "returns all-null/empty" — need the same `icuActivityId` addition where they assert a non-null entry; the all-null assertions are unaffected since `null` needs no field additions).

Add two new tests proving the new nullable-workout / max_speed_ms behavior:
```typescript
  it('supports a workoutless ride (no local workouts row) via a null id', () => {
    const rides = [
      { id: null, icu_activity_id: 'icu-only', date: '2026-04-01', activity_metrics: makeMetrics({ climbs: [makeClimb({ elev_gain_m: 700, length_km: 6 })] }) },
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb).toEqual({ workoutId: null, icuActivityId: 'icu-only', date: '2026-04-01', elev_gain_m: 700, length_km: 6 })
  })

  it('stores max_speed_ms alongside speed_kmh, exactly as provided (no derived reconstruction)', () => {
    const rides = [ride('w1', '2026-01-01', makeMetrics({ max_speed_ms: 19.027 }))]
    const result = computeAllTimeBests(rides)
    expect(result.maxSpeed).toEqual({ workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01', speed_kmh: 68.5, max_speed_ms: 19.027 })
  })
```

Update `__tests__/api/bests.test.ts`'s fixture and assertion to include `icu_activity_id`/`icuActivityId` — the existing test:
```typescript
  it('returns computed all-time and per-year bests for the current user\'s rides', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([
      {
        id: 'w1', date: '2026-03-01',
        activity_metrics: {
          climbs: [{ start_km: 2, duration_secs: 300, elev_gain_m: 500, avg_watts: 220, vam: 600, length_km: 6, path: null }],
          best_efforts: null, speed_bests: null, max_speed_ms: null,
        },
      },
    ]))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.allTime.biggestClimb).toEqual({ workoutId: 'w1', date: '2026-03-01', elev_gain_m: 500, length_km: 6 })
    expect(body.byYear['2026'].biggestClimb).toEqual({ workoutId: 'w1', date: '2026-03-01', elev_gain_m: 500, length_km: 6 })
  })
```
becomes:
```typescript
  it('returns computed all-time and per-year bests for the current user\'s rides', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([
      {
        id: 'w1', icu_activity_id: 'icu-1', date: '2026-03-01',
        activity_metrics: {
          climbs: [{ start_km: 2, duration_secs: 300, elev_gain_m: 500, avg_watts: 220, vam: 600, length_km: 6, path: null }],
          best_efforts: null, speed_bests: null, max_speed_ms: null,
        },
      },
    ]))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.allTime.biggestClimb).toEqual({ workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-03-01', elev_gain_m: 500, length_km: 6 })
    expect(body.byYear['2026'].biggestClimb).toEqual({ workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-03-01', elev_gain_m: 500, length_km: 6 })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/all-time-bests.test.ts __tests__/api/bests.test.ts`
Expected: FAIL — `icuActivityId` is missing from every actual output (the type doesn't produce it yet), and the two new tests fail (`id: null` isn't a valid `BestsRide.id` yet; `max_speed_ms` isn't a field on `maxSpeed` entries yet).

- [ ] **Step 3: Implement**

In `lib/ride/all-time-bests.ts`, replace the whole file's type/function definitions (the detection-agnostic parts — `BestsRide`, `AllTimeBests`, and `computeAllTimeBests`'s body) with the widened versions. Currently:

```typescript
import type { ActivityMetrics } from '@/types'

export interface AllTimeBests {
  biggestClimb: { workoutId: string; date: string; elev_gain_m: number; length_km: number | null } | null
  longestClimb: { workoutId: string; date: string; length_km: number; elev_gain_m: number } | null
  powerBests: Array<{ secs: number; watts: number; workoutId: string; date: string }>
  speedBests: Array<{ distance_km: number; avg_speed_kmh: number; workoutId: string; date: string }>
  maxSpeed: { workoutId: string; date: string; speed_kmh: number } | null
}

export interface AllTimeBestsResponse {
  allTime: AllTimeBests
  byYear: Record<string, AllTimeBests>
}

export interface BestsRide {
  id: string
  date: string
  activity_metrics: ActivityMetrics | null
}
```
to:
```typescript
import type { ActivityMetrics, ClimbSegment, SpeedBest } from '@/types'

export interface AllTimeBests {
  biggestClimb: { workoutId: string | null; icuActivityId: string; date: string; elev_gain_m: number; length_km: number | null } | null
  longestClimb: { workoutId: string | null; icuActivityId: string; date: string; length_km: number; elev_gain_m: number } | null
  powerBests: Array<{ secs: number; watts: number; workoutId: string | null; icuActivityId: string; date: string }>
  speedBests: Array<{ distance_km: number; avg_speed_kmh: number; workoutId: string | null; icuActivityId: string; date: string }>
  maxSpeed: { workoutId: string | null; icuActivityId: string; date: string; speed_kmh: number; max_speed_ms: number } | null
}

export interface AllTimeBestsResponse {
  allTime: AllTimeBests
  byYear: Record<string, AllTimeBests>
}

// Only the fields computeAllTimeBests actually reads — decoupled from the full
// ActivityMetrics shape so a "synthetic" candidate (reconstructed from a stored
// champion, or produced by the deep-history scan with no local workouts row)
// never needs to fake unrelated fields like decoupling_pct or shape.
export interface BestsCandidateMetrics {
  climbs: Array<Pick<ClimbSegment, 'elev_gain_m' | 'length_km'>> | null
  best_efforts: Array<{ secs: number; watts: number }> | null
  speed_bests: Array<Pick<SpeedBest, 'distance_km' | 'avg_speed_kmh'>> | null
  max_speed_ms: number | null
}

export interface BestsRide {
  id: string | null           // workouts.id — null when this ride has no local row (deep-history scan)
  icu_activity_id: string     // always present — every ride reaching this reducer came from an intervals.icu activity
  date: string
  activity_metrics: BestsCandidateMetrics | null
}
```

Note: `ActivityMetrics`'s real `climbs`/`speed_bests` fields are structurally assignable to `BestsCandidateMetrics`'s narrowed `Pick<...>` array types (a full object satisfies a `Pick` of itself), so every existing caller passing a full `ActivityMetrics` object continues to compile with no changes needed at the call site.

Update `computeAllTimeBests`'s body (currently):
```typescript
export function computeAllTimeBests(rides: BestsRide[]): AllTimeBests {
  let biggestClimb: AllTimeBests['biggestClimb'] = null
  let longestClimb: AllTimeBests['longestClimb'] = null
  let maxSpeed: AllTimeBests['maxSpeed'] = null
  const powerBestsByDuration = new Map<number, { watts: number; workoutId: string; date: string }>()
  const speedBestsByDistance = new Map<number, { avg_speed_kmh: number; workoutId: string; date: string }>()

  for (const r of rides) {
    const m = r.activity_metrics
    if (!m) continue

    for (const climb of m.climbs ?? []) {
      if (!biggestClimb || climb.elev_gain_m > biggestClimb.elev_gain_m) {
        biggestClimb = { workoutId: r.id, date: r.date, elev_gain_m: climb.elev_gain_m, length_km: climb.length_km ?? null }
      }
      // Un-backfilled historical climbs don't have length_km yet — never let one
      // become (or beat) the longest-climb record until it's actually measured.
      if (climb.length_km != null && (!longestClimb || climb.length_km > longestClimb.length_km)) {
        longestClimb = { workoutId: r.id, date: r.date, length_km: climb.length_km, elev_gain_m: climb.elev_gain_m }
      }
    }

    for (const effort of m.best_efforts ?? []) {
      const existing = powerBestsByDuration.get(effort.secs)
      if (!existing || effort.watts > existing.watts) {
        powerBestsByDuration.set(effort.secs, { watts: effort.watts, workoutId: r.id, date: r.date })
      }
    }

    for (const speed of m.speed_bests ?? []) {
      const existing = speedBestsByDistance.get(speed.distance_km)
      if (!existing || speed.avg_speed_kmh > existing.avg_speed_kmh) {
        speedBestsByDistance.set(speed.distance_km, { avg_speed_kmh: speed.avg_speed_kmh, workoutId: r.id, date: r.date })
      }
    }

    if (m.max_speed_ms != null) {
      const speed_kmh = Math.round(m.max_speed_ms * 3.6 * 10) / 10
      if (!maxSpeed || speed_kmh > maxSpeed.speed_kmh) {
        maxSpeed = { workoutId: r.id, date: r.date, speed_kmh }
      }
    }
  }

  const powerBests = [...powerBestsByDuration.entries()]
    .map(([secs, v]) => ({ secs, ...v }))
    .sort((a, b) => a.secs - b.secs)
  const speedBests = [...speedBestsByDistance.entries()]
    .map(([distance_km, v]) => ({ distance_km, ...v }))
    .sort((a, b) => a.distance_km - b.distance_km)

  return { biggestClimb, longestClimb, powerBests, speedBests, maxSpeed }
}
```
to (every constructed entry gains `icuActivityId: r.icu_activity_id`, and `maxSpeed` gains `max_speed_ms: m.max_speed_ms`):
```typescript
export function computeAllTimeBests(rides: BestsRide[]): AllTimeBests {
  let biggestClimb: AllTimeBests['biggestClimb'] = null
  let longestClimb: AllTimeBests['longestClimb'] = null
  let maxSpeed: AllTimeBests['maxSpeed'] = null
  const powerBestsByDuration = new Map<number, { watts: number; workoutId: string | null; icuActivityId: string; date: string }>()
  const speedBestsByDistance = new Map<number, { avg_speed_kmh: number; workoutId: string | null; icuActivityId: string; date: string }>()

  for (const r of rides) {
    const m = r.activity_metrics
    if (!m) continue

    for (const climb of m.climbs ?? []) {
      if (!biggestClimb || climb.elev_gain_m > biggestClimb.elev_gain_m) {
        biggestClimb = { workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date, elev_gain_m: climb.elev_gain_m, length_km: climb.length_km ?? null }
      }
      // Un-backfilled historical climbs don't have length_km yet — never let one
      // become (or beat) the longest-climb record until it's actually measured.
      if (climb.length_km != null && (!longestClimb || climb.length_km > longestClimb.length_km)) {
        longestClimb = { workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date, length_km: climb.length_km, elev_gain_m: climb.elev_gain_m }
      }
    }

    for (const effort of m.best_efforts ?? []) {
      const existing = powerBestsByDuration.get(effort.secs)
      if (!existing || effort.watts > existing.watts) {
        powerBestsByDuration.set(effort.secs, { watts: effort.watts, workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date })
      }
    }

    for (const speed of m.speed_bests ?? []) {
      const existing = speedBestsByDistance.get(speed.distance_km)
      if (!existing || speed.avg_speed_kmh > existing.avg_speed_kmh) {
        speedBestsByDistance.set(speed.distance_km, { avg_speed_kmh: speed.avg_speed_kmh, workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date })
      }
    }

    if (m.max_speed_ms != null) {
      const speed_kmh = Math.round(m.max_speed_ms * 3.6 * 10) / 10
      if (!maxSpeed || speed_kmh > maxSpeed.speed_kmh) {
        maxSpeed = { workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date, speed_kmh, max_speed_ms: m.max_speed_ms }
      }
    }
  }

  const powerBests = [...powerBestsByDuration.entries()]
    .map(([secs, v]) => ({ secs, ...v }))
    .sort((a, b) => a.secs - b.secs)
  const speedBests = [...speedBestsByDistance.entries()]
    .map(([distance_km, v]) => ({ distance_km, ...v }))
    .sort((a, b) => a.distance_km - b.distance_km)

  return { biggestClimb, longestClimb, powerBests, speedBests, maxSpeed }
}
```

`computeAllTimeBestsByPeriod` needs no changes — it only groups/delegates, never constructs entries itself.

In `app/api/bests/route.ts`, add `icu_activity_id` to the query (currently):
```typescript
  const { data: rows, error } = await supabase
    .from('workouts')
    .select('id, date, activity_metrics')
    .eq('user_id', user.id)
    .in('status', ['completed', 'needs_review'])
    .not('activity_metrics', 'is', null)
```
to:
```typescript
  const { data: rows, error } = await supabase
    .from('workouts')
    .select('id, icu_activity_id, date, activity_metrics')
    .eq('user_id', user.id)
    .in('status', ['completed', 'needs_review'])
    .not('activity_metrics', 'is', null)
```

(No other line in this route changes in this task — Task 5 replaces this route's data source entirely; this task only keeps it correctly wired to the widened `BestsRide` shape in the meantime.)

**Fix `__tests__/components/AllTimeBestsTab.test.tsx`'s fixture — required, or this file fails to compile.** Its `makeResponse()` is explicitly typed `: AllTimeBestsResponse`, so the new required `icuActivityId`/`max_speed_ms` fields must be added to every entry now, in this task, not deferred to Task 9 (Task 9 only adds a new test on top of an already-compiling fixture). Update the fixture (currently):
```typescript
function makeResponse(overrides: Partial<AllTimeBestsResponse> = {}): AllTimeBestsResponse {
  return {
    allTime: {
      biggestClimb: { workoutId: 'w1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 },
      longestClimb: { workoutId: 'w2', date: '2025-11-02', length_km: 12.1, elev_gain_m: 480 },
      powerBests: [{ secs: 300, watts: 312, workoutId: 'w3', date: '2026-01-10' }],
      speedBests: [{ distance_km: 10, avg_speed_kmh: 38.4, workoutId: 'w4', date: '2026-05-01' }],
      maxSpeed: { workoutId: 'w5', date: '2024-07-04', speed_kmh: 68.2 },
    },
    byYear: {
      '2026': {
        biggestClimb: { workoutId: 'w1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 },
        longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null,
      },
      '2025': {
        biggestClimb: null,
        longestClimb: { workoutId: 'w2', date: '2025-11-02', length_km: 12.1, elev_gain_m: 480 },
        powerBests: [], speedBests: [], maxSpeed: null,
      },
    },
    ...overrides,
  }
}
```
to:
```typescript
function makeResponse(overrides: Partial<AllTimeBestsResponse> = {}): AllTimeBestsResponse {
  return {
    allTime: {
      biggestClimb: { workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 },
      longestClimb: { workoutId: 'w2', icuActivityId: 'icu-2', date: '2025-11-02', length_km: 12.1, elev_gain_m: 480 },
      powerBests: [{ secs: 300, watts: 312, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-01-10' }],
      speedBests: [{ distance_km: 10, avg_speed_kmh: 38.4, workoutId: 'w4', icuActivityId: 'icu-4', date: '2026-05-01' }],
      maxSpeed: { workoutId: 'w5', icuActivityId: 'icu-5', date: '2024-07-04', speed_kmh: 68.2, max_speed_ms: 18.9 },
    },
    byYear: {
      '2026': {
        biggestClimb: { workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 },
        longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null,
      },
      '2025': {
        biggestClimb: null,
        longestClimb: { workoutId: 'w2', icuActivityId: 'icu-2', date: '2025-11-02', length_km: 12.1, elev_gain_m: 480 },
        powerBests: [], speedBests: [], maxSpeed: null,
      },
    },
    ...overrides,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/all-time-bests.test.ts __tests__/api/bests.test.ts __tests__/components/AllTimeBestsTab.test.tsx`
Expected: PASS.

Then run the full suite and typecheck:

Run: `npm run test:ci`
Expected: all suites pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ride/all-time-bests.ts app/api/bests/route.ts __tests__/lib/all-time-bests.test.ts __tests__/api/bests.test.ts __tests__/components/AllTimeBestsTab.test.tsx
git commit -m "feat: widen bests types for workoutless rides and intervals.icu links"
```

---

### Task 3: `lib/ride/best-records.ts` — reconstruction, merge, and DB helpers

**Files:**
- Create: `lib/ride/best-records.ts`
- Test: `__tests__/lib/best-records.test.ts`

**Interfaces:**
- Consumes: `AllTimeBests`, `BestsRide`, `computeAllTimeBests` from Task 2 (`lib/ride/all-time-bests.ts`).
- Produces: `BestRecordRow` type; `reconstructSyntheticRides()`, `flattenAllTimeBestsToRows()`, `mergeCandidateIntoBests()` (pure); `fetchBestRecordRows()`, `upsertBestRecordRows()` (Supabase-backed). Tasks 4, 5, 6, 7 all consume this module.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/best-records.test.ts` with this exact content:

```typescript
import {
  reconstructSyntheticRides, flattenAllTimeBestsToRows, mergeCandidateIntoBests,
  type BestRecordRow,
} from '@/lib/ride/best-records'
import { computeAllTimeBests, type AllTimeBests, type BestsRide } from '@/lib/ride/all-time-bests'

function row(overrides: Partial<BestRecordRow>): BestRecordRow {
  return { period: 'all', category: 'biggest_climb', sub_key: '', value: 0, detail: {}, ...overrides }
}

describe('reconstructSyntheticRides', () => {
  it('reconstructs a climb row (biggest or longest) as a single-climb synthetic ride', () => {
    const rows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 } }),
    ]
    const rides = reconstructSyntheticRides(rows)
    expect(rides).toEqual([
      { id: 'w2', icu_activity_id: 'icu-2', date: '2026-02-01', activity_metrics: { climbs: [{ elev_gain_m: 900, length_km: 3 }], best_efforts: null, speed_bests: null, max_speed_ms: null } },
    ])
  })

  it('reconstructs a power row as a single-entry best_efforts synthetic ride', () => {
    const rows: BestRecordRow[] = [
      row({ category: 'power', sub_key: '300', value: 310, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2' } }),
    ]
    const rides = reconstructSyntheticRides(rows)
    expect(rides).toEqual([
      { id: 'w2', icu_activity_id: 'icu-2', date: '2026-02-01', activity_metrics: { climbs: null, best_efforts: [{ secs: 300, watts: 310 }], speed_bests: null, max_speed_ms: null } },
    ])
  })

  it('reconstructs a speed row as a single-entry speed_bests synthetic ride', () => {
    const rows: BestRecordRow[] = [
      row({ category: 'speed', sub_key: '10', value: 38.4, detail: { date: '2026-05-01', workoutId: null, icuActivityId: 'icu-4' } }),
    ]
    const rides = reconstructSyntheticRides(rows)
    expect(rides).toEqual([
      { id: null, icu_activity_id: 'icu-4', date: '2026-05-01', activity_metrics: { climbs: null, best_efforts: null, speed_bests: [{ distance_km: 10, avg_speed_kmh: 38.4 }], max_speed_ms: null } },
    ])
  })

  it('reconstructs a max_speed row using the stored raw max_speed_ms, not a reversed conversion', () => {
    const rows: BestRecordRow[] = [
      row({ category: 'max_speed', value: 68.5, detail: { date: '2024-07-04', workoutId: 'w5', icuActivityId: 'icu-5', max_speed_ms: 19.027 } }),
    ]
    const rides = reconstructSyntheticRides(rows)
    expect(rides).toEqual([
      { id: 'w5', icu_activity_id: 'icu-5', date: '2024-07-04', activity_metrics: { climbs: null, best_efforts: null, speed_bests: null, max_speed_ms: 19.027 } },
    ])
  })
})

describe('flattenAllTimeBestsToRows', () => {
  it('flattens a full AllTimeBests into one row per present category', () => {
    const bests: AllTimeBests = {
      biggestClimb: { workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', elev_gain_m: 900, length_km: 3 },
      longestClimb: { workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', length_km: 12, elev_gain_m: 400 },
      powerBests: [{ secs: 300, watts: 310, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-03-01' }],
      speedBests: [{ distance_km: 10, avg_speed_kmh: 38.4, workoutId: 'w4', icuActivityId: 'icu-4', date: '2026-04-01' }],
      maxSpeed: { workoutId: 'w5', icuActivityId: 'icu-5', date: '2026-05-01', speed_kmh: 68.5, max_speed_ms: 19.027 },
    }
    const rows = flattenAllTimeBestsToRows('all', bests)
    expect(rows).toEqual([
      { period: 'all', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 } },
      { period: 'all', category: 'longest_climb', sub_key: '', value: 12, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', elev_gain_m: 400 } },
      { period: 'all', category: 'power', sub_key: '300', value: 310, detail: { date: '2026-03-01', workoutId: 'w3', icuActivityId: 'icu-3' } },
      { period: 'all', category: 'speed', sub_key: '10', value: 38.4, detail: { date: '2026-04-01', workoutId: 'w4', icuActivityId: 'icu-4' } },
      { period: 'all', category: 'max_speed', sub_key: '', value: 68.5, detail: { date: '2026-05-01', workoutId: 'w5', icuActivityId: 'icu-5', max_speed_ms: 19.027 } },
    ])
  })

  it('omits rows for absent categories rather than emitting nulls', () => {
    const empty: AllTimeBests = { biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null }
    expect(flattenAllTimeBestsToRows('2026', empty)).toEqual([])
  })
})

describe('reconstruction and flattening round-trip losslessly', () => {
  it('feeding flattened rows back through reconstructSyntheticRides + computeAllTimeBests reproduces the same bests', () => {
    const original: BestsRide[] = [
      { id: 'w1', icu_activity_id: 'icu-1', date: '2026-01-01', activity_metrics: { climbs: [{ elev_gain_m: 900, length_km: 3 }], best_efforts: [{ secs: 300, watts: 310 }], speed_bests: [{ distance_km: 10, avg_speed_kmh: 38.4 }], max_speed_ms: 19.027 } },
    ]
    const computed = computeAllTimeBests(original)
    const rows = flattenAllTimeBestsToRows('all', computed)
    const synthetic = reconstructSyntheticRides(rows)
    const recomputed = computeAllTimeBests(synthetic)
    expect(recomputed).toEqual(computed)
  })
})

describe('mergeCandidateIntoBests', () => {
  it('keeps the existing champion when the new candidate does not beat it', () => {
    const existingAllTimeRows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 } }),
    ]
    const candidate: BestsRide = { id: 'w2', icu_activity_id: 'icu-2', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 300, length_km: 1 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { allTime } = mergeCandidateIntoBests(existingAllTimeRows, [], candidate)
    expect(allTime.biggestClimb).toEqual({ workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', elev_gain_m: 900, length_km: 3 })
  })

  it('replaces the champion when the new candidate beats it', () => {
    const existingAllTimeRows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 } }),
    ]
    const candidate: BestsRide = { id: 'w2', icu_activity_id: 'icu-2', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 1200, length_km: 8 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { allTime } = mergeCandidateIntoBests(existingAllTimeRows, [], candidate)
    expect(allTime.biggestClimb).toEqual({ workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-06-01', elev_gain_m: 1200, length_km: 8 })
  })

  it('seeds a category with no prior champion', () => {
    const candidate: BestsRide = { id: 'w1', icu_activity_id: 'icu-1', date: '2026-01-01', activity_metrics: { climbs: null, best_efforts: null, speed_bests: null, max_speed_ms: 15 } }
    const { allTime } = mergeCandidateIntoBests([], [], candidate)
    expect(allTime.maxSpeed).toEqual({ workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', speed_kmh: 54, max_speed_ms: 15 })
  })

  it('updates the yearBests bucket independently from allTime, using the candidate\'s own year', () => {
    const existingYearRows: BestRecordRow[] = [
      row({ period: '2026', category: 'biggest_climb', value: 400, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 2 } }),
    ]
    const candidate: BestsRide = { id: 'w2', icu_activity_id: 'icu-2', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 900, length_km: 3 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { year, yearBests } = mergeCandidateIntoBests([], existingYearRows, candidate)
    expect(year).toBe('2026')
    expect(yearBests.biggestClimb?.elev_gain_m).toBe(900)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/best-records.test.ts`
Expected: FAIL — `lib/ride/best-records.ts` doesn't exist yet ("Cannot find module").

- [ ] **Step 3: Implement**

Create `lib/ride/best-records.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAllTimeBests, type AllTimeBests, type BestsRide } from '@/lib/ride/all-time-bests'

export type BestCategory = 'biggest_climb' | 'longest_climb' | 'power' | 'speed' | 'max_speed'

export interface BestRecordRow {
  period: string
  category: BestCategory
  sub_key: string
  value: number
  detail: Record<string, unknown>
}

// Reconstructs each stored champion row as a minimal "synthetic ride" carrying
// only the one field relevant to its category — feeding these (plus one real
// candidate ride) back through computeAllTimeBests re-derives the correct new
// champions without needing any separate comparison logic.
export function reconstructSyntheticRides(rows: BestRecordRow[]): BestsRide[] {
  return rows.map((r): BestsRide => {
    const d = r.detail as { date: string; workoutId: string | null; icuActivityId: string; length_km?: number; elev_gain_m?: number; max_speed_ms?: number }
    const base = { id: d.workoutId, icu_activity_id: d.icuActivityId, date: d.date }
    switch (r.category) {
      case 'biggest_climb':
      case 'longest_climb':
        return { ...base, activity_metrics: { climbs: [{ elev_gain_m: r.category === 'biggest_climb' ? r.value : (d.elev_gain_m as number), length_km: r.category === 'longest_climb' ? r.value : (d.length_km ?? null) }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
      case 'power':
        return { ...base, activity_metrics: { climbs: null, best_efforts: [{ secs: Number(r.sub_key), watts: r.value }], speed_bests: null, max_speed_ms: null } }
      case 'speed':
        return { ...base, activity_metrics: { climbs: null, best_efforts: null, speed_bests: [{ distance_km: Number(r.sub_key), avg_speed_kmh: r.value }], max_speed_ms: null } }
      case 'max_speed':
        return { ...base, activity_metrics: { climbs: null, best_efforts: null, speed_bests: null, max_speed_ms: d.max_speed_ms as number } }
    }
  })
}

// The inverse of reconstructSyntheticRides: turns a computed AllTimeBests into
// the rows to upsert for one period. Omits a row entirely for any absent
// category rather than writing a null placeholder.
export function flattenAllTimeBestsToRows(period: string, bests: AllTimeBests): BestRecordRow[] {
  const rows: BestRecordRow[] = []
  if (bests.biggestClimb) {
    const c = bests.biggestClimb
    rows.push({ period, category: 'biggest_climb', sub_key: '', value: c.elev_gain_m, detail: { date: c.date, workoutId: c.workoutId, icuActivityId: c.icuActivityId, length_km: c.length_km } })
  }
  if (bests.longestClimb) {
    const c = bests.longestClimb
    rows.push({ period, category: 'longest_climb', sub_key: '', value: c.length_km, detail: { date: c.date, workoutId: c.workoutId, icuActivityId: c.icuActivityId, elev_gain_m: c.elev_gain_m } })
  }
  for (const p of bests.powerBests) {
    rows.push({ period, category: 'power', sub_key: String(p.secs), value: p.watts, detail: { date: p.date, workoutId: p.workoutId, icuActivityId: p.icuActivityId } })
  }
  for (const s of bests.speedBests) {
    rows.push({ period, category: 'speed', sub_key: String(s.distance_km), value: s.avg_speed_kmh, detail: { date: s.date, workoutId: s.workoutId, icuActivityId: s.icuActivityId } })
  }
  if (bests.maxSpeed) {
    const m = bests.maxSpeed
    rows.push({ period, category: 'max_speed', sub_key: '', value: m.speed_kmh, detail: { date: m.date, workoutId: m.workoutId, icuActivityId: m.icuActivityId, max_speed_ms: m.max_speed_ms } })
  }
  return rows
}

// Merges one new candidate ride into the currently-stored champions for both
// "all-time" and the candidate's own year, reusing computeAllTimeBests as the
// sole comparison authority. Pure — callers persist the results themselves.
export function mergeCandidateIntoBests(
  existingAllTimeRows: BestRecordRow[],
  existingYearRows: BestRecordRow[],
  candidate: BestsRide,
): { allTime: AllTimeBests; year: string; yearBests: AllTimeBests } {
  const year = candidate.date.slice(0, 4)
  const allTime = computeAllTimeBests([...reconstructSyntheticRides(existingAllTimeRows), candidate])
  const yearBests = computeAllTimeBests([...reconstructSyntheticRides(existingYearRows), candidate])
  return { allTime, year, yearBests }
}

export async function fetchBestRecordRows(supabase: SupabaseClient, userId: string, period: string): Promise<BestRecordRow[]> {
  const { data, error } = await supabase
    .from('best_records')
    .select('period, category, sub_key, value, detail')
    .eq('user_id', userId)
    .eq('period', period)
  if (error) throw new Error(error.message)
  return (data ?? []) as BestRecordRow[]
}

export async function upsertBestRecordRows(supabase: SupabaseClient, userId: string, rows: BestRecordRow[]): Promise<void> {
  if (!rows.length) return
  const { error } = await supabase
    .from('best_records')
    .upsert(
      rows.map(r => ({ user_id: userId, ...r })),
      { onConflict: 'user_id,period,category,sub_key' },
    )
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/best-records.test.ts`
Expected: PASS.

Then run the full suite and typecheck:

Run: `npm run test:ci`
Expected: all suites pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ride/best-records.ts __tests__/lib/best-records.test.ts
git commit -m "feat: add best-records reconstruction, merge, and DB helpers"
```

---

### Task 4: Resync route

**Files:**
- Create: `app/api/admin/resync-bests/route.ts`
- Test: `__tests__/api/resync-bests.test.ts`

**Interfaces:**
- Consumes: `computeAllTimeBestsByPeriod` (Task 2, `lib/ride/all-time-bests.ts`), `flattenAllTimeBestsToRows`/`upsertBestRecordRows` (Task 3, `lib/ride/best-records.ts`).
- Produces: `POST /api/admin/resync-bests` — safe to call repeatedly at any time.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/resync-bests.test.ts` with this exact content:

```typescript
/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

import { POST } from '@/app/api/admin/resync-bests/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase({ userId = 'u1', workoutRows = [] as unknown[], upsertSpy = jest.fn() } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: (table: string) => {
      if (table === 'workouts') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                not: async () => ({ data: workoutRows, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'best_records') {
        return { upsert: (rows: unknown[], opts: unknown) => { upsertSpy(rows, opts); return Promise.resolve({ error: null }) } }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('POST /api/admin/resync-bests', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ userId: '' }))
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it('computes bests from current workouts rows and upserts them into best_records', async () => {
    const upsertSpy = jest.fn()
    const workoutRows = [
      {
        id: 'w1', icu_activity_id: 'icu-1', date: '2026-03-01',
        activity_metrics: { climbs: [{ elev_gain_m: 500, length_km: 6 }], best_efforts: null, speed_bests: null, max_speed_ms: null },
      },
    ]
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ workoutRows, upsertSpy }))
    const res = await POST()
    expect(res.status).toBe(200)
    expect(upsertSpy).toHaveBeenCalled()
    const [rows] = upsertSpy.mock.calls[0]
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: 'u1', period: 'all', category: 'biggest_climb', value: 500 }),
        expect.objectContaining({ user_id: 'u1', period: '2026', category: 'biggest_climb', value: 500 }),
      ]),
    )
  })

  it('is safe to call with zero rides (writes nothing, still returns 200)', async () => {
    const upsertSpy = jest.fn()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ workoutRows: [], upsertSpy }))
    const res = await POST()
    expect(res.status).toBe(200)
    expect(upsertSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/api/resync-bests.test.ts`
Expected: FAIL — `app/api/admin/resync-bests/route.ts` doesn't exist yet ("Cannot find module").

- [ ] **Step 3: Implement**

Create `app/api/admin/resync-bests/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { computeAllTimeBestsByPeriod, type BestsRide } from '@/lib/ride/all-time-bests'
import { flattenAllTimeBestsToRows, upsertBestRecordRows } from '@/lib/ride/best-records'

export const dynamic = 'force-dynamic'

/** Recomputes best_records from scratch from the current workouts rows. Safe to
 * re-run at any time — this is the correction path for the "champion records
 * only ever go up" limitation (e.g. after disassociating a workout, or after
 * an algorithm fix that would otherwise leave a stale, too-high value behind). */
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rows, error } = await supabase
    .from('workouts')
    .select('id, icu_activity_id, date, activity_metrics')
    .eq('user_id', user.id)
    .in('status', ['completed', 'needs_review'])
    .not('activity_metrics', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rides = (rows ?? []) as BestsRide[]
  const { allTime, byYear } = computeAllTimeBestsByPeriod(rides)

  const allRows = [
    ...flattenAllTimeBestsToRows('all', allTime),
    ...Object.entries(byYear).flatMap(([year, bests]) => flattenAllTimeBestsToRows(year, bests)),
  ]
  await upsertBestRecordRows(supabase, user.id, allRows)

  return NextResponse.json({ ridesScanned: rides.length, rowsWritten: allRows.length })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/resync-bests.test.ts`
Expected: PASS.

Then run the full suite and typecheck:

Run: `npm run test:ci`
Expected: all suites pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/resync-bests/route.ts __tests__/api/resync-bests.test.ts
git commit -m "feat: add resync-bests route"
```

---

### Task 5: Rewrite `/api/bests` to read from `best_records`

**Files:**
- Modify: `app/api/bests/route.ts`
- Test: `__tests__/api/bests.test.ts`

**Interfaces:**
- Consumes: `fetchBestRecordRows` (Task 3), plus a new pure assembler this task adds.
- Produces: `GET /api/bests` now backed by `best_records` instead of live-scanning `workouts`.

- [ ] **Step 1: Write the failing tests**

Replace `__tests__/api/bests.test.ts` in full with this exact content (the whole file changes shape, since the route's data source changes from `workouts` to `best_records`):

```typescript
/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

import { GET } from '@/app/api/bests/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { BestRecordRow } from '@/lib/ride/best-records'

function makeSupabase(rowsByPeriod: Record<string, BestRecordRow[]>, userId: string | null = 'u1') {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: (_col: string, period: string) => Promise.resolve({ data: rowsByPeriod[period] ?? [], error: null }),
        }),
      }),
    }),
  }
}

describe('GET /api/bests', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({}, null))
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('assembles allTime and byYear from stored best_records rows, without scanning workouts', async () => {
    const rowsByPeriod: Record<string, BestRecordRow[]> = {
      all: [
        { period: 'all', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 } },
      ],
      '2026': [
        { period: '2026', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 } },
      ],
    }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(rowsByPeriod))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.allTime.biggestClimb).toEqual({ workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 })
    expect(body.byYear['2026'].biggestClimb).toEqual({ workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 })
  })

  it('returns empty bests when best_records has no rows yet', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({}))
    const res = await GET()
    const body = await res.json()
    expect(body.allTime).toEqual({ biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null })
    expect(body.byYear).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/api/bests.test.ts`
Expected: FAIL — the route still queries `workouts` directly (Task 2's state), which doesn't match this test's Supabase stub shape (no `in`/`not` chain), and the route doesn't yet know how to discover which years to fetch.

- [ ] **Step 3: Implement**

Add a small assembler to `lib/ride/best-records.ts` — append this export (after `flattenAllTimeBestsToRows`, before `mergeCandidateIntoBests`):

```typescript
// Turns a flat list of stored rows for one period back into an AllTimeBests —
// the read-side counterpart to flattenAllTimeBestsToRows. Categories with no
// row simply stay at their default null/empty value.
export function assembleAllTimeBests(rows: BestRecordRow[]): AllTimeBests {
  const bests: AllTimeBests = { biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null }
  for (const r of rows) {
    const d = r.detail as { date: string; workoutId: string | null; icuActivityId: string; length_km?: number; elev_gain_m?: number; max_speed_ms?: number }
    if (r.category === 'biggest_climb') bests.biggestClimb = { workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date, elev_gain_m: r.value, length_km: d.length_km ?? null }
    if (r.category === 'longest_climb') bests.longestClimb = { workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date, length_km: r.value, elev_gain_m: d.elev_gain_m as number }
    if (r.category === 'power') bests.powerBests.push({ secs: Number(r.sub_key), watts: r.value, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date })
    if (r.category === 'speed') bests.speedBests.push({ distance_km: Number(r.sub_key), avg_speed_kmh: r.value, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date })
    if (r.category === 'max_speed') bests.maxSpeed = { workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date, speed_kmh: r.value, max_speed_ms: d.max_speed_ms as number }
  }
  bests.powerBests.sort((a, b) => a.secs - b.secs)
  bests.speedBests.sort((a, b) => a.distance_km - b.distance_km)
  return bests
}
```

Replace `app/api/bests/route.ts` in full (currently, after Task 2's small tweak):
```typescript
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { computeAllTimeBestsByPeriod, type BestsRide } from '@/lib/ride/all-time-bests'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rows, error } = await supabase
    .from('workouts')
    .select('id, icu_activity_id, date, activity_metrics')
    .eq('user_id', user.id)
    .in('status', ['completed', 'needs_review'])
    .not('activity_metrics', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rides = (rows ?? []) as BestsRide[]
  return NextResponse.json(computeAllTimeBestsByPeriod(rides))
}
```
with:
```typescript
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { AllTimeBestsResponse } from '@/lib/ride/all-time-bests'
import { assembleAllTimeBests, type BestRecordRow } from '@/lib/ride/best-records'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rows, error } = await supabase
    .from('best_records')
    .select('period, category, sub_key, value, detail')
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const allRows = (rows ?? []) as BestRecordRow[]
  const allTime = assembleAllTimeBests(allRows.filter(r => r.period === 'all'))
  const byYear: AllTimeBestsResponse['byYear'] = {}
  for (const r of allRows) {
    if (r.period === 'all') continue
    if (!byYear[r.period]) byYear[r.period] = assembleAllTimeBests(allRows.filter(x => x.period === r.period))
  }
  return NextResponse.json({ allTime, byYear })
}
```

Note this task's implementation fetches ALL rows for the user in one query rather than one query per period (simpler, and `best_records` is always small — at most ~13 rows per period × however many years exist, still trivial at any realistic scale) — which is why the test's Supabase stub in Step 1 needed adjusting to a single `.eq('user_id', ...)` chain rather than the plan's earlier `.eq('period', ...)` sketch. If you already wrote the stub with a period-keyed second `.eq()`, keep it — the route's single query with client-side grouping still satisfies it, since the stub's `eq(_col, period)` call only fires when the route explicitly filters by period, which this implementation doesn't do; adjust the test's stub to a single-`eq` shape returning all rows if needed, matching the implementation above exactly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/bests.test.ts`
Expected: PASS. (If Step 1's stub doesn't match this implementation's single-query shape, fix the stub to match — the important thing is the route reads from `best_records` and correctly assembles `allTime`/`byYear`, not the exact mock call shape.)

Then run the full suite and typecheck:

Run: `npm run test:ci`
Expected: all suites pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/ride/best-records.ts app/api/bests/route.ts __tests__/api/bests.test.ts
git commit -m "feat: read /api/bests from best_records instead of scanning workouts"
```

---

### Task 6: Incremental update on every future ride enrichment

**Files:**
- Modify: `lib/intervals/enrich.ts`
- Test: `__tests__/lib/enrich.test.ts` (already exists — read it in full before editing; its `makeSupabase` helper needs a new `best_records` branch alongside its existing `workouts` branch)

**Interfaces:**
- Consumes: `mergeCandidateIntoBests`, `fetchBestRecordRows`, `flattenAllTimeBestsToRows`, `upsertBestRecordRows` (Task 3).
- Produces: `backfillActivityMetrics` now also keeps `best_records` current as a side effect of its existing enrichment loop.

- [ ] **Step 1: Write the failing tests**

`__tests__/lib/enrich.test.ts` already exists with 8 tests and a `makeSupabase(rows, updateSpy, gteSpy?)` helper whose `.from(table)` special-cases `'workouts'` and falls through to a generic chainable `query` object (terminating via `.maybeSingle()`, used for the `user_profile` lookup) for everything else. None of its 8 existing row fixtures include a `date` field — this task's implementation reads `row.date` to merge into `best_records`, so **do not** add `date` to those 8 fixtures just to avoid a crash; the merge step is (by design, see Step 3) wrapped in its own try/catch that logs and swallows any failure without failing the enrichment itself, so those 8 existing tests keep passing unchanged (the merge silently no-ops for them, which is fine — they don't assert anything about `best_records`). Only the *new* test below needs a fixture row with a real `date`.

Add a `best_records` branch to `makeSupabase` (currently):
```typescript
function makeSupabase(rows: Array<{ id: string; icu_activity_id: string; steps: unknown; activity_metrics?: unknown }>, updateSpy: jest.Mock, gteSpy?: jest.Mock) {
  const query: Record<string, unknown> = {}
  const self = () => query
  Object.assign(query, {
    select: self, eq: self, in: self, not: self,
    gte: (col: string, val: unknown) => { gteSpy?.(col, val); return query },
    order: () => Promise.resolve({ data: rows, error: null }),
    maybeSingle: () => Promise.resolve({ data: { current_ftp: 200 }, error: null }),
  })
  return {
    from: (table: string) => {
      if (table === 'workouts') {
        return {
          ...query,
          update: (patch: unknown) => ({ eq: (_c: string, id: string) => { updateSpy(id, patch); return Promise.resolve({ error: null }) } }),
        }
      }
      return query // user_profile → maybeSingle resolves { current_ftp: 200 }
    },
  }
}
```
to (accepting an optional `bestRecordsUpsertSpy` so the new test can observe it, defaulting to an empty-rows read so the 8 existing tests need no changes):
```typescript
function makeSupabase(rows: Array<{ id: string; icu_activity_id: string; steps: unknown; activity_metrics?: unknown; date?: string }>, updateSpy: jest.Mock, gteSpy?: jest.Mock, bestRecordsUpsertSpy?: jest.Mock) {
  const query: Record<string, unknown> = {}
  const self = () => query
  Object.assign(query, {
    select: self, eq: self, in: self, not: self,
    gte: (col: string, val: unknown) => { gteSpy?.(col, val); return query },
    order: () => Promise.resolve({ data: rows, error: null }),
    maybeSingle: () => Promise.resolve({ data: { current_ftp: 200 }, error: null }),
  })
  return {
    from: (table: string) => {
      if (table === 'workouts') {
        return {
          ...query,
          update: (patch: unknown) => ({ eq: (_c: string, id: string) => { updateSpy(id, patch); return Promise.resolve({ error: null }) } }),
        }
      }
      if (table === 'best_records') {
        return {
          select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }),
          upsert: (upsertRows: unknown[], opts: unknown) => { bestRecordsUpsertSpy?.(upsertRows, opts); return Promise.resolve({ error: null }) },
        }
      }
      return query // user_profile → maybeSingle resolves { current_ftp: 200 }
    },
  }
}
```

Add this new test to the `describe('backfillActivityMetrics', ...)` block:
```typescript
  it('merges each successfully-enriched ride into best_records (all-time and its year)', async () => {
    const updateSpy = jest.fn()
    const bestRecordsUpsertSpy = jest.fn()
    const supabase = makeSupabase(
      [{ id: 'w1', icu_activity_id: 'a1', steps: null, date: '2026-05-20' }],
      updateSpy, undefined, bestRecordsUpsertSpy,
    )
    const client = makeClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await backfillActivityMetrics(supabase as any, client as any, 'u1')

    expect(bestRecordsUpsertSpy).toHaveBeenCalled()
    const periods = bestRecordsUpsertSpy.mock.calls.map(([rows]) => rows.map((r: { period: string }) => r.period)).flat()
    expect(periods).toEqual(expect.arrayContaining(['all', '2026']))
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/enrich.test.ts`
Expected: the 8 pre-existing tests still PASS (the `date`-less merge step silently no-ops, caught by its own try/catch). The new test FAILS — `best_records` is never touched by `backfillActivityMetrics` yet, so `bestRecordsUpsertSpy` is never called.

- [ ] **Step 3: Implement**

In `lib/intervals/enrich.ts`, add the import:
```typescript
import { fetchBestRecordRows, upsertBestRecordRows, mergeCandidateIntoBests, flattenAllTimeBestsToRows } from '@/lib/ride/best-records'
```

Update the per-row loop inside `backfillActivityMetrics` (currently):
```typescript
  for (const row of needing) {
    try {
      const metrics = await enrichActivityById(client, row.icu_activity_id, ftp, lthr, row.steps)
      const { error: updateError } = await supabase
        .from('workouts')
        .update({ activity_metrics: metrics })
        .eq('id', row.id)
      if (updateError) throw new Error(updateError.message)
      enriched++
    } catch (err) {
      failed++
      if (!firstError) firstError = err instanceof Error ? err.message : String(err)
      console.error(`[backfill] failed to enrich workout ${row.id}:`, err)
    }
  }
```
to:
```typescript
  for (const row of needing) {
    try {
      const metrics = await enrichActivityById(client, row.icu_activity_id, ftp, lthr, row.steps)
      const { error: updateError } = await supabase
        .from('workouts')
        .update({ activity_metrics: metrics })
        .eq('id', row.id)
      if (updateError) throw new Error(updateError.message)
      enriched++

      // Keep best_records current as each ride is (re)enriched — failures here
      // are logged but never fail the enrichment itself; a resync can always
      // recover if a merge is missed.
      try {
        const rideDate = row.date
        const candidate = { id: row.id, icu_activity_id: row.icu_activity_id, date: rideDate, activity_metrics: metrics }
        const year = rideDate.slice(0, 4)
        const [allTimeRows, yearRows] = await Promise.all([
          fetchBestRecordRows(supabase, userId, 'all'),
          fetchBestRecordRows(supabase, userId, year),
        ])
        const { allTime, yearBests } = mergeCandidateIntoBests(allTimeRows, yearRows, candidate)
        await upsertBestRecordRows(supabase, userId, [
          ...flattenAllTimeBestsToRows('all', allTime),
          ...flattenAllTimeBestsToRows(year, yearBests),
        ])
      } catch (bestsErr) {
        console.error(`[backfill] failed to merge workout ${row.id} into best_records:`, bestsErr)
      }
    } catch (err) {
      failed++
      if (!firstError) firstError = err instanceof Error ? err.message : String(err)
      console.error(`[backfill] failed to enrich workout ${row.id}:`, err)
    }
  }
```

This requires `row.date` to exist on the queried candidate rows. Update the `candidates` query's `.select(...)` (currently):
```typescript
  const base = supabase
    .from('workouts')
    .select('id, icu_activity_id, steps, activity_metrics')
    .eq('user_id', userId)
```
to:
```typescript
  const base = supabase
    .from('workouts')
    .select('id, icu_activity_id, steps, activity_metrics, date')
    .eq('user_id', userId)
```

Widen the `candidates` cast type (currently):
```typescript
  const candidates = (rows ?? []) as Array<{
    id: string; icu_activity_id: string; steps: WorkoutStep[] | null
    activity_metrics: { distributions?: unknown; metrics_version?: number } | null
  }>
```
to:
```typescript
  const candidates = (rows ?? []) as Array<{
    id: string; icu_activity_id: string; steps: WorkoutStep[] | null; date: string
    activity_metrics: { distributions?: unknown; metrics_version?: number } | null
  }>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/enrich.test.ts`
Expected: PASS — all 8 pre-existing tests plus the new one.

Then run the full suite and typecheck:

Run: `npm run test:ci`
Expected: all suites pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/intervals/enrich.ts __tests__/lib/enrich.test.ts
git commit -m "feat: merge each enriched ride into best_records incrementally"
```

---

### Task 7: Deep-history batch scan

**Files:**
- Create: `lib/intervals/deep-history-bests.ts`
- Test: `__tests__/lib/deep-history-bests.test.ts`

**Interfaces:**
- Consumes: `IntervalsClient` (`lib/intervals/client.ts`), `extractActivityMetrics`/`extractStreamInsights` (`lib/claude/activity-metrics.ts`), `mergeCandidateIntoBests`/`fetchBestRecordRows`/`flattenAllTimeBestsToRows`/`upsertBestRecordRows` (Task 3).
- Produces: `runDeepHistoryBestsBatch()`. Task 8 consumes this.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/deep-history-bests.test.ts` with this exact content:

```typescript
/** @jest-environment node */
import { runDeepHistoryBestsBatch } from '@/lib/intervals/deep-history-bests'
import type { ICUActivity } from '@/types'

function makeActivity(overrides: Partial<ICUActivity> = {}): ICUActivity {
  return {
    id: 'a1', start_date_local: '2020-06-15T08:00:00', type: 'Ride', moving_time: 3600,
    name: 'Old ride', average_watts: 200, max_watts: 400, weighted_average_watts: 210,
    average_heartrate: 140, training_load: 60, rolling_ftp: null, distance: 30000,
    total_elevation_gain: 300, left_right_balance: null,
    ...overrides,
  }
}

function makeClient(activities: ICUActivity[]) {
  return {
    getActivities: jest.fn().mockResolvedValue(activities),
    getPowerCurve: jest.fn().mockResolvedValue(null),
    getActivityStreams: jest.fn().mockResolvedValue(null),
  }
}

function makeSupabase({ existingRows = [] as unknown[], upsertSpy = jest.fn() } = {}) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ eq: async () => ({ data: existingRows, error: null }) }) }),
      upsert: (rows: unknown[], opts: unknown) => { upsertSpy(rows, opts); return Promise.resolve({ error: null }) },
    }),
  }
}

describe('runDeepHistoryBestsBatch', () => {
  it('returns reachedPossibleStart when no activities are found older than the cursor', async () => {
    const client = makeClient([])
    const result = await runDeepHistoryBestsBatch(makeSupabase() as never, client as never, 'u1', '2020-01-01')
    expect(result).toEqual({ fetched: 0, processed: 0, newCursor: null, reachedPossibleStart: true })
  })

  it('processes up to 25 rides, oldest-in-batch becomes the new cursor', async () => {
    const activities = Array.from({ length: 30 }, (_, i) =>
      makeActivity({ id: `a${i}`, start_date_local: `2019-12-${String(31 - i).padStart(2, '0')}T08:00:00` }),
    )
    const upsertSpy = jest.fn()
    const client = makeClient(activities)
    const result = await runDeepHistoryBestsBatch(makeSupabase({ upsertSpy }) as never, client as never, 'u1', '2020-01-01')
    expect(result.fetched).toBe(30)
    expect(result.processed).toBe(25)
    expect(result.newCursor).toBe('2019-12-07')  // 25th-oldest processed date in the batch
    expect(result.reachedPossibleStart).toBe(false)
    expect(upsertSpy).toHaveBeenCalled()
  })

  it('filters out non-ride activity types before batching', async () => {
    const activities = [
      makeActivity({ id: 'run1', type: 'Run', start_date_local: '2019-12-30T08:00:00' }),
      makeActivity({ id: 'ride1', type: 'Ride', start_date_local: '2019-12-29T08:00:00' }),
    ]
    const client = makeClient(activities)
    const result = await runDeepHistoryBestsBatch(makeSupabase() as never, client as never, 'u1', '2020-01-01')
    expect(result.fetched).toBe(1)
    expect(result.processed).toBe(1)
  })

  it('does not throw when a single ride\'s enrichment fails, and still advances the cursor past it', async () => {
    const activities = [makeActivity({ id: 'bad1', start_date_local: '2019-12-30T08:00:00' })]
    const client = {
      getActivities: jest.fn().mockResolvedValue(activities),
      getPowerCurve: jest.fn().mockRejectedValue(new Error('network error')),
      getActivityStreams: jest.fn().mockRejectedValue(new Error('network error')),
    }
    const result = await runDeepHistoryBestsBatch(makeSupabase() as never, client as never, 'u1', '2020-01-01')
    expect(result.processed).toBe(1)
    expect(result.newCursor).toBe('2019-12-30')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/deep-history-bests.test.ts`
Expected: FAIL — `lib/intervals/deep-history-bests.ts` doesn't exist yet ("Cannot find module").

- [ ] **Step 3: Implement**

Create `lib/intervals/deep-history-bests.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { IntervalsClient } from './client'
import { extractActivityMetrics, extractStreamInsights } from '@/lib/claude/activity-metrics'
import { fetchBestRecordRows, upsertBestRecordRows, mergeCandidateIntoBests, flattenAllTimeBestsToRows } from '@/lib/ride/best-records'
import type { BestsRide } from '@/lib/ride/all-time-bests'

const DEEP_HISTORY_BATCH_SIZE = 25
const DEEP_HISTORY_FETCH_WINDOW_DAYS = 3 * 365

export interface DeepHistoryBestsResult {
  fetched: number             // ride activities found in the fetched window
  processed: number           // how many were attempted this run (<= DEEP_HISTORY_BATCH_SIZE)
  newCursor: string | null    // date to resume from next time; null if nothing was found at all
  reachedPossibleStart: boolean  // fetched < batch size — a heuristic, not a certainty
}

// One chunk of the resumable deep-history scan: fetches ride activities older
// than `cursor`, computes bests-relevant candidates purely in memory (no FTP,
// no laps, no workouts writes — ride data is discarded immediately after
// merging), and updates best_records for both "all-time" and each ride's own
// year. Mirrors this app's existing BACKFILL_LIMIT convention (25 items/run).
export async function runDeepHistoryBestsBatch(
  supabase: SupabaseClient,
  client: IntervalsClient,
  userId: string,
  cursor: string,
): Promise<DeepHistoryBestsResult> {
  const newest = cursor
  const oldestFloor = new Date(new Date(`${cursor}T00:00:00Z`).getTime() - DEEP_HISTORY_FETCH_WINDOW_DAYS * 86400000)
    .toISOString().split('T')[0]

  const fetchedActivities = (await client.getActivities(oldestFloor, newest))
    .filter(a => /ride/i.test(a.type) && a.start_date_local.split('T')[0] < cursor)
    .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))

  if (fetchedActivities.length === 0) {
    return { fetched: 0, processed: 0, newCursor: null, reachedPossibleStart: true }
  }

  const batch = fetchedActivities.slice(0, DEEP_HISTORY_BATCH_SIZE)

  for (const activity of batch) {
    try {
      const date = activity.start_date_local.split('T')[0]
      const year = date.slice(0, 4)
      const [curve, streams] = await Promise.all([
        client.getPowerCurve(date, date).catch(() => null),
        client.getActivityStreams(activity.id).catch(() => null),
      ])
      const base = extractActivityMetrics(activity, curve, null)
      const insights = streams ? extractStreamInsights(streams, null, null, null) : { climbs: null, speed_bests: null }
      const candidate: BestsRide = {
        id: null,
        icu_activity_id: activity.id,
        date,
        activity_metrics: {
          climbs: insights.climbs,
          speed_bests: insights.speed_bests,
          best_efforts: base.best_efforts,
          max_speed_ms: base.max_speed_ms,
        },
      }

      const [allTimeRows, yearRows] = await Promise.all([
        fetchBestRecordRows(supabase, userId, 'all'),
        fetchBestRecordRows(supabase, userId, year),
      ])
      const { allTime, yearBests } = mergeCandidateIntoBests(allTimeRows, yearRows, candidate)
      await upsertBestRecordRows(supabase, userId, [
        ...flattenAllTimeBestsToRows('all', allTime),
        ...flattenAllTimeBestsToRows(year, yearBests),
      ])
    } catch (err) {
      console.error(`[deep-history-bests] failed to process activity ${activity.id}:`, err)
    }
  }

  const oldestProcessedDate = batch[batch.length - 1].start_date_local.split('T')[0]
  return {
    fetched: fetchedActivities.length,
    processed: batch.length,
    newCursor: oldestProcessedDate,
    reachedPossibleStart: fetchedActivities.length < DEEP_HISTORY_BATCH_SIZE,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/deep-history-bests.test.ts`
Expected: PASS.

Then run the full suite and typecheck:

Run: `npm run test:ci`
Expected: all suites pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/intervals/deep-history-bests.ts __tests__/lib/deep-history-bests.test.ts
git commit -m "feat: add resumable deep-history bests scan"
```

---

### Task 8: Deep-history route + Settings button

**Files:**
- Create: `app/api/admin/backfill-deep-history-bests/route.ts`
- Test: `__tests__/api/backfill-deep-history-bests.test.ts`
- Modify: `components/DailyBriefingCard.tsx`
- Modify: `app/settings/page.tsx`
- Test: `__tests__/components/DailyBriefingCard.test.tsx` (add to the existing file from the prior branch)

**Interfaces:**
- Consumes: `runDeepHistoryBestsBatch` (Task 7).
- Produces: `POST /api/admin/backfill-deep-history-bests`, plus a new Settings button.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/backfill-deep-history-bests.test.ts` with this exact content:

```typescript
/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/intervals/client', () => ({ IntervalsClient: jest.fn().mockImplementation(() => ({})) }))

const mockRunBatch = jest.fn()
jest.mock('@/lib/intervals/deep-history-bests', () => ({ runDeepHistoryBestsBatch: (...args: unknown[]) => mockRunBatch(...args) }))

import { POST } from '@/app/api/admin/backfill-deep-history-bests/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase({ profile = { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1', deep_history_bests_cursor: null } as unknown, userId = 'u1', oldestWorkoutDate = '2023-01-01' as string | null, updateSpy = jest.fn() } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: (table: string) => {
      if (table === 'user_profile') {
        return {
          select: () => ({ maybeSingle: async () => ({ data: profile }) }),
          update: (fields: unknown) => { updateSpy(fields); return { eq: async () => ({ error: null }) } },
        }
      }
      if (table === 'workouts') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: oldestWorkoutDate ? { date: oldestWorkoutDate } : null }) }) }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/admin/backfill-deep-history-bests', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ userId: '' }))
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it('returns 400 when intervals.icu is not configured', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ profile: { intervals_icu_athlete_id: null, intervals_icu_api_key: null } }))
    const res = await POST()
    expect(res.status).toBe(400)
  })

  it('defaults the cursor to the oldest workout date when no cursor is stored yet', async () => {
    mockRunBatch.mockResolvedValue({ fetched: 5, processed: 5, newCursor: '2022-06-01', reachedPossibleStart: false })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ oldestWorkoutDate: '2023-01-01' }))
    await POST()
    expect(mockRunBatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'u1', '2023-01-01')
  })

  it('uses the stored cursor when one already exists', async () => {
    mockRunBatch.mockResolvedValue({ fetched: 5, processed: 5, newCursor: '2022-06-01', reachedPossibleStart: false })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ profile: { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1', deep_history_bests_cursor: '2022-09-01' } }))
    await POST()
    expect(mockRunBatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'u1', '2022-09-01')
  })

  it('persists the new cursor after a successful batch', async () => {
    mockRunBatch.mockResolvedValue({ fetched: 5, processed: 5, newCursor: '2022-06-01', reachedPossibleStart: false })
    const updateSpy = jest.fn()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ updateSpy }))
    const res = await POST()
    const body = await res.json()
    expect(body.newCursor).toBe('2022-06-01')
    expect(updateSpy).toHaveBeenCalledWith({ deep_history_bests_cursor: '2022-06-01' })
  })
})
```

In `__tests__/components/DailyBriefingCard.test.tsx`, update `makeProps`'s returned object (currently):
```typescript
    strainBackfilling: false, strainBackfillResult: null, onRunBackfillStrain: jest.fn(),
    metricsBackfilling: false, metricsBackfillResult: null, onRunBackfillActivityMetrics: jest.fn(),
    ...overrides,
  }
}
```
to:
```typescript
    strainBackfilling: false, strainBackfillResult: null, onRunBackfillStrain: jest.fn(),
    metricsBackfilling: false, metricsBackfillResult: null, onRunBackfillActivityMetrics: jest.fn(),
    deepHistoryBackfilling: false, deepHistoryResult: null, onRunDeepHistoryBackfill: jest.fn(),
    ...overrides,
  }
}
```

Add this new describe block at the end of the file, after the existing `describe('DailyBriefingCard — all-time bests backfill button', ...)` block:

```typescript
describe('DailyBriefingCard — deep-history bests backfill button', () => {
  it('renders the button when admin', () => {
    render(<DailyBriefingCard {...makeProps()} />)
    expect(screen.getByRole('button', { name: 'Scan further back in ride history' })).toBeInTheDocument()
  })

  it('calls onRunDeepHistoryBackfill when clicked', () => {
    const onRun = jest.fn()
    render(<DailyBriefingCard {...makeProps({ onRunDeepHistoryBackfill: onRun })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Scan further back in ride history' }))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('shows "Scanning…" and disables the button while running', () => {
    render(<DailyBriefingCard {...makeProps({ deepHistoryBackfilling: true })} />)
    expect(screen.getByRole('button', { name: 'Scanning…' })).toBeDisabled()
  })

  it('shows the result message after a batch completes', () => {
    render(<DailyBriefingCard {...makeProps({ deepHistoryResult: { ok: true, message: 'Scanned back to 1 Jun 2022 — click again to keep going.' } })} />)
    expect(screen.getByText('Scanned back to 1 Jun 2022 — click again to keep going.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/api/backfill-deep-history-bests.test.ts __tests__/components/DailyBriefingCard.test.tsx`
Expected: `backfill-deep-history-bests.test.ts` FAILS — the route doesn't exist yet. The new `DailyBriefingCard` tests FAIL — the new props/button don't exist yet.

- [ ] **Step 3: Implement**

Create `app/api/admin/backfill-deep-history-bests/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { runDeepHistoryBestsBatch } from '@/lib/intervals/deep-history-bests'

export const dynamic = 'force-dynamic'

/** One chunk of the resumable deep-history bests scan. Defaults the cursor to
 * the oldest ride already in workouts (so it never wastes calls re-covering
 * ground normal sync/import already handles), then persists wherever the
 * batch left off for next time. Click again to keep going further back. */
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, deep_history_bests_cursor')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  let cursor = profile.deep_history_bests_cursor as string | null
  if (!cursor) {
    const { data: oldestWorkout } = await supabase
      .from('workouts')
      .select('date')
      .eq('user_id', user.id)
      .order('date', { ascending: true })
      .limit(1)
      .maybeSingle()
    cursor = oldestWorkout?.date ?? new Date().toISOString().split('T')[0]
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  const result = await runDeepHistoryBestsBatch(supabase, client, user.id, cursor)

  if (result.newCursor) {
    await supabase.from('user_profile').update({ deep_history_bests_cursor: result.newCursor }).eq('user_id', user.id)
  }

  return NextResponse.json(result)
}
```

In `components/DailyBriefingCard.tsx`, add three new props to `Props` (right after the existing `metricsBackfilling`/`metricsBackfillResult`/`onRunBackfillActivityMetrics`):
```typescript
  metricsBackfilling: boolean
  metricsBackfillResult: ActionResult
  onRunBackfillActivityMetrics: () => void
  deepHistoryBackfilling: boolean
  deepHistoryResult: ActionResult
  onRunDeepHistoryBackfill: () => void
}
```
and to the destructured parameters:
```typescript
  metricsBackfilling, metricsBackfillResult, onRunBackfillActivityMetrics,
  deepHistoryBackfilling, deepHistoryResult, onRunDeepHistoryBackfill,
}: Props) {
```

Insert a new button block between the existing metrics-backfill block and the zones block (currently):
```typescript
                {metricsBackfillResult && (
                  <p className={`text-xs ${metricsBackfillResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    {metricsBackfillResult.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={onPreviewZonesFix}
```
to:
```typescript
                {metricsBackfillResult && (
                  <p className={`text-xs ${metricsBackfillResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    {metricsBackfillResult.message}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={onRunDeepHistoryBackfill}
                  disabled={deepHistoryBackfilling}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 disabled:opacity-50 transition-colors"
                >
                  {deepHistoryBackfilling ? 'Scanning…' : 'Scan further back in ride history'}
                </button>
                {deepHistoryResult && (
                  <p className={`text-xs ${deepHistoryResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    {deepHistoryResult.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={onPreviewZonesFix}
```

In `app/settings/page.tsx`, add new state right after the existing `metricsBackfilling`/`metricsBackfillResult` pair:
```typescript
  const [deepHistoryBackfilling, setDeepHistoryBackfilling] = useState(false)
  const [deepHistoryResult, setDeepHistoryResult] = useState<{ ok: boolean; message: string } | null>(null)
```

Add a new handler right after `runBackfillActivityMetrics`:
```typescript
  async function runDeepHistoryBackfill() {
    setDeepHistoryBackfilling(true)
    setDeepHistoryResult(null)
    try {
      const res = await fetch('/api/admin/backfill-deep-history-bests', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        const message = data.reachedPossibleStart
          ? `Looks like you may have reached the start of your history (scanned back to ${data.newCursor ?? 'today'}). Click again to check further back, or stop here.`
          : `Scanned ${data.processed} ride${data.processed === 1 ? '' : 's'}, back to ${data.newCursor} — click again to keep going.`
        setDeepHistoryResult({ ok: true, message })
      } else {
        setDeepHistoryResult({ ok: false, message: data.error ?? 'Scan failed.' })
      }
    } catch {
      setDeepHistoryResult({ ok: false, message: 'Network error.' })
    } finally {
      setDeepHistoryBackfilling(false)
    }
  }
```

Add the three new props to the `<DailyBriefingCard>` call, right after the existing `metricsBackfilling`/`metricsBackfillResult`/`onRunBackfillActivityMetrics` props:
```typescript
        metricsBackfilling={metricsBackfilling}
        metricsBackfillResult={metricsBackfillResult}
        onRunBackfillActivityMetrics={runBackfillActivityMetrics}
        deepHistoryBackfilling={deepHistoryBackfilling}
        deepHistoryResult={deepHistoryResult}
        onRunDeepHistoryBackfill={runDeepHistoryBackfill}
      />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/backfill-deep-history-bests.test.ts __tests__/components/DailyBriefingCard.test.tsx`
Expected: PASS.

Then run the full suite and typecheck:

Run: `npm run test:ci`
Expected: all suites pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/backfill-deep-history-bests/route.ts __tests__/api/backfill-deep-history-bests.test.ts components/DailyBriefingCard.tsx app/settings/page.tsx __tests__/components/DailyBriefingCard.test.tsx
git commit -m "feat: add deep-history bests scan route and Settings button"
```

---

### Task 9: intervals.icu link on each Bests entry

**Files:**
- Modify: `components/AllTimeBestsTab.tsx`
- Test: `__tests__/components/AllTimeBestsTab.test.tsx`

**Interfaces:**
- Consumes: `icuActivityId` on every `AllTimeBests` entry (Task 2 — the fixture in `AllTimeBestsTab.test.tsx` already has `icuActivityId`/`max_speed_ms` on every entry as of Task 2; this task only adds one new test on top of it).
- Produces: no new exports — UI-only.

- [ ] **Step 1: Write the failing tests**

Add this new test to `__tests__/components/AllTimeBestsTab.test.tsx`, in the existing `describe('AllTimeBestsTab', ...)` block:
```typescript
  it('links each entry to its intervals.icu activity page', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeResponse() })
    render(<AllTimeBestsTab />)
    await screen.findByText('620')
    const link = screen.getByRole('link', { name: /View on intervals\.icu/i })
    expect(link).toHaveAttribute('href', 'https://intervals.icu/activities/icu-1')
    expect(link).toHaveAttribute('target', '_blank')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/components/AllTimeBestsTab.test.tsx`
Expected: FAIL — `getByRole('link', ...)` finds nothing, since `BestCell` doesn't render a link yet.

- [ ] **Step 3: Implement**

In `components/AllTimeBestsTab.tsx`, add an `icuActivityId` prop to `BestCell` and render the link (currently):
```tsx
function BestCell({ label, value, unit, caption }: { label: string; value: string; unit?: string; caption: string }) {
  return (
    <div className="flex-1 text-center px-2 py-3 sm:px-3 sm:py-4 min-w-[110px]">
      <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">
        {value}
        {unit && <span className="text-xs font-medium text-gray-400 ml-0.5">{unit}</span>}
      </div>
      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">{label}</div>
      <div className="text-[11px] text-gray-400 mt-0.5">{caption}</div>
    </div>
  )
}
```
to:
```tsx
function BestCell({ label, value, unit, caption, icuActivityId }: { label: string; value: string; unit?: string; caption: string; icuActivityId: string }) {
  return (
    <div className="flex-1 text-center px-2 py-3 sm:px-3 sm:py-4 min-w-[110px]">
      <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">
        {value}
        {unit && <span className="text-xs font-medium text-gray-400 ml-0.5">{unit}</span>}
      </div>
      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">{label}</div>
      <div className="text-[11px] text-gray-400 mt-0.5">{caption}</div>
      <a
        href={`https://intervals.icu/activities/${icuActivityId}`}
        target="_blank"
        rel="noreferrer"
        className="text-[11px] text-blue-500 hover:text-blue-700 underline underline-offset-2"
      >
        View on intervals.icu →
      </a>
    </div>
  )
}
```

Pass `icuActivityId` at every `<BestCell>` call site inside `BestsSections` — currently:
```tsx
      {bests.biggestClimb && (
        <SectionCard title="Biggest Climb" accent="bg-emerald-400">
          <div className="flex">
            <BestCell
              label="Elevation" value={String(bests.biggestClimb.elev_gain_m)} unit="m"
              caption={bests.biggestClimb.length_km != null
                ? `${bests.biggestClimb.length_km}km · ${formatDate(bests.biggestClimb.date)}`
                : formatDate(bests.biggestClimb.date)}
            />
          </div>
        </SectionCard>
      )}
      {bests.longestClimb && (
        <SectionCard title="Longest Climb" accent="bg-emerald-400">
          <div className="flex">
            <BestCell
              label="Length" value={String(bests.longestClimb.length_km)} unit="km"
              caption={`${bests.longestClimb.elev_gain_m}m gain · ${formatDate(bests.longestClimb.date)}`}
            />
          </div>
        </SectionCard>
      )}
      {bests.powerBests.length > 0 && (
        <SectionCard title="Power Bests" accent="bg-orange-400">
          <div className="flex divide-x divide-gray-100 overflow-x-auto">
            {bests.powerBests.map(p => (
              <BestCell
                key={p.secs} label={durationLabel(p.secs)} value={String(p.watts)} unit="w"
                caption={formatDate(p.date)}
              />
            ))}
          </div>
        </SectionCard>
      )}
      {bests.speedBests.length > 0 && (
        <SectionCard title="Speed Bests" accent="bg-blue-400">
          <div className="flex divide-x divide-gray-100 overflow-x-auto">
            {bests.speedBests.map(sp => (
              <BestCell
                key={sp.distance_km} label={`${sp.distance_km}km`} value={sp.avg_speed_kmh.toFixed(1)} unit="km/h"
                caption={formatDate(sp.date)}
              />
            ))}
          </div>
        </SectionCard>
      )}
      {bests.maxSpeed && (
        <SectionCard title="Max Speed" accent="bg-red-400">
          <div className="flex">
            <BestCell
              label="Top Speed" value={bests.maxSpeed.speed_kmh.toFixed(1)} unit="km/h"
              caption={formatDate(bests.maxSpeed.date)}
            />
          </div>
        </SectionCard>
      )}
```
add `icuActivityId={...}` to each of the five `<BestCell>` calls, sourcing it from the same object each already reads `date`/other fields from (`bests.biggestClimb.icuActivityId`, `bests.longestClimb.icuActivityId`, `p.icuActivityId`, `sp.icuActivityId`, `bests.maxSpeed.icuActivityId` respectively).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/components/AllTimeBestsTab.test.tsx`
Expected: PASS.

Then run the full suite and typecheck:

Run: `npm run test:ci`
Expected: all suites pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add components/AllTimeBestsTab.tsx __tests__/components/AllTimeBestsTab.test.tsx
git commit -m "feat: link each Bests entry to its intervals.icu activity page"
```

---

## Rollout (manual steps after merge)

1. Run the Task 1 migration SQL against the shared Supabase project, then `notify pgrst, 'reload schema';`.
2. Trigger `POST /api/admin/resync-bests` once (via the existing Settings button pattern, or directly) to seed `best_records` from whatever's currently in `workouts`.
3. Trigger `POST /api/admin/backfill-deep-history-bests` (the new Settings button) as many times as desired to extend coverage further back through intervals.icu history — each click processes up to 25 older rides and reports progress.
