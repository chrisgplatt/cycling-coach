# Ranked Bests (Podium) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `best_records` from storing only the single current champion per (period, category, sub_key, is_indoor) slot to storing the top 3 (gold/silver/bronze), surfaced on the Stats → Bests tab (expand-for-2nd/3rd) and as rank-aware ride medal badges.

**Architecture:** `AllTimeBests`'s single-object-or-null fields become arrays of up to 3 ranked entries (rank 1 = best), produced by a new generic `insertRanked` helper inside the existing `computeAllTimeBests` reducer. `BestRecordRow` gains a `rank` column; `flattenAllTimeBestsToRows`/`assembleAllTimeBests` become one-row-per-ranked-entry instead of one-row-per-category. `reconstructSyntheticRides` and every write path (`enrich.ts`, `deep-history-bests.ts`, `resync-bests/route.ts`) need zero changes — they already call only the shared functions this plan updates. `MedalEntry` gains a `rank` field carried straight through from `best_records`. `RideMedals.tsx` and `AllTimeBestsTab.tsx` become rank-aware on the display side only.

**Tech Stack:** Next.js App Router, TypeScript, React, Supabase (Postgres), Jest + React Testing Library.

**Design spec:** `docs/superpowers/specs/2026-07-26-ranked-bests-podium-design.md`

## Global Constraints

- Podium depth is fixed at exactly 3 (gold/silver/bronze) — not configurable.
- Applies to every category (`biggest_climb`, `longest_climb`, `power`, `speed`, `max_speed`) and both periods (all-time, per-year).
- Ties break by whichever candidate was processed first (stable sort, no extra tie-break code) — matches the existing single-champion reducer's behavior, not a new guarantee.
- The "don't double-list a category in both allTime and year" exclusion in `buildMedalsByWorkoutId` stays keyed on `category:sub_key` only — it does NOT become rank-aware. Do not add rank to that key.
- Card badges (`RideMedalIcons`) stay tier-level (max 2 icons: one per tier), picking the best (lowest-numbered) rank across every entry in that tier. Do not render one icon per category.
- Rank-1 display text is unchanged from the pre-podium feature (no "#1" suffix anywhere). Only rank 2/3 get a visible suffix.
- No new backfill mechanism. After the migration in Task 1 is run and this plan is deployed, remind the user to click "Resync bests" (Settings) to backfill 2nd/3rd place for existing history — do not build a new endpoint or button for this.
- Per `AGENTS.md`: the migration in Task 1 must be run manually against the shared Supabase production database (Supabase SQL editor) before or as part of deploying this feature — there is no automated migration deploy step in this repo.
- Run `npm run typecheck` before every commit (per `AGENTS.md` — Jest does not surface TypeScript errors).

---

### Task 1: Migration — add `rank` to `best_records`

**Files:**
- Create: `supabase/migrations/20260726_best_records_rank.sql`

**Interfaces:**
- Produces: a `rank integer not null default 1` column on `best_records`, and a new 6-column unique constraint `(user_id, period, category, sub_key, is_indoor, rank)` replacing the old 5-column one. Task 3 depends on this column existing in production before its code ships.

- [ ] **Step 1: Write the migration file**

```sql
-- Adds a rank dimension to best_records so each (period, category, sub_key,
-- is_indoor) slot can hold up to 3 rows — the top-3 podium (gold/silver/
-- bronze) — instead of only the single champion. Existing rows default to
-- rank 1 as a placeholder only: they ARE the current champion, so rank 1 is
-- correct for them; re-running "Resync bests" (Settings) after this migration
-- backfills 2nd/3rd place for the rider's full history. Run in the Supabase
-- SQL editor before deploying the matching app version.

alter table best_records add column if not exists rank integer not null default 1;

-- Drop whatever the OLD 5-column unique constraint is actually named, found
-- dynamically by its column set rather than guessed — Postgres auto-names
-- unnamed constraints, and this repo has no way to confirm the real
-- production name ahead of time (no linked Supabase CLI).
do $$
declare
  old_constraint_name text;
begin
  select c.conname into old_constraint_name
  from pg_constraint c
  where c.conrelid = 'best_records'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname::text order by a.attname)
      from unnest(c.conkey) as k(attnum)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    ) = array['category', 'is_indoor', 'period', 'sub_key', 'user_id']
  limit 1;

  if old_constraint_name is not null then
    execute format('alter table best_records drop constraint %I', old_constraint_name);
  end if;
end $$;

-- Add the new 6-column unique constraint (idempotent — only adds if missing).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'best_records'::regclass
      and conname = 'best_records_user_id_period_category_sub_key_is_indoor_rank_key'
  ) then
    alter table best_records add constraint best_records_user_id_period_category_sub_key_is_indoor_rank_key
      unique (user_id, period, category, sub_key, is_indoor, rank);
  end if;
end $$;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260726_best_records_rank.sql
git commit -m "Add rank column and constraint to best_records for top-3 podium tracking"
```

No automated test — this is a schema file with no runner in this repo (see Global Constraints: it must be run manually against Supabase before this feature works end-to-end).

---

### Task 2: Podium reducer — `lib/ride/all-time-bests.ts`

**Files:**
- Modify: `lib/ride/all-time-bests.ts`
- Test: `__tests__/lib/all-time-bests.test.ts`

**Interfaces:**
- Produces: `AllTimeBests` with every field now `(RankedEntry & {...})[]` (was a nullable single object or a plain array). `RankedEntry = { rank: 1 | 2 | 3; workoutId: string | null; icuActivityId: string; date: string }`. `computeAllTimeBests(rides: BestsRide[]): AllTimeBests` and `computeAllTimeBestsByPeriod(rides: BestsRide[]): AllTimeBestsResponse` keep their existing signatures. `BestsRide`/`BestsCandidateMetrics` are unchanged.
- Consumes: nothing new — same `ActivityMetrics`/`ClimbSegment`/`SpeedBest` types as before.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `__tests__/lib/all-time-bests.test.ts` with:

```typescript
import { computeAllTimeBests, computeAllTimeBestsByPeriod } from '@/lib/ride/all-time-bests'
import type { ActivityMetrics, ClimbSegment, SpeedBest } from '@/types'

function makeClimb(overrides: Partial<ClimbSegment> = {}): ClimbSegment {
  return { start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675, length_km: 3.2, path: null, ...overrides }
}

function makeSpeedBest(overrides: Partial<SpeedBest> = {}): SpeedBest {
  return { distance_km: 10, avg_speed_kmh: 30, start_km: 2, duration_secs: 1200, ...overrides }
}

function makeMetrics(overrides: Partial<ActivityMetrics> = {}): ActivityMetrics {
  return {
    np: null, avg_power: null, max_power: null, avg_hr: null, distance_m: null, elevation_m: null,
    lr_balance: null, best_efforts: null, intervals: null, decoupling_pct: null, climbs: null,
    time_in_zone: null, shape: null, distributions: null, effort_periods: null, sprints: null,
    speed_bests: null, personal_bests: null, synced_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function ride(id: string, date: string, metrics: ActivityMetrics | null, icuActivityId = `icu-${id}`) {
  return { id, icu_activity_id: icuActivityId, date, activity_metrics: metrics }
}

describe('computeAllTimeBests', () => {
  it('ranks the top 3 climbs by elev_gain_m, best first, each tagged with its rank', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400, length_km: 5 })] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900, length_km: 3 })] })),
      ride('w3', '2026-03-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 600, length_km: 4 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb).toEqual([
      { rank: 1, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 },
      { rank: 2, workoutId: 'w3', icuActivityId: 'icu-w3', date: '2026-03-01', elev_gain_m: 600, length_km: 4 },
      { rank: 3, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01', elev_gain_m: 400, length_km: 5 },
    ])
  })

  it('drops a 4th climb once 3 higher-elevation climbs already fill the podium', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400 })] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900 })] })),
      ride('w3', '2026-03-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 600 })] })),
      ride('w4', '2026-04-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 300 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb).toHaveLength(3)
    expect(result.biggestClimb.map(c => c.workoutId)).toEqual(['w2', 'w3', 'w1'])
  })

  it('finds the longest climb podium by length_km, independent of elevation', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900, length_km: 3 })] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400, length_km: 12.5 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.longestClimb).toEqual([
      { rank: 1, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01', length_km: 12.5, elev_gain_m: 400 },
      { rank: 2, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01', length_km: 3, elev_gain_m: 900 },
    ])
  })

  it('ranks the top 3 watts per duration independently across durations', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 280 }, { secs: 1200, watts: 210 }] })),
      ride('w2', '2026-02-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 310 }] })),
      ride('w3', '2026-03-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 250 }] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.powerBests).toEqual([
      { rank: 1, secs: 300, watts: 310, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01' },
      { rank: 2, secs: 300, watts: 280, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01' },
      { rank: 3, secs: 300, watts: 250, workoutId: 'w3', icuActivityId: 'icu-w3', date: '2026-03-01' },
      { rank: 1, secs: 1200, watts: 210, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01' },
    ])
  })

  it("drops a 4th power result once 3 higher watts already fill that duration's podium", () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 280 }] })),
      ride('w2', '2026-02-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 310 }] })),
      ride('w3', '2026-03-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 250 }] })),
      ride('w4', '2026-04-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 200 }] })),
    ]
    const result = computeAllTimeBests(rides)
    const at300 = result.powerBests.filter(p => p.secs === 300)
    expect(at300).toHaveLength(3)
    expect(at300.map(p => p.watts)).toEqual([310, 280, 250])
  })

  it('ranks the top 3 speeds per distance split', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ speed_bests: [makeSpeedBest({ distance_km: 1, avg_speed_kmh: 35 })] })),
      ride('w2', '2026-02-01', makeMetrics({ speed_bests: [makeSpeedBest({ distance_km: 1, avg_speed_kmh: 42 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.speedBests).toEqual([
      { rank: 1, distance_km: 1, avg_speed_kmh: 42, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01' },
      { rank: 2, distance_km: 1, avg_speed_kmh: 35, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01' },
    ])
  })

  it('ranks the top 3 all-time max speeds from max_speed_ms, converted to km/h', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ max_speed_ms: 15 })),   // 54 km/h
      ride('w2', '2026-02-01', makeMetrics({ max_speed_ms: 19 })),   // 68.4 km/h
    ]
    const result = computeAllTimeBests(rides)
    expect(result.maxSpeed).toEqual([
      { rank: 1, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01', speed_kmh: 68.4, max_speed_ms: 19 },
      { rank: 2, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01', speed_kmh: 54, max_speed_ms: 15 },
    ])
  })

  it('excludes speed bests and max speed from rides before the 2018 trusted-era cutoff, keeping later rides', () => {
    const rides = [
      ride('w1', '2017-12-31', makeMetrics({ speed_bests: [makeSpeedBest({ distance_km: 20, avg_speed_kmh: 69.5 })], max_speed_ms: 30 })),
      ride('w2', '2018-01-01', makeMetrics({ speed_bests: [makeSpeedBest({ distance_km: 20, avg_speed_kmh: 45 })], max_speed_ms: 15 })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.speedBests).toEqual([
      { rank: 1, distance_km: 20, avg_speed_kmh: 45, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2018-01-01' },
    ])
    expect(result.maxSpeed).toEqual([
      { rank: 1, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2018-01-01', speed_kmh: 54, max_speed_ms: 15 },
    ])
  })

  it('produces no speed bests or max speed when every candidate ride predates the trusted era', () => {
    const rides = [
      ride('w1', '2017-06-01', makeMetrics({ speed_bests: [makeSpeedBest({ avg_speed_kmh: 40 })], max_speed_ms: 20 })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.speedBests).toEqual([])
    expect(result.maxSpeed).toEqual([])
  })

  it('leaves climbs and power bests unaffected by the speed-era cutoff', () => {
    const rides = [
      ride('w1', '2017-06-01', makeMetrics({
        climbs: [makeClimb({ elev_gain_m: 900, length_km: 3 })],
        best_efforts: [{ secs: 300, watts: 310 }],
      })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb[0]?.elev_gain_m).toBe(900)
    expect(result.powerBests).toEqual([{ rank: 1, secs: 300, watts: 310, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2017-06-01' }])
  })

  it('skips rides with null activity_metrics without throwing', () => {
    const rides = [
      ride('w1', '2026-01-01', null),
      ride('w2', '2026-02-01', makeMetrics({ max_speed_ms: 15 })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.maxSpeed).toEqual([{ rank: 1, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01', speed_kmh: 54, max_speed_ms: 15 }])
  })

  it('returns all-empty arrays when no rides have any qualifying data', () => {
    const result = computeAllTimeBests([ride('w1', '2026-01-01', makeMetrics())])
    expect(result).toEqual({
      biggestClimb: [], longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [],
    })
  })

  it('ignores climbs missing length_km (un-backfilled historical data) when ranking longestClimb, while biggestClimb still ranks correctly by elevation', () => {
    const oldClimb = { start_km: 5, duration_secs: 480, elev_gain_m: 700, avg_watts: 268, vam: 675 } as unknown as ClimbSegment
    const newClimb = makeClimb({ elev_gain_m: 300, length_km: 8 })
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [oldClimb] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [newClimb] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb).toEqual([
      { rank: 1, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01', elev_gain_m: 700, length_km: null },
      { rank: 2, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01', elev_gain_m: 300, length_km: 8 },
    ])
    expect(result.longestClimb).toEqual([
      { rank: 1, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01', length_km: 8, elev_gain_m: 300 },
    ])
  })

  it('returns an empty longestClimb when no climb anywhere has a backfilled length_km yet', () => {
    const oldClimb = { start_km: 5, duration_secs: 480, elev_gain_m: 700, avg_watts: 268, vam: 675 } as unknown as ClimbSegment
    const result = computeAllTimeBests([ride('w1', '2026-01-01', makeMetrics({ climbs: [oldClimb] }))])
    expect(result.longestClimb).toEqual([])
    expect(result.biggestClimb).toEqual([{ rank: 1, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01', elev_gain_m: 700, length_km: null }])
  })

  it('supports a workoutless ride (no local workouts row) via a null id', () => {
    const rides = [
      { id: null, icu_activity_id: 'icu-only', date: '2026-04-01', activity_metrics: makeMetrics({ climbs: [makeClimb({ elev_gain_m: 700, length_km: 6 })] }) },
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb).toEqual([{ rank: 1, workoutId: null, icuActivityId: 'icu-only', date: '2026-04-01', elev_gain_m: 700, length_km: 6 }])
  })

  it('stores max_speed_ms alongside speed_kmh, exactly as provided (no derived reconstruction)', () => {
    const rides = [ride('w1', '2026-01-01', makeMetrics({ max_speed_ms: 19.027 }))]
    const result = computeAllTimeBests(rides)
    expect(result.maxSpeed).toEqual([{ rank: 1, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01', speed_kmh: 68.5, max_speed_ms: 19.027 }])
  })

  it('gives the earlier-processed ride the better rank when two climbs tie exactly on elev_gain_m', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 500 })] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 500 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb.map(c => c.workoutId)).toEqual(['w1', 'w2'])
  })
})

describe('computeAllTimeBestsByPeriod', () => {
  it('groups rides by year and computes ranked bests both all-time and per-year', () => {
    const rides = [
      ride('w1', '2025-06-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400 })] })),
      ride('w2', '2026-03-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900 })] })),
      ride('w3', '2026-08-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 300 })] })),
    ]
    const result = computeAllTimeBestsByPeriod(rides)
    expect(result.allTime.biggestClimb[0]?.elev_gain_m).toBe(900)
    expect(result.byYear['2025'].biggestClimb[0]?.elev_gain_m).toBe(400)
    expect(result.byYear['2026'].biggestClimb[0]?.elev_gain_m).toBe(900)
    expect(result.byYear['2026'].biggestClimb[1]?.elev_gain_m).toBe(300)
  })

  it('only includes years that have at least one ride with activity_metrics', () => {
    const rides = [
      ride('w1', '2024-01-01', null),   // no metrics — shouldn't produce a 2024 entry
      ride('w2', '2026-01-01', makeMetrics({ max_speed_ms: 10 })),
    ]
    const result = computeAllTimeBestsByPeriod(rides)
    expect(Object.keys(result.byYear)).toEqual(['2026'])
  })

  it('returns an empty byYear map when given no rides', () => {
    const result = computeAllTimeBestsByPeriod([])
    expect(result.byYear).toEqual({})
    expect(result.allTime).toEqual({
      biggestClimb: [], longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [],
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/all-time-bests.test.ts`
Expected: FAIL — `result.biggestClimb` is currently a nullable single object, not an array, so `toEqual([...])` assertions fail.

