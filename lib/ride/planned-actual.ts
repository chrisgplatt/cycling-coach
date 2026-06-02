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
