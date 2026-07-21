# Indoor/Outdoor Bests Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split every all-time-bests category (biggest/longest climb, power bests, speed bests, max speed) into separate outdoor and indoor (trainer/virtual) record sets, so a Zwift session never overwrites or competes against a real-world outdoor personal best.

**Architecture:** `is_indoor` is derived once, at ride-enrichment time, from `activity.type === 'VirtualRide'`, and stored on `ActivityMetrics` itself. All three existing write paths (resync, incremental merge, deep-history scan) already build a candidate from `ActivityMetrics` — each is extended to fetch/merge/write against only the matching surface's existing champions, reusing the same `computeAllTimeBests` reducer unchanged. `best_records` gains an `is_indoor` column folded into its uniqueness key. The read side (`/api/bests`) returns both surfaces in one response; the UI adds a small Outdoor/Indoor toggle next to the existing period selector.

**Tech Stack:** Next.js App Router, TypeScript strict mode, Supabase (Postgres + RLS), Jest + Testing Library.

## Global Constraints

- **Detection signal:** `is_indoor = (activity.type === 'VirtualRide')` — exact string equality, not a substring/regex test. This is the only place indoor/outdoor status is derived.
- **Storage:** `is_indoor` lives on `ActivityMetrics` (the JSON blob already stored per ride), NOT as a new `workouts` table column. It is optional on the TypeScript interface (`is_indoor?: boolean`) because rides enriched before this feature exist in the database without the key — every read site must treat `undefined` the same as `false` (outdoor).
- **No new admin buttons.** This feature reuses the existing "Backfill all-time bests (climbs & speed)" and "Resync all-time bests from current rides" Settings buttons entirely as-is. Do not add any new Settings UI beyond the Outdoor/Indoor toggle inside the Bests tab itself.
- **`computeAllTimeBests` and `computeAllTimeBestsByPeriod` (`lib/ride/all-time-bests.ts`) are NOT modified**, except for one small additive change in Task 6 (a new exported type). They already operate generically over "whatever subset of rides they're given" — every write path achieves the outdoor/indoor split by choosing which pre-filtered subset to pass in, not by teaching the reducer a new concept.
- **API response shape:** `/api/bests` returns `{ outdoor: AllTimeBestsResponse, indoor: AllTimeBestsResponse }` — one fetch, no query parameters, matching the existing "fetch everything once, filter client-side" convention the period selector already uses.
- **Mobile-first (per `AGENTS.md`):** the new Outdoor/Indoor toggle must use `py-2.5` or larger for its touch target (44px minimum), same as every other interactive control in this PWA.
- **Migration idempotency (per `AGENTS.md`):** the migration must be safely re-runnable (`add column if not exists`, guarded `DO` blocks for constraints) since there's no way to confirm ahead of time whether it's already been applied to the shared production database.

---

### Task 1: Detection foundation — `is_indoor` on `ActivityMetrics`, migration, `METRICS_VERSION` bump

**Files:**
- Modify: `types/index.ts`
- Modify: `lib/claude/activity-metrics.ts`
- Modify: `__tests__/lib/activity-metrics.test.ts`
- Create: `supabase/migrations/20260721_best_records_is_indoor.sql`

**Interfaces:**
- Produces: `ActivityMetrics.is_indoor?: boolean` (used by every later task); `METRICS_VERSION = 6` (triggers the existing backfill mechanism to re-enrich every ride and populate `is_indoor`); `best_records.is_indoor boolean not null default false` column + updated 5-column unique constraint (used by Task 2 onward).

- [ ] **Step 1: Add `is_indoor` to the `ActivityMetrics` type**

In `types/index.ts`, find the `ActivityMetrics` interface (around line 524) and add a new field directly after `max_speed_ms`:

```ts
  max_speed_ms?: number | null   // m/s, raw from API
  is_indoor?: boolean            // true for trainer/virtual rides (ICU type === 'VirtualRide'); absent (not false) on rides enriched before this field existed — treat undefined as false everywhere it's read
```

- [ ] **Step 2: Write the failing tests**

In `__tests__/lib/activity-metrics.test.ts`, find this existing test (around line 90):

```ts
  it('bumps METRICS_VERSION to 5', () => {
    expect(METRICS_VERSION).toBe(5)
  })
```

Replace it with:

```ts
  it('bumps METRICS_VERSION to 6', () => {
    expect(METRICS_VERSION).toBe(6)
  })
```

Then add two new tests directly after it:

```ts
  it('detects an indoor/virtual ride from the activity type', () => {
    const m = extractActivityMetrics({ ...act, type: 'VirtualRide' }, curve, intervals)
    expect(m.is_indoor).toBe(true)
  })

  it('treats a real-world ride type as outdoor', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.is_indoor).toBe(false)
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest __tests__/lib/activity-metrics.test.ts -t "METRICS_VERSION|indoor|outdoor"`
Expected: the METRICS_VERSION test fails (`Expected: 6, Received: 5`); the two new tests fail (`m.is_indoor` is `undefined`, not `true`/`false`).

- [ ] **Step 4: Implement**

In `lib/claude/activity-metrics.ts`, change:

```ts
export const METRICS_VERSION = 5
```

to:

```ts
export const METRICS_VERSION = 6
```

Then in `extractActivityMetrics`, find this line (around line 58):

```ts
    max_speed_ms: act.max_speed ?? null,
```

and add directly after it:

```ts
    max_speed_ms: act.max_speed ?? null,
    is_indoor: act.type === 'VirtualRide',
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest __tests__/lib/activity-metrics.test.ts`
Expected: all tests pass, including the three touched above.

- [ ] **Step 6: Write the migration**

Create `supabase/migrations/20260721_best_records_is_indoor.sql`:

```sql
-- Adds an is_indoor dimension to best_records so a trainer/virtual ride's
-- climbs/power/speed/max-speed never compete against (or overwrite) a
-- real-world outdoor record. Existing rows default to false as a
-- placeholder only — the rollout's resync step (run after the existing
-- metrics backfill re-enriches every ride with a real is_indoor value)
-- recomputes every row from scratch, so the placeholder never stands as
-- final data. Run in the Supabase SQL editor before deploying the
-- matching app version.

alter table best_records add column if not exists is_indoor boolean not null default false;

-- Drop whatever the OLD 4-column unique constraint is actually named,
-- found dynamically by its column set rather than guessed — Postgres
-- auto-names unnamed constraints, and this repo has no way to confirm the
-- real production name ahead of time (no linked Supabase CLI).
do $$
declare
  old_constraint_name text;
begin
  select c.conname into old_constraint_name
  from pg_constraint c
  where c.conrelid = 'best_records'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname order by a.attname)
      from unnest(c.conkey) as k(attnum)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    ) = array['category', 'period', 'sub_key', 'user_id']
  limit 1;

  if old_constraint_name is not null then
    execute format('alter table best_records drop constraint %I', old_constraint_name);
  end if;
end $$;

-- Add the new 5-column unique constraint (idempotent — only adds if missing).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'best_records'::regclass
      and conname = 'best_records_user_id_period_category_sub_key_is_indoor_key'
  ) then
    alter table best_records add constraint best_records_user_id_period_category_sub_key_is_indoor_key
      unique (user_id, period, category, sub_key, is_indoor);
  end if;
end $$;

notify pgrst, 'reload schema';
```

- [ ] **Step 7: Commit**

```bash
git add types/index.ts lib/claude/activity-metrics.ts __tests__/lib/activity-metrics.test.ts supabase/migrations/20260721_best_records_is_indoor.sql
git commit -m "feat: detect indoor/virtual rides and add best_records.is_indoor migration"
```

---

### Task 2: `lib/ride/best-records.ts` — thread `is_indoor` through row shape, flatten, fetch, upsert

**Files:**
- Modify: `lib/ride/best-records.ts`
- Modify: `__tests__/lib/best-records.test.ts`

