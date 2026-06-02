# Planned-vs-Actual Overlay — Design

**Date:** 2026-06-02
**Status:** Approved (ready for implementation plan)

## Goal

For a completed workout that is linked to an intervals.icu activity, show the
**actual** ride power trace overlaid on the **planned** target profile, on a shared
%FTP axis, inside `WorkoutDetailModal`. Back the visual with a per-step
planned-vs-actual numbers list. This lets the athlete see how their ride tracked
against the prescription.

## Context — what already exists

- **Planned profile chart:** `components/WorkoutProfileChart.tsx` renders
  `workout.steps` as zone-coloured bars on a %FTP axis with an FTP reference line.
  Exports `zoneFor(pct)` and `fmtTime(min)`. Rendered in the modal at the
  `workout.steps` card.
- **Actual streams:** `GET /api/rides/[workoutId]/streams` returns
  `{ streams }` — downsampled (≤600 points) `RideStreams` (`time[]` seconds,
  `power[]` watts, plus hr/altitude/etc.). Rendered by `components/ride/RideGraph.tsx`
  on the `/ride/[workoutId]` page.
- **Detected laps:** `IntervalsClient.getActivityIntervals(activityId)` returns
  `ActivityInterval[]` = `{ label, duration_secs, avg_watts, avg_hr }`.
- **Graph math:** `lib/ride/graph-math.ts` exports `smoothSeries`,
  `seriesToPolyline`, `extent`, `niceDomain`, `axisFractions`.
- **Existing planned-vs-actual text:** `lib/claude/activity-metrics.ts#computeShape`
  produces `{ label, planned_w, actual_w }[]` but aligns by **planned** cumulative
  time (so it drifts under open-ended press-lap steps) and is used only as text in
  the feedback/briefing prompts. This stays as-is and is **out of scope**; the new
  overlay supersedes it for in-modal display only.

## Decisions (locked during brainstorming)

1. **Placement:** in `WorkoutDetailModal`, swapping the target-only chart in place
   for completed + linked workouts.
2. **Alignment fallback:** lap-anchored when laps map cleanly to steps; otherwise
   fall back to a time-scaled overlay (planned proportions stretched to fill),
   with an "approximate alignment" caption.
3. **Numbers:** include a per-step planned-vs-actual numbers list under the graph in v1.

## Architecture

### Unit 1 — `lib/ride/planned-actual.ts` (pure, the brain)

Does all alignment math. No I/O, no React. Fully unit-tested.

```ts
import type { RideStreams, ActivityInterval, WorkoutStep } from '@/types'

export interface AlignedSegment {
  label: string
  planned_pct: number   // target %FTP (from the step)
  planned_w: number     // target watts = round(ftp * planned_pct / 100)
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

export function buildPlannedActual(
  steps: WorkoutStep[] | null,
  streams: Pick<RideStreams, 'time' | 'power'>,
  intervals: ActivityInterval[] | null,
  ftp: number | null,
): PlannedActual | null
```

Behaviour:

- **Returns `null`** when: `steps` is empty, `ftp` is falsy, or `streams.power` is
  null/empty. (Modal then shows the existing target-only chart.)
- **Lap-anchored path** — chosen when `intervals` is non-null and
  `intervals.length === steps.length`:
  - Bar widths from real lap durations: `width_frac = lap.duration_secs / sumLapSecs`,
    `start_frac` = cumulative.
  - `actual_w = lap.avg_watts ?? <stream average over that lap's time range>`.
    (Prefer the supplied `avg_watts`; if null, average the stream slice.)
  - `aligned = 'laps'`.
- **Scaled path** — otherwise:
  - Bar widths from planned step durations:
    `width_frac = step.duration_minutes / sumPlannedMin`, `start_frac` cumulative.
  - `actual_w` = mean of `streams.power` over the actual-time fraction
    `[start_frac, start_frac + width_frac]` (map fraction → seconds via total time,
    then average samples in range). Empty range → 0.
  - `aligned = 'scaled'`.
- **`planned_pct`/`planned_w`** always from the step.
- **`trace`**: for each power sample `i`, `x = time[i] / time[last]` (guard last>0),
  `pct = power[i] / ftp * 100`. The helper returns the raw (unsmoothed) %FTP series;
  the chart component applies `smoothSeries` at render time. This is the single source
  of the actual line — the component does not read `streams.power` itself.
