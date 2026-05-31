# Ride Map + Synced Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen completed-ride view (Leaflet route map on top, custom SVG scrubbable graph below, cursor-linked) and persist four stream-derived coaching insights (decoupling, climbs, time-in-zone, planned-vs-actual) into `activity_metrics` at sync.

**Architecture:** Two consumers of intervals.icu activity *streams*. The **coach** gets tiny derived summaries computed once at sync (same self-healing backfill that already populates `activity_metrics`); the **visual view** fetches raw streams on demand via a new API route, downsampled server-side. Pure functions (insights, normalisation, graph math) are isolated and unit-tested; Leaflet rendering is verified by build.

**Tech Stack:** Next.js 16 (App Router, `params: Promise<>`), React 19, TypeScript, Supabase (RLS), Anthropic SDK, intervals.icu REST API, Leaflet + OpenStreetMap, Jest (SWC).

Spec: `docs/superpowers/specs/2026-05-31-ride-map-graph-design.md`.

---

## ⚠️ Pre-flight verification (do this before Task 3)

The streams endpoint path/shape is the one external unknown. Before building Task 3, confirm against the live intervals.icu API (the human running the plan has credentials; a subagent should flag this as a checkpoint if it cannot run it):

```bash
# Replace ATHLETE_ID + API_KEY. The endpoint is documented as the per-activity streams resource.
curl -s -u "API_KEY:<your_key>" \
  "https://intervals.icu/api/v1/activity/<activity_id>/streams?types=time,latlng,watts,heartrate,altitude,distance,cadence,velocity_smooth" \
  | head -c 800
```

Expected: a JSON **array** of channel objects, each `{ "type": "watts", "data": [..] }`, with `latlng` data as `[[lat,lng], ...]`. `normaliseStreams` (Task 3) is written defensively for exactly this shape. **If the real shape differs, adjust `normaliseStreams` and its test in Task 3 — do not change any other task.** Everything downstream depends only on the normalised `RideStreams`, not the raw response.

---

## File structure

**Coach side (data + insights):**
- `types/index.ts` — extend `ActivityMetrics`; add `RideStreams`, `ClimbSegment` (Task 1)
- `lib/claude/activity-metrics.ts` — `extractStreamInsights` + sub-functions; formatter extensions (Tasks 1, 2)
- `lib/intervals/streams.ts` *(new)* — `normaliseStreams`, `downsampleStreams` (Task 3)
- `lib/intervals/client.ts` — `getActivityStreams` (Task 3)
- `lib/intervals/enrich.ts` — thread `ftp` + `plannedSteps` + streams (Task 4)
- `app/api/feedback/route.ts`, `app/api/briefing/today/route.ts` — append `formatRideShape` (Task 5)

**Visual side:**
- `app/api/rides/[workoutId]/streams/route.ts` *(new)* — GET streams (Task 6)
- `lib/ride/graph-math.ts` *(new)* — `pointerToIndex`, `seriesToPolyline`, `formatDuration` (Task 7)
- `components/ride/RideGraph.tsx` *(new)* — SVG graph (Task 8)
- `components/ride/RouteMap.tsx` *(new)* — Leaflet map (Task 9)
- `components/ride/RideMapGraph.tsx` *(new)* — parent + readout + toggles (Task 10)
- `app/ride/[workoutId]/page.tsx` *(new)* — full-screen page (Task 10)
- `components/WorkoutDetailModal.tsx` — "View ride map" link (Task 11)
- `package.json` — add `leaflet`, `@types/leaflet` (Task 9)

---

## Task 1: Stream-insight pure functions + types

**Files:**
- Modify: `types/index.ts` (extend `ActivityMetrics` ~line 259; add new interfaces)
- Modify: `lib/claude/activity-metrics.ts`
- Test: `__tests__/lib/stream-insights.test.ts` (create)

- [ ] **Step 1: Add types**

In `types/index.ts`, add the four fields to `interface ActivityMetrics` (after `synced_at` is fine; keep `synced_at` last is not required — just add them inside the interface):

```ts
  // Tier 4 — stream-derived coaching insights (computed at sync from full-resolution streams)
  decoupling_pct: number | null            // aerobic decoupling %, positive = faded
  climbs: ClimbSegment[] | null
  time_in_zone: { z1: number; z2: number; z3: number; z4: number; z5: number; z6: number } | null  // seconds per zone
  shape: Array<{ label: string; planned_w: number; actual_w: number }> | null  // structured rides only
```

Add these interfaces near `ActivityMetrics`:

```ts
export interface ClimbSegment {
  start_km: number
  duration_secs: number
  elev_gain_m: number
  avg_watts: number | null
  vam: number            // vertical ascent metres / hour
}

export interface RideStreams {
  time: number[]                       // seconds from start
  distance: number[]                   // metres
  latlng: [number, number][] | null    // null for indoor rides
  power: number[] | null
  hr: number[] | null
  altitude: number[] | null
  cadence: number[] | null
  velocity: number[] | null            // m/s
}
```

- [ ] **Step 2: Write the failing test**

Create `__tests__/lib/stream-insights.test.ts`:

```ts
/** @jest-environment node */
import { extractStreamInsights } from '@/lib/claude/activity-metrics'
import type { RideStreams, WorkoutStep } from '@/types'

function base(): RideStreams {
  return { time: [], distance: [], latlng: null, power: null, hr: null, altitude: null, cadence: null, velocity: null }
}

describe('extractStreamInsights', () => {
  it('computes positive decoupling when HR drifts up at constant power', () => {
    const time = [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600]
    const power = time.map(() => 200)
    const hr = time.map(t => (t < 300 ? 150 : 165))
    const m = extractStreamInsights({ ...base(), time, power, hr }, 200, null)
    expect(m.decoupling_pct).toBeCloseTo(9.1, 1)
  })

  it('returns null decoupling when HR or power missing', () => {
    const time = [0, 60, 120]
    const m = extractStreamInsights({ ...base(), time, power: [200, 200, 200] }, 200, null)
    expect(m.decoupling_pct).toBeNull()
  })

  it('buckets time into power zones by FTP', () => {
    const time = [0, 60, 120, 180]
    const power = [100, 160, 200, 260] // 50% z1, 80% z3, 100% z4, 130% z6
    const m = extractStreamInsights({ ...base(), time, power }, 200, null)
    expect(m.time_in_zone).toEqual({ z1: 60, z2: 0, z3: 60, z4: 60, z5: 0, z6: 0 })
  })

  it('detects a sustained climb with VAM and avg power', () => {
    const n = 8
    const time = Array.from({ length: n }, (_, i) => 60 * i)
    const distance = Array.from({ length: n }, (_, i) => 100 * i)
    const altitude = Array.from({ length: n }, (_, i) => 10 * i) // 10m per 100m = 10%
    const power = Array.from({ length: n }, () => 250)
    const m = extractStreamInsights({ ...base(), time, distance, altitude, power }, 200, null)
    expect(m.climbs).toEqual([
      { start_km: 0, duration_secs: 360, elev_gain_m: 60, avg_watts: 250, vam: 600 },
    ])
  })

  it('aligns planned steps onto the actual power trace (shape)', () => {
    const time = [0, 30, 60, 90]
    const power = [100, 100, 200, 200]
    const steps: WorkoutStep[] = [
      { label: 'WU', duration_minutes: 1, power_pct_ftp: 50 },
      { label: 'Work', duration_minutes: 1, power_pct_ftp: 100 },
    ]
    const m = extractStreamInsights({ ...base(), time, power }, 200, steps)
    expect(m.shape).toEqual([
      { label: 'WU', planned_w: 100, actual_w: 100 },
      { label: 'Work', planned_w: 200, actual_w: 200 },
    ])
  })

  it('returns null zones/shape when ftp is null', () => {
    const m = extractStreamInsights({ ...base(), time: [0, 60], power: [200, 200] }, null, null)
    expect(m.time_in_zone).toBeNull()
    expect(m.shape).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest stream-insights -i`
Expected: FAIL — `extractStreamInsights` is not exported.

- [ ] **Step 4: Implement**

In `lib/claude/activity-metrics.ts`, update the import line to include the new types:

```ts
import type { ICUActivity, ICUPowerCurvePoint, ActivityInterval, ActivityMetrics, WorkoutStep, RideStreams, ClimbSegment } from '@/types'
```

Update `extractActivityMetrics`'s returned object to include the four new fields as `null` (append inside the returned object, before `synced_at`):

```ts
    best_efforts: best.length ? best : null,
    intervals: intervals?.length ? intervals : null,
    decoupling_pct: null,
    climbs: null,
    time_in_zone: null,
    shape: null,
    synced_at: new Date().toISOString(),
```

Append the insight functions at the end of the file:

```ts
// ── Stream-derived insights ───────────────────────────────────────────────
// Computed from full-resolution streams at sync. All pure and deterministic.
// Zone boundaries match CLAUDE.md: Z1<55, Z2 56–75, Z3 76–90, Z4 91–105,
// Z5 106–120, Z6 >120 (% FTP). Zones/shape need FTP — null when ftp is null.

type ZoneKey = 'z1' | 'z2' | 'z3' | 'z4' | 'z5' | 'z6'

function zoneOf(pct: number): ZoneKey {
  if (pct < 0.55) return 'z1'
  if (pct <= 0.75) return 'z2'
  if (pct <= 0.90) return 'z3'
  if (pct <= 1.05) return 'z4'
  if (pct <= 1.20) return 'z5'
  return 'z6'
}

function avgRatio(power: number[], hr: number[], lo: number, hi: number): number | null {
  let ps = 0, hs = 0, n = 0
  for (let i = lo; i < hi; i++) {
    const p = power[i], h = hr[i]
    if (Number.isFinite(p) && Number.isFinite(h) && h > 0) { ps += p; hs += h; n++ }
  }
  if (n === 0) return null
  return (ps / n) / (hs / n)
}

function computeDecoupling(power: number[] | null, hr: number[] | null, time: number[]): number | null {
  if (!power || !hr || time.length < 4) return null
  const mid = time[0] + (time[time.length - 1] - time[0]) / 2
  let split = time.findIndex(t => t >= mid)
  if (split <= 0 || split >= time.length) return null
  const first = avgRatio(power, hr, 0, split)
  const second = avgRatio(power, hr, split, time.length)
  if (first === null || second === null || first === 0) return null
  return Math.round(((first - second) / first) * 1000) / 10
}

function computeTimeInZone(
  power: number[] | null, time: number[], ftp: number | null,
): ActivityMetrics['time_in_zone'] {
  if (!power || !ftp) return null
  const z = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, z6: 0 }
  for (let i = 0; i < power.length - 1; i++) {
    const dt = time[i + 1] - time[i]
    if (dt <= 0 || !Number.isFinite(power[i])) continue
    z[zoneOf(power[i] / ftp)] += dt
  }
  return z
}

function detectClimbs(
  altitude: number[] | null, distance: number[] | null,
  power: number[] | null, time: number[],
): ClimbSegment[] | null {
  if (!altitude || !distance || altitude.length < 2) return null
  const MIN_GRADE = 0.03, MIN_GAIN = 30, MIN_SECS = 180, WINDOW_M = 200
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

function computeShape(
  plannedSteps: WorkoutStep[] | null, power: number[] | null, time: number[], ftp: number | null,
): ActivityMetrics['shape'] {
  if (!plannedSteps?.length || !power || !ftp) return null
  const out: NonNullable<ActivityMetrics['shape']> = []
  let cursor = 0
  for (const step of plannedSteps) {
    const startSec = cursor
    const endSec = cursor + step.duration_minutes * 60
    cursor = endSec
    let ps = 0, n = 0
    for (let i = 0; i < time.length; i++) {
      if (time[i] >= startSec && time[i] < endSec && Number.isFinite(power[i])) { ps += power[i]; n++ }
    }
    out.push({
      label: step.label,
      planned_w: Math.round((ftp * step.power_pct_ftp) / 100),
      actual_w: n ? Math.round(ps / n) : 0,
    })
  }
  return out
}

export function extractStreamInsights(
  s: RideStreams, ftp: number | null, plannedSteps: WorkoutStep[] | null,
): Pick<ActivityMetrics, 'decoupling_pct' | 'climbs' | 'time_in_zone' | 'shape'> {
  return {
    decoupling_pct: computeDecoupling(s.power, s.hr, s.time),
    time_in_zone: computeTimeInZone(s.power, s.time, ftp),
    climbs: detectClimbs(s.altitude, s.distance, s.power, s.time),
    shape: computeShape(plannedSteps, s.power, s.time, ftp),
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest stream-insights -i`
Expected: PASS (6 tests).

