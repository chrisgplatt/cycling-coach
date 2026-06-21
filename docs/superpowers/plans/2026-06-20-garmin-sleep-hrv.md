# Garmin Sleep Data & HRV Source Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull overnight HRV, resting HR, sleep stages, and respiration from Garmin `getSleepData()`, store them in `garmin_wellness`, route the existing HRV baseline model to prefer Garmin data over intervals.icu, and surface RHR and sleep stages in the briefing prompt and StrainBreakdownSheet.

**Architecture:** Seven sequential tasks: (1) new client method + tests, (2) DB migration + type extensions, (3) sync route + dashboard merge, (4) baseline generalisation + Garmin HRV source functions, (5) migrate 9 HRV call sites, (6) briefing prompt signals, (7) StrainBreakdownSheet sleep stage row. Each task is independently testable and committed.

**Tech Stack:** TypeScript, Next.js App Router, Supabase, `garmin-connect` npm v1.6.2, existing `computeHrvBaseline` / `HrvStatus` model in `lib/hrv/`.

## Global Constraints

- `getSleepData()` is a native method on `GarminConnect` — call `this._gc.getSleepData(new Date(date))`, NOT `gc.get()`.
- `SleepData` type is exported from `garmin-connect/dist/garmin/types/sleep` — import it, do not redefine it.
- `computeHrvBaseline` must remain a pure function (no Supabase/network imports).
- All existing `HrvStatus` consumers continue to receive the identical object shape — no field additions or removals to `HrvStatus`.
- `fetchHrvStatus(client, today)` stays exported and unchanged so any call site not yet migrated still compiles.
- Garmin is tried first; ICU is fallback. Never call both and merge.
- NEVER commit `scripts/ftp-simulation.ts`, `scripts/ftp-feedback-check.ts`, `scripts/ftp-simulation-final.ts`, or any Supabase JWT service role key.

---

## File Map

| File | Change |
|------|--------|
| `lib/garmin/client.ts` | Add `SleepMetrics` interface + `getSleepMetrics()` |
| `lib/garmin/client.test.ts` | Add `getSleepMetrics` test suite |
| `supabase/migrations/20260620_garmin_sleep_hrv.sql` | New — 8 columns on `garmin_wellness` |
| `types/index.ts` | Extend `GarminWellness`, `ICUWellness`, `BriefingContext` |
| `app/api/sync/route.ts` | 5th parallel call + 8 new fields in row/return |
| `app/dashboard/page.tsx` | Extend `latestWellnessWithLoad` merge |
| `lib/hrv/baseline.ts` | Generalise input type; remove `ICUWellness` import |
| `__tests__/lib/hrv-baseline.test.ts` | Add minimal-shape test |
| `lib/hrv/server.ts` | Add `fetchHrvStatusFromGarmin` + `fetchHrvStatusBestSource` |
| `__tests__/lib/hrv-server.test.ts` | New — test the router |
| 9 route files (see Task 5) | Replace `fetchHrvStatus` with `fetchHrvStatusBestSource` |
| `app/api/briefing/today/route.ts` | Extend select + wire 5 new ctx fields |
| `lib/claude/briefing.ts` | Add RHR + sleep stages to `garminLines` |
| `components/StrainBreakdownSheet.tsx` | Add sleep stages sub-signal row |

---

### Task 1: `GarminClient.getSleepMetrics()` + tests

**Files:**
- Modify: `lib/garmin/client.ts`
- Modify: `lib/garmin/client.test.ts`

**Interfaces:**
- Produces: `SleepMetrics` interface and `GarminClient.getSleepMetrics(date: string): Promise<SleepMetrics>`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the bottom of `lib/garmin/client.test.ts`:

```ts
describe('GarminClient.getSleepMetrics', () => {
  it('returns all fields from a full sleep response', async () => {
    const gc = makeMockGC({
      getSleepData: jest.fn().mockResolvedValue({
        avgOvernightHrv: 68.4,
        hrvStatus: 'BALANCED',
        restingHeartRate: 52,
        bodyBatteryChange: 35,
        dailySleepDTO: {
          deepSleepSeconds: 6300,
          lightSleepSeconds: 12120,
          remSleepSeconds: 7800,
          awakeSleepSeconds: 1260,
          averageRespirationValue: 14.6,
        },
      }),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    const result = await client.getSleepMetrics('2026-06-20')
    expect(result.overnightHrv).toBe(68)
    expect(result.hrvGarminStatus).toBe('BALANCED')
    expect(result.restingHr).toBe(52)
    expect(result.deepSecs).toBe(6300)
    expect(result.lightSecs).toBe(12120)
    expect(result.remSecs).toBe(7800)
    expect(result.awakeSecs).toBe(1260)
    expect(result.respirationAvg).toBe(15)
  })

  it('returns all nulls when getSleepData throws', async () => {
    const gc = makeMockGC({
      getSleepData: jest.fn().mockRejectedValue(new Error('no data')),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    const result = await client.getSleepMetrics('2026-06-20')
    expect(result.overnightHrv).toBeNull()
    expect(result.restingHr).toBeNull()
    expect(result.deepSecs).toBeNull()
  })

  it('returns nulls for missing HRV fields when dailySleepDTO is present', async () => {
    const gc = makeMockGC({
      getSleepData: jest.fn().mockResolvedValue({
        dailySleepDTO: { deepSleepSeconds: 5400, lightSleepSeconds: 10800, remSleepSeconds: 6000, awakeSleepSeconds: 900, averageRespirationValue: 13 },
        // avgOvernightHrv and hrvStatus absent
      }),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    const result = await client.getSleepMetrics('2026-06-20')
    expect(result.overnightHrv).toBeNull()
    expect(result.hrvGarminStatus).toBeNull()
    expect(result.deepSecs).toBe(5400)
  })

  it('returns nulls when getSleepData returns null', async () => {
    const gc = makeMockGC({
      getSleepData: jest.fn().mockResolvedValue(null),
    })
    const client = await GarminClient.fromCredentials('a@b.com', 'p')
    // @ts-expect-error
    client['_gc'] = gc
    const result = await client.getSleepMetrics('2026-06-20')
    expect(result.overnightHrv).toBeNull()
    expect(result.deepSecs).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest lib/garmin/client.test.ts --no-coverage
```

Expected: 4 new failures with "getSleepMetrics is not a function".

- [ ] **Step 3: Implement `SleepMetrics` + `getSleepMetrics` in `lib/garmin/client.ts`**

Add this import at the top of `lib/garmin/client.ts` (after the existing imports):

```ts
import type { SleepData } from 'garmin-connect/dist/garmin/types/sleep'
```

Add the `SleepMetrics` interface after `StressData`:

```ts
export interface SleepMetrics {
  overnightHrv: number | null
  hrvGarminStatus: string | null
  restingHr: number | null
  deepSecs: number | null
  lightSecs: number | null
  remSecs: number | null
  awakeSecs: number | null
  respirationAvg: number | null
}

const SLEEP_METRICS_NULL: SleepMetrics = {
  overnightHrv: null, hrvGarminStatus: null, restingHr: null,
  deepSecs: null, lightSecs: null, remSecs: null, awakeSecs: null, respirationAvg: null,
}
```

Add the method inside the `GarminClient` class, after `getDailyStress`:

```ts
async getSleepMetrics(date: string): Promise<SleepMetrics> {
  try {
    const data = await this._gc.getSleepData(new Date(date)) as SleepData | null
    if (!data) return SLEEP_METRICS_NULL
    const dto = data.dailySleepDTO
    return {
      overnightHrv: typeof data.avgOvernightHrv === 'number' ? Math.round(data.avgOvernightHrv) : null,
      hrvGarminStatus: typeof data.hrvStatus === 'string' && data.hrvStatus ? data.hrvStatus : null,
      restingHr: typeof data.restingHeartRate === 'number' ? Math.round(data.restingHeartRate) : null,
      deepSecs: typeof dto?.deepSleepSeconds === 'number' ? dto.deepSleepSeconds : null,
      lightSecs: typeof dto?.lightSleepSeconds === 'number' ? dto.lightSleepSeconds : null,
      remSecs: typeof dto?.remSleepSeconds === 'number' ? dto.remSleepSeconds : null,
      awakeSecs: typeof dto?.awakeSleepSeconds === 'number' ? dto.awakeSleepSeconds : null,
      respirationAvg: typeof dto?.averageRespirationValue === 'number' ? Math.round(dto.averageRespirationValue) : null,
    }
  } catch {
    return SLEEP_METRICS_NULL
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest lib/garmin/client.test.ts --no-coverage
```

Expected: all 17 tests pass (13 existing + 4 new).

- [ ] **Step 5: Commit**

```
git add lib/garmin/client.ts lib/garmin/client.test.ts
git commit -m "feat(garmin): add getSleepMetrics() returning HRV, RHR, sleep stages, respiration"
```

---

### Task 2: DB migration + type extensions

**Files:**
- Create: `supabase/migrations/20260620_garmin_sleep_hrv.sql`
- Modify: `types/index.ts`

**Interfaces:**
- Produces: 8 new optional fields on `GarminWellness`, 7 new optional fields on `ICUWellness`, 5 new optional fields on `BriefingContext`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260620_garmin_sleep_hrv.sql`:

```sql
-- Add Garmin sleep data columns to garmin_wellness.
-- Run in the Supabase SQL editor before deploying the matching app version.

