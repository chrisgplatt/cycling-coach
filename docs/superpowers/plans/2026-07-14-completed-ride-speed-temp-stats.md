# Completed Ride Speed & Temperature Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface average/max speed, elapsed time, and min/avg/max temperature for completed rides in the shared `RideStats` component, everywhere it's already used (stats page, unlinked-ride modal, workout detail modal).

**Architecture:** Add 5 new optional fields to `ICUActivity` (mapped from the live intervals.icu API in `lib/intervals/client.ts`) and 5 matching optional fields to `ActivityMetrics` (mapped in `lib/claude/activity-metrics.ts`, version-bumped to trigger the existing backfill for previously-synced rides). `components/RideStats.tsx`'s two adapters (`rideStatsFromActivity`, `rideStatsFromMetrics`) turn both into a shared `RideStatsData` shape; the component renders a new "Elapsed" row in the existing Ride Totals card and two new cards (Speed, Temperature), each following the existing hide-when-null convention.

**Tech Stack:** Next.js / TypeScript / Jest + React Testing Library.

## Global Constraints

- Units: speed in km/h (1 decimal place), temperature in °C (rounded to nearest whole number) — matches existing formatting conventions in `components/ActivityWeatherPanel.tsx`.
- Every new value follows the existing hide-when-null convention already used throughout `RideStats.tsx`: an individual `StatCell` is omitted when its value is null, and a whole `SectionCard` is omitted when all of its values are null.
- Average speed is **derived** (distance ÷ time), never read from a raw `average_speed` API field — this avoids depending on an unverified field name.
- No Supabase migration: `activity_metrics` is a JSONB column, so new sub-fields need no schema change — only the `METRICS_VERSION` bump (existing backfill mechanism).
- New `ICUActivity` and `ActivityMetrics` fields must be optional (`?: number | null`) to avoid breaking existing object literals across the codebase (matches the existing precedent of `max_heartrate?`, `max_hr?`, `min_hr?`).

---

### Task 1: `ICUActivity` speed/elapsed/temperature fields

**Files:**
- Modify: `types/index.ts:259-280` (`ICUActivity` interface)
- Modify: `lib/intervals/client.ts:228-247` (`mapActivity`)
- Test: `__tests__/lib/intervals.test.ts`

**Interfaces:**
- Produces: `ICUActivity` gains `elapsed_time?: number | null`, `max_speed?: number | null` (m/s), `average_temp?: number | null` (°C), `min_temp?: number | null` (°C), `max_temp?: number | null` (°C). Task 3 reads these fields.

- [ ] **Step 1: Write the failing tests**

Add these two tests to `__tests__/lib/intervals.test.ts`, right after the existing `'maps icu_ftp to the ftp field'` test (after line 52):

```typescript
  it('maps elapsed_time, max_speed, and temperature fields', async () => {
    const mockActivities = [
      { id: 'act1', start_date_local: '2026-05-01T08:00:00', type: 'Ride',
        moving_time: 3600, name: 'Morning Ride', average_watts: 200,
        max_watts: 350, weighted_average_watts: 210, average_heartrate: 145,
        icu_training_load: 85, elapsed_time: 3720, max_speed: 15.5,
        average_temp: 18, min_temp: 14, max_temp: 22 },
    ]
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockActivities })

    const activities = await client.getActivities('2026-04-01', '2026-05-11')
    expect(activities[0].elapsed_time).toBe(3720)
    expect(activities[0].max_speed).toBe(15.5)
    expect(activities[0].average_temp).toBe(18)
    expect(activities[0].min_temp).toBe(14)
    expect(activities[0].max_temp).toBe(22)
  })

  it('defaults elapsed_time, max_speed, and temperature fields to null when absent', async () => {
    const mockActivities = [
      { id: 'act1', start_date_local: '2026-05-01T08:00:00', type: 'Ride',
        moving_time: 3600, name: 'Morning Ride', average_watts: 200,
        max_watts: 350, weighted_average_watts: 210, average_heartrate: 145,
        icu_training_load: 85 },
    ]
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockActivities })

    const activities = await client.getActivities('2026-04-01', '2026-05-11')
    expect(activities[0].elapsed_time).toBeNull()
    expect(activities[0].max_speed).toBeNull()
    expect(activities[0].average_temp).toBeNull()
    expect(activities[0].min_temp).toBeNull()
    expect(activities[0].max_temp).toBeNull()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/intervals.test.ts -t "elapsed_time, max_speed"`
