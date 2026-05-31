// Pure, dependency-free formatters for enriched completed-ride detail.
// Kept free of the intervals.icu and Anthropic clients so prompt builders can
// import it without dragging in network/SDK code (mirrors lib/claude/zones.ts).
import type { ICUActivity, ICUPowerCurvePoint, ActivityInterval, ActivityMetrics, WorkoutStep, RideStreams, ClimbSegment } from '@/types'

// Best-effort durations we sample the power curve down to (seconds).
const CANONICAL_SECS = [5, 15, 60, 300, 1200, 3600]

function sampleBest(curve: ICUPowerCurvePoint[], target: number): { secs: number; watts: number } | null {
  if (!curve.length) return null
  let nearest = curve[0]
  for (const p of curve) {
    if (Math.abs(p.secs - target) < Math.abs(nearest.secs - target)) nearest = p
  }
  // Reject if the nearest available point is more than 20% from the target,
  // so a 20-minute ride never reports a fabricated 60-minute best.
  if (Math.abs(nearest.secs - target) > target * 0.2) return null
  return { secs: target, watts: Math.round(nearest.watts) }
}

export function extractActivityMetrics(
  act: ICUActivity,
  curve: ICUPowerCurvePoint[] | null,
  intervals: ActivityInterval[] | null,
): ActivityMetrics {
  const best = curve?.length
    ? CANONICAL_SECS.map(t => sampleBest(curve, t)).filter((e): e is { secs: number; watts: number } => e !== null)
    : []
  return {
    np: act.weighted_average_watts ?? null,
    avg_power: act.average_watts ?? null,
    max_power: act.max_watts ?? null,
    avg_hr: act.average_heartrate ?? null,
    distance_m: act.distance ?? null,
    elevation_m: act.total_elevation_gain ?? null,
    lr_balance: act.left_right_balance ?? null,
    best_efforts: best.length ? best : null,
    intervals: intervals?.length ? intervals : null,
    decoupling_pct: null,
    climbs: null,
    time_in_zone: null,
    shape: null,
    synced_at: new Date().toISOString(),
  }
}

function findBest(m: ActivityMetrics, secs: number): number | null {
  return m.best_efforts?.find(e => e.secs === secs)?.watts ?? null
}

export function formatActivityMetrics(m: ActivityMetrics): string {
  const parts: string[] = []
  if (m.np !== null) parts.push(`NP ${Math.round(m.np)}W`)
  if (m.avg_power !== null) parts.push(`avg ${Math.round(m.avg_power)}W`)
  if (m.max_power !== null) parts.push(`max ${Math.round(m.max_power)}W`)
  if (m.distance_m !== null) parts.push(`${(m.distance_m / 1000).toFixed(1)}km`)
  if (m.elevation_m !== null) parts.push(`${Math.round(m.elevation_m)}m climb`)
  if (m.avg_hr !== null) parts.push(`HR ${Math.round(m.avg_hr)}`)
  const fiveMin = findBest(m, 300)
  if (fiveMin !== null) parts.push(`5min best ${fiveMin}W`)
  const twentyMin = findBest(m, 1200)
  if (twentyMin !== null) parts.push(`20min best ${twentyMin}W`)
  return parts.length ? parts.join(' · ') : 'no power data'
}

function mmss(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatRideExecution(
  plannedSteps: WorkoutStep[] | null,
  m: ActivityMetrics | null,
): string {
  if (!plannedSteps?.length) return ''
  if (!m?.intervals?.length) return ''
  const planned = plannedSteps
    .map(s => `${s.label} ${s.duration_minutes}min @ ${s.power_pct_ftp}%`)
    .join(' | ')
  const actual = m.intervals
    .map(iv => {
      const bits = [iv.label ?? 'Interval', mmss(iv.duration_secs)]
      if (iv.avg_watts !== null) bits.push(`avg ${Math.round(iv.avg_watts)}W`)
      if (iv.avg_hr !== null) bits.push(`HR ${Math.round(iv.avg_hr)}`)
      return bits.join(' ')
    })
    .join(' | ')
  return `Planned steps: ${planned}\nActual intervals: ${actual}`
}

// ── Stream-derived insights ───────────────────────────────────────────────
// Computed from full-resolution streams at sync. All pure and deterministic.
// Zone boundaries match CLAUDE.md: Z1<55, Z2 56–75, Z3 76–90, Z4 91–105,
// Z5 106–120, Z6 >120 (% FTP). Zones/shape need FTP — null when ftp is null.

type ZoneKey = 'z1' | 'z2' | 'z3' | 'z4' | 'z5' | 'z6'

function zoneOf(pct: number): ZoneKey {
  if (pct < 0.55) return 'z1'  // 55% itself falls through to Z2 (CLAUDE.md boundary is ambiguous there)
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
  // Loop to length-1: a sample's duration is the gap to the next sample, so the
  // final sample has no computable dt and contributes 0 (trapezoidal rule).
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