**Interfaces:**
- Consumes: `ActivityMetrics.is_indoor?: boolean` (Task 1).
- Produces: `BestRecordRow.is_indoor: boolean` (required — every row read from the DB after Task 1's migration has a real boolean, thanks to `not null default false`); `flattenAllTimeBestsToRows(period: string, bests: AllTimeBests, isIndoor: boolean): BestRecordRow[]` (new 3rd parameter); `fetchBestRecordRows(supabase: SupabaseClient, userId: string, period: string, isIndoor: boolean): Promise<BestRecordRow[]>` (new 4th parameter). `reconstructSyntheticRides`, `mergeCandidateIntoBests`, and `assembleAllTimeBests` keep their exact existing signatures unchanged — callers are responsible for passing already-surface-filtered row sets, the same way period filtering already works.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `__tests__/lib/best-records.test.ts` with:

```ts
import {
  reconstructSyntheticRides, flattenAllTimeBestsToRows, mergeCandidateIntoBests, fetchBestRecordRows, upsertBestRecordRows,
  type BestRecordRow,
} from '@/lib/ride/best-records'
import { computeAllTimeBests, type AllTimeBests, type BestsRide } from '@/lib/ride/all-time-bests'
import type { SupabaseClient } from '@supabase/supabase-js'

function row(overrides: Partial<BestRecordRow>): BestRecordRow {
  return { period: 'all', category: 'biggest_climb', sub_key: '', value: 0, detail: {}, is_indoor: false, ...overrides }
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
  it('flattens a full AllTimeBests into one row per present category, tagged with the given isIndoor value', () => {
    const bests: AllTimeBests = {
      biggestClimb: { workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', elev_gain_m: 900, length_km: 3 },
      longestClimb: { workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', length_km: 12, elev_gain_m: 400 },
      powerBests: [{ secs: 300, watts: 310, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-03-01' }],
      speedBests: [{ distance_km: 10, avg_speed_kmh: 38.4, workoutId: 'w4', icuActivityId: 'icu-4', date: '2026-04-01' }],
      maxSpeed: { workoutId: 'w5', icuActivityId: 'icu-5', date: '2026-05-01', speed_kmh: 68.5, max_speed_ms: 19.027 },
    }
    const rows = flattenAllTimeBestsToRows('all', bests, false)
    expect(rows).toEqual([
      { period: 'all', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 }, is_indoor: false },
      { period: 'all', category: 'longest_climb', sub_key: '', value: 12, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', elev_gain_m: 400 }, is_indoor: false },
      { period: 'all', category: 'power', sub_key: '300', value: 310, detail: { date: '2026-03-01', workoutId: 'w3', icuActivityId: 'icu-3' }, is_indoor: false },
      { period: 'all', category: 'speed', sub_key: '10', value: 38.4, detail: { date: '2026-04-01', workoutId: 'w4', icuActivityId: 'icu-4' }, is_indoor: false },
      { period: 'all', category: 'max_speed', sub_key: '', value: 68.5, detail: { date: '2026-05-01', workoutId: 'w5', icuActivityId: 'icu-5', max_speed_ms: 19.027 }, is_indoor: false },
    ])
  })

  it('tags every row true when isIndoor is true', () => {
    const bests: AllTimeBests = {
      biggestClimb: null, longestClimb: null, powerBests: [],
      speedBests: [], maxSpeed: { workoutId: null, icuActivityId: 'icu-9', date: '2026-06-01', speed_kmh: 45.2, max_speed_ms: 12.6 },
    }
    const rows = flattenAllTimeBestsToRows('all', bests, true)
    expect(rows).toEqual([
      { period: 'all', category: 'max_speed', sub_key: '', value: 45.2, detail: { date: '2026-06-01', workoutId: null, icuActivityId: 'icu-9', max_speed_ms: 12.6 }, is_indoor: true },
    ])
  })

  it('omits rows for absent categories rather than emitting nulls', () => {
    const empty: AllTimeBests = { biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null }
    expect(flattenAllTimeBestsToRows('2026', empty, false)).toEqual([])
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
    const rawRow = { period: 'all', category: 'biggest_climb', sub_key: '', value: '900', detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 }, is_indoor: false }
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
  it('upserts on the 5-column conflict target including is_indoor', async () => {
    const upsertSpy = jest.fn()
    const supabase = { from: () => ({ upsert: (rows: unknown[], opts: unknown) => { upsertSpy(rows, opts); return Promise.resolve({ error: null }) } }) } as unknown as SupabaseClient
    await upsertBestRecordRows(supabase, 'u1', [row({ category: 'max_speed', value: 54, is_indoor: false })])
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.any(Array),
      { onConflict: 'user_id,period,category,sub_key,is_indoor' },
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
Expected: FAIL — `flattenAllTimeBestsToRows` called with 3 args when it only accepts 2 (TS type error surfaces as a test-run failure since ts-jest type-checks), `fetchBestRecordRows` called with 4 args, rows missing `is_indoor`, `upsertBestRecordRows`'s onConflict test expects the new 5-column string.

- [ ] **Step 3: Implement**

Replace the full contents of `lib/ride/best-records.ts` with:

```ts
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
}

// Reconstructs each stored champion row as a minimal "synthetic ride" carrying
// only the one field relevant to its category — feeding these (plus one real
// candidate ride) back through computeAllTimeBests re-derives the correct new
// champions without needing any separate comparison logic. Callers are
// responsible for only ever passing rows already filtered to one surface
// (outdoor vs. indoor) — this function has no is_indoor awareness itself.
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
// the rows to upsert for one period, tagged with the given isIndoor value.
// Omits a row entirely for any absent category rather than writing a null
// placeholder.
export function flattenAllTimeBestsToRows(period: string, bests: AllTimeBests, isIndoor: boolean): BestRecordRow[] {
  const rows: BestRecordRow[] = []
  if (bests.biggestClimb) {
    const c = bests.biggestClimb
    rows.push({ period, category: 'biggest_climb', sub_key: '', value: c.elev_gain_m, detail: { date: c.date, workoutId: c.workoutId, icuActivityId: c.icuActivityId, length_km: c.length_km }, is_indoor: isIndoor })
  }
  if (bests.longestClimb) {
    const c = bests.longestClimb
    rows.push({ period, category: 'longest_climb', sub_key: '', value: c.length_km, detail: { date: c.date, workoutId: c.workoutId, icuActivityId: c.icuActivityId, elev_gain_m: c.elev_gain_m }, is_indoor: isIndoor })
  }
  for (const p of bests.powerBests) {
    rows.push({ period, category: 'power', sub_key: String(p.secs), value: p.watts, detail: { date: p.date, workoutId: p.workoutId, icuActivityId: p.icuActivityId }, is_indoor: isIndoor })
  }
  for (const s of bests.speedBests) {
    rows.push({ period, category: 'speed', sub_key: String(s.distance_km), value: s.avg_speed_kmh, detail: { date: s.date, workoutId: s.workoutId, icuActivityId: s.icuActivityId }, is_indoor: isIndoor })
  }
  if (bests.maxSpeed) {
    const m = bests.maxSpeed
    rows.push({ period, category: 'max_speed', sub_key: '', value: m.speed_kmh, detail: { date: m.date, workoutId: m.workoutId, icuActivityId: m.icuActivityId, max_speed_ms: m.max_speed_ms }, is_indoor: isIndoor })
  }
  return rows
}