Expected: FAIL — both new tests fail because `mapActivity` doesn't set these fields, so `activities[0].elapsed_time` etc. are `undefined`, not `3720`/`null` as asserted.

- [ ] **Step 3: Add the fields to `ICUActivity`**

In `types/index.ts`, in the `ICUActivity` interface, add these 5 lines immediately after the existing `power_20min?: number | null` line (the last field in the interface, currently line 279):

```typescript
  elapsed_time?: number | null   // seconds; includes stopped time, unlike moving_time
  max_speed?: number | null      // m/s, raw from API
  average_temp?: number | null   // °C
  min_temp?: number | null       // °C
  max_temp?: number | null       // °C
```

- [ ] **Step 4: Map the fields in `mapActivity`**

In `lib/intervals/client.ts`, inside `mapActivity`'s returned object, add these 5 lines immediately after the existing `left_right_balance: (a.avg_lr_balance ?? null) as number | null,` line:

```typescript
      elapsed_time: (a.elapsed_time ?? null) as number | null,
      max_speed: (a.max_speed ?? null) as number | null,
      average_temp: (a.average_temp ?? null) as number | null,
      min_temp: (a.min_temp ?? null) as number | null,
      max_temp: (a.max_temp ?? null) as number | null,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/intervals.test.ts`
Expected: PASS (all tests in the file, including the two new ones)

- [ ] **Step 6: Verify the raw field names against a live sync (important — see spec's Data Source Decision)**

This project's convention (per `lib/intervals/client.ts`'s existing field-mapping comments) is to verify intervals.icu's actual raw field names rather than assume them, since they don't always match the obvious guess (e.g. `average_watts` is really `icu_average_watts`). `elapsed_time` is very likely correct (already used unprefixed for lap data in this same client). `max_speed`, `average_temp`, `min_temp`, and `max_temp` are educated guesses with real uncertainty, especially for temperature.

If you have access to a live intervals.icu API key for this project (check `.env.local` for `INTERVALS_ICU_API_KEY` / `INTERVALS_ICU_ATHLETE_ID`), fetch one real recent activity and inspect its raw JSON keys, e.g.:

```bash
curl -s -u "API_KEY:$INTERVALS_ICU_API_KEY" "https://intervals.icu/api/v1/athlete/$INTERVALS_ICU_ATHLETE_ID/activities?oldest=2026-06-01&newest=2026-07-14&limit=1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(Object.keys(JSON.parse(d)[0]).sort().join('\n')))"
```

