# Garmin Sleep Data & HRV Source Replacement Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull overnight HRV, resting heart rate, sleep stages, and respiration rate from Garmin's `getSleepData()` API, store them in `garmin_wellness`, use the stored HRV history as the primary source for the existing baseline model, and fall back to intervals.icu HRV when Garmin is not connected or has insufficient history.

**Architecture:** Three layers — data collection (new client method + DB columns + sync), HRV source routing (generalized baseline model + Garmin-first router replacing the current ICU-only function), and signal propagation (new fields in `BriefingContext`, briefing prompt, and `StrainBreakdownSheet`).

**Tech Stack:** TypeScript, Next.js App Router, Supabase, `garmin-connect` npm v1.6.2, existing `computeHrvBaseline` / `HrvStatus` model.

## Global Constraints

- `getSleepData()` is a native method on `GarminConnect` — use `gc.getSleepData(new Date(date))` directly, not `gc.get()`.
- The `SleepData` type is already exported by `garmin-connect/dist/garmin/types/sleep`. Use it; do not redefine it.
- `computeHrvBaseline` must remain a pure function with no Supabase/network imports.
- All existing `HrvStatus` consumers continue to receive exactly the same object shape — no field additions or removals.
- Garmin is always tried first; intervals.icu is the fallback. Never call both and merge.
- The `fetchHrvStatus(client, today)` function signature is kept unchanged (still exported) so any call sites not yet migrated continue to compile. Only the router `fetchHrvStatusBestSource` is the new preferred export.
- Security constraint: NEVER commit `scripts/ftp-simulation.ts`, `scripts/ftp-feedback-check.ts`, `scripts/ftp-simulation-final.ts`, or any Supabase JWT service role key to git.

---

## Section 1: Data Collection

### 1a. `GarminClient.getSleepMetrics(date: string)`

New method in `lib/garmin/client.ts`. Calls `this._gc.getSleepData(new Date(date))` and extracts:

```ts
export interface SleepMetrics {
  overnightHrv: number | null        // dailySleepDTO.avgOvernightHrv — not on dailySleepDTO; top-level avgOvernightHrv on SleepData
  hrvGarminStatus: string | null     // SleepData.hrvStatus
  restingHr: number | null           // SleepData.restingHeartRate
  deepSecs: number | null            // dailySleepDTO.deepSleepSeconds
  lightSecs: number | null           // dailySleepDTO.lightSleepSeconds
  remSecs: number | null             // dailySleepDTO.remSleepSeconds
  awakeSecs: number | null           // dailySleepDTO.awakeSleepSeconds
  respirationAvg: number | null      // dailySleepDTO.averageRespirationValue, rounded to integer
}
```

All fields null-safe: if `getSleepData` throws or returns unexpected shape, return all nulls (same error-handling pattern as existing methods).

### 1b. Database migration

New file `supabase/migrations/20260620_garmin_sleep_hrv.sql`:

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

### 1c. Types

`GarminWellness` in `types/index.ts` gains 8 optional fields matching the columns above.

`ICUWellness` gains the same 8 optional fields (with `garmin_` prefix) so `StrainBreakdownSheet` can receive them through the existing props pattern.

### 1d. Sync route

In `app/api/sync/route.ts`, `syncGarmin()` adds `client.getSleepMetrics(todayStr)` as a fifth parallel call (alongside `getTrainingReadiness`, `getTrainingStatus`, `getBodyBattery`, `getDailyStress`). All 8 returned fields are written to the `garmin_wellness` upsert row and returned in the `GarminWellness` response object.

---

## Section 2: HRV Source Routing

### 2a. Generalize `computeHrvBaseline`

Change input type in `lib/hrv/baseline.ts` from `ICUWellness[]` to `{ id: string; hrv: number | null }[]`. `ICUWellness` already satisfies this shape, so no call-site changes needed anywhere.

### 2b. `fetchHrvStatusFromGarmin`

New function in `lib/hrv/server.ts`:

```ts
export async function fetchHrvStatusFromGarmin(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<HrvStatus>
```

Queries `garmin_wellness` for the 90-day window ending on `today`, selecting only `date` (mapped to `id`) and `garmin_hrv_overnight` (mapped to `hrv`). Runs `computeHrvBaseline()` on the result. Returns the full `HrvStatus` object.