alter table garmin_wellness
  add column if not exists garmin_hrv_overnight          integer,   -- avgOvernightHrv (ms)
  add column if not exists garmin_hrv_status             text,      -- BALANCED | ELEVATED | UNBALANCED | POOR
  add column if not exists garmin_resting_hr             integer,   -- bpm
  add column if not exists garmin_sleep_deep_secs        integer,
  add column if not exists garmin_sleep_light_secs       integer,
  add column if not exists garmin_sleep_rem_secs         integer,
  add column if not exists garmin_sleep_awake_secs       integer,
  add column if not exists garmin_sleep_respiration_avg  integer;   -- breaths/min, rounded
```

- [ ] **Step 2: Extend `GarminWellness` in `types/index.ts`**

Find the `GarminWellness` interface (currently ends at `garmin_stress_max`) and add 8 fields:

```ts
export interface GarminWellness {
  date: string
  garmin_training_readiness: number | null
  garmin_recovery_time_mins: number | null
  garmin_training_status: string | null
  garmin_body_battery_current: number | null
  garmin_body_battery_charged: number | null
  garmin_body_battery_drained: number | null
  garmin_stress_avg: number | null
  garmin_stress_max: number | null
  // Sleep data (from getSleepMetrics)
  garmin_hrv_overnight: number | null
  garmin_hrv_status: string | null
  garmin_resting_hr: number | null
  garmin_sleep_deep_secs: number | null
  garmin_sleep_light_secs: number | null
  garmin_sleep_rem_secs: number | null
  garmin_sleep_awake_secs: number | null
  garmin_sleep_respiration_avg: number | null
}
```

- [ ] **Step 3: Extend `ICUWellness` in `types/index.ts`**

In the `ICUWellness` interface, after the existing `garmin_stress_max?` line, add:

```ts
  garmin_hrv_overnight?: number | null
  garmin_hrv_status?: string | null
  garmin_resting_hr?: number | null
  garmin_sleep_deep_secs?: number | null
  garmin_sleep_light_secs?: number | null
  garmin_sleep_rem_secs?: number | null
  garmin_sleep_awake_secs?: number | null
  garmin_sleep_respiration_avg?: number | null
```

- [ ] **Step 4: Extend `BriefingContext` in `types/index.ts`**

In the `BriefingContext` interface, after the existing `garminStressMax?` line, add:

```ts
  garminRestingHr?: number | null
  garminSleepDeepSecs?: number | null
  garminSleepLightSecs?: number | null
  garminSleepRemSecs?: number | null
  garminSleepRespirationAvg?: number | null
