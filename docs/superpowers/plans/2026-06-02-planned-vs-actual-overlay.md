# Planned-vs-Actual Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `WorkoutDetailModal`, overlay the actual ride power trace on the planned target profile (shared %FTP axis) for completed, linked workouts, with a per-step planned-vs-actual numbers list.

**Architecture:** One pure alignment helper (`lib/ride/planned-actual.ts`) turns planned steps + actual power stream + detected laps + FTP into a unified `PlannedActual` model. Two presentational components render it (chart + numbers). The existing ride-streams endpoint is extended to also return laps, and the modal fetches it on demand for completed/linked workouts, falling back to today's target-only chart whenever the data isn't usable.

**Tech Stack:** Next.js App Router, React 19, TypeScript (strict), Tailwind, Jest + @testing-library/react. Type gate is `npm run typecheck` (SWC skips types in Jest, so tsc is the real gate).

**Spec:** `docs/superpowers/specs/2026-06-02-planned-vs-actual-overlay-design.md`

**Convention:** Every commit message ends with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (shown abbreviated as `<trailer>` in steps below — include the full line).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `lib/ride/planned-actual.ts` (new) | Pure alignment math: `buildPlannedActual(...)` → `PlannedActual \| null` |
| `__tests__/lib/planned-actual.test.ts` (new) | Unit tests for the helper |
| `components/PlannedVsActualChart.tsx` (new) | SVG: target bars + actual trace on shared %FTP axis |
| `__tests__/components/PlannedVsActualChart.test.tsx` (new) | Render smoke test |
| `components/PlannedVsActualList.tsx` (new) | Per-step planned→actual numbers + delta |
| `__tests__/components/PlannedVsActualList.test.tsx` (new) | Delta math test |
| `app/api/rides/[workoutId]/streams/route.ts` (modify) | Also return `intervals` (laps) |
| `__tests__/api/ride-streams.test.ts` (modify) | Cover the new `intervals` field |
| `components/WorkoutDetailModal.tsx` (modify) | Fetch + swap chart in place; fall back |
| `__tests__/components/WorkoutDetailModal.test.tsx` (new) | Falls back without activity/ftp; no stream fetch |

Reused as-is: `zoneFor`, `fmtTime` (exported from `components/WorkoutProfileChart.tsx`), `smoothSeries` (from `lib/ride/graph-math.ts`), `downsampleStreams` (from `lib/intervals/streams.ts`), `IntervalsClient.getActivityIntervals`.

---

## Task 1: Alignment helper `buildPlannedActual`

**Files:**
- Create: `lib/ride/planned-actual.ts`
- Test: `__tests__/lib/planned-actual.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/planned-actual.test.ts`:

