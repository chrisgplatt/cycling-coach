import type { RideStreams, ActivityInterval, WorkoutStep } from '@/types'

export interface AlignedStep {
  planned_w: number     // target watts (from the step + FTP)
  actual_w: number      // duration-weighted mean watts of the laps assigned to this step; 0 if none
  lap_secs: number      // total seconds of laps assigned to this step (for bar widths); 0 if none
}

// Align planned steps to the actual laps by POWER, not by wall-clock. The old
// comparison sliced the power stream by cumulative *planned* durations, so any
// drift (a long warm-up, an over-run recovery, a rolling start, a failed lap
// press) shifted every later window and dragged the back-half intervals down
// into the recovery valley beside them. Instead, partition the ordered laps into
// contiguous groups — one per step — choosing the grouping that best matches each
// step's target power (duration-weighted). A 240W lap snaps to the interval step,
// not the 100W recovery, regardless of how the laps were timed or split. Each lap
// is read at its OWN average power, which is the number we actually want.
//
// Returns one entry per step, or null when there is nothing to align. Robust to
// more laps than steps (warm-up/endurance split across laps) and fewer (a step
// that received no lap reports actual_w 0).
export function alignPlannedToLaps(
  steps: WorkoutStep[],
  laps: Array<{ watts: number; duration_secs: number }>,
  ftp: number,
): AlignedStep[] | null {
  const N = steps.length
  const M = laps.length
  if (!N || !M || !ftp || ftp <= 0) return null

  const plannedW = steps.map(s => Math.round((ftp * s.power_pct_ftp) / 100))
  const w = laps.map(l => (Number.isFinite(l.watts) ? l.watts : 0))
  const d = laps.map(l => Math.max(l.duration_secs, 0))

  // Cost of assigning laps [a, b) all to step i: duration-weighted |Δwatts| (W·s).
  const groupCost = (i: number, a: number, b: number): number => {
    let c = 0
    for (let k = a; k < b; k++) c += d[k] * Math.abs(w[k] - plannedW[i])
    return c
  }

  // dp[i][j] = min cost assigning the first j laps to the first i steps as
  // contiguous groups. back[i][j] = the split point. When there are at least as
  // many laps as steps, forbid empty groups: otherwise, where several adjacent
  // steps share a similar target power (recovery / endurance / cool-down), the
  // cheapest partition collapses them into one step and reports the rest as
  // "actual 0". Requiring ≥1 lap per step blocks that while still letting a
  // warm-up or endurance block span several laps. When laps are scarcer than
  // steps (e.g. failed lap presses merged segments), empty groups are unavoidable.
  const requireNonEmpty = M >= N
  const INF = Infinity
  const dp: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(INF))
  const back: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(-1))
  dp[0][0] = 0
  for (let i = 1; i <= N; i++) {
    for (let j = 0; j <= M; j++) {
      const kEnd = requireNonEmpty ? j - 1 : j  // non-empty group [k, j) needs k < j
      for (let k = 0; k <= kEnd; k++) {
        const prev = dp[i - 1][k]
        if (prev === INF) continue
        const cost = prev + groupCost(i - 1, k, j)
        if (cost < dp[i][j]) { dp[i][j] = cost; back[i][j] = k }
      }
    }
  }
  if (dp[N][M] === INF) return null

  const out: AlignedStep[] = new Array(N)
  let j = M
  for (let i = N; i >= 1; i--) {
    const k = back[i][j]
    let secs = 0, ws = 0
    for (let x = k; x < j; x++) { secs += d[x]; ws += d[x] * w[x] }
    out[i - 1] = {
      planned_w: plannedW[i - 1],
      actual_w: secs > 0 ? Math.round(ws / secs) : 0,
      lap_secs: secs,
    }
    j = k
  }
  return out
}

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
  /** Actual power as %FTP over 0..1 of total time. Raw/unsmoothed — smooth before rendering. */
  trace: { x: number; pct: number }[]
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

  // Resolve laps -> per-step groups by power once, so we can decide the mode. We
  // can lap-anchor whenever there are at least as many laps as steps (each step
  // gets ≥1 lap); with fewer laps than steps a lap spans several steps, so the
  // proportional 'scaled' path is the better fallback.
  const sumSecs = intervals?.length ? intervals.reduce((s, iv) => s + iv.duration_secs, 0) || 1 : 1
  let groups: ReturnType<typeof alignPlannedToLaps> = null
  if (intervals && intervals.length >= steps.length) {
    let frac = 0
    const resolved = intervals.map(iv => {
      const wf = iv.duration_secs / sumSecs
      const f0 = frac
      frac += wf
      const watts = iv.avg_watts != null && Number.isFinite(iv.avg_watts)
        ? iv.avg_watts
        : meanPowerInFrac(f0, f0 + wf)
      return { watts, duration_secs: iv.duration_secs }
    })
    groups = alignPlannedToLaps(steps, resolved, ftp)
  }

  let segments: AlignedSegment[]
  let aligned: 'laps' | 'scaled'
  if (groups) {
    aligned = 'laps'
    let cursor = 0
    segments = steps.map((step, i) => {
      const width_frac = groups![i].lap_secs / sumSecs
      const start_frac = cursor
      cursor += width_frac
      return { label: step.label, planned_pct: step.power_pct_ftp, planned_w: plannedW(step.power_pct_ftp), actual_w: groups![i].actual_w, start_frac, width_frac }
    })
  } else {
    aligned = 'scaled'
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

  const maxPlanned = steps.reduce((m, s) => (s.power_pct_ftp > m ? s.power_pct_ftp : m), 0)
  const maxActual = trace.reduce((m, p) => (p.pct > m ? p.pct : m), 0)
  const yMaxPct = Math.max(Math.ceil((Math.max(maxPlanned, maxActual) * 1.08) / 10) * 10, 110)

  return { segments, trace, aligned, yMaxPct }
}
