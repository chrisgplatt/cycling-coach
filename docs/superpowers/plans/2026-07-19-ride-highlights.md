# Ride Highlights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface climbs, sustained high-power effort periods, sprints, and 90-day personal bests as a new "Highlights" tab on both ride/workout detail modals.

**Architecture:** Extend the existing `ActivityMetrics` sync-time enrichment pipeline (`lib/claude/activity-metrics.ts` / `lib/intervals/enrich.ts`) with three new detector outputs, persisted the same way `climbs` already is. A new pure `lib/ride-highlights.ts` helper merges/orders them for display; a new `RideHighlightsTab` component renders the result. `WorkoutDetailModal` reads the data straight off its existing `workout` prop; `ActivityDetailModal` gets a new lightweight API route mirroring the existing `/distributions` route.

**Tech Stack:** Next.js 16 App Router, TypeScript strict mode, Supabase, Jest + Testing Library, Tailwind CSS v4.

**Design doc:** `docs/superpowers/specs/2026-07-19-ride-highlights-design.md`

## Global Constraints

- Effort-period qualification reuses the existing file-local `zoneOf()` classifier in `lib/claude/activity-metrics.ts` (qualifies at `'z4'`, `'z5'`, `'z6'`) — never introduce a second, independently-tuned percentage threshold.
- Effort-period minimum duration is 180 seconds, matching `detectClimbs`'s own `MIN_SECS` constant exactly, for consistency between the two detectors.
- Personal bests use a 90-day rolling comparison window, anchored on **the ride's own date**, not on "today" — this must work correctly when backfilling old rides, where "today" and the ride's date differ significantly.
- No new database migration or schema change — every new field lives inside the existing `workouts.activity_metrics` JSONB column.
- `npm run typecheck` must pass before every commit (per `AGENTS.md` — Jest does not surface TypeScript errors).
- Mobile-first UI (per `AGENTS.md`): no fixed-width grids narrower than ~130px per column; any future interactive element needs 44px+ touch targets (v1 highlight cards are display-only, so this mainly constrains not regressing existing modal chrome).
- `ActivityMetrics`'s new fields (`effort_periods`, `sprints`, `personal_bests`) are non-optional (no `?`), matching the existing convention for `climbs`/`time_in_zone`/`shape`/`distributions` — every hand-built `ActivityMetrics` object literal in source and tests must include them explicitly (as `null` where not otherwise specified).

---

### Task 1: Extend `ActivityMetrics` with the three new highlight fields

