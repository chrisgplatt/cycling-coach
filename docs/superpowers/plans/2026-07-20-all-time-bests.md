# All-Time Bests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an all-time (and per-year) bests view covering biggest/longest climbs, power bests, speed-over-distance bests, and max speed, aggregated across a rider's full ride history.

**Architecture:** Two new per-ride detection capabilities (climb length/path, speed-over-distance splits) are added to the existing sync-time metrics pipeline and rolled into one `METRICS_VERSION` bump, so the app's existing `?deep=1` backfill sweep re-processes historical rides automatically — no new admin route needed. A pure aggregation module scans all rides' already-stored `activity_metrics` (both the two new fields and three fields that already exist) to compute all-time and per-year bests. A thin API route serves this, and a new tab on the existing Stats page displays it with a period selector (All-time + each year with data).

**Tech Stack:** Next.js App Router, TypeScript, React, Supabase, Jest + Testing Library.

## Global Constraints

- `length_km` on `ClimbSegment` and `SpeedBest` entries are new — everything else needed (biggest climb's `elev_gain_m`, power bests' `best_efforts`, max speed's `max_speed_ms`) already exists in `activity_metrics` today and needs no new detection or backfill.
- Both new detection additions (climb `length_km`/`path`, `speed_bests`) must land in a **single** `METRICS_VERSION` bump — never two separate bumps across two tasks, since that would trigger two separate backfill passes for what is one atomic capability addition.
- `path` on `ClimbSegment` is `null` whenever GPS is unavailable (`latlng` stream is `null` for indoor rides) — `length_km` is independent of GPS and must still be computed in that case (it only needs `distance`, not `latlng`).
- `path` is downsampled to a maximum of 12 points via a new generic `downsamplePoints<T>()` helper — not a full-resolution polyline.
- The aggregation functions (`computeAllTimeBests`, `computeAllTimeBestsByPeriod`) are pure — no Supabase/fetch calls inside `lib/ride/all-time-bests.ts`. Only `app/api/bests/route.ts` touches Supabase.
- No click-through from a bests entry to reopen its source ride in this pass — entries show their date as plain text only (explicitly deferred, not an oversight).
- No new admin route, no caching table — `/api/bests` computes live per request, matching how `/api/charts` and `/api/stats` already work at this app's scale (~150-300 rides/year, single athlete).

---

### Task 1: `downsamplePoints` generic helper

**Files:**
- Modify: `lib/intervals/streams.ts`
- Test: `__tests__/lib/streams.test.ts`

**Interfaces:**
- Produces: `downsamplePoints<T>(points: T[], maxPoints: number): T[]` — exported alongside the existing `downsampleStreams`. Task 2 consumes this for climb `path` computation.

- [ ] **Step 1: Write the failing tests**

Add this describe block to `__tests__/lib/streams.test.ts`, after the existing `downsampleStreams` block:

```typescript
describe('downsamplePoints', () => {
  it('returns the input unchanged when under the cap', () => {
    const points = [1, 2, 3, 4, 5]
    expect(downsamplePoints(points, 12)).toEqual(points)
  })

  it('returns the input unchanged when exactly at the cap', () => {
    const points = Array.from({ length: 12 }, (_, i) => i)
    expect(downsamplePoints(points, 12)).toEqual(points)
  })

  it('downsamples an 18-point array to 9 points via even stride', () => {
    const points = Array.from({ length: 18 }, (_, i) => i)
    // stride = ceil(18/12) = 2 → keeps indices 0,2,4,...,16 (9 points)
    expect(downsamplePoints(points, 12)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16])
  })

  it('works with tuple arrays (lat/lng points)', () => {
    const points: [number, number][] = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]
    // stride = ceil(5/3) = 2 → keeps indices 0,2,4
    expect(downsamplePoints(points, 3)).toEqual([[1, 1], [3, 3], [5, 5]])
  })
})
```

Update the import line at the top of the file to include the new function:
```typescript
import { normaliseStreams, downsampleStreams, downsamplePoints } from '@/lib/intervals/streams'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/streams.test.ts`
Expected: FAIL with "downsamplePoints is not a function" (or a TypeScript error on the import, depending on how Jest reports it) — it doesn't exist yet.

- [ ] **Step 3: Implement**

Add this function to `lib/intervals/streams.ts`, after the existing `downsampleStreams`:

```typescript
// Even-stride downsample for a single array (e.g. a climb's lat/lng path).
// Same technique as downsampleStreams' internal `pick`, generalized to one
// array instead of a whole multi-channel RideStreams object.
export function downsamplePoints<T>(points: T[], maxPoints: number): T[] {
  const n = points.length
  if (n <= maxPoints) return points
  const stride = Math.ceil(n / maxPoints)
  return points.filter((_, i) => i % stride === 0)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/streams.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/intervals/streams.ts __tests__/lib/streams.test.ts
git commit -m "feat: add downsamplePoints generic helper"
```

---

### Task 2: Climb length/path + speed-over-distance detection

**Files:**
- Modify: `types/index.ts`
- Modify: `lib/claude/activity-metrics.ts`
- Modify: `__tests__/support/factories.ts` (shared `ActivityMetrics` test factory needs the new required field)
- Modify: `__tests__/components/RideHighlightsTab.test.tsx`, `__tests__/components/RideMapGraph.test.tsx`, `__tests__/components/RideStats.test.tsx`, `__tests__/components/WorkoutDetailModal.test.tsx`, `__tests__/lib/ride-highlights.test.ts` (pre-existing `ClimbSegment`/`ActivityMetrics`-shaped fixtures need the new required fields — see Step 3a)
- Test: `__tests__/lib/activity-metrics.test.ts`

**Interfaces:**
- Consumes: `downsamplePoints<T>()` from Task 1 (`lib/intervals/streams.ts`).
- Produces: `ClimbSegment.length_km: number`, `ClimbSegment.path: [number, number][] | null`; new `SpeedBest` interface; `ActivityMetrics.speed_bests: SpeedBest[] | null`. Task 3 consumes all of these via `ActivityMetrics`.

- [ ] **Step 1: Write the failing tests**

`extractStreamInsights` is already imported in this file — via a second, mid-file import statement (`import { formatRideShape, extractStreamInsights } from '@/lib/claude/activity-metrics'`, immediately before the existing `effort period detection (via extractStreamInsights)` describe block). No new import is needed; the new describe blocks below can call `extractStreamInsights` directly.

Add these two describe blocks to `__tests__/lib/activity-metrics.test.ts`, after the existing `effort period detection (via extractStreamInsights)` block:

```typescript
describe('climb length/path detection (via extractStreamInsights)', () => {
  it('computes length_km and a downsampled path for a detected climb', () => {
    // 15 samples, 30s apart, 125m apart. Flat 0-250m (idx 0-1), climbing at a
    // steady 5% grade from 250m (idx 2) to 1750m (idx 14), altitude plateauing
    // at idx 11+. The climb-detection algorithm's forward-looking 200m window
    // means the detected climb boundary lands at idx 2..8 (not the full
    // idx 2..10 physical climb) — verified empirically against the real
    // algorithm, not hand-derived, since the forward-window lookahead
    // truncates the tail before the grade drops below threshold.
    const time =     [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 390, 420]
    const distance = [0, 125, 250, 375, 500, 625, 750, 875, 1000, 1125, 1250, 1375, 1500, 1625, 1750]
    const altitude: number[] = []
    for (let i = 0; i < distance.length; i++) {
      if (i <= 1) altitude.push(100)
      else if (i <= 10) altitude.push(100 + (distance[i] - 250) * 0.05)
      else altitude.push(altitude[10])
    }
    const latlng: [number, number][] = distance.map((_, i) => [51.5 + i * 0.001, -0.1 + i * 0.001])
    const power = distance.map(() => 220)
    const s = { time, distance, latlng, power, hr: null, altitude, cadence: null, velocity: null }
    const insights = extractStreamInsights(s, 250, null, null)
    expect(insights.climbs).toEqual([
      {
        start_km: 0.3,
        duration_secs: 180,
        elev_gain_m: 38,
        avg_watts: 220,
        vam: 750,
        length_km: 0.8,
        path: [
          [51.502, -0.098],
          [51.503, -0.097],
          [51.504, -0.096],
          [51.505, -0.095],
          [51.506, -0.094],
          [51.507, -0.093],
          [51.508, -0.092],
        ],
      },
    ])
  })

  it('downsamples a longer climb path to at most 12 points', () => {
    // 24 samples, same spacing/grade shape as above but scaled up: flat
    // idx 0-1, climbing idx 2-20 (altitude plateaus at idx 20+). Detected
    // climb boundary (verified empirically): idx 1..18, an 18-point raw path,
    // downsampled via stride 2 to 9 points.
    const n = 24
    const time: number[] = []
    const distance: number[] = []
    for (let i = 0; i < n; i++) { time.push(i * 30); distance.push(i * 125) }
    const altitude: number[] = []
    for (let i = 0; i < n; i++) {
      if (i <= 1) altitude.push(100)
      else if (i <= 20) altitude.push(100 + (distance[i] - distance[1]) * 0.05)
      else altitude.push(altitude[20])
    }
    const latlng: [number, number][] = distance.map((_, i) => [51.5 + i * 0.001, -0.1 + i * 0.001])
    const power = distance.map(() => 220)
    const s = { time, distance, latlng, power, hr: null, altitude, cadence: null, velocity: null }
    const insights = extractStreamInsights(s, 250, null, null)
    expect(insights.climbs).toHaveLength(1)
    expect(insights.climbs![0].length_km).toBe(2.1)
    expect(insights.climbs![0].path).toEqual([
      [51.501, -0.099],
      [51.503, -0.097],
      [51.505, -0.095],
      [51.507, -0.093],
      [51.509, -0.091],
      [51.511, -0.089],
      [51.513, -0.087],
      [51.515, -0.085],
      [51.517, -0.083],
    ])
  })

  it('still computes length_km but leaves path null when there is no GPS (indoor ride)', () => {
    const time =     [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 390, 420]
    const distance = [0, 125, 250, 375, 500, 625, 750, 875, 1000, 1125, 1250, 1375, 1500, 1625, 1750]
    const altitude: number[] = []
    for (let i = 0; i < distance.length; i++) {
      if (i <= 1) altitude.push(100)
      else if (i <= 10) altitude.push(100 + (distance[i] - 250) * 0.05)
      else altitude.push(altitude[10])
    }
    const power = distance.map(() => 220)
    const s = { time, distance, latlng: null, power, hr: null, altitude, cadence: null, velocity: null }
    const insights = extractStreamInsights(s, 250, null, null)
    expect(insights.climbs).toHaveLength(1)
    expect(insights.climbs![0].length_km).toBe(0.8)
    expect(insights.climbs![0].path).toBeNull()
  })
})

describe('speed-over-distance detection (via extractStreamInsights)', () => {
  // Builds a 15km ride: 5km @ 20km/h, 5km @ 40km/h, 5km @ 20km/h again — so
  // the fastest window for each split is NOT simply "the first N km", proving
  // the detection genuinely finds the fastest contiguous stretch.
  function buildMixedSpeedStreams() {
    const time: number[] = [0]
    const distance: number[] = [0]
    const stepM = 100
    for (let d = stepM; d <= 5000; d += stepM) { distance.push(d); time.push(time[time.length - 1] + 18) }
    for (let d = 5000 + stepM; d <= 10000; d += stepM) { distance.push(d); time.push(time[time.length - 1] + 9) }
    for (let d = 10000 + stepM; d <= 15000; d += stepM) { distance.push(d); time.push(time[time.length - 1] + 18) }
    const power = distance.map(() => 200)
    return { time, distance, latlng: null, power, hr: null, altitude: null, cadence: null, velocity: null }
  }

  it('finds the fastest 1km, 5km, and 10km windows, correctly favouring the faster section over the first N km', () => {
    const s = buildMixedSpeedStreams()
    const insights = extractStreamInsights(s, 250, null, null)
    expect(insights.speed_bests).toEqual([
      { distance_km: 1, avg_speed_kmh: 40, start_km: 5, duration_secs: 90 },
      { distance_km: 5, avg_speed_kmh: 40, start_km: 5, duration_secs: 450 },
      { distance_km: 10, avg_speed_kmh: 26.7, start_km: 0, duration_secs: 1350 },
    ])
  })

  it('skips a split the ride is too short to cover (20km split on a 15km ride)', () => {
    const s = buildMixedSpeedStreams()
    const insights = extractStreamInsights(s, 250, null, null)
    expect(insights.speed_bests!.find(sb => sb.distance_km === 20)).toBeUndefined()
  })

  it('returns null when the ride is shorter than the smallest split (1km)', () => {
    const s = { time: [0, 30, 60], distance: [0, 250, 500], latlng: null, power: [200, 200, 200], hr: null, altitude: null, cadence: null, velocity: null }
    const insights = extractStreamInsights(s, 250, null, null)
    expect(insights.speed_bests).toBeNull()
  })
})
```

Update the existing test in the `describe('extractActivityMetrics', ...)` block (currently):
```typescript
  it('bumps METRICS_VERSION to 4', () => {
    expect(METRICS_VERSION).toBe(4)
  })
```
to:
```typescript
  it('bumps METRICS_VERSION to 5', () => {
    expect(METRICS_VERSION).toBe(5)
  })
```

Also add this new test to the same describe block, right after it, reusing the `act`/`curve`/`intervals` fixtures already defined at the top of the file (used by every other test in this describe block, e.g. the `'extracts 5s and 15s sprint entries'` test just below):
```typescript
  it('sets speed_bests to null in the base extraction (filled later by extractStreamInsights)', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.speed_bests).toBeNull()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/activity-metrics.test.ts`
Expected: the new climb tests FAIL with a TypeScript error (`length_km`/`path` don't exist on `ClimbSegment`) or `undefined` where a value is expected. The speed-over-distance tests FAIL because `insights.speed_bests` is `undefined` (the field doesn't exist on the return type yet). The `METRICS_VERSION` test FAILS (currently 4, expecting 5).

- [ ] **Step 3: Implement**

In `types/index.ts`, update `ClimbSegment` (currently):
```typescript
export interface ClimbSegment {
  start_km: number
  duration_secs: number
  elev_gain_m: number
  avg_watts: number | null
  vam: number            // vertical ascent metres / hour
}
```
to:
```typescript
export interface ClimbSegment {
  start_km: number
  duration_secs: number
  elev_gain_m: number
  avg_watts: number | null
  vam: number            // vertical ascent metres / hour
  length_km: number      // climb's actual distance covered
  path: [number, number][] | null   // simplified polyline (max 12 points), null for indoor/no-GPS rides
}
```

Add a new `SpeedBest` interface right after `PersonalBest`:
```typescript
export interface SpeedBest {
  distance_km: number      // 1, 5, 10, or 20
  avg_speed_kmh: number
  start_km: number         // where along the ride this split began
  duration_secs: number
}
```

Add `speed_bests` to `ActivityMetrics`, right after the existing `sprints` field:
```typescript
  sprints: RideSprint[] | null             // 5s/15s best-effort power, no location data
  speed_bests: SpeedBest[] | null          // fastest-over-distance splits (1/5/10/20km)
  personal_bests: PersonalBest[] | null    // 90-day rolling PBs, anchored on this ride's date
```

**This is a new required field on `ActivityMetrics` — update the shared test factory too, or every test using it fails to typecheck.** `__tests__/support/factories.ts`'s `makeActivityMetrics()` builds a full `ActivityMetrics` object literal and is imported by two other test files (`__tests__/lib/activity-metrics.test.ts`, `__tests__/components/WorkoutDetailModal.test.tsx`) — both would fail to compile once `speed_bests` becomes required, since the literal would be missing a field. Add it to the factory's returned object, right after the existing `sprints: null,` line:
```typescript
    sprints: null,
    speed_bests: null,
    personal_bests: null,
```

In `lib/claude/activity-metrics.ts`:

Add an import for `downsamplePoints` and the `SpeedBest` type, alongside the existing type imports at the top:
```typescript
import type { ICUActivity, ICUPowerCurvePoint, ActivityInterval, ActivityMetrics, WorkoutStep, RideStreams, ClimbSegment, DistributionBin, SessionDistributions, EffortPeriod, RideSprint, PersonalBest, SpeedBest } from '@/types'
import { alignPlannedToLaps } from '@/lib/ride/planned-actual'
import { downsamplePoints } from '@/lib/intervals/streams'
```

Bump the version constant:
```typescript
export const METRICS_VERSION = 5
```

Add two new constants near `CANONICAL_SECS`:
```typescript
const CLIMB_PATH_MAX_POINTS = 12
const SPEED_SPLIT_KM = [1, 5, 10, 20]
```

Add `speed_bests: null,   // filled by extractStreamInsights (all-time bests)` to `extractActivityMetrics`'s returned object literal, right after the existing `sprints: extractSprints(best),` line:
```typescript
    sprints: extractSprints(best),
    speed_bests: null,   // filled by extractStreamInsights (all-time bests)
    personal_bests: null,   // filled by enrichActivity after a 90-day curve fetch (Task 5)
```

Update `detectClimbs`'s signature and body (currently):
```typescript
function detectClimbs(
  altitude: number[] | null, distance: number[] | null,
  power: number[] | null, time: number[],
): ClimbSegment[] | null {
  if (!altitude || !distance || altitude.length < 2) return null
  const MIN_GRADE = 0.03, MIN_GAIN = 30, MIN_SECS = 180, WINDOW_M = 200
  // Known approximation: the final sample has no forward window (dd=0) so it
  // classifies as non-climbing. A climb finishing exactly at ride end is therefore
  // undercounted by one sample — negligible at real (≈1 Hz) sampling rates.
  const climbing = altitude.map((_, i) => {
    let j = i
    while (j < distance.length - 1 && distance[j] - distance[i] < WINDOW_M) j++
    const dd = distance[j] - distance[i]
    if (dd <= 0) return false
    return (altitude[j] - altitude[i]) / dd >= MIN_GRADE
  })
  const out: ClimbSegment[] = []
  let start = -1
  for (let i = 0; i <= climbing.length; i++) {
    if (i < climbing.length && climbing[i]) {
      if (start === -1) start = i
    } else if (start !== -1) {
      const end = i - 1
      const duration_secs = time[end] - time[start]
      const elev_gain_m = altitude[end] - altitude[start]
      if (duration_secs >= MIN_SECS && elev_gain_m >= MIN_GAIN) {
        let ps = 0, pn = 0
        if (power) for (let k = start; k <= end; k++) if (Number.isFinite(power[k])) { ps += power[k]; pn++ }
        out.push({
          start_km: Math.round((distance[start] / 1000) * 10) / 10,
          duration_secs,
          elev_gain_m: Math.round(elev_gain_m),
          avg_watts: pn ? Math.round(ps / pn) : null,
          vam: Math.round(elev_gain_m / (duration_secs / 3600)),
        })
      }
      start = -1
    }
  }
  return out.length ? out : null
}
```
with:
```typescript
function detectClimbs(
  altitude: number[] | null, distance: number[] | null,
  power: number[] | null, time: number[], latlng: [number, number][] | null,
): ClimbSegment[] | null {
  if (!altitude || !distance || altitude.length < 2) return null
  const MIN_GRADE = 0.03, MIN_GAIN = 30, MIN_SECS = 180, WINDOW_M = 200
  // Known approximation: the final sample has no forward window (dd=0) so it
  // classifies as non-climbing. A climb finishing exactly at ride end is therefore
  // undercounted by one sample — negligible at real (≈1 Hz) sampling rates.
  const climbing = altitude.map((_, i) => {
    let j = i
    while (j < distance.length - 1 && distance[j] - distance[i] < WINDOW_M) j++
    const dd = distance[j] - distance[i]
    if (dd <= 0) return false
    return (altitude[j] - altitude[i]) / dd >= MIN_GRADE
  })
  const out: ClimbSegment[] = []
  let start = -1
  for (let i = 0; i <= climbing.length; i++) {
    if (i < climbing.length && climbing[i]) {
      if (start === -1) start = i
    } else if (start !== -1) {
      const end = i - 1
      const duration_secs = time[end] - time[start]
      const elev_gain_m = altitude[end] - altitude[start]
      if (duration_secs >= MIN_SECS && elev_gain_m >= MIN_GAIN) {
        let ps = 0, pn = 0
        if (power) for (let k = start; k <= end; k++) if (Number.isFinite(power[k])) { ps += power[k]; pn++ }
        out.push({
          start_km: Math.round((distance[start] / 1000) * 10) / 10,
          duration_secs,
          elev_gain_m: Math.round(elev_gain_m),
          avg_watts: pn ? Math.round(ps / pn) : null,
          vam: Math.round(elev_gain_m / (duration_secs / 3600)),
          length_km: Math.round(((distance[end] - distance[start]) / 1000) * 10) / 10,
          path: latlng ? downsamplePoints(latlng.slice(start, end + 1), CLIMB_PATH_MAX_POINTS) : null,
        })
      }
      start = -1
    }
  }
  return out.length ? out : null
}
```

Add a new `detectSpeedBests` function, right after `detectClimbs`:
```typescript
// For each target split distance, finds the fastest (minimum-duration) contiguous
// stretch of the ride covering exactly that distance — a two-pointer sweep over the
// monotonic distance/time streams, mirroring detectClimbs' forward-window technique.
// A split is skipped entirely when the ride's total distance doesn't reach it.
function detectSpeedBests(distance: number[], time: number[]): SpeedBest[] | null {
  if (distance.length < 2) return null
  const totalKm = distance[distance.length - 1] / 1000
  const out: SpeedBest[] = []
  for (const targetKm of SPEED_SPLIT_KM) {
    if (totalKm < targetKm) continue
    const targetM = targetKm * 1000
    let bestDuration = Infinity
    let bestStart = -1
    let j = 0
    for (let i = 0; i < distance.length; i++) {
      if (j < i) j = i
      while (j < distance.length && distance[j] - distance[i] < targetM) j++
      if (j >= distance.length) break
      const duration = time[j] - time[i]
      if (duration < bestDuration) { bestDuration = duration; bestStart = i }
    }
    if (bestStart !== -1 && Number.isFinite(bestDuration) && bestDuration > 0) {
      out.push({
        distance_km: targetKm,
        avg_speed_kmh: Math.round((targetKm / (bestDuration / 3600)) * 10) / 10,
        start_km: Math.round((distance[bestStart] / 1000) * 10) / 10,
        duration_secs: bestDuration,
      })
    }
  }
  return out.length ? out : null
}
```

Update `extractStreamInsights` (currently):
```typescript
export function extractStreamInsights(
  s: RideStreams, ftp: number | null, plannedSteps: WorkoutStep[] | null,
  laps: ActivityInterval[] | null = null,
): Pick<ActivityMetrics, 'decoupling_pct' | 'climbs' | 'time_in_zone' | 'shape' | 'effort_periods'> {
  return {
    decoupling_pct: computeDecoupling(s.power, s.hr, s.time),
    time_in_zone: computeTimeInZone(s.power, s.time, ftp),
    climbs: detectClimbs(s.altitude, s.distance, s.power, s.time),
    shape: computeShape(plannedSteps, laps, s.power, s.time, ftp),
    effort_periods: detectEffortPeriods(s.power, s.distance, s.time, ftp),
  }
}
```
with:
```typescript
export function extractStreamInsights(
  s: RideStreams, ftp: number | null, plannedSteps: WorkoutStep[] | null,
  laps: ActivityInterval[] | null = null,
): Pick<ActivityMetrics, 'decoupling_pct' | 'climbs' | 'time_in_zone' | 'shape' | 'effort_periods' | 'speed_bests'> {
  return {
    decoupling_pct: computeDecoupling(s.power, s.hr, s.time),
    time_in_zone: computeTimeInZone(s.power, s.time, ftp),
    climbs: detectClimbs(s.altitude, s.distance, s.power, s.time, s.latlng),
    shape: computeShape(plannedSteps, laps, s.power, s.time, ftp),
    effort_periods: detectEffortPeriods(s.power, s.distance, s.time, ftp),
    speed_bests: detectSpeedBests(s.distance, s.time),
  }
}
```

- [ ] **Step 3a: Fix pre-existing fixtures broken by the two new required `ClimbSegment` fields**

Adding required fields to a shared type breaks every existing test fixture built as a full, explicitly-typed `ClimbSegment` (or `RideHighlight`/`ActivityMetrics` literal containing one) elsewhere in the suite — TypeScript now demands `length_km`/`path` on all of them. This was verified empirically (by temporarily applying the `ClimbSegment` type change alone and running `npm run typecheck` to get the real compiler error list) rather than guessed — five additional files need a small fixture fix, none of which test climb length/path themselves, so the exact `length_km`/`path` values added don't need to be meaningful:

In `__tests__/components/RideHighlightsTab.test.tsx`, update the climb entry (currently):
```typescript
  { kind: 'climb', start_km: 10, data: { start_km: 10, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 } },
```
to:
```typescript
  { kind: 'climb', start_km: 10, data: { start_km: 10, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675, length_km: 3.2, path: null } },
```

In `__tests__/components/RideMapGraph.test.tsx`, update all three climb entries (currently):
```typescript
const highlights: RideHighlight[] = [
  { kind: 'climb', start_km: 2.5, data: { start_km: 2.5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 } },
]

const twoClimbs: RideHighlight[] = [
  { kind: 'climb', start_km: 0, data: { start_km: 0, duration_secs: 60, elev_gain_m: 40, avg_watts: 200, vam: 500 } },
  { kind: 'climb', start_km: 5, data: { start_km: 5, duration_secs: 60, elev_gain_m: 50, avg_watts: 220, vam: 550 } },
]
```
to:
```typescript
const highlights: RideHighlight[] = [
  { kind: 'climb', start_km: 2.5, data: { start_km: 2.5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675, length_km: 3.2, path: null } },
]

const twoClimbs: RideHighlight[] = [
  { kind: 'climb', start_km: 0, data: { start_km: 0, duration_secs: 60, elev_gain_m: 40, avg_watts: 200, vam: 500, length_km: 1.1, path: null } },
  { kind: 'climb', start_km: 5, data: { start_km: 5, duration_secs: 60, elev_gain_m: 50, avg_watts: 220, vam: 550, length_km: 1.4, path: null } },
]
```

In `__tests__/components/WorkoutDetailModal.test.tsx`, update both occurrences (currently, appearing twice at two different tests):
```typescript
        climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
```
to (both occurrences):
```typescript
        climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675, length_km: 3.2, path: null }],
```

In `__tests__/lib/ride-highlights.test.ts`, update the `climb` fixture (currently):
```typescript
const climb: ClimbSegment = { start_km: 10, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }
```
to:
```typescript
const climb: ClimbSegment = { start_km: 10, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675, length_km: 3.2, path: null }
```

In `__tests__/components/RideStats.test.tsx`, the `metrics: ActivityMetrics` fixture is missing the new top-level `speed_bests` field (currently):
```typescript
const metrics: ActivityMetrics = {
  np: 210, avg_power: 200, max_power: 350, avg_hr: 145, distance_m: 30000, elevation_m: 320,
  lr_balance: 52, best_efforts: [{ secs: 60, watts: 380 }, { secs: 300, watts: 320 }, { secs: 1200, watts: 280 }],
  intervals: null, decoupling_pct: null, climbs: null, time_in_zone: null, shape: null, distributions: null,
  effort_periods: null, sprints: null, personal_bests: null, synced_at: '',
}
```
to:
```typescript
const metrics: ActivityMetrics = {
  np: 210, avg_power: 200, max_power: 350, avg_hr: 145, distance_m: 30000, elevation_m: 320,
  lr_balance: 52, best_efforts: [{ secs: 60, watts: 380 }, { secs: 300, watts: 320 }, { secs: 1200, watts: 280 }],
  intervals: null, decoupling_pct: null, climbs: null, time_in_zone: null, shape: null, distributions: null,
  effort_periods: null, sprints: null, speed_bests: null, personal_bests: null, synced_at: '',
}
```

In `__tests__/lib/activity-metrics.test.ts` itself, the `m: AM` fixture in the `describe('insight formatting', ...)` block (currently) is missing both the climb's new fields AND the new top-level `speed_bests` field:
```typescript
  const m: AM = {
    np: 240, avg_power: 230, max_power: 600, avg_hr: 150, distance_m: 40000,
    elevation_m: 500, lr_balance: 50, best_efforts: null, intervals: null,
    decoupling_pct: 6.2,
    time_in_zone: { z1: 0, z2: 6800, z3: 2200, z4: 800, z5: 0, z6: 0 },
    climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
    shape: [{ label: 'Work', planned_w: 250, actual_w: 238 }],
    distributions: null,
    effort_periods: null,
    sprints: null,
    personal_bests: null,
    synced_at: '2026-05-31T00:00:00Z',
  }
```
to:
```typescript
  const m: AM = {
    np: 240, avg_power: 230, max_power: 600, avg_hr: 150, distance_m: 40000,
    elevation_m: 500, lr_balance: 50, best_efforts: null, intervals: null,
    decoupling_pct: 6.2,
    time_in_zone: { z1: 0, z2: 6800, z3: 2200, z4: 800, z5: 0, z6: 0 },
    climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675, length_km: 3.2, path: null }],
    shape: [{ label: 'Work', planned_w: 250, actual_w: 238 }],
    distributions: null,
    effort_periods: null,
    sprints: null,
    speed_bests: null,
    personal_bests: null,
    synced_at: '2026-05-31T00:00:00Z',
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/activity-metrics.test.ts __tests__/components/RideHighlightsTab.test.tsx __tests__/components/RideMapGraph.test.tsx __tests__/components/RideStats.test.tsx __tests__/components/WorkoutDetailModal.test.tsx __tests__/lib/ride-highlights.test.ts`
Expected: PASS.

Then run the full suite and typecheck. This step has already been dry-run end-to-end during planning (every fixture fix above was applied to a scratch copy of the repo and `npm run typecheck` was confirmed to return zero errors before being reverted) — this run should be a clean confirmation, not a discovery step:

Run: `npm run test:ci`
Expected: all suites pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add types/index.ts lib/claude/activity-metrics.ts __tests__/support/factories.ts __tests__/lib/activity-metrics.test.ts __tests__/components/RideHighlightsTab.test.tsx __tests__/components/RideMapGraph.test.tsx __tests__/components/RideStats.test.tsx __tests__/components/WorkoutDetailModal.test.tsx __tests__/lib/ride-highlights.test.ts
git commit -m "feat: detect climb length/path and speed-over-distance bests at sync time"
```

---

### Task 3: Aggregation layer

**Files:**
- Create: `lib/ride/all-time-bests.ts`
- Test: `__tests__/lib/all-time-bests.test.ts`

**Interfaces:**
- Consumes: `ActivityMetrics`, `ClimbSegment`, `SpeedBest` from `@/types` (Task 2).
- Produces: `AllTimeBests`, `AllTimeBestsResponse` interfaces; `computeAllTimeBests()`, `computeAllTimeBestsByPeriod()`. Task 4 consumes both functions and both types.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/all-time-bests.test.ts` with this exact content:

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

function ride(id: string, date: string, metrics: ActivityMetrics | null) {
  return { id, date, activity_metrics: metrics }
}

describe('computeAllTimeBests', () => {
  it('finds the biggest climb by elev_gain_m across rides', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400, length_km: 5 })] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900, length_km: 3 })] })),
      ride('w3', '2026-03-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 600, length_km: 4 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb).toEqual({ workoutId: 'w2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 })
  })

  it('finds the longest climb by length_km across rides, independent of elevation', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900, length_km: 3 })] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400, length_km: 12.5 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.longestClimb).toEqual({ workoutId: 'w2', date: '2026-02-01', length_km: 12.5, elev_gain_m: 400 })
  })

  it('finds the max watts per duration across rides, keeping durations independent', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 280 }, { secs: 1200, watts: 210 }] })),
      ride('w2', '2026-02-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 310 }] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.powerBests).toEqual([
      { secs: 300, watts: 310, workoutId: 'w2', date: '2026-02-01' },
      { secs: 1200, watts: 210, workoutId: 'w1', date: '2026-01-01' },
    ])
  })

  it('finds the fastest speed per distance split across rides', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ speed_bests: [makeSpeedBest({ distance_km: 1, avg_speed_kmh: 35 })] })),
      ride('w2', '2026-02-01', makeMetrics({ speed_bests: [makeSpeedBest({ distance_km: 1, avg_speed_kmh: 42 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.speedBests).toEqual([
      { distance_km: 1, avg_speed_kmh: 42, workoutId: 'w2', date: '2026-02-01' },
    ])
  })

  it('finds the all-time max speed from max_speed_ms, converted to km/h', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ max_speed_ms: 15 })),   // 54 km/h
      ride('w2', '2026-02-01', makeMetrics({ max_speed_ms: 19 })),   // 68.4 km/h
    ]
    const result = computeAllTimeBests(rides)
    expect(result.maxSpeed).toEqual({ workoutId: 'w2', date: '2026-02-01', speed_kmh: 68.4 })
  })

  it('skips rides with null activity_metrics without throwing', () => {
    const rides = [
      ride('w1', '2026-01-01', null),
      ride('w2', '2026-02-01', makeMetrics({ max_speed_ms: 15 })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.maxSpeed).toEqual({ workoutId: 'w2', date: '2026-02-01', speed_kmh: 54 })
  })

  it('returns all-null/empty when no rides have any qualifying data', () => {
    const result = computeAllTimeBests([ride('w1', '2026-01-01', makeMetrics())])
    expect(result).toEqual({
      biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null,
    })
  })
})