### 2c. `fetchHrvStatusBestSource` (router)

New exported function in `lib/hrv/server.ts`:

```ts
export async function fetchHrvStatusBestSource(
  today: string,
  garminParams: { supabase: SupabaseClient; userId: string } | null,
  icuClient: IntervalsClient | null,
): Promise<HrvStatus>
```

Logic:
1. If `garminParams` is non-null, call `fetchHrvStatusFromGarmin`. If `result.sufficient` is true (≥ 14 readings in 90-day window), return it.
2. Otherwise, if `icuClient` is non-null, call and return `fetchHrvStatus(icuClient, today)` (unchanged existing function).
3. Otherwise return `{ label: 'no_data', sufficient: false, daysOfData: 0, ... }`.

`fetchHrvStatus` remains exported and unchanged.

### 2d. Migrate call sites

These 9 routes switch from `fetchHrvStatus(client, today)` to `fetchHrvStatusBestSource(today, garminParams, client)`:

- `app/api/briefing/today/route.ts`
- `app/api/chat/route.ts`
- `app/api/plan/route.ts`
- `app/api/plan/extend/route.ts`
- `app/api/plan/review/route.ts`
- `app/api/cron/daily-briefing/route.ts`
- `app/api/chat/session/route.ts`
- `app/api/chat/interview/route.ts`
- `app/api/hrv/route.ts`

In each route, `garminParams` is `{ supabase, userId }` when `profile.garmin_email` is set, otherwise `null`. The `icuClient` is the existing `IntervalsClient` (or `null` if no ICU credentials).

---

## Section 3: New Signals in Briefing and UI

### 3a. `BriefingContext` type additions

In `types/index.ts`, `BriefingContext` gains:

```ts
garminRestingHr: number | null
garminSleepDeepSecs: number | null
garminSleepLightSecs: number | null
garminSleepRemSecs: number | null
garminSleepRespirationAvg: number | null
```

### 3b. Briefing route

`app/api/briefing/today/route.ts` already selects from `garmin_wellness`. Extend the select to include the 5 new fields and wire them into `ctx`.

### 3c. Briefing prompt

In `lib/claude/briefing.ts`, the `garminLines` block in `generateMorningBriefing` gains two additions after the existing stress line:

**Resting HR** (when `ctx.garminRestingHr != null`):
```
Resting HR: {value}bpm
```

**Sleep stages** (when any stage value is non-null):
```
Sleep stages: {deep}m deep · {rem}m REM · {light}m light · {awake}m awake
```
Values formatted as whole minutes. Respiration included on the same line when present:
```
Sleep stages: {deep}m deep · {rem}m REM · {light}m light · {awake}m awake (resp {avg} brpm)
```

### 3d. `StrainBreakdownSheet` sleep stage row

In `components/StrainBreakdownSheet.tsx`, after the existing sleep duration row, add a new sub-signal row when `garmin_sleep_deep_secs` is present on `wellness`:

```tsx
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

`StrainBreakdownSheet` receives these fields from the `wellness: ICUWellness` prop. The existing garmin fields on `ICUWellness` (e.g. `garmin_body_battery_charged`) are populated by merging `garmin_wellness` table data into the wellness object somewhere in the data pipeline — the implementer must locate this merge point (likely in `app/api/charts/route.ts` or the dashboard's data-loading path) and extend it to include the 5 new sleep stage fields, following the exact same pattern.

No changes to `MetricsBar` — stage detail belongs in the breakdown sheet.

---

## Testing

- **`lib/garmin/client.test.ts`**: Add `getSleepMetrics` test suite (4 cases: normal response, missing HRV, empty dailySleepDTO, network error → all nulls).
- **`lib/hrv/baseline.test.ts`** (if it exists) or new: verify `computeHrvBaseline` still works with plain `{ id, hrv }[]` input.
- **`lib/hrv/server.test.ts`** (new): unit-test `fetchHrvStatusBestSource` with mocked Supabase — Garmin sufficient → returns Garmin result; Garmin insufficient → calls ICU fallback; no Garmin params → calls ICU; neither → returns no_data.
- **Manual**: after running the SQL migration and triggering a sync, verify `garmin_wellness` row has HRV/sleep columns populated; verify morning briefing prompt includes "Resting HR" and "Sleep stages" lines.
