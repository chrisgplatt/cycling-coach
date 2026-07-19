# Unified Recovery Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute Recovery once, server-side, for every day in `/api/charts`'s existing window, and have the dashboard, fitness page, and briefing route all read from that single source instead of each independently re-deriving `RecoveryInputs` with its own timezone, HRV source/window, and freshness assumptions.

**Architecture:** A new pure function `computeHrvStatusBestSource` (extracted from the existing single-date `fetchHrvStatusBestSource`) decides Garmin-vs-ICU HRV given two already-fetched history arrays. A new `fetchRecoveryInputsForRange` does the bulk I/O once and calls that pure function per day. `/api/charts` calls it for its 365-day window and returns full `RecoveryScore` objects per day as `recoveryHistory`; the dashboard and fitness page read from there instead of computing; the briefing route calls the same fetcher for a single day.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres + `@supabase/supabase-js`), Jest.

## Global Constraints

- Run `npm run typecheck` before every commit (`tsc --noEmit`).
- Never use `git commit --amend`; always create new commits. Never use `--no-verify`.
- **Scope boundary, stated explicitly so it isn't accidentally widened:** this plan canonicalizes "today" to the athlete's profile timezone *only* for the new Recovery data path. `app/api/charts/route.ts`'s existing `today`/`newest`/`oldest` variables (server-UTC, used for Strain's freeze boundary and the general wellness/activity fetch) are **not** changed by this plan — that's a separate, previously-logged minor finding from an earlier review, not addressed here. The Recovery fetch introduces its own profile-timezone `today` locally, used only for its own query range.
- **Accepted inefficiency, stated explicitly so it isn't "discovered" mid-review:** `fetchRecoveryInputsForRange` does its own self-contained intervals.icu wellness fetch and its own `daily_wellness` query, both of which overlap with fetches `/api/charts` already makes for Strain. This plan does not thread already-fetched data through to avoid the duplication — `fetchRecoveryInputsForRange` stays simple and independently usable by the briefing route (which has no such data in scope already). Personal single-user app; the extra API calls are not a meaningful cost. A future optimization pass could dedupe this if it ever matters.
- No new database columns or migrations — Recovery has no drifting-reference component (unlike Strain's `trimpRef`) so nothing needs freezing/persisting.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/hrv/best-source.ts` | New — pure `computeHrvStatusBestSource(icuHistory, garminHistory, asOf)` |
| `lib/hrv/server.ts` | `fetchHrvStatusBestSource` refactored to delegate its final decision to the new pure function; public behavior unchanged |
| `lib/recovery-inputs.ts` | New — `fetchRecoveryInputsForRange`, the single shared I/O function |
| `types/index.ts` | `RecoveryHistoryPoint`, `ChartsData.recoveryHistory` |
| `app/api/charts/route.ts` | Computes and returns `recoveryHistory` |
| `app/dashboard/page.tsx` | Reads today's Recovery from `chartsData.recoveryHistory` instead of computing it |
| `app/fitness/page.tsx` | `RecoverySection` reads `recoveryHistory` instead of computing it |
| `app/api/briefing/today/route.ts` | Replaces its manual `RecoveryInputs` assembly with the shared fetcher |

---

### Task 1: Extract `computeHrvStatusBestSource`

**Files:**
- Create: `lib/hrv/best-source.ts`
- Modify: `lib/hrv/server.ts`
- Test: `__tests__/lib/hrv-best-source.test.ts` (new)
- Test: `__tests__/lib/hrv-server.test.ts` (existing — must keep passing unchanged)

**Interfaces:**
- Produces (consumed by Task 2 and by `lib/hrv/server.ts` internally):
  ```typescript
  export function computeHrvStatusBestSource(
    icuWellnessHrv: { id: string; hrv: number | null }[],
    garminHrvHistory: { id: string; hrv: number | null }[],
    asOf: string,
  ): HrvStatus
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/hrv-best-source.test.ts`:

```typescript
/** @jest-environment node */
import { computeHrvStatusBestSource } from '@/lib/hrv/best-source'

function rows(n: number, endDate: string, v: number): { id: string; hrv: number }[] {
  const endMs = new Date(endDate + 'T00:00:00Z').getTime()
  return Array.from({ length: n }, (_, i) => ({
    id: new Date(endMs - (n - 1 - i) * 864e5).toISOString().split('T')[0],
    hrv: v,
  }))
}

describe('computeHrvStatusBestSource', () => {
  test('returns Garmin result when sufficient (>=14 readings)', () => {
    const garmin = rows(60, '2026-06-20', 55)
    const result = computeHrvStatusBestSource([], garmin, '2026-06-20')
    expect(result.sufficient).toBe(true)
    expect(result.label).toBe('balanced')
    expect(result.daysOfData).toBe(60)
  })

  test('falls back to ICU when Garmin has fewer than 14 readings', () => {
    const garmin = rows(5, '2026-06-20', 55)
    const icu = rows(60, '2026-06-20', 50)
    const result = computeHrvStatusBestSource(icu, garmin, '2026-06-20')
    expect(result.sufficient).toBe(true)
    expect(result.daysOfData).toBe(60)   // confirms ICU's 60 rows were used, not Garmin's 5
    expect(result.today).toBe(50)        // confirms ICU's value (50), not Garmin's (55)
  })

  test('empty Garmin history falls straight to ICU', () => {
    const icu = rows(60, '2026-06-20', 50)
    const result = computeHrvStatusBestSource(icu, [], '2026-06-20')
    expect(result.sufficient).toBe(true)
    expect(result.daysOfData).toBe(60)
  })

  test('both empty returns no_data', () => {
    const result = computeHrvStatusBestSource([], [], '2026-06-20')
    expect(result.label).toBe('no_data')
    expect(result.sufficient).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- __tests__/lib/hrv-best-source.test.ts`
Expected: FAIL — `lib/hrv/best-source.ts` doesn't exist.

- [ ] **Step 3: Implement `computeHrvStatusBestSource`**

Create `lib/hrv/best-source.ts`:

```typescript
import { computeHrvBaseline, type HrvStatus } from './baseline'

/** Pure decision: prefer Garmin's overnight HRV when its own baseline is sufficient
 * (>=14 readings in its window), otherwise fall back to intervals.icu's HRV. Both
 * candidate histories are passed in already-fetched — this function does no I/O,
 * so it can be reused identically for a single date or across a bulk date range. */
export function computeHrvStatusBestSource(
  icuWellnessHrv: { id: string; hrv: number | null }[],
  garminHrvHistory: { id: string; hrv: number | null }[],
  asOf: string,
): HrvStatus {
  const garminStatus = computeHrvBaseline(garminHrvHistory, { asOf })
  if (garminStatus.sufficient) return garminStatus
  return computeHrvBaseline(icuWellnessHrv, { asOf })
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npm test -- __tests__/lib/hrv-best-source.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Refactor `fetchHrvStatusBestSource` to delegate to it, preserving the existing lazy short-circuit**

The original function avoids fetching intervals.icu wellness at all when Garmin's HRV is already sufficient — this laziness must be preserved (it saves a real API call), so the refactor can't simply "fetch both up front, then call the pure function" — it stages the fetch and only calls the shared decision function once ICU data is actually needed.

Replace the full contents of `lib/hrv/server.ts`:

```typescript
import { IntervalsClient } from '@/lib/intervals/client'
import { computeHrvBaseline, type HrvStatus } from './baseline'
import { computeHrvStatusBestSource } from './best-source'
import type { SupabaseClient } from '@supabase/supabase-js'

export const HRV_WINDOW_DAYS = 90

export async function fetchHrvStatus(client: IntervalsClient, today: string): Promise<HrvStatus> {
  const start = new Date(new Date(today + 'T00:00:00Z').getTime() - HRV_WINDOW_DAYS * 864e5)
    .toISOString().split('T')[0]
  const wellness = await client.getWellness(start, today)
  return computeHrvBaseline(wellness, { asOf: today })
}

async function fetchGarminHrvHistory(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<{ id: string; hrv: number | null }[]> {
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
  return rows.map(r => ({ id: r.date, hrv: r.garmin_hrv_overnight }))
}

export async function fetchHrvStatusFromGarmin(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<HrvStatus> {
  const mapped = await fetchGarminHrvHistory(supabase, userId, today)
  return computeHrvBaseline(mapped, { asOf: today })
}

export async function fetchHrvStatusBestSource(
  today: string,
  garminParams: { supabase: SupabaseClient; userId: string } | null,
  icuClient: IntervalsClient | null,
): Promise<HrvStatus> {
  const garminHistory = garminParams
    ? await fetchGarminHrvHistory(garminParams.supabase, garminParams.userId, today)
    : []
  const garminStatus = computeHrvBaseline(garminHistory, { asOf: today })
  if (garminStatus.sufficient) return garminStatus
  if (!icuClient) return garminStatus
  const start = new Date(new Date(today + 'T00:00:00Z').getTime() - HRV_WINDOW_DAYS * 864e5)
    .toISOString().split('T')[0]
  const icuWellness = await icuClient.getWellness(start, today)
  const icuWellnessHrv = icuWellness.map(w => ({ id: w.id, hrv: w.hrv }))
  return computeHrvStatusBestSource(icuWellnessHrv, garminHistory, today)
}
```

Trace through each existing test in `__tests__/lib/hrv-server.test.ts` to confirm identical behavior: "Garmin sufficient" → `garminStatus.sufficient` true, returned directly, no ICU fetch (same as before). "Garmin <14 readings, ICU provided" → falls through to the ICU fetch + `computeHrvStatusBestSource` call, which (since `garminStatus` is already known insufficient) evaluates the Garmin branch again internally and falls to ICU — same final result. "garminParams null" → `garminHistory = []`, `garminStatus` is `no_data`/insufficient, falls to ICU branch — same as before. "Both null" → `garminHistory = []`, `garminStatus` insufficient, `!icuClient` → returns `garminStatus` (which is `computeHrvBaseline([], {asOf: today})`, i.e. `no_data`) — identical to the original's explicit `computeHrvBaseline([], { asOf: today })` fallback.

- [ ] **Step 6: Run both test files to verify nothing broke**

Run: `npm test -- __tests__/lib/hrv-best-source.test.ts __tests__/lib/hrv-server.test.ts`
Expected: PASS, all tests in both files (4 new + 4 existing).

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add lib/hrv/best-source.ts lib/hrv/server.ts __tests__/lib/hrv-best-source.test.ts
git commit -m "feat: extract computeHrvStatusBestSource as a pure, reusable HRV-source decision

fetchHrvStatusBestSource now delegates its final Garmin-vs-ICU decision
to this pure function instead of only being usable as a live, single-date
async fetch — needed so the same decision can run per-day across a bulk
range without re-fetching per day."
```

---

### Task 2: `fetchRecoveryInputsForRange` in `lib/recovery-inputs.ts`

**Files:**
- Create: `lib/recovery-inputs.ts`
- Test: `__tests__/lib/recovery-inputs.test.ts`

**Interfaces:**
- Consumes: `computeHrvStatusBestSource` (Task 1); `mergeGarminIntoWellness` from `@/lib/garmin-wellness-merge` (existing, unchanged); `HRV_WINDOW_DAYS` from `@/lib/hrv/server` (existing, unchanged); `RecoveryInputs` from `@/lib/recovery-score` (existing, unchanged).
- Produces (consumed by Tasks 4 and 7):
  ```typescript
  export interface RecoveryInputsRangeResult {
    date: string
    inputs: RecoveryInputs
  }
  export async function fetchRecoveryInputsForRange(
    supabase: SupabaseClient,
    userId: string,
    icuClient: IntervalsClient,
    range: { from: string; to: string },   // YYYY-MM-DD
  ): Promise<RecoveryInputsRangeResult[]>
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/recovery-inputs.test.ts`:

```typescript
/** @jest-environment node */
import { fetchRecoveryInputsForRange } from '@/lib/recovery-inputs'
import type { IntervalsClient } from '@/lib/intervals/client'
import type { ICUWellness } from '@/types'

function wellnessRow(id: string, overrides: Partial<ICUWellness> = {}): ICUWellness {
  return {
    id, ctl: 60, atl: 55, form: 5, hrv: 45, resting_hr: 50, sleep_secs: null,
    body_battery_low: null, body_battery_high: 70, stress_avg: null, stress_high: null,
    garmin_training_load: null, sleep_score: null,
    ...overrides,
  }
}

function makeSupabase(garminRows: Array<{ date: string; garmin_hrv_overnight: number | null; garmin_sleep_deep_secs?: number | null }>, dailyWellnessRows: Array<{ date: string; energy: number | null; leg_freshness: number | null }>) {
  const from = jest.fn((table: string) => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
    }
    if (table === 'garmin_wellness') {
      return { ...chain, lte: jest.fn().mockResolvedValue({ data: garminRows }) }
    }
    return { ...chain, lte: jest.fn().mockResolvedValue({ data: dailyWellnessRows }) }
  })
  return { from }
}

describe('fetchRecoveryInputsForRange', () => {
  test('builds RecoveryInputs for every ICU wellness date in the visible range', async () => {
    const icuClient = {
      getWellness: jest.fn().mockResolvedValue([
        wellnessRow('2026-07-17'),
        wellnessRow('2026-07-18'),
        wellnessRow('2026-07-19'),
      ]),
    } as unknown as IntervalsClient
    const sb = makeSupabase([], [])
    const result = await fetchRecoveryInputsForRange(sb as any, 'u1', icuClient, { from: '2026-07-18', to: '2026-07-19' })
    expect(result.map(r => r.date)).toEqual(['2026-07-18', '2026-07-19'])
    // 2026-07-17 is outside [from, to] and must not appear, even though ICU returned it
    // (it exists only as trailing lookback context for the HRV baseline).
  })

  test('uses body_battery_high and form directly from the ICU wellness row', async () => {
    const icuClient = {
      getWellness: jest.fn().mockResolvedValue([wellnessRow('2026-07-19', { body_battery_high: 82, form: -3 })]),
    } as unknown as IntervalsClient
    const sb = makeSupabase([], [])
    const result = await fetchRecoveryInputsForRange(sb as any, 'u1', icuClient, { from: '2026-07-19', to: '2026-07-19' })
    expect(result[0].inputs.body_battery_high).toBe(82)
    expect(result[0].inputs.tsb).toBe(-3)
  })

  test('falls back to ctl-atl for tsb when form is null', async () => {
    const icuClient = {
      getWellness: jest.fn().mockResolvedValue([wellnessRow('2026-07-19', { form: null, ctl: 60, atl: 55 })]),
    } as unknown as IntervalsClient
    const sb = makeSupabase([], [])
    const result = await fetchRecoveryInputsForRange(sb as any, 'u1', icuClient, { from: '2026-07-19', to: '2026-07-19' })
    expect(result[0].inputs.tsb).toBe(5)
  })

  test('pulls energy/leg_freshness from daily_wellness for the matching date', async () => {
    const icuClient = {
      getWellness: jest.fn().mockResolvedValue([wellnessRow('2026-07-19')]),
    } as unknown as IntervalsClient
    const sb = makeSupabase([], [{ date: '2026-07-19', energy: 4, leg_freshness: 3 }])
    const result = await fetchRecoveryInputsForRange(sb as any, 'u1', icuClient, { from: '2026-07-19', to: '2026-07-19' })
    expect(result[0].inputs.energy).toBe(4)
    expect(result[0].inputs.leg_freshness).toBe(3)
  })

  test('date with no daily_wellness row gets null energy/leg_freshness, not a crash', async () => {
    const icuClient = {
      getWellness: jest.fn().mockResolvedValue([wellnessRow('2026-07-19')]),
    } as unknown as IntervalsClient
    const sb = makeSupabase([], [])
    const result = await fetchRecoveryInputsForRange(sb as any, 'u1', icuClient, { from: '2026-07-19', to: '2026-07-19' })
    expect(result[0].inputs.energy).toBeNull()
    expect(result[0].inputs.leg_freshness).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- __tests__/lib/recovery-inputs.test.ts`
Expected: FAIL — `lib/recovery-inputs.ts` doesn't exist.

- [ ] **Step 3: Implement `fetchRecoveryInputsForRange`**

Create `lib/recovery-inputs.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import { IntervalsClient } from '@/lib/intervals/client'
import { mergeGarminIntoWellness } from '@/lib/garmin-wellness-merge'
import { HRV_WINDOW_DAYS } from '@/lib/hrv/server'
import { computeHrvStatusBestSource } from '@/lib/hrv/best-source'
import type { RecoveryInputs } from '@/lib/recovery-score'
import type { GarminWellness } from '@/types'

export interface RecoveryInputsRangeResult {
  date: string
  inputs: RecoveryInputs
}

/** Single shared source of Recovery inputs, used identically for a bulk historical range
 * (the charts route) or a single date (the briefing route calls this with from === to).
 * Does every piece of I/O exactly once, widened backward by HRV_WINDOW_DAYS so every
 * visible date has enough trailing history for a sufficient HRV baseline. */
export async function fetchRecoveryInputsForRange(
  supabase: SupabaseClient,
  userId: string,
  icuClient: IntervalsClient,
  range: { from: string; to: string },
): Promise<RecoveryInputsRangeResult[]> {
  const widenedFrom = new Date(new Date(range.from + 'T00:00:00Z').getTime() - HRV_WINDOW_DAYS * 864e5)
    .toISOString().split('T')[0]

  const [rawWellness, { data: garminRows }, { data: dailyWellnessRows }] = await Promise.all([
    icuClient.getWellness(widenedFrom, range.to),
    supabase
      .from('garmin_wellness')
      .select('date, garmin_hrv_overnight, garmin_sleep_deep_secs, garmin_sleep_light_secs, garmin_sleep_rem_secs, garmin_sleep_awake_secs')
      .eq('user_id', userId)
      .gte('date', widenedFrom)
      .lte('date', range.to),
    supabase
      .from('daily_wellness')
      .select('date, energy, leg_freshness')
      .eq('user_id', userId)
      .gte('date', widenedFrom)
      .lte('date', range.to),
  ])

  const garminHistory = (garminRows ?? []) as Array<Pick<GarminWellness,
    'date' | 'garmin_hrv_overnight' | 'garmin_sleep_deep_secs' | 'garmin_sleep_light_secs' | 'garmin_sleep_rem_secs' | 'garmin_sleep_awake_secs'>>

  const wellness = mergeGarminIntoWellness(
    rawWellness,
    garminHistory.map(g => ({ ...g } as GarminWellness)),
  )
  const wellnessByDate = new Map(wellness.map(w => [w.id, w]))
  const dailyWellnessByDate = new Map(
    (dailyWellnessRows ?? []).map(d => [d.date as string, d as { energy: number | null; leg_freshness: number | null }]),
  )

  const icuWellnessHrv = wellness.map(w => ({ id: w.id, hrv: w.hrv }))
  const garminHrvHistory = garminHistory.map(g => ({ id: g.date, hrv: g.garmin_hrv_overnight ?? null }))

  const visibleDates = wellness
    .map(w => w.id)
    .filter(id => id >= range.from && id <= range.to)
    .sort((a, b) => a.localeCompare(b))

  return visibleDates.map((date): RecoveryInputsRangeResult => {
    const w = wellnessByDate.get(date)!
    const hrvStatus = computeHrvStatusBestSource(icuWellnessHrv, garminHrvHistory, date)
    const dw = dailyWellnessByDate.get(date)
    const tsb = w.form ?? (w.ctl != null && w.atl != null ? w.ctl - w.atl : null)
    return {
      date,
      inputs: {
        hrv: hrvStatus.today,
        hrvBaseline: hrvStatus.baselineMean,
        garmin_sleep_deep_secs: w.garmin_sleep_deep_secs ?? null,
        garmin_sleep_light_secs: w.garmin_sleep_light_secs ?? null,
        garmin_sleep_rem_secs: w.garmin_sleep_rem_secs ?? null,
        garmin_sleep_awake_secs: w.garmin_sleep_awake_secs ?? null,
        body_battery_high: w.body_battery_high ?? null,
        energy: dw?.energy ?? null,
        leg_freshness: dw?.leg_freshness ?? null,
        tsb,
      },
    }
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- __tests__/lib/recovery-inputs.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add lib/recovery-inputs.ts __tests__/lib/recovery-inputs.test.ts
git commit -m "feat: add fetchRecoveryInputsForRange — single shared Recovery data source"
```

---

### Task 3: `RecoveryHistoryPoint` type and `ChartsData` field

**Files:**
- Modify: `types/index.ts`

**Interfaces:**
- Produces (consumed by Task 4, 5, 6):
  ```typescript
  export interface RecoveryHistoryPoint {
    date: string
    score: number
    band: 'high' | 'moderate' | 'low'
    explanation: string
    components: {
      sleep: number | null
      hrv: number | null
      wellness: number | null
      tsb: number | null
      bodyBattery: number | null
    }
  }
  ```
  added to `ChartsData` as `recoveryHistory: RecoveryHistoryPoint[]`.

- [ ] **Step 1: Add the type**

`types/index.ts` has zero imports (verified: `Grep "^import" types/index.ts` returns nothing) — it's a deliberately standalone, dependency-free central type file. Do not add an import from `lib/recovery-score`; write the shape out explicitly, matching that existing convention.

In `types/index.ts`, near the `ChartsData` interface (currently around line 474), add:

```typescript
export interface RecoveryHistoryPoint {
  date: string
  score: number
  band: 'high' | 'moderate' | 'low'
  explanation: string
  components: {
    sleep: number | null
    hrv: number | null
    wellness: number | null
    tsb: number | null
    bodyBattery: number | null
  }
}
```

This intentionally duplicates `RecoveryScore`'s shape from `lib/recovery-score.ts` rather than importing it — accepted, matching this file's existing pattern (e.g. `BriefingContext`'s `recoveryBand?: 'high' | 'moderate' | 'low' | null` field already duplicates the same union inline rather than importing it).

Add `recoveryHistory: RecoveryHistoryPoint[]` to `ChartsData`:

```typescript
export interface ChartsData {
  wellness: ICUWellness[]
  weeklyTss: WeeklyTss[]
  rides: RidePoint[]
  dailyStrain: DailyStrainPoint[]
  activities: ActivitySummary[]
  recoveryHistory: RecoveryHistoryPoint[]
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: Errors in `app/api/charts/route.ts` (doesn't set the new required field yet — fixed in Task 4) and possibly nowhere else yet, since no consumer reads it until Tasks 5/6. Confirm this is the only new error surface.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add RecoveryHistoryPoint type and ChartsData.recoveryHistory field"
```

---

### Task 4: Wire `fetchRecoveryInputsForRange` into `app/api/charts/route.ts`

**Files:**
- Modify: `app/api/charts/route.ts`

**Interfaces:**
- Consumes: `fetchRecoveryInputsForRange` (Task 2), `RecoveryHistoryPoint` (Task 3), `computeRecoveryScore` from `@/lib/recovery-score` (existing, unchanged).
- Produces: `ChartsData.recoveryHistory`, consumed by Tasks 5 and 6.

- [ ] **Step 1: Add `timezone` to the profile select and resolve a profile-timezone "today" for the Recovery fetch only**

Per this plan's Global Constraints, the route's existing `today`/`newest`/`oldest` (server-UTC, used for Strain) are **not** changed. Add a second, separate profile-timezone date used only for the Recovery fetch's range boundary.

Replace the profile select (currently line 21-24):

```typescript
  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp, max_hr_manual, observed_max_hr, date_of_birth, timezone')
    .maybeSingle()
```

After the existing `oldest`/`newest` block (currently lines 32-36), add:

```typescript
  const tz = (profile as { timezone?: string } | null)?.timezone ?? 'Europe/London'
  const recoveryToday = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
```

- [ ] **Step 2: Fetch and compute `recoveryHistory`**

Add the import:

```typescript
import { fetchRecoveryInputsForRange } from '@/lib/recovery-inputs'
import { computeRecoveryScore } from '@/lib/recovery-score'
import type { RecoveryHistoryPoint } from '@/types'
```

After the existing `dailyStrain` computation block (ends around the `.filter((p): p is DailyStrainPoint => p !== null)` line), add:

```typescript
    // Recovery — computed once here, shared by the dashboard, fitness page, and (via the
    // same fetchRecoveryInputsForRange function) the briefing route. See
    // docs/superpowers/specs/2026-07-19-unified-recovery-inputs-design.md for why this
    // route owns the canonical computation.
    const recoveryInputsResult = await fetchRecoveryInputsForRange(supabase, user.id, client, { from: oldest, to: recoveryToday })
    const recoveryHistory: RecoveryHistoryPoint[] = recoveryInputsResult.map(r => {
      const score = computeRecoveryScore(r.inputs)
      return { date: r.date, ...score }
    })
```

- [ ] **Step 3: Include it in the response**

Replace the final `charts` object construction:

```typescript
    const charts: ChartsData = { wellness, weeklyTss, rides, dailyStrain, activities: activitySummaries, recoveryHistory }
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No errors in `app/api/charts/route.ts` or `types/index.ts`. Errors may remain in files not yet updated (`app/dashboard/page.tsx`, `app/fitness/page.tsx`) only if they already reference `ChartsData` fields in a way this change breaks — check; they shouldn't, since `recoveryHistory` is additive and this task doesn't remove anything those files currently read.

- [ ] **Step 5: Commit**

```bash
git add app/api/charts/route.ts
git commit -m "feat: compute and return recoveryHistory from the charts route"
```

---

### Task 5: `app/dashboard/page.tsx` reads Recovery from `chartsData`

**Files:**
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `chartsData.recoveryHistory` (Task 4).

- [ ] **Step 1: Read the current exact code first**

Before editing, re-read `app/dashboard/page.tsx` around the `computeRecoveryScore` call (search for it — it may have shifted a few lines from where this plan was written since other work may have touched the file) to confirm the exact current block before replacing it. The plan below describes the block as of this plan's writing:

```typescript
  const tsbForRecovery = latestWellnessWithLoad?.form ?? (
    latestWellnessWithLoad?.ctl != null && latestWellnessWithLoad?.atl != null
      ? latestWellnessWithLoad.ctl - latestWellnessWithLoad.atl
      : null
  )
  const recovery = computeRecoveryScore({
    hrv: latestWellnessWithLoad?.hrv ?? null,
    hrvBaseline: hrvStatus.baselineMean,
    garmin_sleep_deep_secs: latestWellnessWithLoad?.garmin_sleep_deep_secs ?? null,
    garmin_sleep_light_secs: latestWellnessWithLoad?.garmin_sleep_light_secs ?? null,
    garmin_sleep_rem_secs: latestWellnessWithLoad?.garmin_sleep_rem_secs ?? null,
    garmin_sleep_awake_secs: latestWellnessWithLoad?.garmin_sleep_awake_secs ?? null,
    body_battery_high: latestWellnessWithLoad?.body_battery_high ?? null,
    energy: todayDailyWellnessForCard?.energy ?? null,
    leg_freshness: todayDailyWellnessForCard?.leg_freshness ?? null,
    tsb: tsbForRecovery,
  })
```

- [ ] **Step 2: Replace it**

```typescript
  const recovery = chartsData?.recoveryHistory.at(-1) ?? null
```

`recoveryHistory` is sorted ascending and always ends at the fetch's `to` date (today, profile-timezone) — the last entry is today's Recovery, no date-matching lookup needed (this deliberately sidesteps the exact browser-local-vs-server-timezone mismatch class of bug this whole project exists to fix, rather than reintroducing it via a client-side `.find(d => d.date === todayStr)`).

- [ ] **Step 3: Update the `StrainRingStrip` call site's typing**

`StrainRingStrip`'s `recovery` prop currently expects `RecoveryScore` (non-nullable) from `@/lib/recovery-score`. Since `recovery` here is now `RecoveryHistoryPoint | null` (nullable, from a possibly-not-yet-loaded `chartsData`), check `StrainRingStrip`'s actual prop type (`Read components/StrainRingStrip.tsx`) and reconcile: the ring strip already only renders inside `{latestWellnessWithLoad && (...)}` — extend that guard (or add `recovery &&`) so `StrainRingStrip` is only rendered once `recovery` is non-null, keeping its prop as required/non-nullable rather than pushing null-handling into that component. `RecoveryHistoryPoint` (this task's new source) and `RecoveryScore` (the prop's declared type) have the same shape apart from the extra `date` field, which is a safe structural-typing superset in TypeScript — passing a `RecoveryHistoryPoint` where `RecoveryScore` is expected should typecheck without changes to `StrainRingStrip` itself; verify this is actually true once typecheck runs in Step 5, and only widen `StrainRingStrip`'s prop type if it isn't.

- [ ] **Step 4: Remove now-dead code**

`tsbForRecovery` is no longer used — remove its declaration. Check with `Grep -n "tsbForRecovery" app/dashboard/page.tsx` that removing it doesn't orphan anything else. The `computeRecoveryScore` import from `@/lib/recovery-score` becomes unused — remove it (check with `Grep -n "computeRecoveryScore" app/dashboard/page.tsx` that this was its only use in the file).

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: No errors in `app/dashboard/page.tsx`.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: read today's Recovery from chartsData instead of computing it client-side

Closes the same class of divergence bug already fixed for Strain —
dashboard and briefing route now derive Recovery from the same shared
fetcher instead of two independent, differently-sourced computations."
```

---

### Task 6: `app/fitness/page.tsx`'s `RecoverySection` reads `recoveryHistory`

**Files:**
- Modify: `app/fitness/page.tsx`

**Interfaces:**
- Consumes: `RecoveryHistoryPoint[]` (Task 3), `charts.recoveryHistory` (Task 4).

- [ ] **Step 1: Change `RecoverySection`'s prop and remove its own computation**

Replace the current `RecoverySection` signature and its `hrvStatus`/`scored` block (currently):

```typescript
function RecoverySection({ wellness }: { wellness: ICUWellness[] }) {
  const [rangeDays, setRangeDays] = useState(14)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const hrvStatus = computeHrvBaseline(wellness)
  const hrvBaseline = hrvStatus.baselineMean

  const cutoff = new Date(Date.now() - rangeDays * 864e5).toISOString().split('T')[0]
  const data = wellness.filter(w => w.id >= cutoff).sort((a, b) => a.id.localeCompare(b.id))

  // energy/leg_freshness unavailable in ICUWellness — today's trend score will differ
  // from the Dashboard chip which includes logged subjective wellness (by design).
  const scored = data.map(w => ({
    id: w.id,
    result: computeRecoveryScore({
      hrv: w.hrv ?? null,
      hrvBaseline,
      garmin_sleep_deep_secs: w.garmin_sleep_deep_secs ?? null,
      garmin_sleep_light_secs: w.garmin_sleep_light_secs ?? null,
      garmin_sleep_rem_secs: w.garmin_sleep_rem_secs ?? null,
      garmin_sleep_awake_secs: w.garmin_sleep_awake_secs ?? null,
      body_battery_high: w.body_battery_high ?? null,
      energy: null,
      leg_freshness: null,
      tsb: w.form ?? null,
    }),
  }))

  const latest = scored.at(-1)
```

with:

```typescript
function RecoverySection({ recoveryHistory }: { recoveryHistory: RecoveryHistoryPoint[] }) {
  const [rangeDays, setRangeDays] = useState(14)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const cutoff = new Date(Date.now() - rangeDays * 864e5).toISOString().split('T')[0]
  const scored = recoveryHistory
    .filter(r => r.date >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => ({ id: r.date, result: r }))

  const latest = scored.at(-1)
```

The rest of the function body (the `if (!scored.length) return null` guard onward, including the `displayed.result.components.*` detail popup and the SVG chart) reads `s.id`/`s.result.score`/`s.result.band`/`displayed.result.components.*` exactly as before — `{ id: r.date, result: r }` preserves that exact shape (`result` is now a full `RecoveryHistoryPoint`, which is a structural superset of the old `RecoveryScore` it replaces), so no further changes are needed below this point. Confirm this by reading the rest of the function (lines ~479 onward) after making this change and checking nothing else references `wellness`, `hrvStatus`, or `hrvBaseline`.

- [ ] **Step 2: Update the import list**

`computeHrvBaseline` and `computeRecoveryScore` are no longer used in this file if `RecoverySection` was their only consumer — check with `Grep -n "computeHrvBaseline\|computeRecoveryScore" app/fitness/page.tsx` and remove their imports if so. Add an import for `RecoveryHistoryPoint` from `@/types` if not already imported (this file likely already imports other types from `@/types` — follow that existing import line rather than adding a new one).

- [ ] **Step 3: Update the call site**

Replace:

```typescript
<RecoverySection wellness={charts.wellness} />
```

with:

```typescript
<RecoverySection recoveryHistory={charts.recoveryHistory} />
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No errors in `app/fitness/page.tsx`.

- [ ] **Step 5: Manually confirm no other consumer of `computeHrvBaseline`/`computeRecoveryScore` in this file was broken**

Run: `Grep -n "computeHrvBaseline\|computeRecoveryScore\|HrvSection\|SleepSection" app/fitness/page.tsx` — this file has other sections (`HrvSection`, `SleepSection`) that take `wellness={charts.wellness}` too; confirm this task didn't touch those (it shouldn't have — only `RecoverySection`'s call site and signature change).

- [ ] **Step 6: Commit**

```bash
git add app/fitness/page.tsx
git commit -m "feat: fitness page's Recovery trend reads recoveryHistory instead of computing it

Also fixes a real bug found during design: this section previously used
one static HRV baseline for the entire historical trend instead of each
day's own rolling baseline, and hardcoded energy/leg_freshness to null.
Both are now correct as a side effect of reading the shared computation."
```

---

### Task 7: `app/api/briefing/today/route.ts` uses the shared fetcher

**Files:**
- Modify: `app/api/briefing/today/route.ts`

**Interfaces:**
- Consumes: `fetchRecoveryInputsForRange` (Task 2).

- [ ] **Step 1: Read the current exact code first**

Re-read the file's `recoveryResult = computeRecoveryScore({...})` block (search for it — may have shifted from where this plan describes it) before editing, to confirm the exact current shape:

```typescript
  const recoveryResult = computeRecoveryScore({
    hrv,
    hrvBaseline: hrvStatus?.baselineMean ?? null,
    garmin_sleep_deep_secs: todayGarmin?.garmin_sleep_deep_secs ?? null,
    garmin_sleep_light_secs: todayGarmin?.garmin_sleep_light_secs ?? null,
    garmin_sleep_rem_secs: todayGarmin?.garmin_sleep_rem_secs ?? null,
    garmin_sleep_awake_secs: todayGarmin?.garmin_sleep_awake_secs ?? null,
    body_battery_high: bodyBatteryHigh,
    energy: todayDailyWellness?.energy ?? null,
    leg_freshness: todayDailyWellness?.leg_freshness ?? null,
    tsb,
  })
```

- [ ] **Step 2: Replace it with the shared fetcher**

This route already has `profile.intervals_icu_athlete_id`/`profile.intervals_icu_api_key` (used to construct an `IntervalsClient` earlier in the file — reuse that existing client instance, or construct a fresh one the same way if it's out of scope by this point in the function; check) and `today` (already profile-timezone-resolved at the top of this file, per its existing `Intl.DateTimeFormat` line — reuse it directly, don't recompute).

Add the import:

```typescript
import { fetchRecoveryInputsForRange } from '@/lib/recovery-inputs'
```

Replace the `recoveryResult` block:

```typescript
  const recoveryInputsResult = profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key
    ? await fetchRecoveryInputsForRange(
        supabase, user.id,
        new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key),
        { from: today, to: today },
      )
    : []
  const recoveryResult = computeRecoveryScore(
    recoveryInputsResult[0]?.inputs ?? {
      hrv: null, hrvBaseline: null, garmin_sleep_deep_secs: null, garmin_sleep_light_secs: null,
      garmin_sleep_rem_secs: null, garmin_sleep_awake_secs: null, body_battery_high: null,
      energy: null, leg_freshness: null, tsb: null,
    },
  )
```

Check whether `hrv`, `hrvStatus`, `todayGarmin`, `bodyBatteryHigh`, `todayDailyWellness`, `tsb` (the variables the old block consumed) are used ANYWHERE else in this file for other purposes (`ctx.hrv`, `ctx.hrvStatus` are populated separately, per the design spec — confirm this with `Grep -n "\bhrv\b\|hrvStatus\|todayGarmin\|bodyBatteryHigh\|todayDailyWellness\|\btsb\b" app/api/briefing/today/route.ts`). Only remove a variable's declaration if this task's change was its sole remaining use — most of these are very likely still used elsewhere in the file (e.g. `ctx.hrv`, `ctx.hrvStatus`) and must NOT be deleted.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No errors in `app/api/briefing/today/route.ts`.

- [ ] **Step 4: Run the existing briefing test suite**

Run: `npm test -- __tests__/lib/claude-briefing.test.ts`
Expected: PASS — this file tests `generateBriefing` (in `lib/claude/briefing.ts`), not the route itself, so it shouldn't be affected by this route-level change; confirm it's still green as a sanity check that nothing downstream broke.

- [ ] **Step 5: Commit**

```bash
git add app/api/briefing/today/route.ts
git commit -m "feat: briefing route sources Recovery from the shared fetcher

Replaces its own hand-built RecoveryInputs assembly — now uses the
exact same function, HRV policy, and inputs the dashboard and fitness
page use, closing the divergence risk between the briefing's Recovery
number and what's shown elsewhere in the app."
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Grep for leftover references to the old per-site computation pattern**

Run: `Grep -rn "computeRecoveryScore" --glob '*.ts' --glob '*.tsx' lib components app`
Expected: Matches only in `lib/recovery-score.ts` (the function's own definition) and `app/api/charts/route.ts` (Task 4's one call site) — confirm `app/dashboard/page.tsx`, `app/fitness/page.tsx`, and `app/api/briefing/today/route.ts`'s OLD manual-assembly pattern are gone (the briefing route's Task 7 change still calls `computeRecoveryScore`, but once, on the shared fetcher's output — that's expected and correct, not a leftover).

- [ ] **Step 2: Run the full CI check**

Run: `npm run test:ci`
Expected: All tests pass, zero typecheck errors anywhere in the repo.

- [ ] **Step 3: Manually verify in the running app**

Start the dev server (`npm run dev`) if not already running. Load the dashboard and confirm the Recovery ring still shows a sensible number/band (it may differ slightly from before this change if you have sufficient Garmin HRV history — that's the intended accuracy improvement, not a bug). Tap the Recovery ring and confirm `RecoveryBreakdownModal` still shows a full component breakdown. Load the fitness page and confirm the Recovery trend chart renders, and tapping a historical point still shows its component detail row. Trigger a briefing refresh and confirm it completes without error.

- [ ] **Step 4: Report completion to the user**

Summarize what changed, and explicitly call out that Recovery numbers may have shifted for anyone with sufficient Garmin HRV history (dashboard/fitness page now prefer it, matching what the briefing already did) — this is the deliberate accuracy improvement from the design's scope decision, not a regression.

---

## Self-Review Notes

- **Spec coverage:** "One new shared module" (`fetchRecoveryInputsForRange`) → Task 2. "Extracted pure function" (`computeHrvStatusBestSource`) → Task 1. "`/api/charts` gains `recoveryHistory`" → Tasks 3, 4. "Consumers stop computing Recovery themselves" → Tasks 5, 6, 7. Scope decisions (all three sites, Garmin-preferred everywhere, canonical profile-timezone today for Recovery specifically, no caching) are all reflected in the corresponding tasks. The spec's two explicitly-stated Out of Scope items (no freezing/persistence, no `computeRecoveryScore` changes) are respected — no task touches either.
- **Placeholder scan:** no TBD/TODO; every code step has complete, runnable code. Two spots explicitly ask the implementer to re-read the live file before editing (Tasks 5 and 7, Step 1 of each) rather than trusting this plan's line-number/exact-code snapshot — this is a deliberate "verify against reality" instruction (the same pattern used successfully in the two prior plans in this project when a brief's assumed code drifted from the real file), not a placeholder. One genuine ambiguity was found and resolved during this self-review: Task 3 originally deferred whether `RecoveryHistoryPoint` should `extends RecoveryScore` (import) or duplicate its shape, pending a check the implementer would have had to do anyway — that check was done now (`types/index.ts` has zero imports, a deliberate convention) and the task rewritten to just say what to do.
- **Type consistency:** `RecoveryInputsRangeResult` (Task 2) is consumed identically by Task 4 (bulk, `.map()` over all results) and Task 7 (single date, `[0]?.inputs`) — same shape, same field names, no divergence between the two call sites. `RecoveryHistoryPoint` (Task 3) is produced once (Task 4) and consumed identically by Tasks 5 and 6 without transformation.