// Turns a flat list of stored rows for one period AND one surface back into
// an AllTimeBests — the read-side counterpart to flattenAllTimeBestsToRows.
// Categories with no row simply stay at their default null/empty value. The
// caller is responsible for pre-filtering rows to one is_indoor value, same
// as it already pre-filters by period.
export function assembleAllTimeBests(rows: BestRecordRow[]): AllTimeBests {
  const bests: AllTimeBests = { biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null }
  for (const r of rows) {
    const d = r.detail as { date: string; workoutId: string | null; icuActivityId: string; length_km?: number; elev_gain_m?: number; max_speed_ms?: number }
    // best_records.value is a Postgres `numeric` column, which some drivers
    // return as a string over the wire. Coerce defensively so the API always
    // serializes real numbers to the UI regardless of driver behavior.
    const value = Number(r.value)
    if (r.category === 'biggest_climb') bests.biggestClimb = { workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date, elev_gain_m: value, length_km: d.length_km ?? null }
    if (r.category === 'longest_climb') bests.longestClimb = { workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date, length_km: value, elev_gain_m: d.elev_gain_m as number }
    if (r.category === 'power') bests.powerBests.push({ secs: Number(r.sub_key), watts: value, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date })
    if (r.category === 'speed') bests.speedBests.push({ distance_km: Number(r.sub_key), avg_speed_kmh: value, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date })
    if (r.category === 'max_speed') bests.maxSpeed = { workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date, speed_kmh: value, max_speed_ms: d.max_speed_ms as number }
  }
  bests.powerBests.sort((a, b) => a.secs - b.secs)
  bests.speedBests.sort((a, b) => a.distance_km - b.distance_km)
  return bests
}

// Merges one new candidate ride into the currently-stored champions for both
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
    .select('period, category, sub_key, value, detail, is_indoor')
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
      { onConflict: 'user_id,period,category,sub_key,is_indoor' },
    )
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/best-records.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ride/best-records.ts __tests__/lib/best-records.test.ts
git commit -m "feat: thread is_indoor through best_records row shape, flatten, fetch, upsert"
```

---

### Task 3: Resync route — partition workouts into outdoor/indoor before computing

**Files:**
- Modify: `app/api/admin/resync-bests/route.ts`
- Modify: `__tests__/api/resync-bests.test.ts`

**Interfaces:**
- Consumes: `ActivityMetrics.is_indoor?: boolean` (Task 1); `flattenAllTimeBestsToRows(period, bests, isIndoor)` (Task 2).

- [ ] **Step 1: Write the failing tests**

In `__tests__/api/resync-bests.test.ts`, add these two new tests at the end of the `describe('POST /api/admin/resync-bests', ...)` block, directly after the existing "resets deep_history_bests_cursor..." test:

```ts
  it('partitions workouts into outdoor and indoor sets, never letting an indoor ride compete with an outdoor record', async () => {
    const upsertSpy = jest.fn()
    const workoutRows = [
      {
        id: 'w1', icu_activity_id: 'icu-1', date: '2026-03-01',
        activity_metrics: { climbs: null, best_efforts: null, speed_bests: null, max_speed_ms: 15, is_indoor: false },
      },
      {
        id: 'w2', icu_activity_id: 'icu-2', date: '2026-03-02',
        activity_metrics: { climbs: null, best_efforts: null, speed_bests: null, max_speed_ms: 40, is_indoor: true },
      },
    ]
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ workoutRows, upsertSpy }))
    const res = await POST()
    expect(res.status).toBe(200)
    const [rows] = upsertSpy.mock.calls[0]
    const outdoorMaxSpeed = rows.find((r: { category: string; is_indoor: boolean }) => r.category === 'max_speed' && r.is_indoor === false)
    const indoorMaxSpeed = rows.find((r: { category: string; is_indoor: boolean }) => r.category === 'max_speed' && r.is_indoor === true)
    expect(outdoorMaxSpeed).toMatchObject({ period: 'all', value: 54 })
    expect(indoorMaxSpeed).toMatchObject({ period: 'all', value: 144 })
  })

  it('treats a ride with no is_indoor key at all (pre-feature data) as outdoor', async () => {
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
    const [rows] = upsertSpy.mock.calls[0]
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'biggest_climb', is_indoor: false }),
    ]))
    expect(rows.find((r: { is_indoor: boolean }) => r.is_indoor === true)).toBeUndefined()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/api/resync-bests.test.ts`
Expected: FAIL — the route currently writes every ride into one undifferentiated set with no `is_indoor` tagging (the existing `flattenAllTimeBestsToRows` call in the route doesn't compile without a 3rd argument once Task 2 lands, or if Task 2 already gives it a default — it doesn't — this fails with a TS error; after fixing the call sites in Step 3 it will fail on the new partitioning assertions specifically).

- [ ] **Step 3: Implement**

Replace the full contents of `app/api/admin/resync-bests/route.ts` with:

```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { computeAllTimeBestsByPeriod, type BestsRide } from '@/lib/ride/all-time-bests'
import { flattenAllTimeBestsToRows, upsertBestRecordRows } from '@/lib/ride/best-records'
import type { ActivityMetrics } from '@/types'