- [ ] **Step 6: Verify existing activity-metrics tests still pass**

Run: `npx jest activity-metrics -i`
Expected: PASS (extractActivityMetrics now also returns the four null fields; existing assertions unaffected).

- [ ] **Step 7: Commit**

```bash
git add types/index.ts lib/claude/activity-metrics.ts __tests__/lib/stream-insights.test.ts
git commit -m "feat: stream-derived ride insights (decoupling, zones, climbs, shape)"
```

---

## Task 2: Coach formatters

**Files:**
- Modify: `lib/claude/activity-metrics.ts` (`formatActivityMetrics` ~line 47; add `formatRideShape`)
- Test: `__tests__/lib/activity-metrics.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/activity-metrics.test.ts`:

```ts
import { formatRideShape } from '@/lib/claude/activity-metrics'
import type { ActivityMetrics as AM } from '@/types'

describe('insight formatting', () => {
  const m: AM = {
    np: 240, avg_power: 230, max_power: 600, avg_hr: 150, distance_m: 40000,
    elevation_m: 500, lr_balance: 50, best_efforts: null, intervals: null,
    decoupling_pct: 6.2,
    time_in_zone: { z1: 0, z2: 6800, z3: 2200, z4: 800, z5: 0, z6: 0 },
    climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
    shape: [{ label: 'Work', planned_w: 250, actual_w: 238 }],
    synced_at: '2026-05-31T00:00:00Z',
  }

  it('formatActivityMetrics appends decoupling, zones and climbs', () => {
    const s = formatActivityMetrics(m)
    expect(s).toContain('decoupling 6.2%')
    expect(s).toContain('Z2 69%')
    expect(s).toContain('1 climb: 8min@268W')
  })

  it('formatRideShape renders planned vs actual per step', () => {
    expect(formatRideShape(m.shape)).toContain('Work: planned 250W, actual 238W')
    expect(formatRideShape(null)).toBe('')
  })
})
```

(Note: `formatActivityMetrics` is already imported at the top of this test file.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest activity-metrics -i`
Expected: FAIL — `formatRideShape` not exported; decoupling/zone/climb strings absent.

- [ ] **Step 3: Implement**

In `lib/claude/activity-metrics.ts`, add helpers above `formatActivityMetrics`:

```ts
const ZONE_LABEL: Record<'z1'|'z2'|'z3'|'z4'|'z5'|'z6', string> = {
  z1: 'Z1', z2: 'Z2', z3: 'Z3', z4: 'Z4', z5: 'Z5', z6: 'Z6',
}

function formatTimeInZone(tiz: NonNullable<ActivityMetrics['time_in_zone']>): string | null {
  const total = Object.values(tiz).reduce((a, b) => a + b, 0)
  if (total <= 0) return null
  const parts = (Object.keys(tiz) as Array<keyof typeof tiz>)
    .map(k => ({ k, pct: Math.round((tiz[k] / total) * 100) }))
    .filter(z => z.pct >= 3)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 4)
    .map(z => `${ZONE_LABEL[z.k]} ${z.pct}%`)
  return parts.length ? parts.join(' ') : null
}

function formatClimbsBrief(climbs: ClimbSegment[]): string {
  const top = climbs.slice(0, 3).map(c => {
    const mins = Math.round(c.duration_secs / 60)
    return c.avg_watts != null ? `${mins}min@${c.avg_watts}W` : `${mins}min +${c.elev_gain_m}m`
  }).join(', ')
  return `${climbs.length} climb${climbs.length > 1 ? 's' : ''}: ${top}`
}
```

Inside `formatActivityMetrics`, after the existing `20min best` block and before `return parts.length ? ...`, append:

```ts
  if (m.decoupling_pct !== null) parts.push(`decoupling ${m.decoupling_pct.toFixed(1)}%`)
  if (m.time_in_zone) { const z = formatTimeInZone(m.time_in_zone); if (z) parts.push(z) }
  if (m.climbs?.length) parts.push(formatClimbsBrief(m.climbs))