describe('computeAllTimeBestsByPeriod', () => {
  it('groups rides by year and computes bests both all-time and per-year', () => {
    const rides = [
      ride('w1', '2025-06-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400 })] })),
      ride('w2', '2026-03-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900 })] })),
      ride('w3', '2026-08-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 300 })] })),
    ]
    const result = computeAllTimeBestsByPeriod(rides)
    expect(result.allTime.biggestClimb?.elev_gain_m).toBe(900)
    expect(result.byYear['2025'].biggestClimb?.elev_gain_m).toBe(400)
    expect(result.byYear['2026'].biggestClimb?.elev_gain_m).toBe(900)
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
      biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null,
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/all-time-bests.test.ts`
Expected: FAIL — the module `lib/ride/all-time-bests.ts` doesn't exist yet ("Cannot find module").

- [ ] **Step 3: Implement**

Create `lib/ride/all-time-bests.ts`:

```typescript
import type { ActivityMetrics } from '@/types'

export interface AllTimeBests {
  biggestClimb: { workoutId: string; date: string; elev_gain_m: number; length_km: number } | null
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

// A single pass over the given rides, tracking running maxima per category and
// remembering which ride each came from. Stays generic over whatever subset of
// rides it's given — the caller decides "all-time" vs. "just this year" by
// choosing which rides to pass in.
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
        biggestClimb = { workoutId: r.id, date: r.date, elev_gain_m: climb.elev_gain_m, length_km: climb.length_km }
      }
      if (!longestClimb || climb.length_km > longestClimb.length_km) {
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/all-time-bests.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ride/all-time-bests.ts __tests__/lib/all-time-bests.test.ts
git commit -m "feat: add all-time and per-year bests aggregation"
```

---

### Task 4: `/api/bests` route

**Files:**
- Create: `app/api/bests/route.ts`
- Test: `__tests__/api/bests.test.ts`

**Interfaces:**
- Consumes: `computeAllTimeBestsByPeriod()` from `@/lib/ride/all-time-bests` (Task 3).
- Produces: `GET /api/bests` returning `AllTimeBestsResponse` JSON. Task 5 consumes this endpoint.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/api/bests.test.ts` with this exact content:

```typescript
/** @jest-environment node */
import { GET } from '@/app/api/bests/route'

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

function supabaseStub(rows: unknown[] | null, userId: string | null = 'u1') {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            not: async () => ({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  }
}

describe('GET /api/bests', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([], null))
    const res = await GET()
    expect(res.status).toBe(401)
  })

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

  it('returns empty bests when the user has no completed rides with metrics', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([]))
    const res = await GET()
    const body = await res.json()
    expect(body.allTime).toEqual({ biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null })
    expect(body.byYear).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/api/bests.test.ts`
Expected: FAIL — `app/api/bests/route.ts` doesn't exist yet ("Cannot find module").

- [ ] **Step 3: Implement**

Create `app/api/bests/route.ts`:

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
    .select('id, date, activity_metrics')
    .eq('user_id', user.id)
    .in('status', ['completed', 'needs_review'])
    .not('activity_metrics', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rides = (rows ?? []) as BestsRide[]
  return NextResponse.json(computeAllTimeBestsByPeriod(rides))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/bests.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/bests/route.ts __tests__/api/bests.test.ts
git commit -m "feat: add /api/bests route"
```

---

### Task 5: "Bests" tab on the Stats page

**Files:**
- Create: `components/AllTimeBestsTab.tsx`
- Modify: `app/stats/page.tsx`
- Test: `__tests__/components/AllTimeBestsTab.test.tsx` (new)
- Test: `__tests__/app/stats/page.test.tsx` (add one test)

**Interfaces:**
- Consumes: `GET /api/bests` (Task 4), `AllTimeBests`/`AllTimeBestsResponse` types (Task 3), `SectionCard` from `components/RideStats.tsx` (existing).
- Produces: no new exports consumed elsewhere — this is the final, UI-facing task.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/AllTimeBestsTab.test.tsx` with this exact content:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import AllTimeBestsTab from '@/components/AllTimeBestsTab'
import type { AllTimeBestsResponse } from '@/lib/ride/all-time-bests'

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

global.fetch = jest.fn()

describe('AllTimeBestsTab', () => {
  afterEach(() => jest.clearAllMocks())

  it('shows a loading state while fetching', () => {
    ;(global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}))
    render(<AllTimeBestsTab />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders all-time bests by default', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeResponse() })
    render(<AllTimeBestsTab />)
    expect(await screen.findByText('620')).toBeInTheDocument()   // biggest climb elevation
    expect(screen.getByText(/8\.4km/)).toBeInTheDocument()        // biggest climb caption
    expect(screen.getByText('12.1')).toBeInTheDocument()          // longest climb length
    expect(screen.getByText('312')).toBeInTheDocument()           // power best watts
    expect(screen.getByText('38.4')).toBeInTheDocument()          // speed best
    expect(screen.getByText('68.2')).toBeInTheDocument()          // max speed
  })

  it('renders an All-time chip plus one chip per byYear entry, most recent year first', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeResponse() })
    render(<AllTimeBestsTab />)
    await screen.findByText('620')
    const chips = screen.getAllByRole('button').map(b => b.textContent)
    expect(chips).toEqual(['All-time', '2026', '2025'])
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

  it('hides sections with no data for the selected period and shows an empty message when all are absent', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => makeResponse({
        allTime: { biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null },
        byYear: {},
      }),
    })
    render(<AllTimeBestsTab />)
    expect(await screen.findByText('No ride data yet for this period.')).toBeInTheDocument()
    expect(screen.queryByText('Biggest Climb')).not.toBeInTheDocument()
  })
})
```

Add this test to `__tests__/app/stats/page.test.tsx`, in the "New tab tests" section at the bottom:

```typescript
  it('shows "Bests" tab and renders bests when clicked', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (String(url).includes('/api/stats/year')) {
        return Promise.resolve({ ok: true, json: async () => minimalYearStats })
      }
      if (String(url).includes('/api/bests')) {
        return Promise.resolve({ ok: true, json: async () => ({
          allTime: {
            biggestClimb: { workoutId: 'w1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 },
            longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null,
          },
          byYear: {},
        }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ stats: mockStats }) })
    })
    render(<StatsPage />)
    await screen.findByText('99')
    fireEvent.click(screen.getByRole('tab', { name: 'Bests' }))
    expect(await screen.findByText('620')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/components/AllTimeBestsTab.test.tsx __tests__/app/stats/page.test.tsx`
Expected: `AllTimeBestsTab.test.tsx` FAILS — the component doesn't exist yet ("Cannot find module"). The new stats-page test FAILS — there's no "Bests" tab yet (`getByRole('tab', { name: 'Bests' })` throws).

- [ ] **Step 3: Implement**

Create `components/AllTimeBestsTab.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { SectionCard } from '@/components/RideStats'
import type { AllTimeBests, AllTimeBestsResponse } from '@/lib/ride/all-time-bests'

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

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
              caption={`${bests.biggestClimb.length_km}km · ${formatDate(bests.biggestClimb.date)}`}
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
    </div>
  )
}

export default function AllTimeBestsTab() {
  const [data, setData] = useState<AllTimeBestsResponse | null>(null)
  const [loading, setLoading] = useState(true)
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

  const years = Object.keys(data.byYear).sort((a, b) => b.localeCompare(a))
  const current = selectedPeriod === 'all' ? data.allTime : data.byYear[selectedPeriod]

  return (
    <div className="space-y-4">
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

In `app/stats/page.tsx`:

Add the import, alongside the other component imports near the top:
```typescript
import AllTimeBestsTab from '@/components/AllTimeBestsTab'
```

Update the `TabId` type and `tabs` array (currently):
```typescript
  type TabId = 'year' | 'log' | '28d' | number
  const tabs: { id: TabId; label: string }[] = [
    { id: 'year', label: 'This Year' },
    { id: 'log', label: 'Activity Log' },
    { id: '28d', label: '28 Days' },
    ...rides.map((r, i) => ({ id: i as TabId, label: formatRideTabLabel(r.start_date_local) })),
  ]
```
to:
```typescript
  type TabId = 'year' | 'log' | '28d' | 'bests' | number
  const tabs: { id: TabId; label: string }[] = [
    { id: 'year', label: 'This Year' },
    { id: 'log', label: 'Activity Log' },
    { id: '28d', label: '28 Days' },
    { id: 'bests', label: 'Bests' },
    ...rides.map((r, i) => ({ id: i as TabId, label: formatRideTabLabel(r.start_date_local) })),
  ]
```

Update the `subtitle` ternary (currently):
```typescript
  const subtitle = activeTab === 'year'
    ? 'All activities this year'
    : activeTab === 'log'
    ? 'All activities'
    : activeTab === '28d'
    ? `Last 28 days · ${stats.ride_count} ride${stats.ride_count !== 1 ? 's' : ''}`
    : formatRideTabLabel((stats.recent_rides ?? [])[activeTab as number]?.start_date_local ?? '')
```
to:
```typescript
  const subtitle = activeTab === 'year'
    ? 'All activities this year'
    : activeTab === 'log'
    ? 'All activities'
    : activeTab === '28d'
    ? `Last 28 days · ${stats.ride_count} ride${stats.ride_count !== 1 ? 's' : ''}`
    : activeTab === 'bests'
    ? 'All-time and yearly bests'
    : formatRideTabLabel((stats.recent_rides ?? [])[activeTab as number]?.start_date_local ?? '')
```

Update the render ternary (currently):
```typescript
      {activeTab === 'year' ? (
        <YearView />
      ) : activeTab === 'log' ? (
        <ActivityLogView />
      ) : activeTab === '28d' ? (
        <>
          <AggregateView stats={stats} />
          <CrossTrainingSummary groups={stats.cross_training} />
        </>
      ) : (
```
to:
```typescript
      {activeTab === 'year' ? (
        <YearView />
      ) : activeTab === 'log' ? (
        <ActivityLogView />
      ) : activeTab === '28d' ? (
        <>
          <AggregateView stats={stats} />
          <CrossTrainingSummary groups={stats.cross_training} />
        </>
      ) : activeTab === 'bests' ? (
        <AllTimeBestsTab />
      ) : (
```

No other lines in `app/stats/page.tsx` change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/components/AllTimeBestsTab.test.tsx __tests__/app/stats/page.test.tsx`
Expected: all PASS.

Then run the full suite and typecheck:

Run: `npm run test:ci`
Expected: all suites pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add components/AllTimeBestsTab.tsx app/stats/page.tsx __tests__/components/AllTimeBestsTab.test.tsx __tests__/app/stats/page.test.tsx
git commit -m "feat: add Bests tab to the Stats page"
```

---

## Backfill (manual step after merge)

Once this branch is merged and deployed, the two new per-ride fields (`length_km`/`path` on climbs, `speed_bests`) will only be populated for *newly synced* rides until the historical backfill runs. Trigger it once by hitting `/api/sync?deep=1` (the existing generic backfill sweep, gated on `metrics_version < METRICS_VERSION`, already used for every prior metrics addition). It processes up to 25 rides per invocation (`BACKFILL_LIMIT` in `lib/intervals/enrich.ts`) — if there's a large backlog of historical rides, hit the endpoint again to process the next batch, same as any previous version bump.