```ts
import { buildPlannedActual } from '@/lib/ride/planned-actual'
import type { WorkoutStep, ActivityInterval, RideStreams } from '@/types'

const steps: WorkoutStep[] = [
  { label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 },
  { label: 'Effort', duration_minutes: 10, power_pct_ftp: 100 },
]
// 20 min ride sampled each minute; first half ~150W, second half ~250W.
const time = Array.from({ length: 21 }, (_, i) => i * 60)
const power = time.map(t => (t < 600 ? 150 : 250))
const streams: Pick<RideStreams, 'time' | 'power'> = { time, power }

describe('buildPlannedActual', () => {
  it('returns null without ftp, power, or steps', () => {
    expect(buildPlannedActual(steps, streams, null, null)).toBeNull()
    expect(buildPlannedActual(steps, { time, power: null }, null, 250)).toBeNull()
    expect(buildPlannedActual([], streams, null, 250)).toBeNull()
  })

  it('lap-anchors when lap count equals step count, using lap avg_watts', () => {
    const laps: ActivityInterval[] = [
      { label: 'wu', duration_secs: 540, avg_watts: 148, avg_hr: null },   // 9 min
      { label: 'eff', duration_secs: 660, avg_watts: 252, avg_hr: null },  // 11 min
    ]
    const out = buildPlannedActual(steps, streams, laps, 250)!
    expect(out.aligned).toBe('laps')
    expect(out.segments[0].width_frac).toBeCloseTo(540 / 1200, 5)
    expect(out.segments[0].actual_w).toBe(148)
    expect(out.segments[1].actual_w).toBe(252)
    expect(out.segments[0].planned_w).toBe(150) // 60% of 250
    expect(out.segments[1].planned_w).toBe(250) // 100% of 250
    expect(out.segments[0].start_frac).toBe(0)
    expect(out.segments[1].start_frac).toBeCloseTo(540 / 1200, 5)
  })

  it('averages the stream when a clean lap has no avg_watts', () => {
    const laps: ActivityInterval[] = [
      { label: 'wu', duration_secs: 600, avg_watts: null, avg_hr: null },
      { label: 'eff', duration_secs: 600, avg_watts: null, avg_hr: null },
    ]
    const out = buildPlannedActual(steps, streams, laps, 250)!
    expect(out.aligned).toBe('laps')
    expect(out.segments[0].actual_w).toBe(150)
    expect(out.segments[1].actual_w).toBe(250)
  })

  it('falls back to scaled when lap count differs from step count', () => {
    const laps: ActivityInterval[] = [
      { label: 'only one', duration_secs: 1200, avg_watts: 200, avg_hr: null },
    ]
    const out = buildPlannedActual(steps, streams, laps, 250)!
    expect(out.aligned).toBe('scaled')
    expect(out.segments[0].width_frac).toBeCloseTo(0.5, 5) // planned proportions
    expect(out.segments[0].actual_w).toBe(150)             // stream avg over first half
    expect(out.segments[1].actual_w).toBe(250)
  })

  it('scales when there are no laps at all', () => {
    expect(buildPlannedActual(steps, streams, null, 250)!.aligned).toBe('scaled')
  })

  it('builds a %FTP trace over 0..1 and a headroom yMaxPct', () => {
    const out = buildPlannedActual(steps, streams, null, 250)!
    expect(out.trace[0]).toEqual({ x: 0, pct: 60 })        // 150 / 250
    expect(out.trace[out.trace.length - 1].x).toBe(1)
    expect(out.trace[out.trace.length - 1].pct).toBe(100)  // 250 / 250
    // max planned/actual pct = 100 → 100*1.08=108 → ceil to 110, floored at 110
    expect(out.yMaxPct).toBe(110)
  })

  it('lifts yMaxPct above an over-target sprint', () => {
    const sprintPower = time.map(() => 375) // 150% FTP
    const out = buildPlannedActual(steps, { time, power: sprintPower }, null, 250)!
    expect(out.yMaxPct).toBe(170) // 150*1.08=162 → ceil/10 → 170
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/lib/planned-actual.test.ts`
Expected: FAIL — "Cannot find module '@/lib/ride/planned-actual'".

- [ ] **Step 3: Implement the helper**

Create `lib/ride/planned-actual.ts`:

```ts
import type { RideStreams, ActivityInterval, WorkoutStep } from '@/types'

export interface AlignedSegment {
  label: string
  planned_pct: number   // target %FTP (from the step)
  planned_w: number     // target watts
  actual_w: number      // achieved watts
  start_frac: number    // 0..1 left edge on the bar axis
  width_frac: number    // 0..1 bar width
}

export interface PlannedActual {
  segments: AlignedSegment[]
  trace: { x: number; pct: number }[]  // actual power as %FTP; x in 0..1 of total time
  aligned: 'laps' | 'scaled'
  yMaxPct: number                       // shared %FTP axis ceiling
}

// Pure: turns planned steps + the actual power stream + detected laps + FTP into a
// single model that drives both the overlay chart and the numbers list. Lap-anchored
// (bars sized by real lap durations) when laps map 1:1 to steps; otherwise the bars
// keep planned proportions stretched to fill, with actual power averaged from the
// matching slice of the (downsampled) stream. Returns null when it cannot draw a
// meaningful overlay — the caller then shows the target-only chart.
export function buildPlannedActual(
  steps: WorkoutStep[] | null,
  streams: Pick<RideStreams, 'time' | 'power'>,
  intervals: ActivityInterval[] | null,
  ftp: number | null,
): PlannedActual | null {
  const { time, power } = streams
  if (!steps?.length || !ftp || ftp <= 0 || !power?.length || !time?.length) return null

  const totalTime = time[time.length - 1]
  if (!(totalTime > 0)) return null

  // Mean power over the half-open actual-time range [f0, f1) of the stream. Half-open
  // so a sample on a segment boundary belongs to the later segment only (an inclusive
  // upper bound would double-count the boundary and skew both segments).
  const meanPowerInFrac = (f0: number, f1: number): number => {
    const t0 = f0 * totalTime, t1 = f1 * totalTime
    let sum = 0, n = 0
    for (let i = 0; i < time.length; i++) {
      const p = power[i]
      if (time[i] >= t0 && time[i] < t1 && p != null && Number.isFinite(p)) { sum += p; n++ }
    }
    return n ? Math.round(sum / n) : 0
  }

  const plannedW = (pct: number) => Math.round((ftp * pct) / 100)
  const lapClean = !!intervals && intervals.length === steps.length

  let segments: AlignedSegment[]
  if (lapClean) {
    const laps = intervals!
    const sumSecs = laps.reduce((s, iv) => s + iv.duration_secs, 0) || 1
    let cursor = 0
    segments = steps.map((step, i) => {
      const iv = laps[i]
      const width_frac = iv.duration_secs / sumSecs
      const start_frac = cursor
      cursor += width_frac
      const actual_w = iv.avg_watts != null && Number.isFinite(iv.avg_watts)
        ? Math.round(iv.avg_watts)
        : meanPowerInFrac(start_frac, start_frac + width_frac)
      return { label: step.label, planned_pct: step.power_pct_ftp, planned_w: plannedW(step.power_pct_ftp), actual_w, start_frac, width_frac }
    })
  } else {
    const sumMin = steps.reduce((s, st) => s + st.duration_minutes, 0) || 1
    let cursor = 0
    segments = steps.map(step => {
      const width_frac = step.duration_minutes / sumMin
      const start_frac = cursor
      cursor += width_frac
      return { label: step.label, planned_pct: step.power_pct_ftp, planned_w: plannedW(step.power_pct_ftp), actual_w: meanPowerInFrac(start_frac, start_frac + width_frac), start_frac, width_frac }
    })
  }

  // Raw (unsmoothed) actual power as %FTP over 0..1 of total time. The chart smooths it.
  const trace = time.map((t, i) => {
    const p = power[i]
    return { x: t / totalTime, pct: p != null && Number.isFinite(p) ? (p / ftp) * 100 : 0 }
  })

  const maxPlanned = Math.max(...steps.map(s => s.power_pct_ftp))
  const maxActual = trace.reduce((m, p) => (p.pct > m ? p.pct : m), 0)
  const yMaxPct = Math.max(Math.ceil((Math.max(maxPlanned, maxActual) * 1.08) / 10) * 10, 110)

  return { segments, trace, aligned: lapClean ? 'laps' : 'scaled', yMaxPct }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/lib/planned-actual.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add lib/ride/planned-actual.ts __tests__/lib/planned-actual.test.ts
git commit -m "feat: add planned-vs-actual alignment helper

<trailer>"
```

---

## Task 2: `PlannedVsActualChart` component