- [ ] **Step 3: Rewrite `lib/ride/all-time-bests.ts`**

Replace the full file contents with:

```typescript
import type { ActivityMetrics, ClimbSegment, SpeedBest } from '@/types'

// Speed data from before this date comes from an era (2017-era Garmin Edge 520)
// with known unreliable GPS/speed readings — excluded from Speed Bests and Max
// Speed entirely, regardless of the plausibility ceilings in activity-metrics.ts.
// Climbs and power bests are unaffected; only speed-derived categories are era-gated.
const SPEED_BESTS_TRUSTED_FROM = '2018-01-01'

// Every ranked slot keeps the top 3 candidates (gold/silver/bronze), best first.
const PODIUM_SIZE = 3

export interface RankedEntry {
  rank: 1 | 2 | 3
  workoutId: string | null
  icuActivityId: string
  date: string
}

export interface AllTimeBests {
  biggestClimb: (RankedEntry & { elev_gain_m: number; length_km: number | null })[]
  longestClimb: (RankedEntry & { length_km: number; elev_gain_m: number })[]
  powerBests: (RankedEntry & { secs: number; watts: number })[]
  speedBests: (RankedEntry & { distance_km: number; avg_speed_kmh: number })[]
  maxSpeed: (RankedEntry & { speed_kmh: number; max_speed_ms: number })[]
}

export interface AllTimeBestsResponse {
  allTime: AllTimeBests
  byYear: Record<string, AllTimeBests>
}

export interface IndoorOutdoorBestsResponse {
  outdoor: AllTimeBestsResponse
  indoor: AllTimeBestsResponse
}

// Only the fields computeAllTimeBests actually reads — decoupled from the full
// ActivityMetrics shape so a "synthetic" candidate (reconstructed from a stored
// champion, or produced by the deep-history scan with no local workouts row)
// never needs to fake unrelated fields like decoupling_pct or shape.
export interface BestsCandidateMetrics {
  // length_km is nullable here — unlike ClimbSegment's own always-present field —
  // because un-backfilled historical climbs (see computeAllTimeBests below) and
  // synthetic champions reconstructed for a climb whose length was never measured
  // both need to represent "no length yet" without faking a numeric value.
  climbs: Array<{ elev_gain_m: ClimbSegment['elev_gain_m']; length_km: ClimbSegment['length_km'] | null }> | null
  best_efforts: Array<{ secs: number; watts: number }> | null
  speed_bests: Array<Pick<SpeedBest, 'distance_km' | 'avg_speed_kmh'>> | null
  max_speed_ms?: number | null
}

export interface BestsRide {
  id: string | null           // workouts.id — null when this ride has no local row (deep-history scan)
  icu_activity_id: string     // always present — every ride reaching this reducer came from an intervals.icu activity
  date: string
  activity_metrics: BestsCandidateMetrics | null
}

// Inserts candidate into a podium array (already sorted best-first, length <=
// PODIUM_SIZE), re-sorts by value descending, and keeps only the top 3.
// Array.sort is stable, so when two candidates tie exactly, whichever was
// already in the array (i.e. processed earlier) keeps the better rank — no
// separate tie-break logic needed. Ranks (1-3) are assigned later, by final
// array position, once every ride has been folded in — see withRanks.
function insertRanked<T>(existing: T[], candidate: T, valueOf: (t: T) => number): T[] {
  return [...existing, candidate]
    .sort((a, b) => valueOf(b) - valueOf(a))
    .slice(0, PODIUM_SIZE)
}

function withRanks<T>(entries: T[]): (T & { rank: 1 | 2 | 3 })[] {
  return entries.map((e, i) => ({ ...e, rank: (i + 1) as 1 | 2 | 3 }))
}

// A single pass over the given rides, tracking a top-3 podium per category and
// remembering which ride each entry came from. Stays generic over whatever subset
// of rides it's given — the caller decides "all-time" vs. "just this year" by
// choosing which rides to pass in.
export function computeAllTimeBests(rides: BestsRide[]): AllTimeBests {
  type ClimbCandidate = { workoutId: string | null; icuActivityId: string; date: string; elev_gain_m: number; length_km: number | null }
  type LongestClimbCandidate = { workoutId: string | null; icuActivityId: string; date: string; length_km: number; elev_gain_m: number }
  type PowerCandidate = { workoutId: string | null; icuActivityId: string; date: string; watts: number }
  type SpeedCandidate = { workoutId: string | null; icuActivityId: string; date: string; avg_speed_kmh: number }
  type MaxSpeedCandidate = { workoutId: string | null; icuActivityId: string; date: string; speed_kmh: number; max_speed_ms: number }

  let biggestClimb: ClimbCandidate[] = []
  let longestClimb: LongestClimbCandidate[] = []
  let maxSpeed: MaxSpeedCandidate[] = []
  const powerBestsByDuration = new Map<number, PowerCandidate[]>()
  const speedBestsByDistance = new Map<number, SpeedCandidate[]>()

  for (const r of rides) {
    const m = r.activity_metrics
    if (!m) continue

    for (const climb of m.climbs ?? []) {
      biggestClimb = insertRanked(
        biggestClimb,
        { workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date, elev_gain_m: climb.elev_gain_m, length_km: climb.length_km ?? null },
        c => c.elev_gain_m,
      )
      // Un-backfilled historical climbs don't have length_km yet — never let one
      // enter (or beat) the longest-climb podium until it's actually measured.
      if (climb.length_km != null) {
        longestClimb = insertRanked(
          longestClimb,
          { workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date, length_km: climb.length_km, elev_gain_m: climb.elev_gain_m },
          c => c.length_km,
        )
      }
    }

    for (const effort of m.best_efforts ?? []) {
      const existing = powerBestsByDuration.get(effort.secs) ?? []
      powerBestsByDuration.set(
        effort.secs,
        insertRanked(existing, { watts: effort.watts, workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date }, p => p.watts),
      )
    }

    const trustSpeed = r.date >= SPEED_BESTS_TRUSTED_FROM
    if (trustSpeed) {
      for (const speed of m.speed_bests ?? []) {
        const existing = speedBestsByDistance.get(speed.distance_km) ?? []
        speedBestsByDistance.set(
          speed.distance_km,
          insertRanked(existing, { avg_speed_kmh: speed.avg_speed_kmh, workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date }, s => s.avg_speed_kmh),
        )
      }

      if (m.max_speed_ms != null) {
        const speed_kmh = Math.round(m.max_speed_ms * 3.6 * 10) / 10
        maxSpeed = insertRanked(
          maxSpeed,
          { workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date, speed_kmh, max_speed_ms: m.max_speed_ms },
          s => s.speed_kmh,
        )
      }
    }
  }

  const powerBests = [...powerBestsByDuration.entries()]
    .flatMap(([secs, entries]) => withRanks(entries).map(e => ({ secs, ...e })))
    .sort((a, b) => a.secs - b.secs || a.rank - b.rank)
  const speedBests = [...speedBestsByDistance.entries()]
    .flatMap(([distance_km, entries]) => withRanks(entries).map(e => ({ distance_km, ...e })))
    .sort((a, b) => a.distance_km - b.distance_km || a.rank - b.rank)

  return {
    biggestClimb: withRanks(biggestClimb),
    longestClimb: withRanks(longestClimb),
    powerBests,
    speedBests,
    maxSpeed: withRanks(maxSpeed),
  }
}

// Groups rides by calendar year (from their `date`) and computes bests once for
// the full set and once per distinct year found. Only years with at least one
// ride carrying activity_metrics get an entry — a ride with null metrics
// contributes to neither the all-time computation nor any year bucket.
export function computeAllTimeBestsByPeriod(rides: BestsRide[]): AllTimeBestsResponse {
  const allTime = computeAllTimeBests(rides)
  const byYearRides = new Map<string, BestsRide[]>()
  for (const r of rides) {
    if (!r.activity_metrics) continue
    const year = r.date.slice(0, 4)
    const arr = byYearRides.get(year) ?? []
    arr.push(r)
    byYearRides.set(year, arr)
  }
  const byYear: Record<string, AllTimeBests> = {}
  for (const [year, yearRides] of byYearRides) {
    byYear[year] = computeAllTimeBests(yearRides)
  }
  return { allTime, byYear }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/all-time-bests.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: fails at this point on every downstream file that still assumes the old singular-object shape (`lib/ride/best-records.ts`, `components/AllTimeBestsTab.tsx`, etc.) — that's expected; those are fixed in later tasks. Confirm the only errors are in files this task doesn't touch, then proceed.

- [ ] **Step 6: Commit**

```bash
git add lib/ride/all-time-bests.ts __tests__/lib/all-time-bests.test.ts
git commit -m "Rank the top 3 per category in computeAllTimeBests instead of tracking a single champion"
```

---

### Task 3: Row mapping — `lib/ride/best-records.ts` + `app/api/bests/route.ts`

**Files:**
- Modify: `lib/ride/best-records.ts`
- Modify: `app/api/bests/route.ts` (one-line `.select()` addition — the design spec called this "no logic change," but the existing explicit column list omits `rank`, so the read path would silently get `undefined` ranks in production without this)
- Test: `__tests__/lib/best-records.test.ts`
- Test: `__tests__/api/bests.test.ts`

**Interfaces:**
- Consumes: `AllTimeBests`, `RankedEntry` from Task 2's `lib/ride/all-time-bests.ts`.
- Produces: `BestRecordRow` gains `rank: number`. `flattenAllTimeBestsToRows(period, bests, isIndoor): BestRecordRow[]` now emits one row per ranked entry (was one row per category). `assembleAllTimeBests(rows): AllTimeBests` now pushes into arrays sorted by rank. `fetchBestRecordRows`/`upsertBestRecordRows` signatures are unchanged but now select/conflict on `rank` too. `reconstructSyntheticRides` and `mergeCandidateIntoBests` signatures are unchanged.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `__tests__/lib/best-records.test.ts` with:

```typescript
import {
  reconstructSyntheticRides, flattenAllTimeBestsToRows, assembleAllTimeBests, mergeCandidateIntoBests, fetchBestRecordRows, upsertBestRecordRows,
  type BestRecordRow,
} from '@/lib/ride/best-records'
import { computeAllTimeBests, type AllTimeBests, type BestsRide } from '@/lib/ride/all-time-bests'
import type { SupabaseClient } from '@supabase/supabase-js'