```

Add at the end of the file:

```ts
// Per-step planned-vs-actual, for single-ride surfaces only (feedback, briefing).
// Deliberately NOT added to the 90-day dossier list to protect the token budget.
export function formatRideShape(shape: ActivityMetrics['shape']): string {
  if (!shape?.length) return ''
  const lines = shape.map(s => `${s.label}: planned ${s.planned_w}W, actual ${s.actual_w}W`)
  return `Planned vs actual by step:\n${lines.join('\n')}`
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest activity-metrics -i`
Expected: PASS. (`Z2 69%` = round(6800/9800*100).)

- [ ] **Step 5: Commit**

```bash
git add lib/claude/activity-metrics.ts __tests__/lib/activity-metrics.test.ts
git commit -m "feat: surface ride insights in coach formatters"
```

---

## Task 3: Stream normalisation, downsampling & client method

**Files:**
- Create: `lib/intervals/streams.ts`
- Modify: `lib/intervals/client.ts` (add `getActivityStreams`)
- Test: `__tests__/lib/streams.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/streams.test.ts`:

```ts
/** @jest-environment node */
import { normaliseStreams, downsampleStreams } from '@/lib/intervals/streams'

describe('normaliseStreams', () => {
  it('maps channels by type and reads latlng pairs', () => {
    const raw = [
      { type: 'time', data: [0, 1, 2] },
      { type: 'watts', data: [100, 200, 300] },
      { type: 'heartrate', data: [120, 130, 140] },
      { type: 'altitude', data: [10, 11, 12] },
      { type: 'distance', data: [0, 5, 10] },
      { type: 'velocity_smooth', data: [5, 6, 7] },
      { type: 'latlng', data: [[53.5, -2.4], [53.6, -2.5], [53.7, -2.6]] },
    ]
    const s = normaliseStreams(raw)
    expect(s.time).toEqual([0, 1, 2])
    expect(s.power).toEqual([100, 200, 300])
    expect(s.hr).toEqual([120, 130, 140])
    expect(s.velocity).toEqual([5, 6, 7])
    expect(s.latlng).toEqual([[53.5, -2.4], [53.6, -2.5], [53.7, -2.6]])
    expect(s.cadence).toBeNull()
  })

  it('returns null latlng for indoor rides (no latlng channel)', () => {
    const s = normaliseStreams([{ type: 'time', data: [0, 1] }, { type: 'watts', data: [150, 160] }])
    expect(s.latlng).toBeNull()
    expect(s.distance).toEqual([0, 0]) // falls back to zeros, length of time
  })
})

describe('downsampleStreams', () => {
  it('returns the input unchanged when under the cap', () => {
    const s = normaliseStreams([{ type: 'time', data: [0, 1, 2] }, { type: 'watts', data: [1, 2, 3] }])
    expect(downsampleStreams(s, 600)).toBe(s)
  })

  it('strides arrays in lockstep when over the cap', () => {
    const time = Array.from({ length: 10 }, (_, i) => i)
    const power = Array.from({ length: 10 }, (_, i) => i * 10)
    const s = normaliseStreams([{ type: 'time', data: time }, { type: 'watts', data: power }])
    const d = downsampleStreams(s, 5) // stride = ceil(10/5) = 2
    expect(d.time).toEqual([0, 2, 4, 6, 8])
    expect(d.power).toEqual([0, 20, 40, 60, 80])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest streams -i`
Expected: FAIL — module `lib/intervals/streams` not found.

- [ ] **Step 3: Implement `lib/intervals/streams.ts`**

```ts
import type { RideStreams } from '@/types'

// intervals.icu returns activity streams as an array of channel objects:
// [{ type: 'watts', data: [...] }, { type: 'latlng', data: [[lat,lng],...] }, ...].
// Absent channels simply aren't in the array → null here.
export function normaliseStreams(raw: Array<{ type: string; data: unknown[] }>): RideStreams {
  const byType = new Map(raw.map(c => [c.type, c.data]))
  const num = (t: string): number[] | null => {
    const d = byType.get(t)
    return Array.isArray(d) ? d.map(v => (typeof v === 'number' ? v : NaN)) : null
  }
  const time = num('time') ?? []
  const latRaw = byType.get('latlng')
  const latlng = Array.isArray(latRaw) && latRaw.length ? (latRaw as [number, number][]) : null
  return {
    time,
    distance: num('distance') ?? time.map(() => 0),
    latlng,
    power: num('watts'),
    hr: num('heartrate'),
    altitude: num('altitude'),
    cadence: num('cadence'),
    velocity: num('velocity_smooth'),
  }
}

// Even-stride downsample for the browser payload. Keeps every channel index-aligned.
export function downsampleStreams(s: RideStreams, maxPoints: number): RideStreams {
  const n = s.time.length
  if (n <= maxPoints) return s
  const stride = Math.ceil(n / maxPoints)
  const pick = <T>(arr: T[] | null): T[] | null => (arr ? arr.filter((_, i) => i % stride === 0) : null)
  return {
    time: pick(s.time)!,
    distance: pick(s.distance)!,
    latlng: pick(s.latlng),
    power: pick(s.power),
    hr: pick(s.hr),
    altitude: pick(s.altitude),
    cadence: pick(s.cadence),
    velocity: pick(s.velocity),
  }
}
```

- [ ] **Step 4: Add the client method**

In `lib/intervals/client.ts`, update the type import on line 1 to add `RideStreams`:

```ts
import type { ICUActivity, ICUWellness, ICUSyncData, WorkoutStep, ICUEvent, ICUPowerCurvePoint, ActivityInterval, RideStreams } from '@/types'
```

Add an import for the normaliser near the top (after the `BASE` const is fine):

```ts
import { normaliseStreams } from './streams'
```

Add the method after `getActivityIntervals` (~line 176):

```ts
  // Per-second streams for one activity. intervals.icu exposes these at
  // /activity/{id}/streams as an array of { type, data } channels.
  async getActivityStreams(activityId: string): Promise<RideStreams> {
    const types = 'time,latlng,watts,heartrate,altitude,distance,cadence,velocity_smooth'
    const raw = await this.request<Array<{ type: string; data: unknown[] }>>(
      `/activity/${activityId}/streams?types=${types}`
    )
    return normaliseStreams(Array.isArray(raw) ? raw : [])
  }
```

- [ ] **Step 5: Add a client URL test**

Append to `__tests__/lib/intervals.test.ts` inside the `describe('IntervalsClient', ...)` block:

```ts
  it('getActivityStreams calls the streams endpoint and normalises channels', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { type: 'time', data: [0, 1] },
        { type: 'watts', data: [100, 200] },
        { type: 'latlng', data: [[53.5, -2.4], [53.6, -2.5]] },
      ]),
    })
    const s = await client.getActivityStreams('act9')
    expect(s.power).toEqual([100, 200])
    expect(s.latlng).toEqual([[53.5, -2.4], [53.6, -2.5]])
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://intervals.icu/api/v1/activity/act9/streams?types=time,latlng,watts,heartrate,altitude,distance,cadence,velocity_smooth'
    )
  })
```

- [ ] **Step 6: Run tests**

Run: `npx jest streams intervals -i`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/intervals/streams.ts lib/intervals/client.ts __tests__/lib/streams.test.ts __tests__/lib/intervals.test.ts
git commit -m "feat: fetch + normalise + downsample intervals.icu activity streams"
```

---

## Task 4: Thread FTP, planned steps & streams through enrichment

**Files:**
- Modify: `lib/intervals/enrich.ts`
- Test: `__tests__/lib/enrich.test.ts` (update mock + assertions)

- [ ] **Step 1: Update the test**

In `__tests__/lib/enrich.test.ts`, add a `getActivityStreams` mock to `makeClient` (inside the returned object, after `getActivityIntervals`):

```ts
    getActivityStreams: jest.fn(async () => ({
      time: [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600],
      distance: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      latlng: null,
      power: Array.from({ length: 11 }, () => 200),
      hr: [150, 150, 150, 150, 150, 165, 165, 165, 165, 165, 165],
      altitude: null, cadence: null, velocity: null,
    })),
```