**Files:**
- Create: `components/PlannedVsActualChart.tsx`
- Test: `__tests__/components/PlannedVsActualChart.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/PlannedVsActualChart.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import PlannedVsActualChart from '@/components/PlannedVsActualChart'
import type { PlannedActual } from '@/lib/ride/planned-actual'

const base: PlannedActual = {
  segments: [
    { label: 'Warm Up', planned_pct: 60, planned_w: 150, actual_w: 148, start_frac: 0, width_frac: 0.5 },
    { label: 'Effort', planned_pct: 100, planned_w: 250, actual_w: 252, start_frac: 0.5, width_frac: 0.5 },
  ],
  trace: [{ x: 0, pct: 60 }, { x: 0.5, pct: 60 }, { x: 0.5, pct: 100 }, { x: 1, pct: 100 }],
  aligned: 'laps',
  yMaxPct: 110,
}

describe('PlannedVsActualChart', () => {
  it('renders one bar per segment and an actual-power polyline', () => {
    const { container } = render(<PlannedVsActualChart data={base} ftp={250} />)
    expect(container.querySelectorAll('rect').length).toBe(2)
    expect(container.querySelector('polyline')).toBeTruthy()
  })

  it('shows the approximate-alignment note only when scaled', () => {
    const { queryByText, rerender } = render(<PlannedVsActualChart data={base} ftp={250} />)
    expect(queryByText(/approximate alignment/i)).toBeNull()
    rerender(<PlannedVsActualChart data={{ ...base, aligned: 'scaled' }} ftp={250} />)
    expect(queryByText(/approximate alignment/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/components/PlannedVsActualChart.test.tsx`
Expected: FAIL — "Cannot find module '@/components/PlannedVsActualChart'".

- [ ] **Step 3: Implement the component**

Create `components/PlannedVsActualChart.tsx`:

```tsx
'use client'
import { zoneFor } from './WorkoutProfileChart'
import { smoothSeries } from '@/lib/ride/graph-math'
import type { PlannedActual } from '@/lib/ride/planned-actual'

const SMOOTH = 5

// Target bars (zone-coloured, sized by each segment's width_frac) with the actual
// power trace overlaid on a shared %FTP axis. Geometry mirrors WorkoutProfileChart so
// the two charts read identically.
export default function PlannedVsActualChart({ data, ftp }: { data: PlannedActual; ftp: number }) {
  const svgLeft = 34, svgRight = 336, svgTop = 8, svgBottom = 96
  const plotW = svgRight - svgLeft
  const plotH = svgBottom - svgTop
  const yOf = (pct: number) => Math.min(Math.max(svgBottom - (pct / data.yMaxPct) * plotH, svgTop), svgBottom)
  const ftpY = yOf(100)

  const tracePts = smoothSeries(data.trace.map(p => p.pct), SMOOTH)
    .map((pct, i) => (pct == null ? null : `${(svgLeft + data.trace[i].x * plotW).toFixed(1)},${yOf(pct).toFixed(1)}`))
    .filter((p): p is string => p !== null)
    .join(' ')

  const legend: { label: string; fill: string }[] = []
  for (const s of data.segments) {
    const z = zoneFor(s.planned_pct)
    if (!legend.some(l => l.label === z.label)) legend.push(z)
  }
  legend.sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div>
      <svg viewBox="0 0 340 116" className="w-full select-none" role="img" aria-label="Planned vs actual power">
        {/* FTP reference line */}
        <line x1={svgLeft} y1={ftpY} x2={svgRight} y2={ftpY} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3" />
        <text x={svgLeft - 4} y={ftpY + 3} fontSize="8" fill="#94a3b8" textAnchor="end">{ftp}w</text>

        {/* Target bars */}
        {data.segments.map((s, i) => {
          const x = svgLeft + s.start_frac * plotW
          const w = Math.max(s.width_frac * plotW - 0.6, 0.4)
          const y = yOf(s.planned_pct)
          return <rect key={i} x={x} y={y} width={w} height={svgBottom - y} fill={zoneFor(s.planned_pct).fill} opacity={0.45} rx="0.5" />
        })}

        {/* Actual power trace */}
        {tracePts && <polyline points={tracePts} fill="none" stroke="#1e293b" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}

        {/* Baseline + time axis */}
        <line x1={svgLeft} y1={svgBottom} x2={svgRight} y2={svgBottom} stroke="#e2e8f0" strokeWidth="1" />
        <text x={svgLeft} y={svgBottom + 14} fontSize="8" fill="#94a3b8" textAnchor="start">start</text>
        <text x={svgRight} y={svgBottom + 14} fontSize="8" fill="#94a3b8" textAnchor="end">end</text>
      </svg>

      {data.aligned === 'scaled' && (
        <p className="text-[10px] text-slate-400 mt-1">&#9432; Approximate alignment — actual time scaled to the plan.</p>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
        {legend.map(l => (
          <span key={l.label} className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: l.fill }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/components/PlannedVsActualChart.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/PlannedVsActualChart.tsx __tests__/components/PlannedVsActualChart.test.tsx
git commit -m "feat: add PlannedVsActualChart overlay component

<trailer>"
```