function row(overrides: Partial<BestRecordRow>): BestRecordRow {
  return { period: 'all', category: 'biggest_climb', sub_key: '', value: 0, detail: {}, is_indoor: false, rank: 1, ...overrides }
}

describe('reconstructSyntheticRides', () => {
  it('reconstructs a climb row (biggest or longest) as a single-climb synthetic ride, independent of its rank', () => {
    const rows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, rank: 2, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 } }),
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

  it('reconstructs every stored rank of a category as its own synthetic ride, so all podium slots feed back into recomputation', () => {
    const rows: BestRecordRow[] = [
      row({ category: 'power', sub_key: '300', value: 310, rank: 1, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2' } }),
      row({ category: 'power', sub_key: '300', value: 280, rank: 2, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1' } }),
    ]
    const rides = reconstructSyntheticRides(rows)
    expect(rides).toHaveLength(2)
    expect(rides.map(r => r.activity_metrics?.best_efforts?.[0].watts)).toEqual([310, 280])
  })
})

describe('flattenAllTimeBestsToRows', () => {
  it('flattens a full AllTimeBests into one row per ranked entry, tagged with the given isIndoor value', () => {
    const bests: AllTimeBests = {
      biggestClimb: [{ rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', elev_gain_m: 900, length_km: 3 }],
      longestClimb: [{ rank: 1, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', length_km: 12, elev_gain_m: 400 }],
      powerBests: [{ rank: 1, secs: 300, watts: 310, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-03-01' }],
      speedBests: [{ rank: 1, distance_km: 10, avg_speed_kmh: 38.4, workoutId: 'w4', icuActivityId: 'icu-4', date: '2026-04-01' }],
      maxSpeed: [{ rank: 1, workoutId: 'w5', icuActivityId: 'icu-5', date: '2026-05-01', speed_kmh: 68.5, max_speed_ms: 19.027 }],
    }
    const rows = flattenAllTimeBestsToRows('all', bests, false)
    expect(rows).toEqual([
      { period: 'all', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 }, is_indoor: false, rank: 1 },
      { period: 'all', category: 'longest_climb', sub_key: '', value: 12, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', elev_gain_m: 400 }, is_indoor: false, rank: 1 },
      { period: 'all', category: 'power', sub_key: '300', value: 310, detail: { date: '2026-03-01', workoutId: 'w3', icuActivityId: 'icu-3' }, is_indoor: false, rank: 1 },
      { period: 'all', category: 'speed', sub_key: '10', value: 38.4, detail: { date: '2026-04-01', workoutId: 'w4', icuActivityId: 'icu-4' }, is_indoor: false, rank: 1 },
      { period: 'all', category: 'max_speed', sub_key: '', value: 68.5, detail: { date: '2026-05-01', workoutId: 'w5', icuActivityId: 'icu-5', max_speed_ms: 19.027 }, is_indoor: false, rank: 1 },
    ])
  })

  it('emits one row per podium entry when a category holds 2nd and 3rd place, each carrying its own rank', () => {
    const bests: AllTimeBests = {
      biggestClimb: [
        { rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', elev_gain_m: 900, length_km: 3 },
        { rank: 2, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 700, length_km: 2 },
      ],
      longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [],
    }
    const rows = flattenAllTimeBestsToRows('all', bests, false)
    expect(rows).toEqual([
      { period: 'all', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 }, is_indoor: false, rank: 1 },
      { period: 'all', category: 'biggest_climb', sub_key: '', value: 700, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 2 }, is_indoor: false, rank: 2 },
    ])
  })

  it('tags every row true when isIndoor is true', () => {
    const bests: AllTimeBests = {
      biggestClimb: [], longestClimb: [], powerBests: [],
      speedBests: [], maxSpeed: [{ rank: 1, workoutId: null, icuActivityId: 'icu-9', date: '2026-06-01', speed_kmh: 45.2, max_speed_ms: 12.6 }],
    }
    const rows = flattenAllTimeBestsToRows('all', bests, true)
    expect(rows).toEqual([
      { period: 'all', category: 'max_speed', sub_key: '', value: 45.2, detail: { date: '2026-06-01', workoutId: null, icuActivityId: 'icu-9', max_speed_ms: 12.6 }, is_indoor: true, rank: 1 },
    ])
  })

  it('omits rows for absent categories rather than emitting nulls', () => {
    const empty: AllTimeBests = { biggestClimb: [], longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [] }
    expect(flattenAllTimeBestsToRows('2026', empty, false)).toEqual([])
  })
})

describe('assembleAllTimeBests round-trips with flattenAllTimeBestsToRows', () => {
  it('reassembles a multi-rank category back into a rank-ascending array', () => {
    const bests: AllTimeBests = {
      biggestClimb: [
        { rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', elev_gain_m: 900, length_km: 3 },
        { rank: 2, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 700, length_km: 2 },
        { rank: 3, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-03-01', elev_gain_m: 500, length_km: 1 },
      ],
      longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [],
    }
    const rows = flattenAllTimeBestsToRows('all', bests, false)
    // shuffle the rows to prove assembleAllTimeBests sorts by rank itself, not by input order
    const shuffled = [rows[2], rows[0], rows[1]]
    const reassembled = assembleAllTimeBests(shuffled)
    expect(reassembled.biggestClimb.map(c => c.rank)).toEqual([1, 2, 3])
    expect(reassembled.biggestClimb.map(c => c.workoutId)).toEqual(['w1', 'w2', 'w3'])
  })

  it('sorts power/speed groups by duration/distance first, then rank within each group', () => {
    const bests: AllTimeBests = {
      biggestClimb: [], longestClimb: [], speedBests: [], maxSpeed: [],
      powerBests: [
        { rank: 2, secs: 300, watts: 280, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01' },
        { rank: 1, secs: 300, watts: 310, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01' },
        { rank: 1, secs: 1200, watts: 210, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-03-01' },
      ],
    }
    const rows = flattenAllTimeBestsToRows('all', bests, false)
    const reassembled = assembleAllTimeBests(rows)
    expect(reassembled.powerBests).toEqual([
      { rank: 1, secs: 300, watts: 310, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01' },
      { rank: 2, secs: 300, watts: 280, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01' },
      { rank: 1, secs: 1200, watts: 210, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-03-01' },
    ])
  })
})

describe('reconstruction and flattening round-trip losslessly', () => {
  it('feeding flattened rows back through reconstructSyntheticRides + computeAllTimeBests reproduces the same bests', () => {
    const original: BestsRide[] = [
      { id: 'w1', icu_activity_id: 'icu-1', date: '2026-01-01', activity_metrics: { climbs: [{ elev_gain_m: 900, length_km: 3 }], best_efforts: [{ secs: 300, watts: 310 }], speed_bests: [{ distance_km: 10, avg_speed_kmh: 38.4 }], max_speed_ms: 19.027 } },
    ]
    const computed = computeAllTimeBests(original)
    const rows = flattenAllTimeBestsToRows('all', computed, false)
    const synthetic = reconstructSyntheticRides(rows)
    const recomputed = computeAllTimeBests(synthetic)
    expect(recomputed).toEqual(computed)
  })
})

describe('fetchBestRecordRows', () => {
  it('coerces value to a real number even when the driver returns it as a string', async () => {
    const rawRow = { period: 'all', category: 'biggest_climb', sub_key: '', value: '900', detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 }, is_indoor: false, rank: 1 }
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: [rawRow], error: null }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient
    const result = await fetchBestRecordRows(supabase, 'u1', 'all', false)
    expect(typeof result[0].value).toBe('number')
    expect(result[0].value).toBe(900)
  })

  it('filters by is_indoor in addition to user_id and period', async () => {
    const eqSpy = jest.fn()
    const supabase = {
      from: () => ({
        select: () => ({
          eq: (...args: unknown[]) => { eqSpy(args); return { eq: (...a2: unknown[]) => { eqSpy(a2); return { eq: (...a3: unknown[]) => { eqSpy(a3); return Promise.resolve({ data: [], error: null }) } } } } },
        }),
      }),
    } as unknown as SupabaseClient
    await fetchBestRecordRows(supabase, 'u1', 'all', true)
    expect(eqSpy).toHaveBeenCalledWith(['user_id', 'u1'])
    expect(eqSpy).toHaveBeenCalledWith(['period', 'all'])
    expect(eqSpy).toHaveBeenCalledWith(['is_indoor', true])
  })
})

describe('upsertBestRecordRows', () => {
  it('upserts on the 6-column conflict target including rank', async () => {
    const upsertSpy = jest.fn()
    const supabase = { from: () => ({ upsert: (rows: unknown[], opts: unknown) => { upsertSpy(rows, opts); return Promise.resolve({ error: null }) } }) } as unknown as SupabaseClient
    await upsertBestRecordRows(supabase, 'u1', [row({ category: 'max_speed', value: 54, is_indoor: false, rank: 1 })])
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.any(Array),
      { onConflict: 'user_id,period,category,sub_key,is_indoor,rank' },
    )
  })

  it('does nothing when given an empty row list', async () => {
    const upsertSpy = jest.fn()
    const supabase = { from: () => ({ upsert: upsertSpy }) } as unknown as SupabaseClient
    await upsertBestRecordRows(supabase, 'u1', [])
    expect(upsertSpy).not.toHaveBeenCalled()
  })
})

describe('mergeCandidateIntoBests', () => {
  it('keeps a full existing podium unchanged when the new candidate beats none of it', () => {
    const existingAllTimeRows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, rank: 1, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 } }),
      row({ category: 'biggest_climb', value: 700, rank: 2, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 2 } }),
      row({ category: 'biggest_climb', value: 500, rank: 3, detail: { date: '2026-03-01', workoutId: 'w3', icuActivityId: 'icu-3', length_km: 1 } }),
    ]
    const candidate: BestsRide = { id: 'w4', icu_activity_id: 'icu-4', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 100, length_km: 0.5 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { allTime } = mergeCandidateIntoBests(existingAllTimeRows, [], candidate)
    expect(allTime.biggestClimb.map(c => c.workoutId)).toEqual(['w1', 'w2', 'w3'])
  })

  it('adds the candidate onto an unfilled podium below the existing champion', () => {
    const existingAllTimeRows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, rank: 1, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 } }),
    ]
    const candidate: BestsRide = { id: 'w2', icu_activity_id: 'icu-2', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 300, length_km: 1 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { allTime } = mergeCandidateIntoBests(existingAllTimeRows, [], candidate)
    expect(allTime.biggestClimb).toEqual([
      { rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', elev_gain_m: 900, length_km: 3 },
      { rank: 2, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-06-01', elev_gain_m: 300, length_km: 1 },
    ])
  })

  it('inserts the new candidate at rank 1 and pushes the existing champion to rank 2 when it beats the podium', () => {
    const existingAllTimeRows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, rank: 1, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 } }),
    ]
    const candidate: BestsRide = { id: 'w2', icu_activity_id: 'icu-2', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 1200, length_km: 8 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { allTime } = mergeCandidateIntoBests(existingAllTimeRows, [], candidate)
    expect(allTime.biggestClimb[0]).toEqual({ rank: 1, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-06-01', elev_gain_m: 1200, length_km: 8 })
    expect(allTime.biggestClimb[1]).toEqual({ rank: 2, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', elev_gain_m: 900, length_km: 3 })
  })

  it('drops the previous 3rd place once a 4th podium-worthy candidate arrives', () => {
    const existingAllTimeRows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, rank: 1, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 } }),
      row({ category: 'biggest_climb', value: 700, rank: 2, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 2 } }),
      row({ category: 'biggest_climb', value: 500, rank: 3, detail: { date: '2026-03-01', workoutId: 'w3', icuActivityId: 'icu-3', length_km: 1 } }),
    ]
    const candidate: BestsRide = { id: 'w4', icu_activity_id: 'icu-4', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 600, length_km: 1.5 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { allTime } = mergeCandidateIntoBests(existingAllTimeRows, [], candidate)
    expect(allTime.biggestClimb.map(c => c.workoutId)).toEqual(['w1', 'w2', 'w4'])
  })

  it('seeds a category with no prior champion', () => {
    const candidate: BestsRide = { id: 'w1', icu_activity_id: 'icu-1', date: '2026-01-01', activity_metrics: { climbs: null, best_efforts: null, speed_bests: null, max_speed_ms: 15 } }
    const { allTime } = mergeCandidateIntoBests([], [], candidate)
    expect(allTime.maxSpeed).toEqual([{ rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', speed_kmh: 54, max_speed_ms: 15 }])
  })

  it('updates the yearBests bucket independently from allTime, using the candidate\'s own year', () => {
    const existingYearRows: BestRecordRow[] = [
      row({ period: '2026', category: 'biggest_climb', value: 400, rank: 1, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 2 } }),
    ]
    const candidate: BestsRide = { id: 'w2', icu_activity_id: 'icu-2', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 900, length_km: 3 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { year, yearBests } = mergeCandidateIntoBests([], existingYearRows, candidate)
    expect(year).toBe('2026')
    expect(yearBests.biggestClimb[0]?.elev_gain_m).toBe(900)
  })
})
```

Replace the full contents of `__tests__/api/bests.test.ts` with:

```typescript
/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

import { GET } from '@/app/api/bests/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { BestRecordRow } from '@/lib/ride/best-records'

// The route issues a single `.eq('user_id', ...)` query and groups the
// returned rows by period AND is_indoor client-side, so the stub returns all
// rows (flattened across periods/surfaces) from that one `.eq()` call rather
// than filtering server-side.
function makeSupabase(rowsByPeriod: Record<string, BestRecordRow[]>, userId: string | null = 'u1') {
  const allRows = Object.values(rowsByPeriod).flat()
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: allRows, error: null }),
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

  it('assembles outdoor allTime and byYear from stored best_records rows, without scanning workouts', async () => {
    const rowsByPeriod: Record<string, BestRecordRow[]> = {
      all: [
        { period: 'all', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 }, is_indoor: false, rank: 1 },
      ],
      '2026': [
        { period: '2026', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 }, is_indoor: false, rank: 1 },
      ],
    }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(rowsByPeriod))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.outdoor.allTime.biggestClimb).toEqual([{ rank: 1, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 }])
    expect(body.outdoor.byYear['2026'].biggestClimb).toEqual([{ rank: 1, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 }])
  })

  it('returns empty bests for both surfaces when best_records has no rows yet', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({}))
    const res = await GET()
    const body = await res.json()
    const empty = { biggestClimb: [], longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [] }
    expect(body.outdoor.allTime).toEqual(empty)
    expect(body.outdoor.byYear).toEqual({})
    expect(body.indoor.allTime).toEqual(empty)
    expect(body.indoor.byYear).toEqual({})
  })

  it('keeps indoor and outdoor records separate even when they share the same period/category/sub_key', async () => {
    const rowsByPeriod: Record<string, BestRecordRow[]> = {
      all: [
        { period: 'all', category: 'max_speed', sub_key: '', value: 54, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', max_speed_ms: 15 }, is_indoor: false, rank: 1 },
        { period: 'all', category: 'max_speed', sub_key: '', value: 144, detail: { date: '2026-01-02', workoutId: 'w2', icuActivityId: 'icu-2', max_speed_ms: 40 }, is_indoor: true, rank: 1 },
      ],
    }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(rowsByPeriod))
    const res = await GET()
    const body = await res.json()
    expect(body.outdoor.allTime.maxSpeed[0]?.speed_kmh).toBe(54)
    expect(body.indoor.allTime.maxSpeed[0]?.speed_kmh).toBe(144)
  })

  it('sorts a multi-rank podium ascending by rank in the response', async () => {
    const rowsByPeriod: Record<string, BestRecordRow[]> = {
      all: [
        { period: 'all', category: 'max_speed', sub_key: '', value: 40, detail: { date: '2026-01-03', workoutId: 'w3', icuActivityId: 'icu-3', max_speed_ms: 11 }, is_indoor: false, rank: 2 },
        { period: 'all', category: 'max_speed', sub_key: '', value: 54, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', max_speed_ms: 15 }, is_indoor: false, rank: 1 },
      ],
    }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(rowsByPeriod))
    const res = await GET()
    const body = await res.json()
    expect(body.outdoor.allTime.maxSpeed.map((m: { rank: number }) => m.rank)).toEqual([1, 2])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/best-records.test.ts __tests__/api/bests.test.ts`
Expected: FAIL — `BestRecordRow` has no `rank` field yet, and the production functions still emit/expect the old singular-object shape.

- [ ] **Step 3: Rewrite `lib/ride/best-records.ts`**

Replace the full file contents with:

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
  is_indoor: boolean
  rank: number   // 1 (gold) through 3 (bronze) — this row's podium position within its (period, category, sub_key, is_indoor) slot
}

// Reconstructs each stored podium row as a minimal "synthetic ride" carrying
// only the one field relevant to its category — feeding these (plus one real
// candidate ride) back through computeAllTimeBests re-derives the correct new
// podium without needing any separate comparison logic. Every stored rank
// becomes its own synthetic ride, so all 3 podium slots (not just rank 1) feed
// back into the recomputation. Callers are responsible for only ever passing
// rows already filtered to one surface (outdoor vs. indoor) — this function has
// no is_indoor awareness itself.
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
// the rows to upsert for one period, tagged with the given isIndoor value. Each
// ranked entry in every category becomes its own row, carrying its rank. Omits
// rows entirely for an empty category rather than writing a null placeholder.
export function flattenAllTimeBestsToRows(period: string, bests: AllTimeBests, isIndoor: boolean): BestRecordRow[] {
  const rows: BestRecordRow[] = []
  for (const c of bests.biggestClimb) {
    rows.push({ period, category: 'biggest_climb', sub_key: '', value: c.elev_gain_m, detail: { date: c.date, workoutId: c.workoutId, icuActivityId: c.icuActivityId, length_km: c.length_km }, is_indoor: isIndoor, rank: c.rank })
  }
  for (const c of bests.longestClimb) {
    rows.push({ period, category: 'longest_climb', sub_key: '', value: c.length_km, detail: { date: c.date, workoutId: c.workoutId, icuActivityId: c.icuActivityId, elev_gain_m: c.elev_gain_m }, is_indoor: isIndoor, rank: c.rank })
  }
  for (const p of bests.powerBests) {
    rows.push({ period, category: 'power', sub_key: String(p.secs), value: p.watts, detail: { date: p.date, workoutId: p.workoutId, icuActivityId: p.icuActivityId }, is_indoor: isIndoor, rank: p.rank })
  }
  for (const s of bests.speedBests) {
    rows.push({ period, category: 'speed', sub_key: String(s.distance_km), value: s.avg_speed_kmh, detail: { date: s.date, workoutId: s.workoutId, icuActivityId: s.icuActivityId }, is_indoor: isIndoor, rank: s.rank })
  }
  for (const m of bests.maxSpeed) {
    rows.push({ period, category: 'max_speed', sub_key: '', value: m.speed_kmh, detail: { date: m.date, workoutId: m.workoutId, icuActivityId: m.icuActivityId, max_speed_ms: m.max_speed_ms }, is_indoor: isIndoor, rank: m.rank })
  }
  return rows
}

// Turns a flat list of stored rows for one period AND one surface back into an
// AllTimeBests — the read-side counterpart to flattenAllTimeBestsToRows. Each
// category collects every row it has, then sorts by rank (power/speed sort by
// duration/distance first, then rank within each). The caller is responsible
// for pre-filtering rows to one is_indoor value, same as it already
// pre-filters by period.
export function assembleAllTimeBests(rows: BestRecordRow[]): AllTimeBests {
  const bests: AllTimeBests = { biggestClimb: [], longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [] }
  for (const r of rows) {
    const d = r.detail as { date: string; workoutId: string | null; icuActivityId: string; length_km?: number; elev_gain_m?: number; max_speed_ms?: number }
    // best_records.value is a Postgres `numeric` column, which some drivers
    // return as a string over the wire. Coerce defensively so the API always
    // serializes real numbers to the UI regardless of driver behavior.
    const value = Number(r.value)
    const rank = r.rank as 1 | 2 | 3
    if (r.category === 'biggest_climb') bests.biggestClimb.push({ rank, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date, elev_gain_m: value, length_km: d.length_km ?? null })
    if (r.category === 'longest_climb') bests.longestClimb.push({ rank, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date, length_km: value, elev_gain_m: d.elev_gain_m as number })
    if (r.category === 'power') bests.powerBests.push({ rank, secs: Number(r.sub_key), watts: value, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date })
    if (r.category === 'speed') bests.speedBests.push({ rank, distance_km: Number(r.sub_key), avg_speed_kmh: value, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date })
    if (r.category === 'max_speed') bests.maxSpeed.push({ rank, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date, speed_kmh: value, max_speed_ms: d.max_speed_ms as number })
  }
  bests.biggestClimb.sort((a, b) => a.rank - b.rank)
  bests.longestClimb.sort((a, b) => a.rank - b.rank)
  bests.powerBests.sort((a, b) => a.secs - b.secs || a.rank - b.rank)
  bests.speedBests.sort((a, b) => a.distance_km - b.distance_km || a.rank - b.rank)
  bests.maxSpeed.sort((a, b) => a.rank - b.rank)
  return bests
}

// Merges one new candidate ride into the currently-stored podiums for both
// "all-time" and the candidate's own year, reusing computeAllTimeBests as the
// sole comparison authority. Pure — callers persist the results themselves.
// existingAllTimeRows/existingYearRows must already be filtered to the same
// surface (outdoor/indoor) as the candidate — see fetchBestRecordRows.
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

export async function fetchBestRecordRows(supabase: SupabaseClient, userId: string, period: string, isIndoor: boolean): Promise<BestRecordRow[]> {
  const { data, error } = await supabase
    .from('best_records')
    .select('period, category, sub_key, value, detail, is_indoor, rank')
    .eq('user_id', userId)
    .eq('period', period)
    .eq('is_indoor', isIndoor)
  if (error) throw new Error(error.message)
  // best_records.value is a Postgres `numeric` column, which some drivers
  // return as a string over the wire — coerce defensively so every downstream
  // reconstruction/comparison always sees a real number (matches the same
  // defensive coercion assembleAllTimeBests already applies for its own reads).
  return ((data ?? []) as BestRecordRow[]).map(row => ({ ...row, value: Number(row.value) }))
}

export async function upsertBestRecordRows(supabase: SupabaseClient, userId: string, rows: BestRecordRow[]): Promise<void> {
  if (!rows.length) return
  const { error } = await supabase
    .from('best_records')
    .upsert(
      rows.map(r => ({ user_id: userId, ...r })),
      { onConflict: 'user_id,period,category,sub_key,is_indoor,rank' },
    )
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 4: Update `app/api/bests/route.ts` to select `rank`**

In `app/api/bests/route.ts`, change:

```typescript
  const { data: rows, error } = await supabase
    .from('best_records')
    .select('period, category, sub_key, value, detail, is_indoor')
    .eq('user_id', user.id)
```

to:

```typescript
  const { data: rows, error } = await supabase
    .from('best_records')
    .select('period, category, sub_key, value, detail, is_indoor, rank')
    .eq('user_id', user.id)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/best-records.test.ts __tests__/api/bests.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 6: Also run the resync-bests and deep-history-bests suites to confirm no regression**

Run: `npx jest __tests__/api/resync-bests.test.ts __tests__/lib/deep-history-bests.test.ts __tests__/lib/enrich.test.ts`
Expected: PASS unchanged — these files call the same shared functions this task updated but assert with `objectContaining`/`toMatchObject`/specific-field checks that tolerate the new `rank` field appearing on rows, per the design spec's "no changes needed downstream" claim.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: still fails in files this task doesn't touch yet (`components/AllTimeBestsTab.tsx`, `lib/ride/ride-medals.ts`, etc.) — confirm no NEW errors in files this task does touch, then proceed.

- [ ] **Step 8: Commit**

```bash
git add lib/ride/best-records.ts app/api/bests/route.ts __tests__/lib/best-records.test.ts __tests__/api/bests.test.ts
git commit -m "Carry rank through best_records row mapping (flatten/assemble/fetch/upsert)"
```

---

### Task 4: Medals data — `lib/ride/ride-medals.ts` + `app/api/rides/medals/route.ts`

**Files:**
- Modify: `lib/ride/ride-medals.ts`
- Modify: `app/api/rides/medals/route.ts` (one-line `.select()` addition, same reasoning as Task 3's `bests/route.ts` change)
- Test: `__tests__/lib/ride-medals.test.ts`
- Test: `__tests__/api/rides-medals.test.ts`
- Test: `__tests__/components/WorkoutCard.test.tsx` (one-line mock fix — `MedalEntry` now requires `rank`)
- Test: `__tests__/components/WorkoutDetailModal.test.tsx` (two-line mock fix, same reason)
- Test: `__tests__/components/TodayCardBadge.test.tsx` (one-line mock fix, same reason)

**Interfaces:**
- Consumes: `BestRecordRow` (with `rank`) from Task 3.
- Produces: `MedalEntry` gains `rank: number`. `buildMedalsByWorkoutId(rows: BestRecordRow[]): Record<string, RideMedals>` signature is unchanged; `RideMedals` shape (`{ allTime: MedalEntry[]; year: MedalEntry[] }`) is unchanged.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `__tests__/lib/ride-medals.test.ts` with:

```typescript
import { buildMedalsByWorkoutId } from '@/lib/ride/ride-medals'
import type { BestRecordRow } from '@/lib/ride/best-records'

function row(overrides: Partial<Omit<BestRecordRow, 'detail'>> & { workoutId: string | null }): BestRecordRow {
  const { workoutId, ...rest } = overrides
  return {
    period: 'all',
    category: 'power',
    sub_key: '',
    value: 100,
    is_indoor: false,
    rank: 1,
    detail: { workoutId, date: '2026-01-01', icuActivityId: 'a1' },
    ...rest,
  }
}

describe('buildMedalsByWorkoutId', () => {
  it('returns an empty object for empty input', () => {
    expect(buildMedalsByWorkoutId([])).toEqual({})
  })

  it('skips rows with a null workoutId (deep-history champions with no local ride)', () => {
    const rows = [row({ workoutId: null, category: 'max_speed' })]
    expect(buildMedalsByWorkoutId(rows)).toEqual({})
  })

  it('puts an "all" period row into the allTime list, carrying its rank', () => {
    const rows = [row({ workoutId: 'w1', period: 'all', category: 'biggest_climb', rank: 1 })]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: { allTime: [{ category: 'biggest_climb', subKey: '', rank: 1 }], year: [] },
    })
  })

  it('puts a non-"all" period row into the year list, carrying its rank', () => {
    const rows = [row({ workoutId: 'w1', period: '2026', category: 'max_speed', rank: 2 })]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: { allTime: [], year: [{ category: 'max_speed', subKey: '', rank: 2 }] },
    })
  })

  it('excludes a category from year when the same ride already holds it all-time', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '300', rank: 1 }),
      row({ workoutId: 'w1', period: '2026', category: 'power', sub_key: '300', rank: 1 }),
    ]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: { allTime: [{ category: 'power', subKey: '300', rank: 1 }], year: [] },
    })
  })

  it('keeps multiple sub_keys of the same category as separate entries (a ride can hold several durations)', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '300', rank: 1 }),
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '1200', rank: 2 }),
    ]
    const result = buildMedalsByWorkoutId(rows)
    expect(result.w1.allTime).toHaveLength(2)
    expect(result.w1.allTime).toEqual(expect.arrayContaining([
      { category: 'power', subKey: '300', rank: 1 },
      { category: 'power', subKey: '1200', rank: 2 },
    ]))
  })

  it('deduplicates an exact repeat of the same category+sub_key', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '300', rank: 1 }),
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '300', rank: 1 }),
    ]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: { allTime: [{ category: 'power', subKey: '300', rank: 1 }], year: [] },
    })
  })

  it('lists different sub_keys of the same category independently across tiers', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '300', rank: 1 }),
      row({ workoutId: 'w1', period: '2026', category: 'power', sub_key: '1200', rank: 3 }),
    ]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: {
        allTime: [{ category: 'power', subKey: '300', rank: 1 }],
        year: [{ category: 'power', subKey: '1200', rank: 3 }],
      },
    })
  })

  it('keeps different categories on the same ride separate', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'biggest_climb', rank: 1 }),
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '300', rank: 2 }),
    ]
    const result = buildMedalsByWorkoutId(rows)
    expect(result.w1.allTime).toHaveLength(2)
    expect(result.w1.allTime).toEqual(expect.arrayContaining([
      { category: 'biggest_climb', subKey: '', rank: 1 },
      { category: 'power', subKey: '300', rank: 2 },
    ]))
  })

  it('keeps different workouts independent', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'max_speed', rank: 1 }),
      row({ workoutId: 'w2', period: '2025', category: 'longest_climb', rank: 3 }),
    ]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: { allTime: [{ category: 'max_speed', subKey: '', rank: 1 }], year: [] },
      w2: { allTime: [], year: [{ category: 'longest_climb', subKey: '', rank: 3 }] },
    })
  })
})
```

In `__tests__/api/rides-medals.test.ts`, change:

```typescript
  it("returns a workoutId-keyed medals lookup for the current user's best_records rows", async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([
      {
        period: 'all', category: 'max_speed', sub_key: '', value: 68.2, is_indoor: false,
        detail: { workoutId: 'w1', date: '2026-03-01', icuActivityId: 'a1' },
      },
    ]))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({
      w1: { allTime: [{ category: 'max_speed', subKey: '' }], year: [] },
    })
  })
```

to:

```typescript
  it("returns a workoutId-keyed medals lookup for the current user's best_records rows", async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([
      {
        period: 'all', category: 'max_speed', sub_key: '', value: 68.2, is_indoor: false, rank: 1,
        detail: { workoutId: 'w1', date: '2026-03-01', icuActivityId: 'a1' },
      },
    ]))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({
      w1: { allTime: [{ category: 'max_speed', subKey: '', rank: 1 }], year: [] },
    })
  })
```

In `__tests__/components/WorkoutCard.test.tsx`, change:

```typescript
    render(<WorkoutCard workout={{ ...workout, status: 'completed' }} medals={{ allTime: [{ category: 'power', subKey: '300' }], year: [] }} />)
```

to:

```typescript
    render(<WorkoutCard workout={{ ...workout, status: 'completed' }} medals={{ allTime: [{ category: 'power', subKey: '300', rank: 1 }], year: [] }} />)
```

In `__tests__/components/WorkoutDetailModal.test.tsx`, change:

```typescript
        medals={{ allTime: [{ category: 'biggest_climb', subKey: '' }], year: [] }}
```

to:

```typescript
        medals={{ allTime: [{ category: 'biggest_climb', subKey: '', rank: 1 }], year: [] }}
```

and change:

```typescript
        medals={{ allTime: [], year: [{ category: 'power', subKey: '300' }] }}
```

to:

```typescript
        medals={{ allTime: [], year: [{ category: 'power', subKey: '300', rank: 1 }] }}
```

In `__tests__/components/TodayCardBadge.test.tsx`, change:

```typescript
  render(<TodayCard workout={workout} wellness={null} medals={{ allTime: [{ category: 'power', subKey: '300' }], year: [] }} />)
```

to:

```typescript
  render(<TodayCard workout={workout} wellness={null} medals={{ allTime: [{ category: 'power', subKey: '300', rank: 1 }], year: [] }} />)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/ride-medals.test.ts __tests__/api/rides-medals.test.ts`
Expected: FAIL — `MedalEntry` has no `rank` field yet.

- [ ] **Step 3: Rewrite `lib/ride/ride-medals.ts`**

Replace the full file contents with:

```typescript
import type { BestRecordRow, BestCategory } from './best-records'

export interface MedalEntry {
  category: BestCategory
  subKey: string   // '' for climbs/max_speed; duration (secs) or distance (km) for power/speed
  rank: number      // 1 (gold) through 3 (bronze) — the ride's podium position for this category+subKey+period
}

export interface RideMedals {
  allTime: MedalEntry[]
  year: MedalEntry[]
}

// Builds a workoutId -> RideMedals lookup from a flat list of best_records rows
// (any mix of periods/surfaces, typically all of one user's rows). Rows whose
// detail.workoutId is null (deep-history champions with no local `workouts` row)
// are skipped — there's no card to attach a badge to. A ride can hold several
// distinct sub_keys within one category (e.g. both a 5-min and a 20-min power
// record) — each gets its own entry, so the detail list shows every one. Only an
// exact (category, sub_key) repeat is deduplicated — a ride can only ever hold
// one rank for a given (category, sub_key, period), so this can't discard a
// distinct rank. A (category, sub_key) already present in a ride's `allTime`
// list is never also added to its `year` list, even though best_records may
// carry a row for both periods — any ride on the all-time podium for a slot is
// provably also on that year's podium for the same slot, so listing both would
// be redundant, regardless of which rank it holds in each.
export function buildMedalsByWorkoutId(rows: BestRecordRow[]): Record<string, RideMedals> {
  const result: Record<string, RideMedals> = {}
  const keyOf = (r: BestRecordRow) => `${r.category}:${r.sub_key}`
  const allTimeKeys: Record<string, Set<string>> = {}

  for (const r of rows) {
    if (r.period !== 'all') continue
    const workoutId = (r.detail as { workoutId: string | null }).workoutId
    if (!workoutId) continue
    if (!result[workoutId]) result[workoutId] = { allTime: [], year: [] }
    if (!allTimeKeys[workoutId]) allTimeKeys[workoutId] = new Set()
    const key = keyOf(r)
    if (allTimeKeys[workoutId].has(key)) continue
    allTimeKeys[workoutId].add(key)
    result[workoutId].allTime.push({ category: r.category, subKey: r.sub_key, rank: r.rank })
  }

  const yearKeys: Record<string, Set<string>> = {}
  for (const r of rows) {
    if (r.period === 'all') continue
    const workoutId = (r.detail as { workoutId: string | null }).workoutId
    if (!workoutId) continue
    const key = keyOf(r)
    if (allTimeKeys[workoutId]?.has(key)) continue
    if (!result[workoutId]) result[workoutId] = { allTime: [], year: [] }
    if (!yearKeys[workoutId]) yearKeys[workoutId] = new Set()
    if (yearKeys[workoutId].has(key)) continue
    yearKeys[workoutId].add(key)
    result[workoutId].year.push({ category: r.category, subKey: r.sub_key, rank: r.rank })
  }

  return result
}
```

- [ ] **Step 4: Update `app/api/rides/medals/route.ts` to select `rank`**

Change:

```typescript
  const { data: rows, error } = await supabase
    .from('best_records')
    .select('period, category, sub_key, value, detail, is_indoor')
    .eq('user_id', user.id)
```

to:

```typescript
  const { data: rows, error } = await supabase
    .from('best_records')
    .select('period, category, sub_key, value, detail, is_indoor, rank')
    .eq('user_id', user.id)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/ride-medals.test.ts __tests__/api/rides-medals.test.ts __tests__/components/WorkoutCard.test.tsx __tests__/components/WorkoutDetailModal.test.tsx __tests__/components/TodayCardBadge.test.tsx`
Expected: PASS (all tests green)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: still fails in `components/RideMedals.tsx` and `components/AllTimeBestsTab.tsx` (Task 5/6) — confirm no new errors elsewhere, then proceed.

- [ ] **Step 7: Commit**

```bash
git add lib/ride/ride-medals.ts app/api/rides/medals/route.ts __tests__/lib/ride-medals.test.ts __tests__/api/rides-medals.test.ts __tests__/components/WorkoutCard.test.tsx __tests__/components/WorkoutDetailModal.test.tsx __tests__/components/TodayCardBadge.test.tsx
git commit -m "Carry rank through the ride-medals lookup and its API route"
```

---

### Task 5: Medal badges — `components/RideMedals.tsx`

**Files:**
- Modify: `components/RideMedals.tsx`
- Test: `__tests__/components/RideMedals.test.tsx`

**Interfaces:**
- Consumes: `MedalEntry` (with `rank`), `RideMedals` from Task 4's `lib/ride/ride-medals.ts`.
- Produces: `RideMedalIcons({ medals })` and `RideMedalList({ medals, year })` — same props as before, no signature change. `WorkoutCard.tsx`, `WorkoutDetailModal.tsx`, `TodayCard.tsx` need no changes — they already pass `medals` through untouched.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `__tests__/components/RideMedals.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react'
import { RideMedalIcons, RideMedalList } from '@/components/RideMedals'

describe('RideMedalIcons', () => {
  it('renders nothing when medals is null', () => {
    const { container } = render(<RideMedalIcons medals={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when medals is undefined', () => {
    const { container } = render(<RideMedalIcons medals={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when both lists are empty', () => {
    const { container } = render(<RideMedalIcons medals={{ allTime: [], year: [] }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders only the trophy when only allTime has entries', () => {
    render(<RideMedalIcons medals={{ allTime: [{ category: 'power', subKey: '300', rank: 1 }], year: [] }} />)
    expect(screen.getByTitle('All-time record')).toBeInTheDocument()
    expect(screen.queryByTitle('Year-best record')).not.toBeInTheDocument()
  })

  it('renders only the medal when only year has entries', () => {
    render(<RideMedalIcons medals={{ allTime: [], year: [{ category: 'max_speed', subKey: '', rank: 1 }] }} />)
    expect(screen.queryByTitle('All-time record')).not.toBeInTheDocument()
    expect(screen.getByTitle('Year-best record')).toBeInTheDocument()
  })

  it('renders both when both lists have entries', () => {
    render(<RideMedalIcons medals={{
      allTime: [{ category: 'biggest_climb', subKey: '', rank: 1 }],
      year: [{ category: 'power', subKey: '300', rank: 1 }],
    }} />)
    expect(screen.getByTitle('All-time record')).toBeInTheDocument()
    expect(screen.getByTitle('Year-best record')).toBeInTheDocument()
  })

  it('shows no rank suffix for a rank-1 entry', () => {
    render(<RideMedalIcons medals={{ allTime: [{ category: 'power', subKey: '300', rank: 1 }], year: [] }} />)
    expect(screen.getByTitle('All-time record')).toHaveTextContent('🏆')
    expect(screen.getByTitle('All-time record')).not.toHaveTextContent('🏆 1')
  })

  it('appends the rank number for a rank-2 or rank-3 entry', () => {
    render(<RideMedalIcons medals={{ allTime: [{ category: 'power', subKey: '300', rank: 3 }], year: [] }} />)
    expect(screen.getByTitle('All-time record')).toHaveTextContent('🏆 3')
  })

  it('picks the best (lowest) rank across multiple entries in the same tier', () => {
    render(<RideMedalIcons medals={{
      allTime: [
        { category: 'power', subKey: '300', rank: 3 },
        { category: 'biggest_climb', subKey: '', rank: 1 },
      ],
      year: [],
    }} />)
    expect(screen.getByTitle('All-time record')).toHaveTextContent('🏆')
    expect(screen.getByTitle('All-time record')).not.toHaveTextContent('🏆 3')
  })
})

describe('RideMedalList', () => {
  it('renders nothing when medals is null', () => {
    const { container } = render(<RideMedalList medals={null} year="2026" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when both lists are empty', () => {
    const { container } = render(<RideMedalList medals={{ allTime: [], year: [] }} year="2026" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('labels a rank-1 all-time entry with its category and no rank suffix', () => {
    render(<RideMedalList medals={{ allTime: [{ category: 'biggest_climb', subKey: '', rank: 1 }], year: [] }} year="2026" />)
    expect(screen.getByText('All-time · Biggest climb')).toBeInTheDocument()
  })

  it('appends the rank number for a rank-2 all-time entry', () => {
    render(<RideMedalList medals={{ allTime: [{ category: 'biggest_climb', subKey: '', rank: 2 }], year: [] }} year="2026" />)
    expect(screen.getByText('All-time #2 · Biggest climb')).toBeInTheDocument()
  })

  it('appends the rank number for a rank-3 year entry, alongside the year label', () => {
    render(<RideMedalList medals={{ allTime: [], year: [{ category: 'power', subKey: '300', rank: 3 }] }} year="2026" />)
    expect(screen.getByText('2026 best #3 · Power 5 min')).toBeInTheDocument()
  })

  it('labels a year entry with the given year, its category, and the duration for power', () => {
    render(<RideMedalList medals={{ allTime: [], year: [{ category: 'power', subKey: '300', rank: 1 }] }} year="2026" />)
    expect(screen.getByText('2026 best · Power 5 min')).toBeInTheDocument()
  })

  it('formats a sub-minute power duration in seconds', () => {
    render(<RideMedalList medals={{ allTime: [{ category: 'power', subKey: '15', rank: 1 }], year: [] }} year="2026" />)
    expect(screen.getByText('All-time · Power 15s')).toBeInTheDocument()
  })

  it('formats a speed entry with its distance in km', () => {
    render(<RideMedalList medals={{ allTime: [{ category: 'speed', subKey: '10', rank: 1 }], year: [] }} year="2026" />)
    expect(screen.getByText('All-time · Speed 10 km')).toBeInTheDocument()
  })

  it('renders one row per entry across both tiers', () => {
    render(<RideMedalList medals={{
      allTime: [{ category: 'biggest_climb', subKey: '', rank: 1 }],
      year: [{ category: 'power', subKey: '300', rank: 1 }, { category: 'max_speed', subKey: '', rank: 2 }],
    }} year="2025" />)
    expect(screen.getByText('All-time · Biggest climb')).toBeInTheDocument()
    expect(screen.getByText('2025 best · Power 5 min')).toBeInTheDocument()
    expect(screen.getByText('2025 best #2 · Max speed')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/components/RideMedals.test.tsx`
Expected: FAIL — the new rank-suffix and best-rank-picking assertions don't match the current unranked rendering.

- [ ] **Step 3: Rewrite `components/RideMedals.tsx`**

Replace the full file contents with:

```tsx
import type { RideMedals, MedalEntry } from '@/lib/ride/ride-medals'
import type { BestCategory } from '@/lib/ride/best-records'

const CATEGORY_ICON: Record<BestCategory, string> = {
  biggest_climb: '🏔️',
  longest_climb: '📏',
  power: '⚡',
  speed: '🚀',
  max_speed: '💥',
}

const CATEGORY_LABEL: Record<BestCategory, string> = {
  biggest_climb: 'Biggest climb',
  longest_climb: 'Longest climb',
  power: 'Power',
  speed: 'Speed',
  max_speed: 'Max speed',
}

// power's subKey is a duration in seconds; speed's is a distance in km. Climbs
// and max_speed carry no subKey ('') and need no detail suffix.
function formatSubKey(category: BestCategory, subKey: string): string {
  if (!subKey) return ''
  if (category === 'power') {
    const secs = Number(subKey)
    return secs < 60 ? `${secs}s` : `${secs / 60} min`
  }
  if (category === 'speed') return `${subKey} km`
  return ''
}

function categoryDetail(entry: MedalEntry): string {
  const detail = formatSubKey(entry.category, entry.subKey)
  return detail ? `${CATEGORY_LABEL[entry.category]} ${detail}` : CATEGORY_LABEL[entry.category]
}

// The card badge is presence-only per tier, not per category — a ride holding
// both an all-time #1 climb and an all-time #3 power record still shows a
// single trophy, picking the best (lowest-numbered) rank across every entry
// in that tier.
function bestRank(entries: MedalEntry[]): number | null {
  if (entries.length === 0) return null
  return Math.min(...entries.map(e => e.rank))
}

function TierIcon({ icon, label, rank }: { icon: string; label: string; rank: number }) {
  return (
    <span title={label} aria-label={label}>
      {icon}{rank > 1 ? ` ${rank}` : ''}
    </span>
  )
}

export function RideMedalIcons({ medals }: { medals: RideMedals | null | undefined }) {
  if (!medals) return null
  const allTimeRank = bestRank(medals.allTime)
  const yearRank = bestRank(medals.year)
  if (allTimeRank == null && yearRank == null) return null
  return (
    <span className="inline-flex items-center gap-1">
      {allTimeRank != null && <TierIcon icon="🏆" label="All-time record" rank={allTimeRank} />}
      {yearRank != null && <TierIcon icon="🥇" label="Year-best record" rank={yearRank} />}
    </span>
  )
}

function MedalRow({ tierIcon, tierLabel, entry }: { tierIcon: string; tierLabel: string; entry: MedalEntry }) {
  const rankSuffix = entry.rank > 1 ? ` #${entry.rank}` : ''
  return (
    <div className="flex items-center gap-2 text-sm text-gray-700">
      <span aria-hidden="true">{tierIcon}</span>
      <span aria-hidden="true">{CATEGORY_ICON[entry.category]}</span>
      <span>{tierLabel}{rankSuffix} · {categoryDetail(entry)}</span>
    </div>
  )
}

export function RideMedalList({ medals, year }: { medals: RideMedals | null | undefined; year: string }) {
  if (!medals) return null
  if (medals.allTime.length === 0 && medals.year.length === 0) return null
  return (
    <div className="space-y-1">
      {medals.allTime.map((entry, i) => (
        <MedalRow key={`all-${i}`} tierIcon="🏆" tierLabel="All-time" entry={entry} />
      ))}
      {medals.year.map((entry, i) => (
        <MedalRow key={`year-${i}`} tierIcon="🥇" tierLabel={`${year} best`} entry={entry} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/components/RideMedals.test.tsx`
Expected: PASS (all tests green)

- [ ] **Step 5: Run the full medal-related component suites to confirm no regression**

Run: `npx jest __tests__/components/WorkoutCard.test.tsx __tests__/components/WorkoutDetailModal.test.tsx __tests__/components/TodayCardBadge.test.tsx`
Expected: PASS — these consumers only pass `medals` through and were already fixed for the `rank` field in Task 4.

- [ ] **Step 6: Commit**

```bash
git add components/RideMedals.tsx __tests__/components/RideMedals.test.tsx
git commit -m "Show rank on ride medal badges (card icon suffix, detail list #2/#3)"
```

---

### Task 6: Bests tab expand-for-2nd/3rd — `components/AllTimeBestsTab.tsx`

**Files:**
- Modify: `components/AllTimeBestsTab.tsx`
- Test: `__tests__/components/AllTimeBestsTab.test.tsx`
- Test: `__tests__/app/stats/page.test.tsx` (one mock update — same `AllTimeBests` shape change)

**Interfaces:**
- Consumes: `AllTimeBests`, `IndoorOutdoorBestsResponse` from Task 2/3 (array-shaped, ranked).
- Produces: `AllTimeBestsTab` — no props, no signature change (it's a page-level component fetching its own data).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `__tests__/components/AllTimeBestsTab.test.tsx` with:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import AllTimeBestsTab from '@/components/AllTimeBestsTab'
import type { AllTimeBests, IndoorOutdoorBestsResponse } from '@/lib/ride/all-time-bests'

const EMPTY_BESTS: AllTimeBests = { biggestClimb: [], longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [] }

function makeResponse(overrides: Partial<IndoorOutdoorBestsResponse> = {}): IndoorOutdoorBestsResponse {
  return {
    outdoor: {
      allTime: {
        biggestClimb: [
          { rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 },
        ],
        longestClimb: [
          { rank: 1, workoutId: 'w2', icuActivityId: 'icu-2', date: '2025-11-02', length_km: 12.1, elev_gain_m: 480 },
        ],
        powerBests: [
          { rank: 1, secs: 300, watts: 312, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-01-10' },
        ],
        speedBests: [
          { rank: 1, distance_km: 10, avg_speed_kmh: 38.4, workoutId: 'w4', icuActivityId: 'icu-4', date: '2026-05-01' },
        ],
        maxSpeed: [
          { rank: 1, workoutId: 'w5', icuActivityId: 'icu-5', date: '2024-07-04', speed_kmh: 68.2, max_speed_ms: 18.9 },
        ],
      },
      byYear: {
        '2026': {
          biggestClimb: [{ rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 }],
          longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [],
        },
        '2025': {
          biggestClimb: [],
          longestClimb: [{ rank: 1, workoutId: 'w2', icuActivityId: 'icu-2', date: '2025-11-02', length_km: 12.1, elev_gain_m: 480 }],
          powerBests: [], speedBests: [], maxSpeed: [],
        },
      },
    },
    indoor: { allTime: EMPTY_BESTS, byYear: {} },
    ...overrides,
  }
}

global.fetch = jest.fn()

describe('AllTimeBestsTab', () => {
  afterEach(() => jest.clearAllMocks())

  it('shows a loading state while fetching', () => {
    ;(global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}))
    render(<AllTimeBestsTab />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders outdoor all-time bests by default', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeResponse() })
    render(<AllTimeBestsTab />)
    expect(await screen.findByText('620')).toBeInTheDocument()   // biggest climb elevation
    expect(screen.getByText(/8\.4km/)).toBeInTheDocument()        // biggest climb caption
    expect(screen.getByText('12.1')).toBeInTheDocument()          // longest climb length
    expect(screen.getByText('312')).toBeInTheDocument()           // power best watts
    expect(screen.getByText('38.4')).toBeInTheDocument()          // speed best
    expect(screen.getByText('68.2')).toBeInTheDocument()          // max speed
  })

  it('renders Outdoor/Indoor toggle buttons plus an All-time chip and one chip per byYear entry, most recent year first', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeResponse() })
    render(<AllTimeBestsTab />)
    await screen.findByText('620')
    const chips = screen.getAllByRole('button').map(b => b.textContent)
    expect(chips).toEqual(['Outdoor', 'Indoor', 'All-time', '2026', '2025'])
  })

  it('clicking a year chip re-scopes the sections without an extra fetch', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeResponse() })
    render(<AllTimeBestsTab />)
    await screen.findByText('620')
    expect(global.fetch).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '2025' }))

    expect(screen.queryByText('620')).not.toBeInTheDocument()      // 2026's biggest climb no longer shown
    expect(await screen.findByText('12.1')).toBeInTheDocument()    // 2025's longest climb shown
    expect(global.fetch).toHaveBeenCalledTimes(1)                  // still just the one initial fetch
  })

  it('switching to Indoor shows indoor bests and resets the period back to All-time', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => makeResponse({
        indoor: {
          allTime: { ...EMPTY_BESTS, maxSpeed: [{ rank: 1, workoutId: null, icuActivityId: 'icu-9', date: '2026-06-01', speed_kmh: 45.2, max_speed_ms: 12.6 }] },
          byYear: {},
        },
      }),
    })
    render(<AllTimeBestsTab />)
    await screen.findByText('620')

    fireEvent.click(screen.getByRole('button', { name: '2025' }))
    await screen.findByText('12.1')

    fireEvent.click(screen.getByRole('button', { name: 'Indoor' }))

    expect(screen.queryByText('620')).not.toBeInTheDocument()
    expect(screen.queryByText('12.1')).not.toBeInTheDocument()
    expect(await screen.findByText('45.2')).toBeInTheDocument()
    // switching surface drops the other surface's year chips and returns to All-time
    expect(screen.queryByRole('button', { name: '2025' })).not.toBeInTheDocument()
  })

  it('hides sections with no data for the selected period and shows an empty message when all are absent', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => makeResponse({ outdoor: { allTime: EMPTY_BESTS, byYear: {} } }),
    })
    render(<AllTimeBestsTab />)
    expect(await screen.findByText('No ride data yet for this period.')).toBeInTheDocument()
    expect(screen.queryByText('Biggest Climb')).not.toBeInTheDocument()
  })

  it('renders the Biggest Climb caption without a bogus length when length_km is null (un-backfilled data)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => makeResponse({
        outdoor: {
          allTime: { biggestClimb: [{ rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-03-15', elev_gain_m: 620, length_km: null }], longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [] },
          byYear: {},
        },
      }),
    })
    render(<AllTimeBestsTab />)
    expect(await screen.findByText('620')).toBeInTheDocument()
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
  })

  it('links each entry to its intervals.icu activity page', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeResponse() })
    render(<AllTimeBestsTab />)
    await screen.findByText('620')
    const links = screen.getAllByRole('link', { name: /View on intervals\.icu/i })
    expect(links.length).toBeGreaterThanOrEqual(5) // at least one for each category
    expect(links[0]).toHaveAttribute('href', 'https://intervals.icu/activities/icu-1')
    expect(links[0]).toHaveAttribute('target', '_blank')
    expect(links[1]).toHaveAttribute('href', 'https://intervals.icu/activities/icu-2')
  })

  it('does not show an expand toggle when a category has only one podium entry', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeResponse() })
    render(<AllTimeBestsTab />)
    await screen.findByText('620')
    expect(screen.queryByRole('button', { name: /runners-up/i })).not.toBeInTheDocument()
  })

  it('reveals 2nd and 3rd place when the expand toggle is clicked, and hides them again on a second click', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => makeResponse({
        outdoor: {
          allTime: {
            biggestClimb: [
              { rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 },
              { rank: 2, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 580, length_km: 7.1 },
              { rank: 3, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-01-01', elev_gain_m: 540, length_km: 6.5 },
            ],
            longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [],
          },
          byYear: {},
        },
      }),
    })
    render(<AllTimeBestsTab />)
    await screen.findByText('620')

    expect(screen.queryByText('580')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Show Elevation runners-up' })
    fireEvent.click(toggle)

    expect(await screen.findByText('580')).toBeInTheDocument()
    expect(screen.getByText('540')).toBeInTheDocument()
    expect(screen.getByText('#2 Elevation')).toBeInTheDocument()
    expect(screen.getByText('#3 Elevation')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hide Elevation runners-up' }))
    expect(screen.queryByText('580')).not.toBeInTheDocument()
  })
})
```

In `__tests__/app/stats/page.test.tsx`, change:

```typescript
      if (String(url).includes('/api/bests')) {
        return Promise.resolve({ ok: true, json: async () => ({
          outdoor: {
            allTime: {
              biggestClimb: { workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 },
              longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null,
            },
            byYear: {},
          },
          indoor: {
            allTime: { biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null },
            byYear: {},
          },
        }) })
      }
```

to:

```typescript
      if (String(url).includes('/api/bests')) {
        return Promise.resolve({ ok: true, json: async () => ({
          outdoor: {
            allTime: {
              biggestClimb: [{ rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 }],
              longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [],
            },
            byYear: {},
          },
          indoor: {
            allTime: { biggestClimb: [], longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [] },
            byYear: {},
          },
        }) })
      }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/components/AllTimeBestsTab.test.tsx __tests__/app/stats/page.test.tsx`
Expected: FAIL — the component still renders the old singular-object shape and has no expand toggle.

- [ ] **Step 3: Rewrite `components/AllTimeBestsTab.tsx`**

Replace the full file contents with:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { SectionCard } from '@/components/RideStats'
import type { AllTimeBests, IndoorOutdoorBestsResponse } from '@/lib/ride/all-time-bests'

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function BestCell({ label, value, unit, caption, icuActivityId, tile, rankBadge }: {
  label: string; value: string; unit?: string; caption: string; icuActivityId: string; tile?: boolean; rankBadge?: number
}) {
  return (
    <div className={tile
      ? 'text-center px-2 py-3 bg-gray-50 rounded-lg'
      : 'flex-1 text-center px-2 py-3 sm:px-3 sm:py-4 min-w-[110px]'
    }>
      <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">
        {value}
        {unit && <span className="text-xs font-medium text-gray-400 ml-0.5">{unit}</span>}
      </div>
      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">
        {rankBadge ? `#${rankBadge} ` : ''}{label}
      </div>
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

function durationLabel(secs: number): string {
  return secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}min`
}

// Groups a rank-sorted array of entries by a key (duration for power, distance
// for speed) while preserving each group's existing rank order.
function groupByKey<T, K>(items: T[], keyFn: (t: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    const group = map.get(key)
    if (group) group.push(item)
    else map.set(key, [item])
  }
  return map
}

// Renders the #1 entry exactly like a plain BestCell. When 2nd/3rd place also
// exist, a chevron toggles them into view below — kept as a sibling button
// (not a wrapper) so it never nests inside the cell's own intervals.icu <a> link.
function ExpandableBestCell<T extends { rank: number; icuActivityId: string }>({
  entries, label, tile, formatValue, formatUnit, formatCaption,
}: {
  entries: T[]
  label: string
  tile?: boolean
  formatValue: (e: T) => string
  formatUnit?: (e: T) => string | undefined
  formatCaption: (e: T) => string
}) {
  const [expanded, setExpanded] = useState(false)
  const [primary, ...rest] = entries
  if (!primary) return null
  return (
    <div className="relative w-full">
      <BestCell
        label={label} value={formatValue(primary)} unit={formatUnit?.(primary)}
        caption={formatCaption(primary)} icuActivityId={primary.icuActivityId} tile={tile}
      />
      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
          aria-label={expanded ? `Hide ${label} runners-up` : `Show ${label} runners-up`}
          className="absolute top-1 right-1 text-gray-300 hover:text-gray-500 p-1"
        >
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
            strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
      {expanded && rest.map(e => (
        <div key={e.rank} className="mt-1">
          <BestCell
            label={label} value={formatValue(e)} unit={formatUnit?.(e)}
            caption={formatCaption(e)} icuActivityId={e.icuActivityId} tile={tile} rankBadge={e.rank}
          />
        </div>
      ))}
    </div>
  )
}

function BestsSections({ bests }: { bests: AllTimeBests }) {
  const isEmpty = bests.biggestClimb.length === 0 && bests.longestClimb.length === 0
    && bests.powerBests.length === 0 && bests.speedBests.length === 0 && bests.maxSpeed.length === 0

  if (isEmpty) {
    return <p className="text-sm text-gray-400 text-center py-8">No ride data yet for this period.</p>
  }

  const powerByDuration = groupByKey(bests.powerBests, p => p.secs)
  const speedByDistance = groupByKey(bests.speedBests, s => s.distance_km)

  return (
    <div className="space-y-4">
      {bests.biggestClimb.length > 0 && (
        <SectionCard title="Biggest Climb" accent="bg-emerald-400">
          <div className="flex">
            <ExpandableBestCell
              entries={bests.biggestClimb}
              label="Elevation"
              formatValue={c => String(c.elev_gain_m)}
              formatUnit={() => 'm'}
              formatCaption={c => c.length_km != null ? `${c.length_km}km · ${formatDate(c.date)}` : formatDate(c.date)}
            />
          </div>
        </SectionCard>
      )}
      {bests.longestClimb.length > 0 && (
        <SectionCard title="Longest Climb" accent="bg-emerald-400">
          <div className="flex">
            <ExpandableBestCell
              entries={bests.longestClimb}
              label="Length"
              formatValue={c => String(c.length_km)}
              formatUnit={() => 'km'}
              formatCaption={c => `${c.elev_gain_m}m gain · ${formatDate(c.date)}`}
            />
          </div>
        </SectionCard>
      )}
      {bests.powerBests.length > 0 && (
        <SectionCard title="Power Bests" accent="bg-orange-400">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2">
            {[...powerByDuration.entries()].map(([secs, entries]) => (
              <ExpandableBestCell
                key={secs}
                entries={entries}
                label={durationLabel(secs)}
                tile
                formatValue={p => String(p.watts)}
                formatUnit={() => 'w'}
                formatCaption={p => formatDate(p.date)}
              />
            ))}
          </div>
        </SectionCard>
      )}
      {bests.speedBests.length > 0 && (
        <SectionCard title="Speed Bests" accent="bg-blue-400">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2">
            {[...speedByDistance.entries()].map(([distance_km, entries]) => (
              <ExpandableBestCell
                key={distance_km}
                entries={entries}
                label={`${distance_km}km`}
                tile
                formatValue={s => s.avg_speed_kmh.toFixed(1)}
                formatUnit={() => 'km/h'}
                formatCaption={s => formatDate(s.date)}
              />
            ))}
          </div>
        </SectionCard>
      )}
      {bests.maxSpeed.length > 0 && (
        <SectionCard title="Max Speed" accent="bg-red-400">
          <div className="flex">
            <ExpandableBestCell
              entries={bests.maxSpeed}
              label="Top Speed"
              formatValue={m => m.speed_kmh.toFixed(1)}
              formatUnit={() => 'km/h'}
              formatCaption={m => formatDate(m.date)}
            />
          </div>
        </SectionCard>
      )}
    </div>
  )
}

export default function AllTimeBestsTab() {
  const [data, setData] = useState<IndoorOutdoorBestsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSurface, setSelectedSurface] = useState<'outdoor' | 'indoor'>('outdoor')
  const [selectedPeriod, setSelectedPeriod] = useState<'all' | string>('all')

  useEffect(() => {
    fetch('/api/bests')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setData(d))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 rounded-full border-2 border-gray-200 border-t-blue-500" />
      </div>
    )
  }
  if (!data) return <p className="text-sm text-red-600">Could not load bests.</p>

  const surfaceData = data[selectedSurface]
  const years = Object.keys(surfaceData.byYear).sort((a, b) => b.localeCompare(a))
  const current = selectedPeriod === 'all' ? surfaceData.allTime : surfaceData.byYear[selectedPeriod]

  function selectSurface(surface: 'outdoor' | 'indoor') {
    setSelectedSurface(surface)
    setSelectedPeriod('all')
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        <button
          onClick={() => selectSurface('outdoor')}
          className={`flex-1 text-xs font-semibold px-3 py-2.5 rounded-full border transition-colors ${
            selectedSurface === 'outdoor' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-500'
          }`}
        >
          Outdoor
        </button>
        <button
          onClick={() => selectSurface('indoor')}
          className={`flex-1 text-xs font-semibold px-3 py-2.5 rounded-full border transition-colors ${
            selectedSurface === 'indoor' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-500'
          }`}
        >
          Indoor
        </button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none" style={{ touchAction: 'pan-x' }}>
        <button
          onClick={() => setSelectedPeriod('all')}
          className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
            selectedPeriod === 'all' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-500'
          }`}
        >
          All-time
        </button>
        {years.map(year => (
          <button
            key={year}
            onClick={() => setSelectedPeriod(year)}
            className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              selectedPeriod === year ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-500'
            }`}
          >
            {year}
          </button>
        ))}
      </div>
      <BestsSections bests={current} />
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/components/AllTimeBestsTab.test.tsx __tests__/app/stats/page.test.tsx`
Expected: PASS (all tests green)

- [ ] **Step 5: Full suite + typecheck**

Run: `npm run test:ci`
Expected: PASS with zero failures and zero type errors — this is the last task, so the whole branch must be green.

- [ ] **Step 6: Manual mobile-width sanity check**

Per `AGENTS.md`'s mobile-first UI rule, mentally check (or run the dev server and resize to 375px) that the new expand chevron on power/speed tiles doesn't overlap the tile's existing "View on intervals.icu →" link or get clipped at the tile's edge. The chevron is `absolute top-1 right-1` inside a `relative` wrapper — confirm it renders inside the tile's padding, not outside it.

- [ ] **Step 7: Commit**

```bash
git add components/AllTimeBestsTab.tsx __tests__/components/AllTimeBestsTab.test.tsx __tests__/app/stats/page.test.tsx
git commit -m "Add expand-for-2nd/3rd interaction to the Bests tab's ranked tiles"
```

---

## After all tasks: remind the user about the migration and backfill

Once Task 6 is merged, tell the user (do not act on this yourself without confirmation):

1. The exact SQL from Task 1 (`supabase/migrations/20260726_best_records_rank.sql`) must be run against the shared Supabase project's SQL editor before or as part of deploying this feature — there is no automated migration deploy step in this repo.
2. After that migration is run and the app is deployed, click "Resync bests" on the Settings page (and, if desired, re-trigger the deep-history scan) to backfill 2nd/3rd place for existing ride history — no new backfill mechanism was built; this reuses the existing recovery path per the design spec.