Look for the actual key names covering speed and temperature (they may differ from this task's guesses, or not exist at all for some/all fields). If you don't have API access, skip this step — it's a nice-to-have verification, not a blocker; wrong or absent field names degrade silently to `null` per the Global Constraints, so shipping without this check is safe, just less certain to actually show data.

If you find different field names, update Step 4's mapping accordingly and re-run Step 5.

- [ ] **Step 7: Commit**

```bash
git add types/index.ts lib/intervals/client.ts __tests__/lib/intervals.test.ts
git commit -m "feat: map elapsed time, max speed, and temperature onto ICUActivity"
```

---

### Task 2: `ActivityMetrics` speed/elapsed/temperature fields

**Files:**
- Modify: `types/index.ts:507-530` (`ActivityMetrics` interface)
- Modify: `lib/claude/activity-metrics.ts:15,29-57` (`METRICS_VERSION`, `extractActivityMetrics`)
- Test: `__tests__/lib/activity-metrics.test.ts`

**Interfaces:**
- Consumes: `ICUActivity.elapsed_time`, `.max_speed`, `.average_temp`, `.min_temp`, `.max_temp` (from Task 1).
- Produces: `ActivityMetrics` gains `elapsed_secs?: number | null`, `max_speed_ms?: number | null`, `avg_temp_c?: number | null`, `min_temp_c?: number | null`, `max_temp_c?: number | null`. Task 3 reads these fields. `METRICS_VERSION` becomes `3`.

- [ ] **Step 1: Write the failing tests**

Add these three tests to `__tests__/lib/activity-metrics.test.ts`, inside the `describe('extractActivityMetrics', ...)` block, after the existing `'passes intervals through'` test (after line 67):

```typescript
  it('maps elapsed time, max speed, and temperature from the activity', () => {
    const m = extractActivityMetrics(
      { ...act, elapsed_time: 3720, max_speed: 15.5, average_temp: 18, min_temp: 14, max_temp: 22 },
      curve, intervals,
    )
    expect(m.elapsed_secs).toBe(3720)
    expect(m.max_speed_ms).toBe(15.5)
    expect(m.avg_temp_c).toBe(18)
    expect(m.min_temp_c).toBe(14)
    expect(m.max_temp_c).toBe(22)
  })

  it('defaults elapsed time, max speed, and temperature to null when absent from the activity', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.elapsed_secs).toBeNull()
    expect(m.max_speed_ms).toBeNull()
    expect(m.avg_temp_c).toBeNull()
    expect(m.min_temp_c).toBeNull()
    expect(m.max_temp_c).toBeNull()
  })

  it('bumps METRICS_VERSION to 3', () => {
    expect(METRICS_VERSION).toBe(3)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/activity-metrics.test.ts -t "elapsed time|METRICS_VERSION to 3"`
Expected: FAIL — `elapsed_secs`/`max_speed_ms`/`avg_temp_c`/`min_temp_c`/`max_temp_c` are `undefined` on the returned object (not yet mapped), and `METRICS_VERSION` is still `2`.

- [ ] **Step 3: Add the fields to `ActivityMetrics`**

In `types/index.ts`, in the `ActivityMetrics` interface, add these 5 lines immediately after the existing `lr_balance: number | null    // left %` line (currently line 517), keeping them inside the "Tier 1" block:

```typescript
  elapsed_secs?: number | null   // seconds; includes stopped time
  max_speed_ms?: number | null   // m/s, raw from API
  avg_temp_c?: number | null
  min_temp_c?: number | null
  max_temp_c?: number | null
```

- [ ] **Step 4: Map the fields in `extractActivityMetrics` and bump the version**

In `lib/claude/activity-metrics.ts`, change line 15 from:

```typescript
export const METRICS_VERSION = 2
```

to:

```typescript
export const METRICS_VERSION = 3
```

Then, in `extractActivityMetrics`'s returned object, add these 5 lines immediately after the existing `lr_balance: act.left_right_balance ?? null,` line:

```typescript
    elapsed_secs: act.elapsed_time ?? null,
    max_speed_ms: act.max_speed ?? null,
    avg_temp_c: act.average_temp ?? null,
    min_temp_c: act.min_temp ?? null,
    max_temp_c: act.max_temp ?? null,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/activity-metrics.test.ts __tests__/lib/enrich.test.ts`
Expected: PASS (both files — `enrich.test.ts` is included because it references `METRICS_VERSION` and must still pass after the bump)

- [ ] **Step 6: Commit**

```bash
git add types/index.ts lib/claude/activity-metrics.ts __tests__/lib/activity-metrics.test.ts
git commit -m "feat: map elapsed time, max speed, and temperature onto ActivityMetrics, bump METRICS_VERSION to 3"
```

---

### Task 3: `RideStats` UI — Speed and Temperature cards, Elapsed stat

**Files:**
- Modify: `components/RideStats.tsx` (entire file, see below for exact new contents of each changed section)
- Test: `__tests__/components/RideStats.test.tsx`

**Interfaces:**
- Consumes: `ICUActivity.elapsed_time`, `.max_speed`, `.average_temp`, `.min_temp`, `.max_temp` (Task 1); `ActivityMetrics.elapsed_secs`, `.max_speed_ms`, `.avg_temp_c`, `.min_temp_c`, `.max_temp_c` (Task 2).
- Produces: `RideStatsData` gains `avgSpeedKph: number | null`, `maxSpeedKph: number | null`, `elapsedSecs: number | null`, `avgTempC: number | null`, `minTempC: number | null`, `maxTempC: number | null`. No other file consumes these — this is the final task.

- [ ] **Step 1: Write the failing tests**

Add these to `__tests__/components/RideStats.test.tsx`, as two new `describe` blocks after the existing `describe('RideStats render', ...)` block (after line 71):

```typescript
describe('RideStats adapters — speed, elapsed time, temperature', () => {
  it('derives average speed from distance and moving time, and maps max speed / elapsed / temperature from an ICUActivity', () => {
    const d = rideStatsFromActivity({
      ...activity, moving_time: 3600, distance: 36000,
      elapsed_time: 3720, max_speed: 15.5, average_temp: 18, min_temp: 14, max_temp: 22,
    })
    expect(d.avgSpeedKph).toBeCloseTo(36, 5)
    expect(d.maxSpeedKph).toBeCloseTo(55.8, 1)
    expect(d.elapsedSecs).toBe(3720)
    expect(d.avgTempC).toBe(18)
    expect(d.minTempC).toBe(14)
    expect(d.maxTempC).toBe(22)
  })

  it('nulls speed, elapsed, and temperature fields when absent from an ICUActivity', () => {
    const d = rideStatsFromActivity(activity)
    expect(d.maxSpeedKph).toBeNull()
    expect(d.elapsedSecs).toBeNull()
    expect(d.avgTempC).toBeNull()
    expect(d.minTempC).toBeNull()
    expect(d.maxTempC).toBeNull()
  })

  it('returns null average speed when distance is unavailable', () => {
    const d = rideStatsFromActivity({ ...activity, distance: null })
    expect(d.avgSpeedKph).toBeNull()
  })

  it('derives average speed from distance and the supplied duration, and maps max speed / elapsed / temperature from ActivityMetrics', () => {
    const d = rideStatsFromMetrics({
      ...metrics, distance_m: 36000, max_speed_ms: 15.5,
      elapsed_secs: 3720, avg_temp_c: 18, min_temp_c: 14, max_temp_c: 22,
    }, 3600, 85)
    expect(d.avgSpeedKph).toBeCloseTo(36, 5)
    expect(d.maxSpeedKph).toBeCloseTo(55.8, 1)
    expect(d.elapsedSecs).toBe(3720)
    expect(d.avgTempC).toBe(18)
    expect(d.minTempC).toBe(14)
    expect(d.maxTempC).toBe(22)
  })
})

describe('RideStats render — speed and temperature cards', () => {
  it('shows the Speed card when speed data is present', () => {
    const d = rideStatsFromActivity({ ...activity, max_speed: 15.5 })
    render(<RideStats data={d} />)
    expect(screen.getByText('Speed')).toBeInTheDocument()
    expect(screen.getByText('Avg Speed')).toBeInTheDocument()
    expect(screen.getByText('Max Speed')).toBeInTheDocument()
  })

  it('hides the Speed card when both average and max speed are absent', () => {
    const d = rideStatsFromActivity({ ...activity, distance: null, max_speed: null })
    render(<RideStats data={d} />)
    expect(screen.queryByText('Speed')).toBeNull()
  })

  it('shows the Elapsed stat in Ride Totals when present', () => {
    const d = rideStatsFromActivity({ ...activity, elapsed_time: 3720 })
    render(<RideStats data={d} />)
    expect(screen.getByText('Elapsed')).toBeInTheDocument()
    expect(screen.getByText('1h 2m')).toBeInTheDocument()
  })

  it('hides the Elapsed stat when absent', () => {
    render(<RideStats data={rideStatsFromActivity(activity)} />)
    expect(screen.queryByText('Elapsed')).toBeNull()
  })

  it('shows the Temperature card with only the fields that are present', () => {
    const d = rideStatsFromActivity({ ...activity, average_temp: 18, min_temp: null, max_temp: null })
    render(<RideStats data={d} />)
    expect(screen.getByText('Temperature')).toBeInTheDocument()
    expect(screen.getByText('Avg Temp')).toBeInTheDocument()
    expect(screen.queryByText('Min Temp')).toBeNull()
    expect(screen.queryByText('Max Temp')).toBeNull()
  })

  it('hides the Temperature card when all three values are absent', () => {
    render(<RideStats data={rideStatsFromActivity(activity)} />)
    expect(screen.queryByText('Temperature')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/components/RideStats.test.tsx`
Expected: FAIL — TypeScript compile error (Jest transpiles per-file, so this surfaces as runtime failures) because `avgSpeedKph` etc. don't exist on `RideStatsData` yet, and the "Speed"/"Elapsed"/"Temperature" text isn't rendered anywhere.

- [ ] **Step 3: Update `RideStatsData` and both adapters**

In `components/RideStats.tsx`, replace the `RideStatsData` interface (lines 4-18) with:

```typescript
export interface RideStatsData {
  avgWatts: number | null
  np: number | null
  tss: number | null
  best: { p1: number | null; p5: number | null; p10: number | null; p20: number | null }
  distanceM: number | null
  elevationM: number | null
  durationSecs: number
  avgHr: number | null
  maxHr: number | null
  minHr: number | null
  lrBalanceRight: number | null  // right-side %, e.g. 47.7 (intervals.icu stores right-side %)
  npWkg: number | null
  avgWkg: number | null
  avgSpeedKph: number | null
  maxSpeedKph: number | null
  elapsedSecs: number | null
  avgTempC: number | null
  minTempC: number | null
  maxTempC: number | null
}
```

Replace `rideStatsFromActivity` (lines 29-48) with:

```typescript
export function rideStatsFromActivity(a: ICUActivity): RideStatsData {
  return {
    avgWatts: a.average_watts,
    np: a.weighted_average_watts,
    tss: a.training_load,
    best: {
      p1: a.power_1min ?? null, p5: a.power_5min ?? null,
      p10: a.power_10min ?? null, p20: a.power_20min ?? null,
    },
    distanceM: a.distance,
    elevationM: a.total_elevation_gain,
    durationSecs: a.moving_time,
    avgHr: a.average_heartrate,
    maxHr: a.max_heartrate ?? null,
    minHr: null,
    lrBalanceRight: a.left_right_balance,
    npWkg: null,
    avgWkg: null,
    avgSpeedKph: (a.distance != null && a.moving_time > 0) ? (a.distance / 1000) / (a.moving_time / 3600) : null,
    maxSpeedKph: a.max_speed != null ? a.max_speed * 3.6 : null,
    elapsedSecs: a.elapsed_time ?? null,
    avgTempC: a.average_temp ?? null,
    minTempC: a.min_temp ?? null,
    maxTempC: a.max_temp ?? null,
  }
}
```

Replace `rideStatsFromMetrics` (lines 50-67) with:

```typescript
export function rideStatsFromMetrics(m: ActivityMetrics, durationSecs: number, tss: number | null): RideStatsData {
  const effort = (secs: number) => m.best_efforts?.find(e => e.secs === secs)?.watts ?? null
  return {
    avgWatts: m.avg_power,
    np: m.np,
    tss,
    best: { p1: effort(60), p5: effort(300), p10: effort(600), p20: effort(1200) },
    distanceM: m.distance_m,
    elevationM: m.elevation_m,
    durationSecs,
    avgHr: m.avg_hr,
    maxHr: m.max_hr ?? null,
    minHr: m.min_hr ?? null,
    lrBalanceRight: m.lr_balance,
    npWkg: null,
    avgWkg: null,
    avgSpeedKph: (m.distance_m != null && durationSecs > 0) ? (m.distance_m / 1000) / (durationSecs / 3600) : null,
    maxSpeedKph: m.max_speed_ms != null ? m.max_speed_ms * 3.6 : null,
    elapsedSecs: m.elapsed_secs ?? null,
    avgTempC: m.avg_temp_c ?? null,
    minTempC: m.min_temp_c ?? null,
    maxTempC: m.max_temp_c ?? null,
  }
}
```

- [ ] **Step 4: Update the render function**

Replace the entire `RideStats` default export function (lines 97-166) with:

```typescript
export default function RideStats({ data, effectiveMaxHr }: { data: RideStatsData; effectiveMaxHr?: number | null }) {
  const hasBest = data.best.p1 != null || data.best.p5 != null || data.best.p10 != null || data.best.p20 != null
  const hasSpeed = data.avgSpeedKph !== null || data.maxSpeedKph !== null
  const hasTemp = data.avgTempC !== null || data.minTempC !== null || data.maxTempC !== null
  const balance = data.lrBalanceRight !== null
    ? `${(100 - data.lrBalanceRight).toFixed(1)}% L / ${data.lrBalanceRight.toFixed(1)}% R`
    : null
  const num = (v: number | null) => (v !== null ? String(Math.round(v)) : '—')

  return (
    <div className="space-y-4">
      <SectionCard title="Power" accent="bg-orange-400">
        <div className="flex divide-x divide-gray-100">
          <StatCell label="Avg W" value={num(data.avgWatts)} unit={data.avgWatts !== null ? 'w' : undefined} valueClass="text-orange-500" />
          <StatCell label="NP" value={num(data.np)} unit={data.np !== null ? 'w' : undefined} valueClass="text-orange-500" />
          <StatCell label="TSS" value={num(data.tss)} valueClass="text-orange-500" />
        </div>
        {(data.avgWkg !== null || data.npWkg !== null) && (
          <div className="flex divide-x divide-gray-100 border-t border-gray-100">
            {data.avgWkg !== null && (
              <StatCell label="Avg w/kg" value={data.avgWkg.toFixed(2)} valueClass="text-orange-400" />
            )}
            {data.npWkg !== null && (
              <StatCell label="NP w/kg" value={data.npWkg.toFixed(2)} valueClass="text-orange-400" />
            )}
          </div>
        )}
      </SectionCard>

      {hasBest && (
        <SectionCard title="Best Power" accent="bg-orange-400">
          <div className="flex divide-x divide-gray-100">
            <StatCell label="1 min" value={num(data.best.p1)} unit={data.best.p1 != null ? 'w' : undefined} valueClass="text-orange-500" />
            <StatCell label="5 min" value={num(data.best.p5)} unit={data.best.p5 != null ? 'w' : undefined} valueClass="text-orange-500" />
            <StatCell label="10 min" value={num(data.best.p10)} unit={data.best.p10 != null ? 'w' : undefined} valueClass="text-orange-500" />
            <StatCell label="20 min" value={num(data.best.p20)} unit={data.best.p20 != null ? 'w' : undefined} valueClass="text-orange-500" />
          </div>
        </SectionCard>
      )}

      <SectionCard title="Ride Totals" accent="bg-blue-500">
        <div className="flex divide-x divide-gray-100">
          <StatCell label="Distance" value={data.distanceM !== null ? (Math.round(data.distanceM / 100) / 10).toFixed(1) : '—'} unit={data.distanceM !== null ? 'km' : undefined} valueClass="text-blue-600" />
          <StatCell label="Elevation" value={data.elevationM !== null ? String(Math.floor(data.elevationM)) : '—'} unit={data.elevationM !== null ? 'm' : undefined} valueClass="text-emerald-600" />
          <StatCell label="Duration" value={formatHrsMins(data.durationSecs)} valueClass="text-violet-600" />
        </div>
        {data.elapsedSecs !== null && (
          <div className="flex divide-x divide-gray-100 border-t border-gray-100">
            <StatCell label="Elapsed" value={formatHrsMins(data.elapsedSecs)} valueClass="text-violet-400" />
          </div>
        )}
      </SectionCard>

      {hasSpeed && (
        <SectionCard title="Speed" accent="bg-cyan-500">
          <div className="flex divide-x divide-gray-100">
            {data.avgSpeedKph !== null && (
              <StatCell label="Avg Speed" value={data.avgSpeedKph.toFixed(1)} unit="km/h" valueClass="text-cyan-600" />
            )}
            {data.maxSpeedKph !== null && (
              <StatCell label="Max Speed" value={data.maxSpeedKph.toFixed(1)} unit="km/h" valueClass="text-cyan-600" />
            )}
          </div>
        </SectionCard>
      )}

      {(data.avgHr !== null || data.maxHr !== null) && (
        <SectionCard title="Heart Rate" accent="bg-red-400">
          <div className="flex divide-x divide-gray-100">
            {data.minHr !== null && <StatCell label="Min HR" value={num(data.minHr)} unit="bpm" valueClass="text-red-300" />}
            {data.avgHr !== null && <StatCell label="Avg HR" value={num(data.avgHr)} unit="bpm" valueClass="text-red-500" />}
            {data.maxHr !== null && <StatCell label="Max HR" value={num(data.maxHr)} unit="bpm" valueClass="text-red-600" />}
            {data.maxHr !== null && effectiveMaxHr != null && effectiveMaxHr > 0 && (
              <StatCell label="% of Max" value={String(Math.round((data.maxHr / effectiveMaxHr) * 100))} valueClass="text-red-400" unit="%" />
            )}
          </div>
        </SectionCard>
      )}

      {hasTemp && (
        <SectionCard title="Temperature" accent="bg-amber-500">
          <div className="flex divide-x divide-gray-100">
            {data.minTempC !== null && (
              <StatCell label="Min Temp" value={String(Math.round(data.minTempC))} unit="°C" valueClass="text-amber-500" />
            )}
            {data.avgTempC !== null && (
              <StatCell label="Avg Temp" value={String(Math.round(data.avgTempC))} unit="°C" valueClass="text-amber-600" />
            )}
            {data.maxTempC !== null && (
              <StatCell label="Max Temp" value={String(Math.round(data.maxTempC))} unit="°C" valueClass="text-amber-700" />
            )}
          </div>
        </SectionCard>
      )}

      {balance !== null && (
        <SectionCard title="L/R Balance" accent="bg-rose-400">
          <div className="text-center px-2 py-3 sm:px-3 sm:py-4">
            <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-rose-500">{balance}</div>
            <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">Left / Right</div>
          </div>
        </SectionCard>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/components/RideStats.test.tsx`
Expected: PASS (all tests in the file, including the new ones)

- [ ] **Step 6: Run typecheck and the full test suite**

Run: `npm run typecheck`
Expected: no errors (this touches shared types consumed by `app/stats/page.tsx`, `components/ActivityDetailModal.tsx`, and `components/WorkoutDetailModal.tsx` — none of those files need code changes since they pass data through unchanged, but typecheck confirms nothing broke)

Run: `npx jest`
Expected: all suites pass

- [ ] **Step 7: Manual verification (no dedicated test file exists for the 3 pages/modals that render `RideStats`)**

Start the dev server (`npm run dev`) and check, for a completed ride with speed/temperature data (or by temporarily hardcoding test values in one adapter call to confirm rendering if no such ride exists yet):
- Stats page (`/stats`, a specific ride tab): Ride Totals shows Elapsed under Distance/Elevation/Duration when available; Speed and Temperature cards appear when their data is present.
- An unlinked completed ride's detail modal: same.
- A workout linked to a completed ride, in its detail modal's Stats tab: same, sourced from `activity_metrics`.
- Confirm on a narrow viewport (375px) that the new cards don't overflow or clip — they reuse the existing `SectionCard`/`StatCell` layout primitives, which are already mobile-tested by the rest of this component.

- [ ] **Step 8: Commit**

```bash
git add components/RideStats.tsx __tests__/components/RideStats.test.tsx
git commit -m "feat: add Speed and Temperature stat cards, and Elapsed time, to RideStats"
```