Update the chainable Supabase stub so a `user_profile` read for FTP resolves. Replace `makeSupabase` with:

```ts
function makeSupabase(rows: Array<{ id: string; icu_activity_id: string; steps: unknown }>, updateSpy: jest.Mock) {
  const query: Record<string, unknown> = {}
  const self = () => query
  Object.assign(query, {
    select: self, eq: self, in: self, gte: self, not: self, is: self, order: self,
    limit: () => Promise.resolve({ data: rows, error: null }),
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

Update both existing `makeSupabase([...])` call sites to include `steps: null` on each row, e.g.:

```ts
    const supabase = makeSupabase(
      [{ id: 'w1', icu_activity_id: 'a1', steps: null }, { id: 'w2', icu_activity_id: 'a2', steps: null }],
      updateSpy,
    )
```

Add an assertion in the first test (after the existing `best_efforts` assertion) that insights were computed:

```ts
    expect(patch.activity_metrics.decoupling_pct).toBeCloseTo(9.1, 1)
    expect(patch.activity_metrics.time_in_zone).not.toBeNull()
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest enrich -i`
Expected: FAIL — `decoupling_pct` is `null` (enrich doesn't fetch streams yet) and/or the FTP read path differs.

- [ ] **Step 3: Implement enrich changes**

Replace the body of `lib/intervals/enrich.ts` with:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ICUActivity, ActivityMetrics, WorkoutStep } from '@/types'
import type { IntervalsClient } from './client'
import { extractActivityMetrics, extractStreamInsights } from '@/lib/claude/activity-metrics'

// Build the full metrics blob for an activity already in hand. Each extra call
// degrades gracefully — a failure leaves that tier null. Streams (full
// resolution) feed the four derived coaching insights; zones/shape need FTP.
export async function enrichActivity(
  client: IntervalsClient,
  activity: ICUActivity,
  ftp: number | null,
  plannedSteps: WorkoutStep[] | null,
): Promise<ActivityMetrics> {
  const date = activity.start_date_local.split('T')[0]
  const [curve, intervals, streams] = await Promise.all([
    client.getPowerCurve(date, date).catch(() => null),
    client.getActivityIntervals(activity.id).catch(() => null),
    client.getActivityStreams(activity.id).catch(() => null),
  ])
  const base = extractActivityMetrics(activity, curve, intervals)
  if (!streams) return base
  return { ...base, ...extractStreamInsights(streams, ftp, plannedSteps) }
}

export async function enrichActivityById(
  client: IntervalsClient,
  activityId: string,
  ftp: number | null,
  plannedSteps: WorkoutStep[] | null,
): Promise<ActivityMetrics> {
  const activity = await client.getActivity(activityId)
  return enrichActivity(client, activity, ftp, plannedSteps)
}

const BACKFILL_LIMIT = 25

// Self-healing pass: enrich up to BACKFILL_LIMIT completed rides in the last 90
// days that have an icu_activity_id but no activity_metrics yet. Newest first.
// Per-ride failures are logged and skipped. Returns the number enriched.
// Note: zones bucket against the athlete's CURRENT FTP at sync time.
export async function backfillActivityMetrics(
  supabase: SupabaseClient,
  client: IntervalsClient,
  userId: string,
): Promise<number> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0]

  const { data: profile } = await supabase
    .from('user_profile')
    .select('current_ftp')
    .maybeSingle()
  const ftp = (profile as { current_ftp?: number | null } | null)?.current_ftp ?? null

  const { data: rows, error } = await supabase
    .from('workouts')
    .select('id, icu_activity_id, steps')
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
  for (const row of (rows ?? []) as Array<{ id: string; icu_activity_id: string; steps: WorkoutStep[] | null }>) {
    try {
      const metrics = await enrichActivityById(client, row.icu_activity_id, ftp, row.steps)
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

- [ ] **Step 4: Run tests**

Run: `npx jest enrich -i`
Expected: PASS (both tests). The skip-on-throw test still passes (`getActivity` throws for `a1`).

- [ ] **Step 5: Commit**

```bash
git add lib/intervals/enrich.ts __tests__/lib/enrich.test.ts
git commit -m "feat: feed FTP, planned steps and streams into ride enrichment"
```

---

## Task 5: Surface planned-vs-actual shape in feedback & briefing

**Files:**
- Modify: `app/api/feedback/route.ts:56-58`
- Modify: `app/api/briefing/today/route.ts` (where `execution` is built per ride)
- Test: build verification (these are thin glue changes over already-tested formatters)

- [ ] **Step 1: Feedback route**

In `app/api/feedback/route.ts`, replace lines 56–58:

```ts
    const { formatRideExecution } = await import('@/lib/claude/activity-metrics')
    const w = workout as Workout
    const rideExecution = formatRideExecution(w.steps, w.activity_metrics)
```

with:

```ts
    const { formatRideExecution, formatRideShape } = await import('@/lib/claude/activity-metrics')
    const w = workout as Workout
    const rideExecution = [
      formatRideExecution(w.steps, w.activity_metrics),
      formatRideShape(w.activity_metrics?.shape ?? null),
    ].filter(Boolean).join('\n\n')
```

- [ ] **Step 2: Briefing route**

In `app/api/briefing/today/route.ts`, the completed-rides mapping (~lines 113–125) destructures `formatRideExecution` dynamically and builds `execution` from locals `steps` and `metrics`.

Change the dynamic import on line 113 from:

```ts
      const { formatRideExecution } = await import('@/lib/claude/activity-metrics')
```

to:

```ts
      const { formatRideExecution, formatRideShape } = await import('@/lib/claude/activity-metrics')
```

Change the `execution` field on line 125 from:

```ts
          execution: formatRideExecution(steps, metrics) || null,
```

to:

```ts
          execution: [
            formatRideExecution(steps, metrics),
            formatRideShape(metrics?.shape ?? null),
          ].filter(Boolean).join('\n\n') || null,
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: `✓ Compiled successfully`. (Type-check gate; both routes use the already-exported `formatRideShape`.)

- [ ] **Step 4: Commit**

```bash
git add app/api/feedback/route.ts app/api/briefing/today/route.ts
git commit -m "feat: include planned-vs-actual shape in feedback and briefing prompts"
```

---

## Task 6: Streams API route