```

- [ ] **Step 5: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```
git add supabase/migrations/20260620_garmin_sleep_hrv.sql types/index.ts
git commit -m "feat(types): extend GarminWellness, ICUWellness, BriefingContext with sleep/HRV fields"
```

---

### Task 3: Sync route + dashboard merge

**Files:**
- Modify: `app/api/sync/route.ts`
- Modify: `app/dashboard/page.tsx` (lines ~388–397)

**Interfaces:**
- Consumes: `GarminClient.getSleepMetrics(date)` → `SleepMetrics` (from Task 1)
- Consumes: `GarminWellness` with 8 new fields (from Task 2)

- [ ] **Step 1: Add `getSleepMetrics` to the parallel calls in `syncGarmin()`**

In `app/api/sync/route.ts`, find the `Promise.all` at line 28 and add the fifth call:

```ts
const [readinessData, status, batteryData, stressData, sleepData] = await Promise.all([
  client.getTrainingReadiness(todayStr),
  client.getTrainingStatus(todayStr),
  client.getBodyBattery(todayStr),
  client.getDailyStress(todayStr),
  client.getSleepMetrics(todayStr),
])
```

Add the import for `SleepMetrics` is not needed — `getSleepMetrics` is already on the client.

- [ ] **Step 2: Extend the upsert row in `syncGarmin()`**

Replace the `const row = { ... }` block (lines 35–47) with:

```ts
const row = {
  user_id: userId,
  date: todayStr,
  garmin_training_readiness: readinessData.score,
  garmin_recovery_time_mins: readinessData.recoveryTimeMins,
  garmin_training_status: status,
  garmin_body_battery_current: batteryData.current,
  garmin_body_battery_charged: batteryData.charged,
  garmin_body_battery_drained: batteryData.drained,
  garmin_stress_avg: stressData.avg,
  garmin_stress_max: stressData.max,
  garmin_hrv_overnight: sleepData.overnightHrv,
  garmin_hrv_status: sleepData.hrvGarminStatus,
  garmin_resting_hr: sleepData.restingHr,
  garmin_sleep_deep_secs: sleepData.deepSecs,
  garmin_sleep_light_secs: sleepData.lightSecs,
  garmin_sleep_rem_secs: sleepData.remSecs,
  garmin_sleep_awake_secs: sleepData.awakeSecs,
  garmin_sleep_respiration_avg: sleepData.respirationAvg,
  synced_at: new Date().toISOString(),
}
```

- [ ] **Step 3: Extend the return value in `syncGarmin()`**

Replace the `return { date: todayStr, ... }` block (lines 54–64) with:

```ts
return {
  date: todayStr,
  garmin_training_readiness: readinessData.score,
  garmin_recovery_time_mins: readinessData.recoveryTimeMins,
  garmin_training_status: status,
  garmin_body_battery_current: batteryData.current,
  garmin_body_battery_charged: batteryData.charged,
  garmin_body_battery_drained: batteryData.drained,
  garmin_stress_avg: stressData.avg,
  garmin_stress_max: stressData.max,
  garmin_hrv_overnight: sleepData.overnightHrv,
  garmin_hrv_status: sleepData.hrvGarminStatus,
  garmin_resting_hr: sleepData.restingHr,
  garmin_sleep_deep_secs: sleepData.deepSecs,
  garmin_sleep_light_secs: sleepData.lightSecs,
  garmin_sleep_rem_secs: sleepData.remSecs,
  garmin_sleep_awake_secs: sleepData.awakeSecs,
  garmin_sleep_respiration_avg: sleepData.respirationAvg,
}
```

- [ ] **Step 4: Extend `latestWellnessWithLoad` merge in `app/dashboard/page.tsx`**

Find the `latestWellnessWithLoad` block (around line 388). It currently ends with `garmin_stress_avg_direct`. Add 7 more lines after it:

```ts
const latestWellnessWithLoad: ICUWellness | null = latestWellness
  ? {
      ...latestWellness,
      garmin_training_load: todayActivityLoad > 0 ? todayActivityLoad : null,
      garmin_training_readiness: syncData?.garmin_today?.garmin_training_readiness ?? latestWellness.garmin_training_readiness,
      garmin_training_status: syncData?.garmin_today?.garmin_training_status ?? latestWellness.garmin_training_status,
      garmin_body_battery_current: syncData?.garmin_today?.garmin_body_battery_current ?? latestWellness.garmin_body_battery_current,
      garmin_stress_avg_direct: syncData?.garmin_today?.garmin_stress_avg ?? latestWellness.garmin_stress_avg_direct,
      garmin_hrv_overnight: syncData?.garmin_today?.garmin_hrv_overnight ?? latestWellness.garmin_hrv_overnight,
      garmin_hrv_status: syncData?.garmin_today?.garmin_hrv_status ?? latestWellness.garmin_hrv_status,
      garmin_resting_hr: syncData?.garmin_today?.garmin_resting_hr ?? latestWellness.garmin_resting_hr,
      garmin_sleep_deep_secs: syncData?.garmin_today?.garmin_sleep_deep_secs ?? latestWellness.garmin_sleep_deep_secs,
      garmin_sleep_light_secs: syncData?.garmin_today?.garmin_sleep_light_secs ?? latestWellness.garmin_sleep_light_secs,
      garmin_sleep_rem_secs: syncData?.garmin_today?.garmin_sleep_rem_secs ?? latestWellness.garmin_sleep_rem_secs,
      garmin_sleep_awake_secs: syncData?.garmin_today?.garmin_sleep_awake_secs ?? latestWellness.garmin_sleep_awake_secs,
      garmin_sleep_respiration_avg: syncData?.garmin_today?.garmin_sleep_respiration_avg ?? latestWellness.garmin_sleep_respiration_avg,
    }
  : null
```

- [ ] **Step 5: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```
git add app/api/sync/route.ts app/dashboard/page.tsx
git commit -m "feat(sync): collect Garmin sleep metrics (HRV, RHR, stages, respiration) on sync"
```

---

### Task 4: Baseline generalisation + Garmin HRV source

**Files:**
- Modify: `lib/hrv/baseline.ts`
- Modify: `__tests__/lib/hrv-baseline.test.ts`
- Modify: `lib/hrv/server.ts`
- Create: `__tests__/lib/hrv-server.test.ts`

**Interfaces:**
- Produces: `computeHrvBaseline({ id: string; hrv: number | null }[], opts?)` (unchanged return type)
- Produces: `fetchHrvStatusFromGarmin(supabase, userId, today): Promise<HrvStatus>`
- Produces: `fetchHrvStatusBestSource(today, garminParams, icuClient): Promise<HrvStatus>`

- [ ] **Step 1: Write the failing server test**

Create `__tests__/lib/hrv-server.test.ts`:

```ts
/** @jest-environment node */
import { fetchHrvStatusBestSource } from '@/lib/hrv/server'
import { IntervalsClient } from '@/lib/intervals/client'