export const dynamic = 'force-dynamic'

/** Recomputes best_records from scratch from the current workouts rows. Safe to
 * re-run at any time — this is the correction path for the "champion records
 * only ever go up" limitation (e.g. after disassociating a workout, or after
 * an algorithm fix that would otherwise leave a stale, too-high value behind).
 * Partitions rides into outdoor/indoor before computing so the two surfaces
 * are always recomputed and written completely independently. */
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

  const allRides = (rows ?? []) as Array<{ id: string; icu_activity_id: string; date: string; activity_metrics: ActivityMetrics }>
  // Rides enriched before this feature existed have no is_indoor key at all
  // (undefined) — treat that the same as false, matching the column's own
  // `not null default false`. This is a transient state: the metrics
  // backfill (run before this resync, per the rollout) supersedes it for
  // every ride going forward.
  const outdoorRides = allRides.filter(r => !r.activity_metrics.is_indoor) as BestsRide[]
  const indoorRides = allRides.filter(r => r.activity_metrics.is_indoor) as BestsRide[]

  const outdoor = computeAllTimeBestsByPeriod(outdoorRides)
  const indoor = computeAllTimeBestsByPeriod(indoorRides)

  const allRows = [
    ...flattenAllTimeBestsToRows('all', outdoor.allTime, false),
    ...Object.entries(outdoor.byYear).flatMap(([year, bests]) => flattenAllTimeBestsToRows(year, bests, false)),
    ...flattenAllTimeBestsToRows('all', indoor.allTime, true),
    ...Object.entries(indoor.byYear).flatMap(([year, bests]) => flattenAllTimeBestsToRows(year, bests, true)),
  ]

  // A full wipe-and-rewrite, not a partial upsert: this route already recomputes
  // from the ENTIRE workouts table every time, so any category that no longer
  // qualifies (e.g. its record-holding ride was disassociated) must not leave a
  // stale row behind — clearing first is what makes this a genuine recovery
  // mechanism for the "champion records only ever go up" limitation.
  const { error: deleteError } = await supabase.from('best_records').delete().eq('user_id', user.id)
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

  // Deep-history-sourced champions have no workouts row and can't be restored by
  // this recompute (it only reads workouts) — resetting the cursor to null makes
  // the next deep-history scan restart from the oldest workout (its own fallback
  // logic) instead of resuming from wherever it last left off, so it re-covers
  // exactly the span this wipe just discarded.
  const { error: cursorError } = await supabase.from('user_profile').update({ deep_history_bests_cursor: null }).eq('user_id', user.id)
  if (cursorError) return NextResponse.json({ error: cursorError.message }, { status: 500 })

  await upsertBestRecordRows(supabase, user.id, allRows)

  return NextResponse.json({ ridesScanned: allRides.length, rowsWritten: allRows.length })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/resync-bests.test.ts`
Expected: all tests pass, including the two new ones.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm run test:ci`
Expected: no failures — this is the first task where other files (Task 2's `best-records.ts`) are actually consumed with the new signatures, so this is the first point a signature mismatch elsewhere would surface.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/resync-bests/route.ts __tests__/api/resync-bests.test.ts
git commit -m "feat: partition resync-bests into outdoor and indoor sets"
```

---

### Task 4: Incremental merge (`lib/intervals/enrich.ts`) — thread `is_indoor` through

**Files:**
- Modify: `lib/intervals/enrich.ts`
- Modify: `__tests__/lib/enrich.test.ts`

**Interfaces:**
- Consumes: `ActivityMetrics.is_indoor?: boolean` (Task 1); `fetchBestRecordRows(supabase, userId, period, isIndoor)`, `flattenAllTimeBestsToRows(period, bests, isIndoor)` (Task 2).

- [ ] **Step 1: Write the failing test**

In `__tests__/lib/enrich.test.ts`, the mock for the `best_records` table (inside `makeSupabase`, around line 53-57) needs one more chained `.eq()` level to match the new 3-filter query. Replace:

```ts
      if (table === 'best_records') {
        return {
          select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }),
          upsert: (upsertRows: unknown[], opts: unknown) => { bestRecordsUpsertSpy?.(upsertRows, opts); return Promise.resolve({ error: null }) },
        }
      }
```

with:

```ts
      if (table === 'best_records') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }) }),
          upsert: (upsertRows: unknown[], opts: unknown) => { bestRecordsUpsertSpy?.(upsertRows, opts); return Promise.resolve({ error: null }) },
        }
      }