**Files:**
- Create: `app/api/rides/[workoutId]/streams/route.ts`
- Test: `__tests__/api/ride-streams.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/ride-streams.test.ts`:

```ts
/** @jest-environment node */
import { GET } from '@/app/api/rides/[workoutId]/streams/route'

const streams = {
  time: Array.from({ length: 1000 }, (_, i) => i),
  distance: Array.from({ length: 1000 }, (_, i) => i),
  latlng: null, power: Array.from({ length: 1000 }, () => 200),
  hr: null, altitude: null, cadence: null, velocity: null,
}

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getActivityStreams: jest.fn(async () => streams),
  })),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

function supabaseStub(workoutRow: unknown, profileRow: unknown) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: table === 'workouts' ? workoutRow : profileRow }) }),
        maybeSingle: async () => ({ data: profileRow }),
      }),
    }),
  }
}

const ctx = (id: string) => ({ params: Promise.resolve({ workoutId: id }) })

beforeEach(() => jest.clearAllMocks())

describe('GET /api/rides/[workoutId]/streams', () => {
  it('returns downsampled streams (<=600 points)', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseStub({ icu_activity_id: 'a1' }, { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k' }),
    )
    const res = await GET({} as Request as never, ctx('w1') as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.streams.time.length).toBeLessThanOrEqual(600)
    expect(body.streams.power.length).toBe(body.streams.time.length)
  })

  it('404s when the workout has no activity', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseStub({ icu_activity_id: null }, { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k' }),
    )
    const res = await GET({} as Request as never, ctx('w1') as never)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest ride-streams -i`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

Create `app/api/rides/[workoutId]/streams/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { downsampleStreams } from '@/lib/intervals/streams'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workoutId: string }> },
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { workoutId } = await params

  // RLS scopes this select to the signed-in user, so a foreign workout reads as null.
  const { data: workout } = await supabase
    .from('workouts')
    .select('icu_activity_id')
    .eq('id', workoutId)
    .maybeSingle()

  if (!workout?.icu_activity_id) {
    return NextResponse.json({ error: 'No activity for this workout' }, { status: 404 })
  }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  try {
    const streams = await client.getActivityStreams(workout.icu_activity_id)
    return NextResponse.json({ streams: downsampleStreams(streams, 600) })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest ride-streams -i`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/api/rides/[workoutId]/streams/route.ts" __tests__/api/ride-streams.test.ts
git commit -m "feat: GET /api/rides/[workoutId]/streams (downsampled, on-demand)"
```

---

## Task 7: Graph math pure helpers

**Files:**
- Create: `lib/ride/graph-math.ts`
- Test: `__tests__/lib/graph-math.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/graph-math.test.ts`:

```ts
/** @jest-environment node */
import { pointerToIndex, seriesToPolyline, formatDuration } from '@/lib/ride/graph-math'

describe('pointerToIndex', () => {
  it('maps an x position within the rect to a clamped sample index', () => {
    expect(pointerToIndex(0, 0, 100, 11)).toBe(0)
    expect(pointerToIndex(50, 0, 100, 11)).toBe(5)
    expect(pointerToIndex(100, 0, 100, 11)).toBe(10)
    expect(pointerToIndex(200, 0, 100, 11)).toBe(10) // clamp past the end
    expect(pointerToIndex(-50, 0, 100, 11)).toBe(0)  // clamp before the start
  })
})

describe('seriesToPolyline', () => {
  it('scales values into the box and skips nulls', () => {
    const pts = seriesToPolyline([0, 50, 100], 100, 100, 0)
    // min=0,max=100 → y inverted: 0→100, 50→50, 100→0; x evenly 0,50,100
    expect(pts).toBe('0.0,100.0 50.0,50.0 100.0,0.0')
  })
  it('returns empty string with no numeric values', () => {
    expect(seriesToPolyline([null, null], 100, 100, 0)).toBe('')
  })
})