---

## Task 3: `PlannedVsActualList` component

**Files:**
- Create: `components/PlannedVsActualList.tsx`
- Test: `__tests__/components/PlannedVsActualList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/PlannedVsActualList.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import PlannedVsActualList from '@/components/PlannedVsActualList'
import type { AlignedSegment } from '@/lib/ride/planned-actual'

const segments: AlignedSegment[] = [
  { label: 'Warm Up', planned_pct: 60, planned_w: 150, actual_w: 165, start_frac: 0, width_frac: 0.5 }, // +10%
  { label: 'Effort', planned_pct: 100, planned_w: 250, actual_w: 240, start_frac: 0.5, width_frac: 0.5 }, // -4%
]

describe('PlannedVsActualList', () => {
  it('shows planned, actual, and signed delta per segment', () => {
    render(<PlannedVsActualList segments={segments} />)
    expect(screen.getByText('Warm Up')).toBeInTheDocument()
    expect(screen.getByText('165w')).toBeInTheDocument()
    expect(screen.getByText('+10%')).toBeInTheDocument()
    expect(screen.getByText('-4%')).toBeInTheDocument()
  })

  it('renders nothing for an empty list', () => {
    const { container } = render(<PlannedVsActualList segments={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/components/PlannedVsActualList.test.tsx`
Expected: FAIL — "Cannot find module '@/components/PlannedVsActualList'".

- [ ] **Step 3: Implement the component**

Create `components/PlannedVsActualList.tsx`:

```tsx
'use client'
import { zoneFor } from './WorkoutProfileChart'
import type { AlignedSegment } from '@/lib/ride/planned-actual'

// Per-step planned → actual watts with a signed delta. Over-target deltas read warm
// (orange), under-target cool (blue), on-target neutral.
export default function PlannedVsActualList({ segments }: { segments: AlignedSegment[] }) {
  if (!segments.length) return null
  return (
    <ol className="divide-y divide-slate-100">
      {segments.map((s, i) => {
        const delta = s.planned_w > 0 ? Math.round(((s.actual_w - s.planned_w) / s.planned_w) * 100) : 0
        const deltaColour = delta > 0 ? 'text-orange-500' : delta < 0 ? 'text-blue-500' : 'text-slate-400'
        return (
          <li key={i} className="flex items-center justify-between gap-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: zoneFor(s.planned_pct).fill }} />
              <span className="text-sm text-slate-700 truncate">{s.label}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0 text-xs tabular-nums">
              <span className="text-slate-400">{s.planned_w}</span>
              <span className="text-slate-300">&rarr;</span>
              <span className="font-semibold text-slate-600">{s.actual_w}w</span>
              <span className={`${deltaColour} w-10 text-right`}>{delta > 0 ? '+' : ''}{delta}%</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/components/PlannedVsActualList.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add components/PlannedVsActualList.tsx __tests__/components/PlannedVsActualList.test.tsx
git commit -m "feat: add PlannedVsActualList numbers component

<trailer>"
```

---

## Task 4: Extend the ride-streams endpoint to return laps

**Files:**
- Modify: `app/api/rides/[workoutId]/streams/route.ts:41-48`
- Test: `__tests__/api/ride-streams.test.ts`