// Minimal Supabase mock
function makeSupabase(rows: { date: string; garmin_hrv_overnight: number | null }[]) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: rows }),
  }
  return { from: jest.fn().mockReturnValue(chain) }
}

// 60 rows with HRV value v
function garminRows(n: number, today: string, v: number) {
  const endMs = new Date(today + 'T00:00:00Z').getTime()
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(endMs - (n - 1 - i) * 864e5).toISOString().split('T')[0],
    garmin_hrv_overnight: v,
  }))
}

describe('fetchHrvStatusBestSource', () => {
  it('returns Garmin result when sufficient (≥14 readings)', async () => {
    const sb = makeSupabase(garminRows(60, '2026-06-20', 55))
    const result = await fetchHrvStatusBestSource(
      '2026-06-20',
      { supabase: sb as any, userId: 'u1' },
      null,
    )
    expect(result.sufficient).toBe(true)
    expect(result.label).toBe('balanced')
  })

  it('falls back to ICU when Garmin has < 14 readings', async () => {
    const sb = makeSupabase(garminRows(5, '2026-06-20', 55))
    const icuClient = { getWellness: jest.fn().mockResolvedValue(garminRows(60, '2026-06-20', 55).map(r => ({
      id: r.date, ctl: null, atl: null, form: null, hrv: 55, resting_hr: null,
      sleep_secs: null, body_battery_low: null, body_battery_high: null,
      stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null,
    }))) } as unknown as IntervalsClient
    const result = await fetchHrvStatusBestSource(
      '2026-06-20',
      { supabase: sb as any, userId: 'u1' },
      icuClient,
    )
    expect(result.sufficient).toBe(true)
    expect(result.label).toBe('balanced')
  })

  it('uses ICU only when garminParams is null', async () => {
    const icuClient = { getWellness: jest.fn().mockResolvedValue(garminRows(60, '2026-06-20', 55).map(r => ({
      id: r.date, ctl: null, atl: null, form: null, hrv: 50, resting_hr: null,
      sleep_secs: null, body_battery_low: null, body_battery_high: null,
      stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null,
    }))) } as unknown as IntervalsClient
    const result = await fetchHrvStatusBestSource('2026-06-20', null, icuClient)
    expect(result.sufficient).toBe(true)
  })

  it('returns no_data when both sources absent', async () => {
    const result = await fetchHrvStatusBestSource('2026-06-20', null, null)
    expect(result.label).toBe('no_data')
    expect(result.sufficient).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```
npx jest __tests__/lib/hrv-server.test.ts --no-coverage
```

Expected: failures — `fetchHrvStatusBestSource` not exported yet.

- [ ] **Step 3: Generalise `computeHrvBaseline` in `lib/hrv/baseline.ts`**

Remove the `ICUWellness` import (line 3). Change the function signature and the type predicate:

```ts
// Remove this line entirely:
// import type { ICUWellness } from '@/types'

// ...

export function computeHrvBaseline(
  wellness: { id: string; hrv: number | null }[],
  opts: { asOf?: string } = {},
): HrvStatus {
  const sorted = [...wellness].sort((a, b) => a.id.localeCompare(b.id))
  // ... rest of function unchanged except the type predicate on line 68:
  const readings = window.filter((w): w is { id: string; hrv: number } => w.hrv !== null)
  // everything else unchanged
```

Full changed lines in `lib/hrv/baseline.ts` — only lines 3, 58, 68:
- Line 3: remove `import type { ICUWellness } from '@/types'`
- Line 58: `wellness: ICUWellness[]` → `wellness: { id: string; hrv: number | null }[]`
- Line 68: `(w): w is ICUWellness & { hrv: number }` → `(w): w is { id: string; hrv: number }`

- [ ] **Step 4: Add minimal-shape test to `__tests__/lib/hrv-baseline.test.ts`**

Add this test after the existing ones:

```ts
test('accepts plain { id, hrv } objects (no ICUWellness)', () => {
  const data = Array.from({ length: 30 }, (_, i) => ({
    id: new Date(new Date('2026-06-01T00:00:00Z').getTime() - (29 - i) * 864e5).toISOString().split('T')[0],
    hrv: 55 as number | null,
  }))
  const s = computeHrvBaseline(data, { asOf: '2026-06-01' })
  expect(s.label).toBe('balanced')
  expect(s.sufficient).toBe(true)
})
```

- [ ] **Step 5: Run baseline tests to confirm they still pass**

```
npx jest __tests__/lib/hrv-baseline.test.ts --no-coverage
```

Expected: all tests pass (existing + new).

- [ ] **Step 6: Implement `fetchHrvStatusFromGarmin` and `fetchHrvStatusBestSource` in `lib/hrv/server.ts`**

Replace the full contents of `lib/hrv/server.ts` with:

```ts
import { IntervalsClient } from '@/lib/intervals/client'
import { computeHrvBaseline, type HrvStatus } from './baseline'
import type { SupabaseClient } from '@supabase/supabase-js'

export const HRV_WINDOW_DAYS = 90

export async function fetchHrvStatus(client: IntervalsClient, today: string): Promise<HrvStatus> {
  const start = new Date(new Date(today + 'T00:00:00Z').getTime() - HRV_WINDOW_DAYS * 864e5)
    .toISOString().split('T')[0]
  const wellness = await client.getWellness(start, today)
  return computeHrvBaseline(wellness, { asOf: today })
}

export async function fetchHrvStatusFromGarmin(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<HrvStatus> {
  const start = new Date(new Date(today + 'T00:00:00Z').getTime() - HRV_WINDOW_DAYS * 864e5)
    .toISOString().split('T')[0]
  const { data } = await supabase
    .from('garmin_wellness')
    .select('date, garmin_hrv_overnight')
    .eq('user_id', userId)
    .gte('date', start)
    .lte('date', today)
    .order('date', { ascending: true })
  const rows = (data ?? []) as { date: string; garmin_hrv_overnight: number | null }[]
  const mapped = rows.map(r => ({ id: r.date, hrv: r.garmin_hrv_overnight }))
  return computeHrvBaseline(mapped, { asOf: today })
}

export async function fetchHrvStatusBestSource(
  today: string,
  garminParams: { supabase: SupabaseClient; userId: string } | null,
  icuClient: IntervalsClient | null,
): Promise<HrvStatus> {
  if (garminParams) {
    const status = await fetchHrvStatusFromGarmin(garminParams.supabase, garminParams.userId, today)
    if (status.sufficient) return status
  }
  if (icuClient) return fetchHrvStatus(icuClient, today)
  return computeHrvBaseline([], { asOf: today })
}
```

- [ ] **Step 7: Run server tests to confirm they pass**

```
npx jest __tests__/lib/hrv-server.test.ts __tests__/lib/hrv-baseline.test.ts --no-coverage
```

Expected: all tests pass.

- [ ] **Step 8: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 9: Commit**

```
git add lib/hrv/baseline.ts lib/hrv/server.ts __tests__/lib/hrv-baseline.test.ts __tests__/lib/hrv-server.test.ts
git commit -m "feat(hrv): generalise computeHrvBaseline; add fetchHrvStatusFromGarmin + fetchHrvStatusBestSource"
```

---

### Task 5: Migrate 9 HRV call sites

**Files:**
- Modify: `app/api/briefing/today/route.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/plan/route.ts`
- Modify: `app/api/plan/extend/route.ts`
- Modify: `app/api/plan/review/route.ts`
- Modify: `app/api/cron/daily-briefing/route.ts`
- Modify: `app/api/chat/session/route.ts`
- Modify: `app/api/chat/interview/route.ts`
- Modify: `app/api/hrv/route.ts`

**Interfaces:**
- Consumes: `fetchHrvStatusBestSource(today, garminParams, icuClient)` from `@/lib/hrv/server`

**Pattern for every file:**

1. Change the import from:
   ```ts
   import { fetchHrvStatus } from '@/lib/hrv/server'
   ```
   to:
   ```ts
   import { fetchHrvStatusBestSource } from '@/lib/hrv/server'
   ```

2. In the profile select, ensure `garmin_email` is included. If the select doesn't have it, add it.

3. Replace the HRV fetch block. The current pattern is:
   ```ts
   if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
     const hrvClient = new IntervalsClient(...)
     try { hrvStatus = await fetchHrvStatus(hrvClient, today) } catch { /* optional */ }
   }
   ```
   Replace with:
   ```ts
   const garminParams = profile?.garmin_email
     ? { supabase, userId: user.id }
     : null
   const icuClient = profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key
     ? new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
     : null
   try { hrvStatus = await fetchHrvStatusBestSource(today, garminParams, icuClient) } catch { /* optional */ }
   ```

**Note on variable names:** Each route uses slightly different variable names. Read each file before editing. The pattern is the same — find the HRV block, replace it. The `supabase` client and `user.id` are available in all these routes (they all authenticate first).

**Concrete example — `app/api/briefing/today/route.ts`:**

This route already has `garmin_email` in the profile select (line 213). Find this block (around line 95):
```ts
try { hrvStatus = await fetchHrvStatus(client, today) } catch { /* HRV optional */ }
```

The briefing route's `client` is an `IntervalsClient` used for other calls too — do NOT rename it. Instead add a separate `garminParams`:

```ts
const garminParams = profile?.garmin_email ? { supabase, userId: user.id } : null
try {
  hrvStatus = await fetchHrvStatusBestSource(today, garminParams, client)
} catch { /* HRV optional */ }
```

Change the import at the top:
```ts
import { fetchHrvStatusBestSource } from '@/lib/hrv/server'
```

- [ ] **Step 1: Update `app/api/briefing/today/route.ts`**

As described in the concrete example above.

- [ ] **Step 2: Update `app/api/chat/route.ts`**

This route's profile select currently does NOT include `garmin_email`. Add it. Find the select and add `garmin_email`:
```ts
.select('events, intervals_icu_athlete_id, intervals_icu_api_key, timezone, garmin_email')
```
Then apply the pattern replacing `fetchHrvStatus(hrvClient, hrvToday)` with `fetchHrvStatusBestSource(hrvToday, garminParams, icuClient)`.

- [ ] **Step 3: Update the remaining 7 routes**

For each of these files, open it, check the profile select for `garmin_email` (add if missing), then apply the substitution pattern:
- `app/api/plan/route.ts`
- `app/api/plan/extend/route.ts`
- `app/api/plan/review/route.ts`
- `app/api/cron/daily-briefing/route.ts`
- `app/api/chat/session/route.ts`
- `app/api/chat/interview/route.ts`
- `app/api/hrv/route.ts`

- [ ] **Step 4: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: 0 errors. Fix any `user.id` access issues — all these routes fetch `user` from `supabase.auth.getUser()`.

- [ ] **Step 5: Run the full test suite**

```
npx jest --no-coverage
```

Expected: all tests pass. If `__tests__/lib/claude-briefing.test.ts` or similar tests mock `fetchHrvStatus`, update those mocks to `fetchHrvStatusBestSource`.

- [ ] **Step 6: Commit**

```
git add app/api/briefing/today/route.ts app/api/chat/route.ts app/api/plan/route.ts app/api/plan/extend/route.ts app/api/plan/review/route.ts app/api/cron/daily-briefing/route.ts app/api/chat/session/route.ts app/api/chat/interview/route.ts app/api/hrv/route.ts
git commit -m "feat(hrv): migrate all call sites to fetchHrvStatusBestSource (Garmin-first, ICU fallback)"
```

---

### Task 6: Briefing signals (RHR, sleep stages, respiration)

**Files:**
- Modify: `app/api/briefing/today/route.ts`
- Modify: `lib/claude/briefing.ts`

**Interfaces:**
- Consumes: `BriefingContext.garminRestingHr`, `.garminSleepDeepSecs`, `.garminSleepLightSecs`, `.garminSleepRemSecs`, `.garminSleepRespirationAvg` (from Task 2)

- [ ] **Step 1: Extend the garmin_wellness select in `app/api/briefing/today/route.ts`**

Find the `supabase.from('garmin_wellness').select(...)` call (around line 213). It currently selects:
```
'garmin_training_readiness, garmin_recovery_time_mins, garmin_training_status, garmin_body_battery_current, garmin_body_battery_charged, garmin_body_battery_drained, garmin_stress_avg, garmin_stress_max'
```

Add the 5 new fields:
```
'garmin_training_readiness, garmin_recovery_time_mins, garmin_training_status, garmin_body_battery_current, garmin_body_battery_charged, garmin_body_battery_drained, garmin_stress_avg, garmin_stress_max, garmin_resting_hr, garmin_sleep_deep_secs, garmin_sleep_light_secs, garmin_sleep_rem_secs, garmin_sleep_respiration_avg'
```

- [ ] **Step 2: Wire the 5 new fields into `ctx` in `app/api/briefing/today/route.ts`**

The `todayGarmin` variable is already cast to a `Pick<GarminWellness, ...>`. Extend that cast to include the 5 new fields:

```ts
const todayGarmin = garminRow as Pick<GarminWellness,
  | 'garmin_training_readiness' | 'garmin_recovery_time_mins' | 'garmin_training_status'
  | 'garmin_body_battery_current' | 'garmin_body_battery_charged' | 'garmin_body_battery_drained'
  | 'garmin_stress_avg' | 'garmin_stress_max'
  | 'garmin_resting_hr' | 'garmin_sleep_deep_secs' | 'garmin_sleep_light_secs'
  | 'garmin_sleep_rem_secs' | 'garmin_sleep_respiration_avg'
> | null
```

In the `ctx` object (around line 245), after `garminStressMax`, add:
```ts
garminRestingHr: todayGarmin?.garmin_resting_hr ?? null,
garminSleepDeepSecs: todayGarmin?.garmin_sleep_deep_secs ?? null,
garminSleepLightSecs: todayGarmin?.garmin_sleep_light_secs ?? null,
garminSleepRemSecs: todayGarmin?.garmin_sleep_rem_secs ?? null,
garminSleepRespirationAvg: todayGarmin?.garmin_sleep_respiration_avg ?? null,
```

- [ ] **Step 3: Add RHR + sleep stages to `garminLines` in `lib/claude/briefing.ts`**

Find the `garminLines` block in `generateMorningBriefing` (around line 165). After the stress block, add:

```ts
if (ctx.garminRestingHr != null) {
  garminLines.push(`Resting HR: ${ctx.garminRestingHr}bpm`)
}
if (
  ctx.garminSleepDeepSecs != null ||
  ctx.garminSleepLightSecs != null ||
  ctx.garminSleepRemSecs != null
) {
  const parts: string[] = []
  if (ctx.garminSleepDeepSecs != null) parts.push(`${Math.round(ctx.garminSleepDeepSecs / 60)}m deep`)
  if (ctx.garminSleepRemSecs != null) parts.push(`${Math.round(ctx.garminSleepRemSecs / 60)}m REM`)
  if (ctx.garminSleepLightSecs != null) parts.push(`${Math.round(ctx.garminSleepLightSecs / 60)}m light`)
  let stageLine = `Sleep stages: ${parts.join(' · ')}`
  if (ctx.garminSleepRespirationAvg != null) stageLine += ` (resp ${ctx.garminSleepRespirationAvg} brpm)`
  garminLines.push(stageLine)
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Run tests**

```
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```
git add app/api/briefing/today/route.ts lib/claude/briefing.ts
git commit -m "feat(briefing): add Garmin resting HR and sleep stages to morning prompt"
```

---

### Task 7: StrainBreakdownSheet sleep stage row

**Files:**
- Modify: `components/StrainBreakdownSheet.tsx`

**Interfaces:**
- Consumes: `wellness.garmin_sleep_deep_secs`, `.garmin_sleep_light_secs`, `.garmin_sleep_rem_secs`, `.garmin_sleep_awake_secs` (available on `ICUWellness` from Task 2; merged into `latestWellnessWithLoad` from Task 3)

- [ ] **Step 1: Extract sleep stage variables at the top of `StrainBreakdownSheet`**

In `components/StrainBreakdownSheet.tsx`, after the existing variable declarations (after `recoveryTimeMins`), add:

```ts
const deepSecs = wellness.garmin_sleep_deep_secs ?? null
const lightSecs = wellness.garmin_sleep_light_secs ?? null
const remSecs = wellness.garmin_sleep_rem_secs ?? null
const awakeSecs = wellness.garmin_sleep_awake_secs ?? null
```

- [ ] **Step 2: Add sleep stages sub-signal row after the sleep duration row**

Find the sleep duration row (the `{c.sleepSecs != null ? ... }` block). Immediately after it, add:

```tsx
{/* Sleep stages (from Garmin) */}
{deepSecs != null && (
  <div className="flex items-center gap-2">
    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-violet-200" />
    <span className="text-xs text-gray-700">
      Sleep stages{' '}
      <span className="text-gray-400">
        {Math.round(deepSecs / 60)}m deep
        {remSecs != null && ` · ${Math.round(remSecs / 60)}m REM`}
        {lightSecs != null && ` · ${Math.round(lightSecs / 60)}m light`}
        {awakeSecs != null && ` · ${Math.round(awakeSecs / 60)}m awake`}
      </span>
    </span>
  </div>
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Run the full test suite**

```
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```
git add components/StrainBreakdownSheet.tsx
git commit -m "feat(ui): add Garmin sleep stage breakdown to StrainBreakdownSheet"
```

---

## SQL Scripts

Run this in the Supabase SQL editor before deploying:

```sql
alter table garmin_wellness
  add column if not exists garmin_hrv_overnight          integer,
  add column if not exists garmin_hrv_status             text,
  add column if not exists garmin_resting_hr             integer,
  add column if not exists garmin_sleep_deep_secs        integer,
  add column if not exists garmin_sleep_light_secs       integer,
  add column if not exists garmin_sleep_rem_secs         integer,
  add column if not exists garmin_sleep_awake_secs       integer,
  add column if not exists garmin_sleep_respiration_avg  integer;
```

## Manual Verification

After running the migration and triggering a Sync:
1. Check Supabase `garmin_wellness` table — today's row should have non-null values for `garmin_hrv_overnight`, `garmin_resting_hr`, and sleep stage columns.
2. Refresh the morning briefing — the Garmin line should include "Resting HR: Xbpm" and "Sleep stages: Xm deep · Xm REM…".
3. Open the Strain Breakdown Sheet — a "Sleep stages" row should appear below the sleep duration row.
4. Verify HRV chip on dashboard still shows (unchanged `HrvStatus` shape).