describe('formatDuration', () => {
  it('formats seconds as H:MM:SS / M:SS', () => {
    expect(formatDuration(75)).toBe('1:15')
    expect(formatDuration(3675)).toBe('1:01:15')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest graph-math -i`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/ride/graph-math.ts`**

```ts
// Pure helpers for the ride graph. No React, no DOM — unit-testable.

export function pointerToIndex(clientX: number, left: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width))
  return Math.round(ratio * (count - 1))
}

// Builds an SVG polyline `points` string scaling values into [0,width]×[0,height].
// Y is inverted (SVG origin top-left). Nulls/NaNs are skipped.
export function seriesToPolyline(
  values: (number | null)[], width: number, height: number, pad = 2,
): string {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (!nums.length) return ''
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const span = max - min || 1
  const n = values.length
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const v = values[i]
    if (v == null || !Number.isFinite(v)) continue
    const x = n === 1 ? 0 : (i / (n - 1)) * width
    const y = height - pad - ((v - min) / span) * (height - pad * 2)
    out.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return out.join(' ')
}

export function formatDuration(secs: number): string {
  const s = Math.max(0, Math.round(secs))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest graph-math -i`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ride/graph-math.ts __tests__/lib/graph-math.test.ts
git commit -m "feat: pure graph-math helpers for the ride graph"
```

---

## Task 8: RideGraph SVG component

**Files:**
- Create: `components/ride/RideGraph.tsx`
- Test: `__tests__/components/RideGraph.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/RideGraph.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import RideGraph from '@/components/ride/RideGraph'
import type { RideStreams } from '@/types'

const streams: RideStreams = {
  time: [0, 60, 120], distance: [0, 1000, 2000], latlng: null,
  power: [100, 200, 150], hr: [120, 140, 150], altitude: [10, 20, 15],
  cadence: null, velocity: null,
}

describe('RideGraph', () => {
  it('renders a polyline for each active series', () => {
    const { container } = render(
      <RideGraph streams={streams} cursorIndex={1} onScrub={() => {}}
        show={{ power: true, hr: true, elevation: true }} xAxis="distance" />,
    )
    // power + hr + elevation = 3 polylines, plus the crosshair line
    expect(container.querySelectorAll('polyline').length).toBe(3)
    expect(container.querySelector('line')).toBeTruthy() // crosshair
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest RideGraph -i`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `components/ride/RideGraph.tsx`**

```tsx
'use client'
import { useRef } from 'react'
import type { RideStreams } from '@/types'
import { pointerToIndex, seriesToPolyline } from '@/lib/ride/graph-math'

const W = 1000
const H = 260

const COLOURS = { power: '#7c3aed', hr: '#ef4444', elevation: '#16a34a' }

interface Props {
  streams: RideStreams
  cursorIndex: number
  onScrub: (index: number) => void
  show: { power: boolean; hr: boolean; elevation: boolean }
  xAxis: 'distance' | 'time'
}

export default function RideGraph({ streams, cursorIndex, onScrub, show }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const n = streams.time.length

  function handle(clientX: number) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    onScrub(pointerToIndex(clientX, rect.left, rect.width, n))
  }

  const crosshairX = n > 1 ? (cursorIndex / (n - 1)) * W : 0

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full touch-none select-none"
      style={{ height: '40vh', maxHeight: 320 }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); handle(e.clientX) }}
      onPointerMove={e => { if (e.buttons || e.pointerType === 'touch') handle(e.clientX) }}
    >
      {show.elevation && streams.altitude && (
        <polyline points={seriesToPolyline(streams.altitude, W, H)} fill="none" stroke={COLOURS.elevation} strokeWidth={2} opacity={0.6} />
      )}
      {show.hr && streams.hr && (
        <polyline points={seriesToPolyline(streams.hr, W, H)} fill="none" stroke={COLOURS.hr} strokeWidth={2} />
      )}
      {show.power && streams.power && (
        <polyline points={seriesToPolyline(streams.power, W, H)} fill="none" stroke={COLOURS.power} strokeWidth={2.5} />
      )}
      <line x1={crosshairX} y1={0} x2={crosshairX} y2={H} stroke="#111" strokeWidth={1.5} opacity={0.5} />
    </svg>
  )
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest RideGraph -i`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ride/RideGraph.tsx __tests__/components/RideGraph.test.tsx
git commit -m "feat: scrubbable SVG ride graph component"
```

---

## Task 9: RouteMap (Leaflet) + dependency

**Files:**
- Modify: `package.json` (add `leaflet`, `@types/leaflet`)
- Create: `components/ride/RouteMap.tsx`
- No jest test — Leaflet needs a real DOM; verified by build. (Pure logic already covered elsewhere.)

- [ ] **Step 1: Install Leaflet**

```bash
npm install leaflet@^1.9.4 && npm install -D @types/leaflet@^1.9.12
```

Expected: both added to `package.json`; lockfile updated.

- [ ] **Step 2: Implement `components/ride/RouteMap.tsx`**

```tsx
'use client'
import { useEffect, useRef } from 'react'
import type { Map as LMap, CircleMarker, Polyline } from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface Props {
  latlng: [number, number][]
  cursorIndex: number
}

// Leaflet touches `window`, so this component must only ever render client-side.
// The parent imports it via next/dynamic({ ssr: false }). We use circleMarker +
// polyline (no image marker assets, avoiding bundler icon-path issues).
export default function RouteMap({ latlng, cursorIndex }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LMap | null>(null)
  const markerRef = useRef<CircleMarker | null>(null)

  useEffect(() => {
    let cancelled = false
    import('leaflet').then(L => {
      if (cancelled || !elRef.current || mapRef.current || latlng.length === 0) return
      const map = L.map(elRef.current, { zoomControl: false })
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19,
      }).addTo(map)
      const line: Polyline = L.polyline(latlng, { color: '#2563eb', weight: 4 }).addTo(map)
      map.fitBounds(line.getBounds(), { padding: [20, 20] })
      markerRef.current = L.circleMarker(latlng[0], {
        radius: 7, color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1,
      }).addTo(map)
    })
    return () => {
      cancelled = true
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null }
    }
  }, [latlng])

  useEffect(() => {
    const pt = latlng[cursorIndex]
    if (markerRef.current && pt) markerRef.current.setLatLng(pt)
  }, [cursorIndex, latlng])

  return <div ref={elRef} className="w-full h-full" />
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: `✓ Compiled successfully` (types resolve; `RouteMap` is not yet imported anywhere, which is fine).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json components/ride/RouteMap.tsx
git commit -m "feat: Leaflet RouteMap component with cursor-linked marker"
```

---

## Task 10: RideMapGraph parent + full-screen page

**Files:**
- Create: `components/ride/RideMapGraph.tsx`
- Create: `app/ride/[workoutId]/page.tsx`
- No jest test — composition over already-tested units; verified by build + manual.

- [ ] **Step 1: Implement `components/ride/RideMapGraph.tsx`**

```tsx
'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { RideStreams } from '@/types'
import RideGraph from './RideGraph'
import { formatDuration } from '@/lib/ride/graph-math'

const RouteMap = dynamic(() => import('./RouteMap'), { ssr: false })

function Chip({ label, value, colour }: { label: string; value: string; colour: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: colour }} />
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className="text-sm font-semibold text-gray-900">{value}</span>
    </div>
  )
}

export default function RideMapGraph({ streams }: { streams: RideStreams }) {
  const [cursor, setCursor] = useState(0)
  const [show, setShow] = useState({ power: true, hr: true, elevation: true })
  const hasGps = !!streams.latlng && streams.latlng.length > 0

  const at = (arr: number[] | null) => (arr && arr[cursor] != null ? arr[cursor] : null)
  const power = at(streams.power)
  const hr = at(streams.hr)
  const alt = at(streams.altitude)
  const dist = at(streams.distance)
  const t = at(streams.time)

  return (
    <div className="flex flex-col">
      <div className="h-[40vh] min-h-[220px] bg-slate-100 relative">
        {hasGps ? (
          <RouteMap latlng={streams.latlng!} cursorIndex={cursor} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-slate-400">
            No GPS recorded for this ride
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-y border-gray-100 flex flex-wrap gap-x-5 gap-y-2 bg-white">
        <Chip label="Time" value={t != null ? formatDuration(t) : '—'} colour="#94a3b8" />
        <Chip label="Dist" value={dist != null ? `${(dist / 1000).toFixed(1)}km` : '—'} colour="#94a3b8" />
        {streams.power && <Chip label="Power" value={power != null ? `${Math.round(power)}W` : '—'} colour="#7c3aed" />}
        {streams.hr && <Chip label="HR" value={hr != null ? `${Math.round(hr)}` : '—'} colour="#ef4444" />}
        {streams.altitude && <Chip label="Elev" value={alt != null ? `${Math.round(alt)}m` : '—'} colour="#16a34a" />}
      </div>

      <RideGraph streams={streams} cursorIndex={cursor} onScrub={setCursor} show={show} xAxis="distance" />

      <div className="px-4 py-3 flex gap-2 flex-wrap">
        {(['power', 'hr', 'elevation'] as const).map(k => {
          const present = k === 'power' ? streams.power : k === 'hr' ? streams.hr : streams.altitude
          if (!present) return null
          const label = k === 'hr' ? 'HR' : k[0].toUpperCase() + k.slice(1)
          return (
            <button
              key={k}
              onClick={() => setShow(s => ({ ...s, [k]: !s[k] }))}
              className={`text-xs font-medium px-3 py-2 rounded-full border transition-colors ${
                show[k] ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-400'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Implement `app/ride/[workoutId]/page.tsx`**

```tsx
'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { RideStreams } from '@/types'
import RideMapGraph from '@/components/ride/RideMapGraph'

export default function RidePage() {
  const { workoutId } = useParams<{ workoutId: string }>()
  const router = useRouter()
  const [streams, setStreams] = useState<RideStreams | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true); setError(null)
    fetch(`/api/rides/${workoutId}/streams`)
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error ?? 'Could not load ride data')
        return d
      })
      .then(d => setStreams(d.streams))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [workoutId])

  useEffect(() => { load() }, [load])

  return (
    <div className="min-h-screen bg-white">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
        <button onClick={() => router.back()} className="min-w-[44px] min-h-[44px] flex items-center text-blue-600 text-sm font-medium">
          ← Back
        </button>
        <h1 className="text-base font-bold text-gray-900">Ride detail</h1>
      </div>

      {loading && <p className="text-sm text-gray-400 p-6">Loading ride…</p>}
      {error && !loading && (
        <div className="p-6 space-y-3">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={load} className="text-sm font-medium text-blue-600 py-2.5 px-4 rounded-lg bg-blue-50">Retry</button>
        </div>
      )}
      {streams && !loading && !error && <RideMapGraph streams={streams} />}
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: `✓ Compiled successfully`. The `/ride/[workoutId]` route appears in the build output.

- [ ] **Step 4: Commit**

```bash
git add "components/ride/RideMapGraph.tsx" "app/ride/[workoutId]/page.tsx"
git commit -m "feat: full-screen ride map + graph page"
```

---

## Task 11: "View ride map" link in the workout modal

**Files:**
- Modify: `components/WorkoutDetailModal.tsx` (~line 343, the activity-links block)

- [ ] **Step 1: Add the Link import**

At the top of `components/WorkoutDetailModal.tsx`, add:

```ts
import Link from 'next/link'
```

- [ ] **Step 2: Add the link**

In the links block (after the `activityUrl` anchor that ends `View completed activity in intervals.icu →`, ~line 352), add:

```tsx
            {workout.icu_activity_id && (workout.status === 'completed' || workout.status === 'needs_review') && (
              <Link
                href={`/ride/${workout.id}`}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium block transition-colors"
              >
                View ride map →
              </Link>
            )}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add components/WorkoutDetailModal.tsx
git commit -m "feat: link to ride map from the workout detail modal"
```

---

## Task 12: Re-enrich existing rides, full verification & wrap-up

**Files:** none (operational).

- [ ] **Step 1: Full test suite**

Run: `npx jest`
Expected: all NEW suites pass (`stream-insights`, `streams`, `graph-math`, `ride-streams`, `RideGraph`, plus updated `activity-metrics`, `enrich`, `intervals`). The pre-existing known-failing suites (email-allowlist, review, WorkoutCard, AddEventModal, WorkoutDetailModal, SettingsPage) are unchanged — do not attempt to fix them here.

- [ ] **Step 2: Full production build**

Run: `npm run build`
Expected: `✓ Compiled successfully`, `/ride/[workoutId]` and `/api/rides/[workoutId]/streams` present in the route list.

- [ ] **Step 3: One-time re-enrich SQL (apply in Supabase SQL editor after deploy)**

The backfill's `.is('activity_metrics', null)` filter skips already-enriched rows, so existing rides won't gain the new insight fields until their blob is cleared. Run once:

```sql
update workouts set activity_metrics = null where activity_metrics is not null;
```

Then trigger a sync (or wait for the nightly cron) to recompute every recent ride with streams. Backfill is capped at 25 rides/run — repeat the sync if you have more than 25 recent completed rides.

- [ ] **Step 4: Manual smoke test (with live intervals.icu data)**

1. Open a completed **outdoor** ride → modal shows "View ride map →" → tap it → map draws the route, graph shows power/HR/elevation, dragging scrubs the crosshair and moves the map marker, readout chip updates.
2. Toggle the Power/HR/Elev chips → series hide/show.
3. Open a completed **indoor** ride → page loads, graph works, map area shows "No GPS recorded".
4. Open the coach notes / trigger a briefing → confirm a ride line now includes `decoupling X% · Zn …%` and, where applicable, climbs.

- [ ] **Step 5: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill.

---

## Self-review notes (author)

- **Spec coverage:** map view (T6–T11), Leaflet (T9), custom SVG graph (T7–T8), Layout A map-on-top (T10), distance default X (T8/T10), on-demand downsampled streams (T3/T6), decoupling+climbs+time-in-zone+shape (T1), terse formatter line + single-ride shape (T2/T5), all four coach surfaces reached via existing formatters (T2) + shape into feedback/briefing (T5), `activity_metrics` storage + re-enrich SQL (T4/T12), indoor/no-power/error edge cases (T8/T10), FTP caveat (T1/T4), streams-endpoint verification (pre-flight + T3), Leaflet SSR via dynamic ssr:false (T9/T10). All covered.
- **Type consistency:** `extractStreamInsights(s, ftp, plannedSteps)`, `RideStreams`, `ClimbSegment`, `time_in_zone` zone keys, `formatRideShape(shape)` are used identically across tasks.
```