**Files:**
- Modify: `types/index.ts`
- Modify: `lib/claude/activity-metrics.ts` (`extractActivityMetrics`'s return object only, ~lines 37-61)
- Modify: `__tests__/support/factories.ts` (`makeActivityMetrics`, lines 35-54)
- Modify: `__tests__/lib/activity-metrics.test.ts` (the hand-built `m: AM` literal, lines 171-180)
- Modify: `__tests__/components/RideStats.test.tsx` (the hand-built `metrics: ActivityMetrics` literal, lines 13-17)

**Interfaces:**
- Produces: `EffortPeriod`, `RideSprint`, `PersonalBest` types; `ActivityMetrics.effort_periods: EffortPeriod[] | null`, `ActivityMetrics.sprints: RideSprint[] | null`, `ActivityMetrics.personal_bests: PersonalBest[] | null` — every later task in this plan reads or writes these exact field names and shapes.

This task is pure data-shape scaffolding — no new logic yet, so there's no new behavior to drive with a failing test. Instead, verify with the full existing suite + typecheck, which must both stay green throughout.

- [ ] **Step 1: Add the three new types to `types/index.ts`, right after `ClimbSegment` (currently ending at line 560)**

```typescript
export interface EffortPeriod {
  start_km: number
  duration_secs: number
  avg_watts: number
  zone: 'z4' | 'z5' | 'z6'
}

export interface RideSprint {
  duration_secs: number   // 5 or 15
  watts: number
}

export interface PersonalBest {
  duration_secs: number   // one of the canonical best-effort durations (5,15,60,300,600,1200,3600)
  watts: number
  window_days: number     // 90
}
```

- [ ] **Step 2: Add the three new fields to `ActivityMetrics` in `types/index.ts` (currently lines 524-552), directly after `distributions`**

Change:
```typescript
  distributions: SessionDistributions | null  // Tier-4 within-session histograms
  metrics_version?: number  // computation version; drives one-time backfill refresh
  synced_at: string
}
```
to:
```typescript
  distributions: SessionDistributions | null  // Tier-4 within-session histograms
  // Tier 5 — ride highlights (climbs reuse Tier 4's `climbs`; these three are new)
  effort_periods: EffortPeriod[] | null    // sustained Z4+ blocks
  sprints: RideSprint[] | null             // 5s/15s best-effort power, no location data
  personal_bests: PersonalBest[] | null    // 90-day rolling PBs, anchored on this ride's date
  metrics_version?: number  // computation version; drives one-time backfill refresh
  synced_at: string
}
```

- [ ] **Step 3: Add matching `null` placeholders to `extractActivityMetrics`'s return object in `lib/claude/activity-metrics.ts` (currently lines 37-61)**

Change the tail of the returned object from:
```typescript
    best_efforts: best.length ? best : null,
    intervals: intervals?.length ? intervals : null,
    decoupling_pct: null,
    climbs: null,
    time_in_zone: null,
    shape: null,
    distributions: null,
    metrics_version: METRICS_VERSION,
    synced_at: new Date().toISOString(),
  }
}
```
to:
```typescript
    best_efforts: best.length ? best : null,
    intervals: intervals?.length ? intervals : null,
    decoupling_pct: null,
    climbs: null,
    time_in_zone: null,
    shape: null,
    distributions: null,
    effort_periods: null,   // filled by extractStreamInsights (Task 2)
    sprints: null,          // filled below in this function (Task 3)
    personal_bests: null,   // filled by enrichActivity after a 90-day curve fetch (Task 5)
    metrics_version: METRICS_VERSION,
    synced_at: new Date().toISOString(),
  }
}
```

- [ ] **Step 4: Extend `makeActivityMetrics` in `__tests__/support/factories.ts` (currently lines 35-54)**

Change:
```typescript
    time_in_zone: null,
    shape: null,
    distributions: null,
    synced_at: '2026-05-01T10:00:00Z',
    ...overrides,
  }
}
```
to:
```typescript
    time_in_zone: null,
    shape: null,
    distributions: null,
    effort_periods: null,
    sprints: null,
    personal_bests: null,
    synced_at: '2026-05-01T10:00:00Z',
    ...overrides,
  }
}
```

- [ ] **Step 5: Fix the two other hand-built `ActivityMetrics`-typed literals so typecheck stays green**

In `__tests__/lib/activity-metrics.test.ts`, the `insight formatting` describe block's `m: AM` literal (currently lines 171-180) — add the three fields before `synced_at`:
```typescript
    climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
    shape: [{ label: 'Work', planned_w: 250, actual_w: 238 }],
    distributions: null,
    effort_periods: null,
    sprints: null,
    personal_bests: null,
    synced_at: '2026-05-31T00:00:00Z',
```

In `__tests__/components/RideStats.test.tsx`, the `metrics: ActivityMetrics` literal (currently lines 13-17) — add the three fields:
```typescript
const metrics: ActivityMetrics = {
  np: 210, avg_power: 200, max_power: 350, avg_hr: 145, distance_m: 30000, elevation_m: 320,
  lr_balance: 52, best_efforts: [{ secs: 60, watts: 380 }, { secs: 300, watts: 320 }, { secs: 1200, watts: 280 }],
  intervals: null, decoupling_pct: null, climbs: null, time_in_zone: null, shape: null, distributions: null,
  effort_periods: null, sprints: null, personal_bests: null, synced_at: '',
}
```

- [ ] **Step 6: Run typecheck and the full test suite to confirm nothing else broke**

Run: `npm run typecheck`
Expected: no errors.

Run: `npx jest`
Expected: all existing tests still pass (this task changes no runtime behavior).

If typecheck surfaces any OTHER hand-built `ActivityMetrics`-typed object literal not listed above, fix it the same way (add the three new fields as `null`) before proceeding — do not silently loosen a type or cast around the error.

- [ ] **Step 7: Commit**

```bash
git add types/index.ts lib/claude/activity-metrics.ts __tests__/support/factories.ts __tests__/lib/activity-metrics.test.ts __tests__/components/RideStats.test.tsx
git commit -m "Add EffortPeriod/RideSprint/PersonalBest types to ActivityMetrics"
```

---

### Task 2: Detect sustained high-power effort periods

**Files:**
- Modify: `lib/claude/activity-metrics.ts`
- Modify: `__tests__/lib/activity-metrics.test.ts`

**Interfaces:**
- Consumes: `EffortPeriod` (Task 1), file-local `zoneOf(pct: number): ZoneKey` (existing, line 143).
- Produces: file-local `detectEffortPeriods(power, distance, time, ftp): EffortPeriod[] | null`, wired into `extractStreamInsights`'s return (so `ActivityMetrics.effort_periods` is populated end-to-end via `enrichActivity`).

- [ ] **Step 1: Write the failing tests in `__tests__/lib/activity-metrics.test.ts`**

Add this new `describe` block at the end of the file (after the `insight formatting` block):

```typescript
describe('effort period detection (via extractStreamInsights)', () => {
  // 10 samples, 30s apart (dt=30s). At this spacing the 30s centred rolling
  // average only ever includes the sample itself (its neighbours are exactly
  // 30s away, outside the ±15s half-window), so smoothed power === raw power
  // here — keeping the fixture's expected output simple to reason about.
  const time = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270]
  const distance = [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800]
  const ftp = 250

  it('detects a sustained Z4+ block lasting at least 180s', () => {
    // indices 2..8 (7 points) = 230W (92% FTP, Z4); rest = 150W (60% FTP, Z2).
    // time[8]-time[2] = 240-60 = 180s, exactly meeting the minimum.
    const power = [150, 150, 230, 230, 230, 230, 230, 230, 230, 150]
    const s = { time, distance, latlng: null, power, hr: null, altitude: null, cadence: null, velocity: null }
    const insights = extractStreamInsights(s, ftp, null, null)
    expect(insights.effort_periods).toEqual([
      { start_km: 0.4, duration_secs: 180, avg_watts: 230, zone: 'z4' },
    ])
  })

  it('does not emit a block shorter than 180s', () => {
    // indices 2..6 (5 points) = 230W; duration = time[6]-time[2] = 150-60 = 90s.
    const power = [150, 150, 230, 230, 230, 230, 230, 150, 150, 150]
    const s = { time, distance, latlng: null, power, hr: null, altitude: null, cadence: null, velocity: null }
    const insights = extractStreamInsights(s, ftp, null, null)
    expect(insights.effort_periods).toBeNull()
  })

  it('returns null when power or ftp is unavailable', () => {
    const s = { time, distance, latlng: null, power: null, hr: null, altitude: null, cadence: null, velocity: null }
    expect(extractStreamInsights(s, ftp, null, null).effort_periods).toBeNull()
    const s2 = { time, distance, latlng: null, power: [200, 200, 200, 200, 200, 200, 200, 200, 200, 200], hr: null, altitude: null, cadence: null, velocity: null }
    expect(extractStreamInsights(s2, null, null, null).effort_periods).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/activity-metrics.test.ts -t "effort period detection"`
Expected: FAIL — `insights.effort_periods` is `undefined` (the field doesn't exist yet on `extractStreamInsights`'s return).

- [ ] **Step 3: Add `smoothPower` and `qualifyingZone` helpers, right after `zoneOf` (currently lines 141-150) in `lib/claude/activity-metrics.ts`**

```typescript
// 30s centred rolling average — raw per-second power is too spiky for direct
// threshold classification (a single second of soft-pedalling mid-interval
// would fragment one hard block into several tiny ones); this is the same
// smoothing convention Normalized Power itself is built on. O(n) via a
// two-pointer sliding window (time is monotonically increasing).
function smoothPower(power: number[], time: number[], windowSecs: number): number[] {
  const half = windowSecs / 2
  const out = new Array(power.length).fill(NaN)
  let lo = 0, hi = 0, sum = 0, n = 0
  for (let i = 0; i < power.length; i++) {
    while (hi < power.length && time[hi] - time[i] <= half) {
      if (Number.isFinite(power[hi])) { sum += power[hi]; n++ }
      hi++
    }
    while (lo < i && time[i] - time[lo] > half) {
      if (Number.isFinite(power[lo])) { sum -= power[lo]; n-- }
      lo++
    }
    out[i] = n ? sum / n : NaN
  }
  return out
}

// Clamps zoneOf's output up to the qualifying effort-period range. Only
// matters for the rare edge case where a run's *average* power (computed from
// raw, unsmoothed samples) lands a hair below the smoothed classification
// that qualified it in the first place.
function qualifyingZone(ratio: number): 'z4' | 'z5' | 'z6' {
  const z = zoneOf(ratio)
  return z === 'z1' || z === 'z2' || z === 'z3' ? 'z4' : z
}
```

- [ ] **Step 4: Add `detectEffortPeriods`, right after `detectClimbs` (currently ending at line 228) in `lib/claude/activity-metrics.ts`**

```typescript
function detectEffortPeriods(
  power: number[] | null, distance: number[] | null, time: number[], ftp: number | null,
): EffortPeriod[] | null {
  if (!power || !distance || !ftp || power.length < 2) return null
  const MIN_SECS = 180
  const smoothed = smoothPower(power, time, 30)
  const inEffort = smoothed.map(p => {
    if (!Number.isFinite(p)) return false
    const z = zoneOf(p / ftp)
    return z === 'z4' || z === 'z5' || z === 'z6'
  })
  const out: EffortPeriod[] = []
  let start = -1
  for (let i = 0; i <= inEffort.length; i++) {
    if (i < inEffort.length && inEffort[i]) {
      if (start === -1) start = i
    } else if (start !== -1) {
      const end = i - 1
      const duration_secs = time[end] - time[start]
      if (duration_secs >= MIN_SECS) {
        let ps = 0, pn = 0
        for (let k = start; k <= end; k++) if (Number.isFinite(power[k])) { ps += power[k]; pn++ }
        const avg_watts = pn ? Math.round(ps / pn) : 0
        out.push({
          start_km: Math.round((distance[start] / 1000) * 10) / 10,
          duration_secs,
          avg_watts,
          zone: qualifyingZone(avg_watts / ftp),
        })
      }
      start = -1
    }
  }
  return out.length ? out : null
}
```

- [ ] **Step 5: Wire it into `extractStreamInsights` (currently lines 294-304)**

Change:
```typescript
export function extractStreamInsights(
  s: RideStreams, ftp: number | null, plannedSteps: WorkoutStep[] | null,
  laps: ActivityInterval[] | null = null,
): Pick<ActivityMetrics, 'decoupling_pct' | 'climbs' | 'time_in_zone' | 'shape'> {
  return {
    decoupling_pct: computeDecoupling(s.power, s.hr, s.time),
    time_in_zone: computeTimeInZone(s.power, s.time, ftp),
    climbs: detectClimbs(s.altitude, s.distance, s.power, s.time),
    shape: computeShape(plannedSteps, laps, s.power, s.time, ftp),
  }
}
```
to:
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

- [ ] **Step 6: Also add the new import of `EffortPeriod` at the top of the file (line 4)**

Change:
```typescript
import type { ICUActivity, ICUPowerCurvePoint, ActivityInterval, ActivityMetrics, WorkoutStep, RideStreams, ClimbSegment, DistributionBin, SessionDistributions } from '@/types'
```
to:
```typescript
import type { ICUActivity, ICUPowerCurvePoint, ActivityInterval, ActivityMetrics, WorkoutStep, RideStreams, ClimbSegment, DistributionBin, SessionDistributions, EffortPeriod } from '@/types'
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/activity-metrics.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones).

- [ ] **Step 8: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add lib/claude/activity-metrics.ts __tests__/lib/activity-metrics.test.ts
git commit -m "Detect sustained Z4+ effort periods from the power stream"
```

---

### Task 3: Extract sprint highlights from existing best_efforts

**Files:**
- Modify: `lib/claude/activity-metrics.ts`
- Modify: `__tests__/lib/activity-metrics.test.ts`

**Interfaces:**
- Consumes: `RideSprint` (Task 1), the existing `best: Array<{secs; watts}>` local built inside `extractActivityMetrics`.
- Produces: file-local `extractSprints`, wired into `extractActivityMetrics`'s return so `ActivityMetrics.sprints` is populated for every enriched ride (no new I/O).

- [ ] **Step 1: Write the failing tests in `__tests__/lib/activity-metrics.test.ts`**

Add to the existing `describe('extractActivityMetrics', ...)` block (after the last `it`, before its closing `})` — the block currently ends around line 92):

```typescript
  it('extracts 5s and 15s sprint entries from best_efforts', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.sprints).toEqual([
      { duration_secs: 5, watts: 600 },
      { duration_secs: 15, watts: 520 },
    ])
  })

  it('returns null sprints when the curve has no 5s/15s points', () => {
    const shortCurve = curve.filter(c => c.secs !== 5 && c.secs !== 15)
    const m = extractActivityMetrics(act, shortCurve, intervals)
    expect(m.sprints).toBeNull()
  })

  it('returns null sprints when there is no curve at all', () => {
    const m = extractActivityMetrics(act, null, intervals)
    expect(m.sprints).toBeNull()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/activity-metrics.test.ts -t "sprint"`
Expected: FAIL — `m.sprints` is `null` for the first test (the placeholder from Task 1), not the expected array.

- [ ] **Step 3: Add `extractSprints`, right after `sampleBest` (currently ending at line 27) in `lib/claude/activity-metrics.ts`**

```typescript
function extractSprints(best: Array<{ secs: number; watts: number }>): RideSprint[] | null {
  const out = best
    .filter(e => e.secs === 5 || e.secs === 15)
    .map(e => ({ duration_secs: e.secs, watts: e.watts }))
  return out.length ? out : null
}
```

- [ ] **Step 4: Wire it into `extractActivityMetrics`'s return object (the `sprints: null` placeholder added in Task 1)**

Change:
```typescript
    effort_periods: null,   // filled by extractStreamInsights (Task 2)
    sprints: null,          // filled below in this function (Task 3)
    personal_bests: null,   // filled by enrichActivity after a 90-day curve fetch (Task 5)
```
to:
```typescript
    effort_periods: null,   // filled by extractStreamInsights (Task 2)
    sprints: extractSprints(best),
    personal_bests: null,   // filled by enrichActivity after a 90-day curve fetch (Task 5)
```

- [ ] **Step 5: Add the new import of `RideSprint` at the top of the file (line 4)**

Change:
```typescript
import type { ICUActivity, ICUPowerCurvePoint, ActivityInterval, ActivityMetrics, WorkoutStep, RideStreams, ClimbSegment, DistributionBin, SessionDistributions, EffortPeriod } from '@/types'
```
to:
```typescript
import type { ICUActivity, ICUPowerCurvePoint, ActivityInterval, ActivityMetrics, WorkoutStep, RideStreams, ClimbSegment, DistributionBin, SessionDistributions, EffortPeriod, RideSprint } from '@/types'
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/activity-metrics.test.ts`
Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/claude/activity-metrics.ts __tests__/lib/activity-metrics.test.ts
git commit -m "Extract 5s/15s sprint highlights from best_efforts"
```

---

### Task 4: Detect personal bests against a 90-day power curve

**Files:**
- Modify: `lib/claude/activity-metrics.ts`
- Modify: `__tests__/lib/activity-metrics.test.ts`

**Interfaces:**
- Consumes: `PersonalBest` (Task 1), file-local `sampleBest(curve, target)` (existing, line 17), `ICUPowerCurvePoint` (existing type).
- Produces: **exported** `detectPersonalBests(rideBestEfforts, ninetyDayCurve): PersonalBest[] | null` — must be exported because Task 5 calls it from `lib/intervals/enrich.ts`, a different file.

- [ ] **Step 1: Write the failing tests in `__tests__/lib/activity-metrics.test.ts`**

First, add `detectPersonalBests` to the file's existing top import line (currently line 2):
```typescript
import { extractActivityMetrics, formatActivityMetrics, formatRideExecution, METRICS_VERSION } from '@/lib/claude/activity-metrics'
```
becomes:
```typescript
import { extractActivityMetrics, formatActivityMetrics, formatRideExecution, detectPersonalBests, METRICS_VERSION } from '@/lib/claude/activity-metrics'
```

Then add a new `describe` block, after the `extractActivityMetrics` block:

```typescript
describe('detectPersonalBests', () => {
  const rideBest = [{ secs: 300, watts: 312 }, { secs: 1200, watts: 264 }]

  it('flags a duration where this ride ties or beats the 90-day curve max', () => {
    const ninetyDayCurve: ICUPowerCurvePoint[] = [
      { secs: 300, watts: 312 },   // this ride currently holds the best
      { secs: 1200, watts: 290 },  // a different day was better — not a PB
    ]
    expect(detectPersonalBests(rideBest, ninetyDayCurve)).toEqual([
      { duration_secs: 300, watts: 312, window_days: 90 },
    ])
  })

  it('returns null when no duration qualifies', () => {
    const ninetyDayCurve: ICUPowerCurvePoint[] = [
      { secs: 300, watts: 340 }, { secs: 1200, watts: 290 },
    ]
    expect(detectPersonalBests(rideBest, ninetyDayCurve)).toBeNull()
  })

  it('returns null when best_efforts or the curve is null/empty', () => {
    expect(detectPersonalBests(null, [{ secs: 300, watts: 312 }])).toBeNull()
    expect(detectPersonalBests(rideBest, null)).toBeNull()
    expect(detectPersonalBests(rideBest, [])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/activity-metrics.test.ts -t "detectPersonalBests"`
Expected: FAIL — `detectPersonalBests` is not exported/does not exist yet (TypeScript/import error, or ReferenceError).

- [ ] **Step 3: Add `detectPersonalBests`, right after `extractActivityMetrics` (currently ending at line 62) in `lib/claude/activity-metrics.ts`**

```typescript
export function detectPersonalBests(
  rideBestEfforts: Array<{ secs: number; watts: number }> | null,
  ninetyDayCurve: ICUPowerCurvePoint[] | null,
): PersonalBest[] | null {
  if (!rideBestEfforts?.length || !ninetyDayCurve?.length) return null
  const out: PersonalBest[] = []
  for (const e of rideBestEfforts) {
    const best = sampleBest(ninetyDayCurve, e.secs)
    if (best && best.watts <= e.watts) {
      out.push({ duration_secs: e.secs, watts: e.watts, window_days: 90 })
    }
  }
  return out.length ? out : null
}
```

- [ ] **Step 4: Add the new import of `PersonalBest` at the top of the file (line 4)**

Change:
```typescript
import type { ICUActivity, ICUPowerCurvePoint, ActivityInterval, ActivityMetrics, WorkoutStep, RideStreams, ClimbSegment, DistributionBin, SessionDistributions, EffortPeriod, RideSprint } from '@/types'
```
to:
```typescript
import type { ICUActivity, ICUPowerCurvePoint, ActivityInterval, ActivityMetrics, WorkoutStep, RideStreams, ClimbSegment, DistributionBin, SessionDistributions, EffortPeriod, RideSprint, PersonalBest } from '@/types'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/activity-metrics.test.ts`
Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/claude/activity-metrics.ts __tests__/lib/activity-metrics.test.ts
git commit -m "Add detectPersonalBests: compares ride best_efforts against a 90-day curve"
```

---

### Task 5: Wire personal bests into `enrichActivity`, bump `METRICS_VERSION`

**Files:**
- Modify: `lib/intervals/enrich.ts`
- Modify: `lib/claude/activity-metrics.ts` (`METRICS_VERSION` constant, line 15)
- Modify: `__tests__/lib/activity-metrics.test.ts` (the "bumps METRICS_VERSION" test, currently lines 90-92)
- Modify: `__tests__/lib/enrich.test.ts`

**Interfaces:**
- Consumes: `detectPersonalBests` (Task 4), the existing `client.getPowerCurve(oldest, newest): Promise<ICUPowerCurvePoint[]>` (`lib/intervals/client.ts`, unchanged).
- Produces: `enrichActivity` now returns a fully-populated `personal_bests` field. `METRICS_VERSION` becomes `4`, which — via the existing, unmodified `backfillActivityMetrics` predicate (`metrics_version < METRICS_VERSION`) — causes every historical ride to be re-enriched (picking up `effort_periods`/`sprints`/`personal_bests` for the first time) the next time a sync or `?deep=1` backfill runs. This is the entire "backfill everything" mechanism for this feature; no new backfill code is needed.

- [ ] **Step 1: Write the failing test in `__tests__/lib/enrich.test.ts`**

Add this test to the existing `describe('backfillActivityMetrics', ...)` block, reusing the file's existing `makeClient()` and `makeSupabase()` helpers exactly as the other tests in this file do:

```typescript
  it('fetches a 90-day power curve anchored on the ride\'s own date, not today', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase([{ id: 'w1', icu_activity_id: 'a1', steps: null }], updateSpy)
    const client = makeClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await backfillActivityMetrics(supabase as any, client as any, 'u1')

    // a1's start_date_local (from makeClient's getActivity mock) is 2026-05-20;
    // 90 days before that is 2026-02-19, independent of the current wall-clock date.
    expect(client.getPowerCurve).toHaveBeenCalledWith('2026-02-19', '2026-05-20')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/lib/enrich.test.ts -t "90-day power curve"`
Expected: FAIL — `getPowerCurve` was only ever called with `('2026-05-20', '2026-05-20')` (the existing single-day call), not the 90-day range.

- [ ] **Step 3: Update `enrichActivity` in `lib/intervals/enrich.ts`**

Change:
```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ICUActivity, ActivityMetrics, WorkoutStep, RideStreams } from '@/types'
import type { IntervalsClient } from './client'
import { extractActivityMetrics, extractStreamInsights, extractDistributions, METRICS_VERSION } from '@/lib/claude/activity-metrics'
```
to:
```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ICUActivity, ActivityMetrics, WorkoutStep, RideStreams } from '@/types'
import type { IntervalsClient } from './client'
import { extractActivityMetrics, extractStreamInsights, extractDistributions, detectPersonalBests, METRICS_VERSION } from '@/lib/claude/activity-metrics'
```

Change the body of `enrichActivity` from:
```typescript
export async function enrichActivity(
  client: IntervalsClient,
  activity: ICUActivity,
  ftp: number | null,
  lthr: number | null,
  plannedSteps: WorkoutStep[] | null,
): Promise<ActivityMetrics> {
  const date = activity.start_date_local.split('T')[0]
  const [curve, intervals, streams] = await Promise.all([
    client.getPowerCurve(date, date).catch(() => null),
    client.getActivityIntervals(activity.id).catch(() => null),
    client.getActivityStreams(activity.id).catch(() => null),
  ])
  const base = extractActivityMetrics(activity, curve, intervals)
  if (!streams) {
    return { ...base, distributions: extractDistributions(EMPTY_STREAMS, ftp, lthr, base.np, base.avg_power) }
  }
  return {
    ...base,
    ...extractStreamInsights(streams, ftp, plannedSteps, intervals),
    distributions: extractDistributions(streams, ftp, lthr, base.np, base.avg_power),
  }
}
```
to:
```typescript
export async function enrichActivity(
  client: IntervalsClient,
  activity: ICUActivity,
  ftp: number | null,
  lthr: number | null,
  plannedSteps: WorkoutStep[] | null,
): Promise<ActivityMetrics> {
  const date = activity.start_date_local.split('T')[0]
  // Anchored on the RIDE's own date, not "now" — critical for backfilling old
  // rides correctly, where each ride's 90-day PB window must end on its own
  // date, not on today's.
  const ninetyDaysBefore = new Date(new Date(`${date}T00:00:00Z`).getTime() - 90 * 86400000)
    .toISOString().split('T')[0]
  const [curve, intervals, streams, ninetyDayCurve] = await Promise.all([
    client.getPowerCurve(date, date).catch(() => null),
    client.getActivityIntervals(activity.id).catch(() => null),
    client.getActivityStreams(activity.id).catch(() => null),
    client.getPowerCurve(ninetyDaysBefore, date).catch(() => null),
  ])
  const base = extractActivityMetrics(activity, curve, intervals)
  const personal_bests = detectPersonalBests(base.best_efforts, ninetyDayCurve)
  if (!streams) {
    return { ...base, distributions: extractDistributions(EMPTY_STREAMS, ftp, lthr, base.np, base.avg_power), personal_bests }
  }
  return {
    ...base,
    ...extractStreamInsights(streams, ftp, plannedSteps, intervals),
    distributions: extractDistributions(streams, ftp, lthr, base.np, base.avg_power),
    personal_bests,
  }
}
```

- [ ] **Step 4: Bump `METRICS_VERSION` in `lib/claude/activity-metrics.ts` (line 15)**

Change:
```typescript
export const METRICS_VERSION = 3
```
to:
```typescript
export const METRICS_VERSION = 4
```

- [ ] **Step 5: Update the version-bump test in `__tests__/lib/activity-metrics.test.ts` (currently lines 90-92)**

Change:
```typescript
  it('bumps METRICS_VERSION to 3', () => {
    expect(METRICS_VERSION).toBe(3)
  })
```
to:
```typescript
  it('bumps METRICS_VERSION to 4', () => {
    expect(METRICS_VERSION).toBe(4)
  })
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/enrich.test.ts __tests__/lib/activity-metrics.test.ts`
Expected: PASS — including the pre-existing `expect(client.getPowerCurve).toHaveBeenCalledWith('2026-05-20', '2026-05-20')` assertion elsewhere in `enrich.test.ts`, which still holds since `getPowerCurve` is now called twice (with different arguments) and `toHaveBeenCalledWith` matches any call, not only the most recent one.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npx jest`
Expected: all tests pass.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/intervals/enrich.ts lib/claude/activity-metrics.ts __tests__/lib/enrich.test.ts __tests__/lib/activity-metrics.test.ts
git commit -m "Wire personal-bests detection into enrichActivity; bump METRICS_VERSION to trigger backfill"
```

---

### Task 6: Unified highlight ordering helper

**Files:**
- Create: `lib/ride-highlights.ts`
- Create: `__tests__/lib/ride-highlights.test.ts`

**Interfaces:**
- Consumes: `ClimbSegment`, `EffortPeriod`, `RideSprint`, `PersonalBest` (all from `@/types`, Task 1 for the new three).
- Produces: `RideHighlightKind`, `RideHighlight`, `buildHighlightList(metrics): RideHighlight[]` — consumed by Task 7 (the rendering component) and Tasks 9-10 (the two modals).

- [ ] **Step 1: Write the failing test, `__tests__/lib/ride-highlights.test.ts`**

```typescript
/** @jest-environment node */
import { buildHighlightList } from '@/lib/ride-highlights'
import type { ClimbSegment, EffortPeriod, RideSprint, PersonalBest } from '@/types'

const climb: ClimbSegment = { start_km: 10, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }
const effort: EffortPeriod = { start_km: 5, duration_secs: 300, avg_watts: 230, zone: 'z4' }
const sprint: RideSprint = { duration_secs: 5, watts: 890 }
const personalBest: PersonalBest = { duration_secs: 300, watts: 312, window_days: 90 }

describe('buildHighlightList', () => {
  it('interleaves climbs and effort periods by start_km, then appends sprints then personal bests', () => {
    const list = buildHighlightList({
      climbs: [climb], effort_periods: [effort], sprints: [sprint], personal_bests: [personalBest],
    })
    expect(list).toEqual([
      { kind: 'effort', start_km: 5, data: effort },
      { kind: 'climb', start_km: 10, data: climb },
      { kind: 'sprint', start_km: null, data: sprint },
      { kind: 'personal_best', start_km: null, data: personalBest },
    ])
  })

  it('does not deduplicate an overlapping climb and effort at the same start_km', () => {
    const overlappingEffort: EffortPeriod = { ...effort, start_km: 10 }
    const list = buildHighlightList({
      climbs: [climb], effort_periods: [overlappingEffort], sprints: null, personal_bests: null,
    })
    expect(list).toHaveLength(2)
  })

  it('returns an empty array when every field is null', () => {
    expect(buildHighlightList({ climbs: null, effort_periods: null, sprints: null, personal_bests: null })).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/lib/ride-highlights.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ride-highlights'`.

- [ ] **Step 3: Create `lib/ride-highlights.ts`**

```typescript
import type { ActivityMetrics, ClimbSegment, EffortPeriod, RideSprint, PersonalBest } from '@/types'

export type RideHighlightKind = 'climb' | 'effort' | 'sprint' | 'personal_best'

export interface RideHighlight {
  kind: RideHighlightKind
  start_km: number | null   // null for sprint/personal_best — no location data
  data: ClimbSegment | EffortPeriod | RideSprint | PersonalBest
}

type HighlightSource = Pick<ActivityMetrics, 'climbs' | 'effort_periods' | 'sprints' | 'personal_bests'>

// Climbs and effort periods are merged and sorted by ride position — they can
// legitimately overlap (a hard effort partway up a climb produces both a climb
// card and an effort card) and are deliberately NOT deduplicated; each is a
// distinct lens on the same stretch of the ride. Sprints and personal bests
// carry no ride position, so they're grouped at the tail instead of being
// forced into arbitrary chronological slots.
export function buildHighlightList(metrics: HighlightSource): RideHighlight[] {
  const located: RideHighlight[] = [
    ...(metrics.climbs ?? []).map(c => ({ kind: 'climb' as const, start_km: c.start_km, data: c })),
    ...(metrics.effort_periods ?? []).map(e => ({ kind: 'effort' as const, start_km: e.start_km, data: e })),
  ].sort((a, b) => a.start_km - b.start_km)

  const sprints: RideHighlight[] = (metrics.sprints ?? [])
    .map(s => ({ kind: 'sprint' as const, start_km: null, data: s }))
  const personalBests: RideHighlight[] = (metrics.personal_bests ?? [])
    .map(p => ({ kind: 'personal_best' as const, start_km: null, data: p }))

  return [...located, ...sprints, ...personalBests]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/lib/ride-highlights.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/ride-highlights.ts __tests__/lib/ride-highlights.test.ts
git commit -m "Add buildHighlightList: merges and orders climbs/efforts/sprints/PBs"
```

---

### Task 7: `RideHighlightsTab` rendering component

**Files:**
- Create: `components/RideHighlightsTab.tsx`
- Create: `__tests__/components/RideHighlightsTab.test.tsx`

**Interfaces:**
- Consumes: `RideHighlight` (Task 6).
- Produces: `RideHighlightsTab({ highlights: RideHighlight[] })` — a default export, consumed by Tasks 9-10.

- [ ] **Step 1: Write the failing test, `__tests__/components/RideHighlightsTab.test.tsx`**

```typescript
import { render, screen } from '@testing-library/react'
import RideHighlightsTab from '@/components/RideHighlightsTab'
import type { RideHighlight } from '@/lib/ride-highlights'

const highlights: RideHighlight[] = [
  { kind: 'effort', start_km: 5, data: { start_km: 5, duration_secs: 300, avg_watts: 230, zone: 'z4' } },
  { kind: 'climb', start_km: 10, data: { start_km: 10, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 } },
  { kind: 'sprint', start_km: null, data: { duration_secs: 5, watts: 890 } },
  { kind: 'personal_best', start_km: null, data: { duration_secs: 300, watts: 312, window_days: 90 } },
]

describe('RideHighlightsTab', () => {
  it('renders one card per highlight in the given order', () => {
    render(<RideHighlightsTab highlights={highlights} />)
    expect(screen.getByText(/Effort/)).toBeInTheDocument()
    expect(screen.getByText(/km 5/)).toBeInTheDocument()
    expect(screen.getByText(/5min in Z4 Threshold/)).toBeInTheDocument()
    expect(screen.getByText(/230W avg/)).toBeInTheDocument()

    expect(screen.getByText(/Climb/)).toBeInTheDocument()
    expect(screen.getByText(/km 10/)).toBeInTheDocument()
    expect(screen.getByText(/8min · 90m gain · 268W avg · VAM 675/)).toBeInTheDocument()

    expect(screen.getByText(/Sprint/)).toBeInTheDocument()
    expect(screen.getByText(/5s · 890W/)).toBeInTheDocument()

    expect(screen.getByText(/Personal best/)).toBeInTheDocument()
    expect(screen.getByText(/5min power: 312W \(90-day best\)/)).toBeInTheDocument()
  })

  it('renders nothing when there are no highlights', () => {
    const { container } = render(<RideHighlightsTab highlights={[]} />)
    expect(container.querySelectorAll('[data-testid="highlight-card"]')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/components/RideHighlightsTab.test.tsx`
Expected: FAIL — `Cannot find module '@/components/RideHighlightsTab'`.

- [ ] **Step 3: Create `components/RideHighlightsTab.tsx`**

```tsx
'use client'
import type { RideHighlight } from '@/lib/ride-highlights'
import type { ClimbSegment, EffortPeriod, RideSprint, PersonalBest } from '@/types'

const ZONE_LABEL: Record<'z4' | 'z5' | 'z6', string> = {
  z4: 'Z4 Threshold', z5: 'Z5 VO2max', z6: 'Z6 Anaerobic',
}

function mins(secs: number): number {
  return Math.round(secs / 60)
}

function durationLabel(secs: number): string {
  return secs < 60 ? `${secs}s` : `${mins(secs)}min`
}

function Card({ icon, kind, children }: { icon: string; kind: string; children: React.ReactNode }) {
  return (
    <div data-testid="highlight-card" className="flex items-start gap-3 p-3 rounded-xl bg-white border border-gray-100">
      <span className="text-xl shrink-0" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">{kind}</p>
        {children}
      </div>
    </div>
  )
}

function ClimbCard({ c }: { c: ClimbSegment }) {
  return (
    <Card icon="🏔️" kind={`Climb · km ${c.start_km}`}>
      <p className="text-sm text-gray-900">
        {mins(c.duration_secs)}min · {c.elev_gain_m}m gain{c.avg_watts != null ? ` · ${c.avg_watts}W avg` : ''} · VAM {c.vam}
      </p>
    </Card>
  )
}

function EffortCard({ e }: { e: EffortPeriod }) {
  return (
    <Card icon="⚡" kind={`Effort · km ${e.start_km}`}>
      <p className="text-sm text-gray-900">{mins(e.duration_secs)}min in {ZONE_LABEL[e.zone]} · {e.avg_watts}W avg</p>
    </Card>
  )
}

function SprintCard({ s }: { s: RideSprint }) {
  return (
    <Card icon="🏁" kind="Sprint">
      <p className="text-sm text-gray-900">{durationLabel(s.duration_secs)} · {s.watts}W</p>
    </Card>
  )
}

function PersonalBestCard({ p }: { p: PersonalBest }) {
  return (
    <Card icon="🏆" kind="Personal best">
      <p className="text-sm text-gray-900">{durationLabel(p.duration_secs)} power: {p.watts}W ({p.window_days}-day best)</p>
    </Card>
  )
}

export default function RideHighlightsTab({ highlights }: { highlights: RideHighlight[] }) {
  return (
    <div className="space-y-2">
      {highlights.map((h, i) => {
        if (h.kind === 'climb') return <ClimbCard key={i} c={h.data as ClimbSegment} />
        if (h.kind === 'effort') return <EffortCard key={i} e={h.data as EffortPeriod} />
        if (h.kind === 'sprint') return <SprintCard key={i} s={h.data as RideSprint} />
        return <PersonalBestCard key={i} p={h.data as PersonalBest} />
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/components/RideHighlightsTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/RideHighlightsTab.tsx __tests__/components/RideHighlightsTab.test.tsx
git commit -m "Add RideHighlightsTab component"
```

---

### Task 8: Highlights API route for `ActivityDetailModal`

**Files:**
- Create: `app/api/rides/activity/[activityId]/highlights/route.ts`
- Create: `__tests__/api/ride-highlights-route.test.ts`

**Interfaces:**
- Produces: `GET /api/rides/activity/[activityId]/highlights` → `{ climbs, effort_periods, sprints, personal_bests }`, each `null` when absent. Consumed by Task 10.

- [ ] **Step 1: Write the failing test, `__tests__/api/ride-highlights-route.test.ts`**

```typescript
/** @jest-environment node */
import { GET } from '@/app/api/rides/activity/[activityId]/highlights/route'

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

function supabaseStub(rows: unknown[], userId: string | null = 'u1') {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: async () => ({ data: rows }),
          }),
        }),
      }),
    }),
  }
}

const ctx = (id: string) => ({ params: Promise.resolve({ activityId: id }) })

describe('GET /api/rides/activity/[activityId]/highlights', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([], null))
    const res = await GET({} as Request as never, ctx('a1') as never)
    expect(res.status).toBe(401)
  })

  it('returns the four highlight fields from the linked workout row', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([{
      activity_metrics: {
        climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
        effort_periods: [{ start_km: 2, duration_secs: 200, avg_watts: 240, zone: 'z4' }],
        sprints: [{ duration_secs: 5, watts: 890 }],
        personal_bests: [{ duration_secs: 300, watts: 312, window_days: 90 }],
      },
    }]))
    const res = await GET({} as Request as never, ctx('a1') as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.climbs).toHaveLength(1)
    expect(body.effort_periods).toHaveLength(1)
    expect(body.sprints).toHaveLength(1)
    expect(body.personal_bests).toHaveLength(1)
  })

  it('returns all-null fields when there is no linked workout row', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([]))
    const res = await GET({} as Request as never, ctx('a1') as never)
    const body = await res.json()
    expect(body).toEqual({ climbs: null, effort_periods: null, sprints: null, personal_bests: null })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/api/ride-highlights-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/rides/activity/[activityId]/highlights/route'`.

- [ ] **Step 3: Create `app/api/rides/activity/[activityId]/highlights/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// Persisted ride highlights (climbs, effort periods, sprints, personal bests)
// for an activity, read from the linked workout row (keyed by icu_activity_id).
// Each field is null when there's no row or it hasn't been enriched yet.
// Scoped to the signed-in user. Mirrors the /distributions route exactly.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ activityId: string }> },
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { activityId } = await params
  if (!activityId) return NextResponse.json({ error: 'Missing activity id' }, { status: 400 })

  const { data: rows } = await supabase
    .from('workouts')
    .select('activity_metrics')
    .eq('user_id', user.id)
    .eq('icu_activity_id', activityId)
    .limit(1)

  const metrics = (rows?.[0]?.activity_metrics ?? null) as {
    climbs?: unknown; effort_periods?: unknown; sprints?: unknown; personal_bests?: unknown
  } | null
  return NextResponse.json({
    climbs: metrics?.climbs ?? null,
    effort_periods: metrics?.effort_periods ?? null,
    sprints: metrics?.sprints ?? null,
    personal_bests: metrics?.personal_bests ?? null,
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/api/ride-highlights-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/rides/activity/[activityId]/highlights/route.ts __tests__/api/ride-highlights-route.test.ts
git commit -m "Add /api/rides/activity/[activityId]/highlights route"
```

---

### Task 9: Wire the Highlights tab into `WorkoutDetailModal`

**Files:**
- Modify: `components/WorkoutDetailModal.tsx`
- Modify: `__tests__/components/WorkoutDetailModal.test.tsx`

**Interfaces:**
- Consumes: `buildHighlightList` (Task 6), `RideHighlightsTab` (Task 7).

- [ ] **Step 1: Write the failing tests in `__tests__/components/WorkoutDetailModal.test.tsx`**

Add these two tests to the existing `describe('WorkoutDetailModal tabs', ...)` block (which already defines `completedLinked` with `activity_metrics: null`):

```typescript
  it('shows a Highlights tab when the linked ride has at least one highlight', async () => {
    const withClimb = {
      ...completedLinked,
      activity_metrics: makeActivityMetrics({
        climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
      }),
    }
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ feedback: null }) })) as never
    render(<WorkoutDetailModal workout={withClimb} athleteId="i1" ftp={250} onClose={() => {}} />)
    expect(await screen.findByRole('tab', { name: 'Highlights' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Highlights' }))
    expect(screen.getByText(/Climb/)).toBeInTheDocument()
  })

  it('hides the Highlights tab when the linked ride has no highlights', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ feedback: null }) })) as never
    render(<WorkoutDetailModal workout={completedLinked} athleteId="i1" ftp={250} onClose={() => {}} />)
    await screen.findByRole('tab', { name: 'Stats' })
    expect(screen.queryByRole('tab', { name: 'Highlights' })).toBeNull()
  })
```

Add the `makeActivityMetrics` import to the file's existing factory import line (currently `import { makeWorkout, makeActivityMetrics } from '../support/factories'` per the research — confirm and add `makeActivityMetrics` if it isn't already imported).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/components/WorkoutDetailModal.test.tsx -t "Highlights"`
Expected: FAIL — no `'Highlights'` tab exists yet.

- [ ] **Step 3: Add the imports and highlight computation to `components/WorkoutDetailModal.tsx`**

Add to the top imports (after the `TabBar` import, line 11):
```typescript
import RideHighlightsTab from './RideHighlightsTab'
import { buildHighlightList } from '@/lib/ride-highlights'
```

Change the tab state (line 71) from:
```typescript
  const [tab, setTab] = useState<'overview' | 'stats' | 'map' | 'feedback'>('overview')
```
to:
```typescript
  const [tab, setTab] = useState<'overview' | 'stats' | 'map' | 'feedback' | 'highlights'>('overview')
```

Add, right after the `hasRide` computation (line 82):
```typescript
  const highlights = workout.activity_metrics ? buildHighlightList(workout.activity_metrics) : []
```

- [ ] **Step 4: Add the tab entry and conditional render branch**

Change the `tabs` array construction (currently lines 461-476) from:
```tsx
        {(() => {
          const isCompleted = workout.status === 'completed' || workout.status === 'needs_review'
          const hasFeedbackDot = isCompleted && existingFeedback === null && !feedbackSaved
          const tabs = [
            { id: 'overview', label: 'Overview' },
            ...(hasRide ? [{ id: 'stats', label: 'Stats' }, { id: 'map', label: 'Map' }] : []),
            ...(isCompleted ? [{ id: 'feedback', label: 'Feedback', dot: hasFeedbackDot }] : []),
          ]
          return tabs.length > 1 ? (
            <TabBar
              tabs={tabs}
              activeId={tab}
              onSelect={(id) => setTab(id as 'overview' | 'stats' | 'map' | 'feedback')}
            />
          ) : null
        })()}
```
to:
```tsx
        {(() => {
          const isCompleted = workout.status === 'completed' || workout.status === 'needs_review'
          const hasFeedbackDot = isCompleted && existingFeedback === null && !feedbackSaved
          const tabs = [
            { id: 'overview', label: 'Overview' },
            ...(hasRide ? [{ id: 'stats', label: 'Stats' }, { id: 'map', label: 'Map' }] : []),
            ...(highlights.length ? [{ id: 'highlights', label: 'Highlights' }] : []),
            ...(isCompleted ? [{ id: 'feedback', label: 'Feedback', dot: hasFeedbackDot }] : []),
          ]
          return tabs.length > 1 ? (
            <TabBar
              tabs={tabs}
              activeId={tab}
              onSelect={(id) => setTab(id as 'overview' | 'stats' | 'map' | 'feedback' | 'highlights')}
            />
          ) : null
        })()}
```

Change the top of the render-chain ternary (currently lines 478-486) from:
```tsx
        {hasRide && tab === 'map' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {streams
              ? <RideMapGraph streams={streams} fit />
              : <p className="p-5 text-sm text-slate-400">{streamsError ? 'Could not load ride data.' : 'Loading ride…'}</p>}
          </div>
        ) : tab === 'feedback' ? (
```
to:
```tsx
        {hasRide && tab === 'map' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {streams
              ? <RideMapGraph streams={streams} fit />
              : <p className="p-5 text-sm text-slate-400">{streamsError ? 'Could not load ride data.' : 'Loading ride…'}</p>}
          </div>
        ) : tab === 'highlights' ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-5">
            <RideHighlightsTab highlights={highlights} />
          </div>
        ) : tab === 'feedback' ? (
```
(the rest of the ternary chain — the `feedback` arm and the trailing overview/stats `<div>` — is unchanged).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/components/WorkoutDetailModal.test.tsx`
Expected: PASS — all tests in the file, including pre-existing ones.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/WorkoutDetailModal.tsx __tests__/components/WorkoutDetailModal.test.tsx
git commit -m "Add Highlights tab to WorkoutDetailModal"
```

---

### Task 10: Wire the Highlights tab into `ActivityDetailModal`

**Files:**
- Modify: `components/ActivityDetailModal.tsx`
- Modify: `__tests__/components/ActivityDetailModal.test.tsx`

**Interfaces:**
- Consumes: `buildHighlightList` (Task 6), `RideHighlightsTab` (Task 7), `GET /api/rides/activity/[activityId]/highlights` (Task 8).

- [ ] **Step 1: Write the failing tests in `__tests__/components/ActivityDetailModal.test.tsx`**

Add these two tests to the existing `describe('ActivityDetailModal', ...)` block:

```typescript
  it('shows a Highlights tab when the highlights fetch returns at least one highlight', async () => {
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/highlights')
        ? Promise.resolve({ ok: true, json: async () => ({
            climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
            effort_periods: null, sprints: null, personal_bests: null,
          }) })
        : Promise.resolve({ ok: true, json: async () => ({ streams: null }) }),
    ) as never
    render(<ActivityDetailModal activity={activity} onClose={() => {}} />)
    expect(await screen.findByRole('tab', { name: 'Highlights' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Highlights' }))
    expect(screen.getByText(/Climb/)).toBeInTheDocument()
  })

  it('hides the Highlights tab when the highlights fetch returns nothing', async () => {
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/highlights')
        ? Promise.resolve({ ok: true, json: async () => ({ climbs: null, effort_periods: null, sprints: null, personal_bests: null }) })
        : Promise.resolve({ ok: true, json: async () => ({ streams: null }) }),
    ) as never
    render(<ActivityDetailModal activity={activity} onClose={() => {}} />)
    await screen.findByRole('tab', { name: 'Stats' })
    expect(screen.queryByRole('tab', { name: 'Highlights' })).toBeNull()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/components/ActivityDetailModal.test.tsx -t "Highlights"`
Expected: FAIL — no `'Highlights'` tab exists yet.

- [ ] **Step 3: Update `components/ActivityDetailModal.tsx`**

Add to the top imports (line 6, after `SessionHistogram`):
```typescript
import RideHighlightsTab from './RideHighlightsTab'
import { buildHighlightList, type RideHighlight } from '@/lib/ride-highlights'
```

Change the tab state (line 21) from:
```typescript
  const [tab, setTab] = useState<'stats' | 'map'>('stats')
```
to:
```typescript
  const [tab, setTab] = useState<'stats' | 'map' | 'highlights'>('stats')
```

Add a new state variable, right after the `distributions` state (line 24):
```typescript
  const [highlights, setHighlights] = useState<RideHighlight[]>([])
```

Add a new effect, right after the distributions-fetch effect (currently lines 26-35):
```typescript
  // Ride highlights (climbs, effort periods, sprints, personal bests) live on
  // the same linked workout row as distributions; fetched separately since
  // they're a distinct concern with their own route, matching this file's
  // existing per-concern fetch convention.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/rides/activity/${activity.id}/highlights`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setHighlights(buildHighlightList(d)) })
      .catch(() => { /* no highlights if they can't be loaded */ })
    return () => { cancelled = true }
  }, [activity.id])
```

- [ ] **Step 4: Add the tab entry and conditional render branch**

Change the `TabBar` usage (currently lines 66-70) from:
```tsx
        <TabBar
          tabs={[{ id: 'stats', label: 'Stats' }, { id: 'map', label: 'Map' }]}
          activeId={tab}
          onSelect={(id) => setTab(id as 'stats' | 'map')}
        />
```
to:
```tsx
        <TabBar
          tabs={[
            { id: 'stats', label: 'Stats' },
            { id: 'map', label: 'Map' },
            ...(highlights.length ? [{ id: 'highlights', label: 'Highlights' }] : []),
          ]}
          activeId={tab}
          onSelect={(id) => setTab(id as 'stats' | 'map' | 'highlights')}
        />
```

Change the render branch (currently lines 72-83) from:
```tsx
        {tab === 'map' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {streams
              ? <RideMapGraph streams={streams} fit />
              : <p className="p-6 text-sm text-slate-400">{streamsError ? 'Could not load ride data.' : 'Loading ride…'}</p>}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-6 pt-4 space-y-4">
            <RideStats data={rideStatsFromActivity(activity)} effectiveMaxHr={effectiveMaxHr} />
            <SessionHistogram distributions={distributions} />
          </div>
        )}
```
to:
```tsx
        {tab === 'map' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {streams
              ? <RideMapGraph streams={streams} fit />
              : <p className="p-6 text-sm text-slate-400">{streamsError ? 'Could not load ride data.' : 'Loading ride…'}</p>}
          </div>
        ) : tab === 'highlights' ? (
          <div className="flex-1 min-h-0 overflow-y-auto p-6 pt-4">
            <RideHighlightsTab highlights={highlights} />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-6 pt-4 space-y-4">
            <RideStats data={rideStatsFromActivity(activity)} effectiveMaxHr={effectiveMaxHr} />
            <SessionHistogram distributions={distributions} />
          </div>
        )}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/components/ActivityDetailModal.test.tsx`
Expected: PASS — all tests in the file, including pre-existing ones (the pre-existing tests' `global.fetch` mocks that don't special-case `/highlights` will fall through to their `else` branch, returning `{ streams: null }` for the highlights fetch too; `buildHighlightList` on that shape produces `[]`, so `setHighlights([])` — no behavior change for those tests).

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/ActivityDetailModal.tsx __tests__/components/ActivityDetailModal.test.tsx
git commit -m "Add Highlights tab to ActivityDetailModal"
```

---

## Post-plan verification

After all 10 tasks are complete:

```bash
npm run test:ci
```

Expected: full suite + typecheck both pass, matching the CI pipeline exactly (per `AGENTS.md`).
