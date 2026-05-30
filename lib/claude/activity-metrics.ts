// Pure, dependency-free formatters for enriched completed-ride detail.
// Kept free of the intervals.icu and Anthropic clients so prompt builders can
// import it without dragging in network/SDK code (mirrors lib/claude/zones.ts).
import type { ICUActivity, ICUPowerCurvePoint, ActivityInterval, ActivityMetrics } from '@/types'

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