- **`yMaxPct`** = `ceil(max(maxPlannedPct, maxActualPct) * 1.08 / 10) * 10`, floor 110
  (mirrors `WorkoutProfileChart`'s headroom rule) so sprints above target stay on-chart.

"Clean match" is deliberately the simple count-equality rule
(`intervals.length === steps.length`, 1:1 by order). The scaled fallback is always
correct, so a stricter matcher is unnecessary and would only shrink the lap path.

### Unit 2 — `components/PlannedVsActualChart.tsx` (presentational SVG)

Props: `{ data: PlannedActual; ftp: number }`. Renders, in the style of
`WorkoutProfileChart` (same `viewBox`, FTP reference line, baseline, time axis,
zone legend):

- Target bars: for each `segment`, a rect at `start_frac`/`width_frac` (× plot width),
  height from `planned_pct` against `yMaxPct`, filled via `zoneFor(planned_pct).fill`.
- Actual trace: `smoothSeries` over `data.trace` `pct` values, projected with
  `seriesToPolyline` (x from `trace[i].x`, y from `pct` against `yMaxPct`), drawn as
  a dark polyline with `vectorEffect="non-scaling-stroke"`.
- When `data.aligned === 'scaled'`, render a small ⓘ "approximate alignment" caption
  below the chart.

Reuses `zoneFor`, `fmtTime` (export from `WorkoutProfileChart` as needed) and
`smoothSeries`/`seriesToPolyline` from `graph-math`.

### Unit 3 — `components/PlannedVsActualList.tsx` (presentational)

Props: `{ segments: AlignedSegment[] }`. A compact per-step list: label, zone swatch,
`planned_w → actual_w` watts, and delta `round((actual_w - planned_w) / planned_w * 100)%`
(guard `planned_w > 0`); colour the delta (over/under) subtly. Mobile-first: rows
stack, ≥44px touch targets not required (non-interactive), tabular-nums for figures.

### Unit 4 — `GET /api/rides/[workoutId]/streams` (extend)

Add `client.getActivityIntervals(workout.icu_activity_id)` to the existing
`Promise.all`, returning `{ streams: downsampleStreams(...), intervals }`. The
`intervals` call already degrades to `[]` on a bad payload, so wrap it in
`.catch(() => [])` to keep streams working if laps fail. Existing `RideGraph` callers
ignore the new field — no breaking change.

### Unit 5 — `components/WorkoutDetailModal.tsx` (wire-up)

- New state: `actual: PlannedActual | null` and a `loadingActual` flag (or a simple
  `'idle' | 'loading' | 'done'`).
- New `useEffect` keyed on `[workout.id, workout.status, workout.icu_activity_id, ftp]`:
  fires only when status is `completed`/`needs_review` **and** `icu_activity_id` is set
  **and** `ftp` is truthy. Fetches the streams endpoint, then
  `setActual(buildPlannedActual(workout.steps, data.streams, data.intervals, ftp))`.
  Any failure → leave `actual` null.
- In the `workout.steps` card: if `actual` is non-null, render
  `PlannedVsActualChart` + `PlannedVsActualList`; else render the existing
  `WorkoutProfileChart` unchanged. The `Steps ▸` expander stays in both cases.

## Data flow

```
modal (completed + linked + ftp)
  └─ GET /api/rides/[id]/streams ──► { streams, intervals }
        └─ buildPlannedActual(steps, streams, intervals, ftp) ──► PlannedActual | null
              ├─ PlannedVsActualChart  (bars + trace)
              └─ PlannedVsActualList   (numbers)
   (null / not-linked / no-ftp / no-power) ──► existing WorkoutProfileChart
```

## States & edge cases

| Condition | Behaviour |
|---|---|
| Planned (not completed) | Existing target-only chart (no fetch) |
| Completed/needs_review, **not** linked | Existing target-only chart (no fetch) |
| Linked but `ftp` missing | Existing target-only chart (no fetch) |
| Fetch in flight | Target-only chart shown; overlay swaps in on resolve |
| Fetch fails / no `power` stream (e.g. no power meter) | Target-only chart + tiny "actual power unavailable" note |
| Laps clean (`count == steps`) | Lap-anchored bars, exact alignment |
| Laps messy/absent | Scaled bars + ⓘ "approximate alignment" |

## Testing

- **`lib/ride/planned-actual.ts`** (primary surface):
  - lap-clean → bar widths from lap durations, `actual_w` from `avg_watts`, `aligned: 'laps'`
  - lap-clean with a null `avg_watts` → that segment's `actual_w` from stream average
  - lap count ≠ step count → `aligned: 'scaled'`, widths from planned durations,
    `actual_w` from stream slice averages
  - no power / no ftp / empty steps → `null`
  - `yMaxPct` headroom incl. an over-target sprint
  - `trace` maps watts→%FTP and x→0..1 correctly
- **`PlannedVsActualChart`** render smoke test (bars + a polyline present; ⓘ caption
  only when scaled).
- **`PlannedVsActualList`** delta math + sign.
- **`WorkoutDetailModal`** falls back to `WorkoutProfileChart` when there's no
  activity/ftp (no fetch fired).
- **Type gate:** `npm run typecheck` must stay clean (SWC skips types in Jest).

## Out of scope (v1)

- HR/elevation overlay (power only).
- Changes to `computeShape` and the feedback/briefing text paths.
- The `/ride/[workoutId]` page (placement is the modal only).
- Persisting the overlay data — it is fetched on demand.