```

Then add a new test at the end of the file, directly after the existing "merges each successfully-enriched ride into best_records" test:

```ts
  it('threads is_indoor through to the best_records rows for an indoor/virtual ride', async () => {
    const updateSpy = jest.fn()
    const bestRecordsUpsertSpy = jest.fn()
    const supabase = makeSupabase(
      [{ id: 'w1', icu_activity_id: 'a1', steps: null, date: '2026-05-20' }],
      updateSpy, undefined, bestRecordsUpsertSpy,
    )
    const client = makeClient()
    client.getActivity = jest.fn(async (id: string) => ({
      id, start_date_local: '2026-05-20T07:00:00', type: 'VirtualRide', moving_time: 3600,
      name: 'Zwift Ride', average_watts: 200, max_watts: 500, weighted_average_watts: 210,
      average_heartrate: 140, training_load: 80, rolling_ftp: 250, distance: 30000,
      total_elevation_gain: 300, left_right_balance: 50,
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await backfillActivityMetrics(supabase as any, client as any, 'u1')

    const rows = bestRecordsUpsertSpy.mock.calls.flatMap(([r]) => r as Array<{ is_indoor: boolean }>)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.is_indoor === true)).toBe(true)
  })
```

Also extend the existing "merges each successfully-enriched ride into best_records" test with one more assertion, so the default (outdoor) path is explicitly checked too. Find:

```ts
    expect(bestRecordsUpsertSpy).toHaveBeenCalled()
    const periods = bestRecordsUpsertSpy.mock.calls.map(([rows]) => rows.map((r: { period: string }) => r.period)).flat()
    expect(periods).toEqual(expect.arrayContaining(['all', '2026']))
  })