- [ ] **Step 1: Update the test to expect `intervals`**

In `__tests__/api/ride-streams.test.ts`, add a mock for the laps call and assert it is returned.

Add the mock fn next to the others (after line 15, `const mockGetActivityMap = jest.fn()`):

```ts
const mockGetActivityIntervals = jest.fn()
```

Add it to the `IntervalsClient` mock implementation (inside the object returned at lines 21-24):

```ts
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getActivityStreams: mockGetActivityStreams,
    getActivityMap: mockGetActivityMap,
    getActivityIntervals: mockGetActivityIntervals,
  })),
}))
```

In `beforeEach` (after the `mockGetActivityMap.mockResolvedValue(...)` line), add:

```ts
mockGetActivityIntervals.mockResolvedValue([
  { label: 'Lap 1', duration_secs: 600, avg_watts: 200, avg_hr: 140 },
])
```

Add a new test inside the `describe` block:

```ts
it('returns detected laps as intervals', async () => {
  ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
    supabaseStub({ icu_activity_id: 'a1' }, goodProfile),
  )
  const res = await GET({} as Request as never, ctx('w1') as never)
  const body = await res.json()
  expect(res.status).toBe(200)
  expect(body.intervals).toHaveLength(1)
  expect(body.intervals[0].avg_watts).toBe(200)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/api/ride-streams.test.ts`
Expected: FAIL — the new test sees `body.intervals` undefined.

- [ ] **Step 3: Implement the route change**

In `app/api/rides/[workoutId]/streams/route.ts`, replace the `try` body (lines 38-52) so the laps call joins the `Promise.all` and `intervals` is returned:

```ts
  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  try {
    // Streams carry the graph channels; the real route comes from /map (the streams
    // latlng channel is latitude-only). latlngs is index-aligned with the streams.
    // intervals (detected laps) drive the planned-vs-actual overlay; they degrade to
    // [] so a lap-detection hiccup never breaks the graph.
    const [streams, map, intervals] = await Promise.all([
      client.getActivityStreams(workout.icu_activity_id),
      client.getActivityMap(workout.icu_activity_id).catch(() => ({ latlngs: null })),
      client.getActivityIntervals(workout.icu_activity_id).catch(() => []),
    ])
    if (map.latlngs && map.latlngs.length === streams.time.length) {
      streams.latlng = map.latlngs
    }
    return NextResponse.json({ streams: downsampleStreams(streams, 600), intervals })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/api/ride-streams.test.ts`
Expected: PASS (5 tests — the original 4 plus the new one).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/rides/[workoutId]/streams/route.ts __tests__/api/ride-streams.test.ts
git commit -m "feat: return detected laps from ride-streams endpoint

<trailer>"
```

---

## Task 5: Wire the overlay into `WorkoutDetailModal`

**Files:**
- Modify: `components/WorkoutDetailModal.tsx` (imports near line 6; state near line 68; new effect after line 79; render swap at lines 335-350)
- Test: `__tests__/components/WorkoutDetailModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/WorkoutDetailModal.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import WorkoutDetailModal from '@/components/WorkoutDetailModal'
import type { Workout } from '@/types'

const plannedWorkout: Workout = {
  id: 'w1', plan_id: 'p1', date: '2026-06-01', type: 'threshold',
  duration_minutes: 60, description: 'Test session', target_zones: 'Zone 4',
  status: 'planned', intervals_icu_event_id: null, icu_activity_id: null,
  tss: null, missed_reason: null,
  steps: [{ label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 }],
  created_at: '',
}