```

and replace with:

```ts
    expect(bestRecordsUpsertSpy).toHaveBeenCalled()
    const rows = bestRecordsUpsertSpy.mock.calls.flatMap(([r]) => r as Array<{ period: string; is_indoor: boolean }>)
    expect(rows.map(r => r.period)).toEqual(expect.arrayContaining(['all', '2026']))
    expect(rows.every(r => r.is_indoor === false)).toBe(true)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/enrich.test.ts`
Expected: FAIL — `fetchBestRecordRows`/`flattenAllTimeBestsToRows` calls in `enrich.ts` don't yet pass the new `isIndoor` argument (TS error), and the new/extended assertions don't find `is_indoor` on the written rows.

- [ ] **Step 3: Implement**

In `lib/intervals/enrich.ts`, find this block (around line 142-157):

```ts
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
```

Replace with:

```ts
      try {
        const rideDate = row.date
        const isIndoor = metrics.is_indoor ?? false
        const candidate = { id: row.id, icu_activity_id: row.icu_activity_id, date: rideDate, activity_metrics: metrics }
        const year = rideDate.slice(0, 4)
        const [allTimeRows, yearRows] = await Promise.all([
          fetchBestRecordRows(supabase, userId, 'all', isIndoor),
          fetchBestRecordRows(supabase, userId, year, isIndoor),
        ])
        const { allTime, yearBests } = mergeCandidateIntoBests(allTimeRows, yearRows, candidate)
        await upsertBestRecordRows(supabase, userId, [
          ...flattenAllTimeBestsToRows('all', allTime, isIndoor),
          ...flattenAllTimeBestsToRows(year, yearBests, isIndoor),
        ])
      } catch (bestsErr) {
        console.error(`[backfill] failed to merge workout ${row.id} into best_records:`, bestsErr)
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/enrich.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/intervals/enrich.ts __tests__/lib/enrich.test.ts
git commit -m "feat: thread is_indoor through the incremental best_records merge"
```

---

### Task 5: Deep-history scan (`lib/intervals/deep-history-bests.ts`) — thread `is_indoor` through

**Files:**
- Modify: `lib/intervals/deep-history-bests.ts`
- Modify: `__tests__/lib/deep-history-bests.test.ts`

**Interfaces:**
- Consumes: `ActivityMetrics.is_indoor?: boolean` (Task 1, already flows through `extractActivityMetrics`, already called here); `fetchBestRecordRows(supabase, userId, period, isIndoor)`, `flattenAllTimeBestsToRows(period, bests, isIndoor)` (Task 2).

- [ ] **Step 1: Write the failing test**

In `__tests__/lib/deep-history-bests.test.ts`, the `makeSupabase` helper needs one more chained `.eq()` level. Replace:

```ts
function makeSupabase({ existingRows = [] as unknown[], upsertSpy = jest.fn() } = {}) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ eq: async () => ({ data: existingRows, error: null }) }) }),
      upsert: (rows: unknown[], opts: unknown) => { upsertSpy(rows, opts); return Promise.resolve({ error: null }) },
    }),
  }
}
```

with:

```ts
function makeSupabase({ existingRows = [] as unknown[], upsertSpy = jest.fn() } = {}) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ data: existingRows, error: null }) }) }) }),
      upsert: (rows: unknown[], opts: unknown) => { upsertSpy(rows, opts); return Promise.resolve({ error: null }) },
    }),
  }
}
```

Then add a new test at the end of the `describe('runDeepHistoryBestsBatch', ...)` block:

```ts
  it('threads is_indoor through when the activity is a VirtualRide (indoor/trainer)', async () => {
    const activities = [makeActivity({ id: 'v1', start_date_local: '2019-12-30T08:00:00', type: 'VirtualRide', max_speed: 12 })]
    const upsertSpy = jest.fn()
    const client = makeClient(activities)
    const result = await runDeepHistoryBestsBatch(makeSupabase({ upsertSpy }) as never, client as never, 'u1', '2020-01-01')
    expect(result.processed).toBe(1)
    expect(upsertSpy).toHaveBeenCalled()
    const rows = upsertSpy.mock.calls.flatMap(([r]) => r as Array<{ is_indoor: boolean }>)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.is_indoor === true)).toBe(true)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/deep-history-bests.test.ts`
Expected: FAIL — `fetchBestRecordRows`/`flattenAllTimeBestsToRows` calls in `deep-history-bests.ts` don't yet pass the new `isIndoor` argument (TS error), and the new test's rows don't carry `is_indoor: true`.

- [ ] **Step 3: Implement**

In `lib/intervals/deep-history-bests.ts`, find this block (the full `for` loop body, around lines 42-76):

```ts
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
```

Replace with:

```ts
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
      const isIndoor = base.is_indoor ?? false
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
        fetchBestRecordRows(supabase, userId, 'all', isIndoor),
        fetchBestRecordRows(supabase, userId, year, isIndoor),
      ])
      const { allTime, yearBests } = mergeCandidateIntoBests(allTimeRows, yearRows, candidate)
      await upsertBestRecordRows(supabase, userId, [
        ...flattenAllTimeBestsToRows('all', allTime, isIndoor),
        ...flattenAllTimeBestsToRows(year, yearBests, isIndoor),
      ])
    } catch (err) {
      console.error(`[deep-history-bests] failed to process activity ${activity.id}:`, err)
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/deep-history-bests.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/intervals/deep-history-bests.ts __tests__/lib/deep-history-bests.test.ts
git commit -m "feat: thread is_indoor through the deep-history bests scan"
```

---

### Task 6: Read side — `IndoorOutdoorBestsResponse` type and `/api/bests` route

**Files:**
- Modify: `lib/ride/all-time-bests.ts`
- Modify: `app/api/bests/route.ts`
- Modify: `__tests__/api/bests.test.ts`

**Interfaces:**
- Consumes: `BestRecordRow.is_indoor` (Task 2).
- Produces: `IndoorOutdoorBestsResponse { outdoor: AllTimeBestsResponse; indoor: AllTimeBestsResponse }`, exported from `lib/ride/all-time-bests.ts` — consumed by Task 7.

- [ ] **Step 1: Write the failing tests**

In `lib/ride/all-time-bests.ts`, this new type doesn't exist yet, so import it will fail. Replace the full contents of `__tests__/api/bests.test.ts` with:

```ts
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
        { period: 'all', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 }, is_indoor: false },
      ],
      '2026': [
        { period: '2026', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 }, is_indoor: false },
      ],
    }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(rowsByPeriod))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.outdoor.allTime.biggestClimb).toEqual({ workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 })
    expect(body.outdoor.byYear['2026'].biggestClimb).toEqual({ workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 })
  })

  it('returns empty bests for both surfaces when best_records has no rows yet', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({}))
    const res = await GET()
    const body = await res.json()
    const empty = { biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null }
    expect(body.outdoor.allTime).toEqual(empty)
    expect(body.outdoor.byYear).toEqual({})
    expect(body.indoor.allTime).toEqual(empty)
    expect(body.indoor.byYear).toEqual({})
  })

  it('keeps indoor and outdoor records separate even when they share the same period/category/sub_key', async () => {
    const rowsByPeriod: Record<string, BestRecordRow[]> = {
      all: [
        { period: 'all', category: 'max_speed', sub_key: '', value: 54, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', max_speed_ms: 15 }, is_indoor: false },
        { period: 'all', category: 'max_speed', sub_key: '', value: 144, detail: { date: '2026-01-02', workoutId: 'w2', icuActivityId: 'icu-2', max_speed_ms: 40 }, is_indoor: true },
      ],
    }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(rowsByPeriod))
    const res = await GET()
    const body = await res.json()
    expect(body.outdoor.allTime.maxSpeed?.speed_kmh).toBe(54)
    expect(body.indoor.allTime.maxSpeed?.speed_kmh).toBe(144)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/api/bests.test.ts`
Expected: FAIL — the route still returns `{ allTime, byYear }` directly (no `outdoor`/`indoor` keys), and `BestRecordRow` fixtures now include `is_indoor` which isn't read by anything yet.

- [ ] **Step 3: Implement**

In `lib/ride/all-time-bests.ts`, find the `AllTimeBestsResponse` interface (around line 11-14):

```ts
export interface AllTimeBestsResponse {
  allTime: AllTimeBests
  byYear: Record<string, AllTimeBests>
}
```

and add directly after it:

```ts
export interface IndoorOutdoorBestsResponse {
  outdoor: AllTimeBestsResponse
  indoor: AllTimeBestsResponse
}
```

Then replace the full contents of `app/api/bests/route.ts` with:

```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { AllTimeBestsResponse, IndoorOutdoorBestsResponse } from '@/lib/ride/all-time-bests'
import { assembleAllTimeBests, type BestRecordRow } from '@/lib/ride/best-records'

export const dynamic = 'force-dynamic'

function buildSurface(rows: BestRecordRow[], isIndoor: boolean): AllTimeBestsResponse {
  const surfaceRows = rows.filter(r => r.is_indoor === isIndoor)
  const allTime = assembleAllTimeBests(surfaceRows.filter(r => r.period === 'all'))
  const byYear: AllTimeBestsResponse['byYear'] = {}
  for (const r of surfaceRows) {
    if (r.period === 'all') continue
    if (!byYear[r.period]) byYear[r.period] = assembleAllTimeBests(surfaceRows.filter(x => x.period === r.period))
  }
  return { allTime, byYear }
}

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rows, error } = await supabase
    .from('best_records')
    .select('period, category, sub_key, value, detail, is_indoor')
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const allRows = (rows ?? []) as BestRecordRow[]
  const response: IndoorOutdoorBestsResponse = {
    outdoor: buildSurface(allRows, false),
    indoor: buildSurface(allRows, true),
  }
  return NextResponse.json(response)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/bests.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ride/all-time-bests.ts app/api/bests/route.ts __tests__/api/bests.test.ts
git commit -m "feat: return separate outdoor/indoor bests from /api/bests"
```

---

### Task 7: `AllTimeBestsTab.tsx` — Outdoor/Indoor toggle

**Files:**
- Modify: `components/AllTimeBestsTab.tsx`
- Modify: `__tests__/components/AllTimeBestsTab.test.tsx`

**Interfaces:**
- Consumes: `IndoorOutdoorBestsResponse` (Task 6).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `__tests__/components/AllTimeBestsTab.test.tsx` with:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import AllTimeBestsTab from '@/components/AllTimeBestsTab'
import type { AllTimeBests, IndoorOutdoorBestsResponse } from '@/lib/ride/all-time-bests'

const EMPTY_BESTS: AllTimeBests = { biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null }

function makeResponse(overrides: Partial<IndoorOutdoorBestsResponse> = {}): IndoorOutdoorBestsResponse {
  return {
    outdoor: {
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
          allTime: { ...EMPTY_BESTS, maxSpeed: { workoutId: null, icuActivityId: 'icu-9', date: '2026-06-01', speed_kmh: 45.2, max_speed_ms: 12.6 } },
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
          allTime: { biggestClimb: { workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-03-15', elev_gain_m: 620, length_km: null }, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null },
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
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/components/AllTimeBestsTab.test.tsx`
Expected: FAIL — the component still fetches/renders a flat `AllTimeBestsResponse`, so `data.outdoor`/`data.indoor` don't exist and the toggle buttons ("Outdoor"/"Indoor") aren't rendered.

- [ ] **Step 3: Implement**

Replace the full contents of `components/AllTimeBestsTab.tsx` with:

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

function durationLabel(secs: number): string {
  return secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}min`
}

function BestsSections({ bests }: { bests: AllTimeBests }) {
  const isEmpty = !bests.biggestClimb && !bests.longestClimb
    && bests.powerBests.length === 0 && bests.speedBests.length === 0 && !bests.maxSpeed

  if (isEmpty) {
    return <p className="text-sm text-gray-400 text-center py-8">No ride data yet for this period.</p>
  }

  return (
    <div className="space-y-4">
      {bests.biggestClimb && (
        <SectionCard title="Biggest Climb" accent="bg-emerald-400">
          <div className="flex">
            <BestCell
              label="Elevation" value={String(bests.biggestClimb.elev_gain_m)} unit="m"
              caption={bests.biggestClimb.length_km != null
                ? `${bests.biggestClimb.length_km}km · ${formatDate(bests.biggestClimb.date)}`
                : formatDate(bests.biggestClimb.date)}
              icuActivityId={bests.biggestClimb.icuActivityId}
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
              icuActivityId={bests.longestClimb.icuActivityId}
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
                icuActivityId={p.icuActivityId}
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
                icuActivityId={sp.icuActivityId}
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
              icuActivityId={bests.maxSpeed.icuActivityId}
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/components/AllTimeBestsTab.test.tsx`
Expected: all tests pass.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm run test:ci`
Expected: no failures across the whole repo — this is the final task, so this confirms every prior task's signature changes compose correctly end to end.

- [ ] **Step 6: Commit**

```bash
git add components/AllTimeBestsTab.tsx __tests__/components/AllTimeBestsTab.test.tsx
git commit -m "feat: add Outdoor/Indoor toggle to the Bests tab"
```

---

## Rollout (after all tasks merge)

No new admin buttons — this reuses every control already built:

1. Run the migration in the Supabase SQL editor (`supabase/migrations/20260721_best_records_is_indoor.sql`).
2. Click **Backfill all-time bests (climbs & speed)** in Settings — the `METRICS_VERSION` bump (5 → 6) makes it re-enrich every ride and populate `is_indoor` on each one's stored `activity_metrics`. This may need to be clicked multiple times if the athlete has more than `BACKFILL_LIMIT` (25) rides needing re-enrichment — it reports progress and is safe to re-click.
3. Click **Resync all-time bests from current rides** — recomputes `best_records` from scratch, now correctly split into outdoor/indoor.
4. Future **Scan further back in ride history** clicks carry the split forward automatically.