describe('WorkoutDetailModal planned-vs-actual', () => {
  it('shows the target-only chart and never fetches streams when not completed/linked', () => {
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }))
    global.fetch = fetchMock as never
    render(<WorkoutDetailModal workout={plannedWorkout} athleteId="i1" ftp={250} onClose={() => {}} />)
    expect(screen.getByLabelText('Workout power profile')).toBeInTheDocument()
    const hitStreams = fetchMock.mock.calls.some(c => String(c[0]).includes('/streams'))
    expect(hitStreams).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/components/WorkoutDetailModal.test.tsx`
Expected: FAIL — `getByLabelText('Workout power profile')` is found (that part passes), but the file/import wiring is incomplete only if you jumped ahead; if it already passes, proceed — this test mainly guards the no-fetch fallback. If it passes immediately, continue to Step 3 to add the overlay path (the test still protects the fallback).

> Note: this test asserts existing fallback behaviour, so it may already pass against the current modal. That is expected — it locks the fallback so Step 3's overlay wiring cannot regress it.

- [ ] **Step 3: Add imports**

In `components/WorkoutDetailModal.tsx`, after line 6 (`import WorkoutProfileChart, { WorkoutStepList } from './WorkoutProfileChart'`), add:

```ts
import PlannedVsActualChart from './PlannedVsActualChart'
import PlannedVsActualList from './PlannedVsActualList'
import { buildPlannedActual, type PlannedActual } from '@/lib/ride/planned-actual'
```

- [ ] **Step 4: Add state**

After line 68 (`const [linkError, setLinkError] = useState<string | null>(null)`), add:

```ts
  const [actual, setActual] = useState<PlannedActual | null>(null)
```

- [ ] **Step 5: Add the fetch effect**

After the existing feedback `useEffect` (ends at line 79, the closing `}, [workout.id, workout.status])`), add:

```ts
  // For a completed, linked workout, fetch the actual ride streams + laps and build
  // the planned-vs-actual overlay. Any miss (not linked, no FTP, no power, fetch
  // error) leaves `actual` null and the target-only chart shows instead.
  useEffect(() => {
    setActual(null)
    const isDone = workout.status === 'completed' || workout.status === 'needs_review'
    if (!isDone || !workout.icu_activity_id || !ftp || !workout.steps?.length) return
    let cancelled = false
    fetch(`/api/rides/${workout.id}/streams`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d?.streams) return
        setActual(buildPlannedActual(workout.steps, d.streams, d.intervals ?? null, ftp))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [workout.id, workout.status, workout.icu_activity_id, ftp, workout.steps])
```

- [ ] **Step 6: Swap the chart in the steps card**

Replace the steps card block (lines 335-350, the `{workout.steps && workout.steps.length > 0 && ( ... )}` region) with:

```tsx
          {workout.steps && workout.steps.length > 0 && (
            <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/60 space-y-2">
              {actual ? (
                <>
                  <PlannedVsActualChart data={actual} ftp={ftp ?? 0} />
                  <PlannedVsActualList segments={actual.segments} />
                </>
              ) : (
                <WorkoutProfileChart steps={workout.steps} ftp={ftp} />
              )}
              <details className="group">
                <summary className="cursor-pointer list-none text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1 select-none">
                  <svg width="10" height="10" viewBox="0 0 12 12" className="transition-transform group-open:rotate-90" fill="currentColor" aria-hidden="true">
                    <path d="M4 2l4 4-4 4z" />
                  </svg>
                  Steps
                </summary>
                <div className="mt-1">
                  <WorkoutStepList steps={workout.steps} ftp={ftp} />
                </div>
              </details>
            </div>
          )}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx jest __tests__/components/WorkoutDetailModal.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add components/WorkoutDetailModal.tsx __tests__/components/WorkoutDetailModal.test.tsx
git commit -m "feat: show planned-vs-actual overlay in the workout modal

<trailer>"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `npm test`
Expected: all suites pass (includes the new planned-actual, chart, list, modal, and updated ride-streams tests).

- [ ] **Typecheck once more**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Manual smoke (optional, requires dev server + a completed linked workout)**

Run: `npm run dev`, open a completed workout linked to an activity. Expect: target bars with the actual power line overlaid, a per-step planned→actual list beneath, and (when laps don't map 1:1) the "Approximate alignment" caption. A planned/unlinked workout still shows the plain target profile.
