import type { ActivityWeather } from '@/types'
import type { IntervalsClient } from '@/lib/intervals/client'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Haversine helpers (module-private)
// ---------------------------------------------------------------------------

function toRad(deg: number): number {
  return deg * Math.PI / 180
}

function haversineBearing([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δλ = toRad(lon2 - lon1)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function haversineDistance([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const R = 6_371_000 // metres
  const φ1 = toRad(lat1)
  const φ2 = toRad(lat2)
  const Δφ = toRad(lat2 - lat1)
  const Δλ = toRad(lon2 - lon1)
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Returns angle between two bearings, normalised to 0–180.
function angleDiff(bearing: number, windDir: number): number {
  const raw = Math.abs(bearing - windDir) % 360
  return raw > 180 ? 360 - raw : raw
}

// ---------------------------------------------------------------------------
// computeHeadwindAnalysis — pure, no I/O
// ---------------------------------------------------------------------------

export function computeHeadwindAnalysis(params: {
  latlngs: [number, number][]
  windDirDeg: number
  windSpeedKph: number
  avgSpeedKph: number
}): {
  headwind_pct: number
  tailwind_pct: number
  crosswind_pct: number
  air_speed_kph: number
  weather_impact_pct: number
} {
  const { latlngs, windDirDeg, windSpeedKph, avgSpeedKph } = params
  if (latlngs.length < 2) {
    return { headwind_pct: 0, tailwind_pct: 0, crosswind_pct: 100,
             air_speed_kph: Math.round(avgSpeedKph * 10) / 10, weather_impact_pct: 0 }
  }

  let totalDist = 0
  let headwindDist = 0
  let tailwindDist = 0
  let weightedAirSpeed = 0
  let weightedImpact = 0

  for (let i = 0; i + 1 < latlngs.length; i++) {
    const dist = haversineDistance(latlngs[i], latlngs[i + 1])
    if (dist < 0.1) continue // skip duplicate GPS points

    const bearing = haversineBearing(latlngs[i], latlngs[i + 1])
    const diff = angleDiff(bearing, windDirDeg)

    // Positive windComponent = headwind; negative = tailwind
    const windComponent = windSpeedKph * Math.cos(toRad(diff))
    const vAir = avgSpeedKph + windComponent

    // Aerodynamic drag power scales with v_air³. Impact relative to still air.
    const impact = avgSpeedKph > 0
      ? ((Math.max(vAir, 0) ** 3 / avgSpeedKph ** 3) - 1) * 100
      : 0

    totalDist += dist
    weightedAirSpeed += vAir * dist
    weightedImpact += impact * dist

    if (diff <= 45) headwindDist += dist
    else if (diff >= 135) tailwindDist += dist
  }

  if (totalDist === 0) {
    return { headwind_pct: 0, tailwind_pct: 0, crosswind_pct: 100,
             air_speed_kph: Math.round(avgSpeedKph * 10) / 10, weather_impact_pct: 0 }
  }

  const crosswindDist = totalDist - headwindDist - tailwindDist
  const hw = Math.round((headwindDist / totalDist) * 100)
  const tw = Math.round((tailwindDist / totalDist) * 100)
  const cw = 100 - hw - tw  // guarantees sum === 100

  return {
    headwind_pct: hw,
    tailwind_pct: tw,
    crosswind_pct: cw,
    air_speed_kph: Math.round((weightedAirSpeed / totalDist) * 10) / 10,
    weather_impact_pct: Math.round((weightedImpact / totalDist) * 10) / 10,
  }
}

// Placeholder stubs — implemented in Task 3
export async function fetchHistoricalWeather(
  _lat: number, _lon: number, _dateStr: string, _rideHour: number,
): Promise<{ temp_min_c: number; temp_max_c: number; precip_mm: number; wind_avg_kph: number; wind_dir_deg: number } | null> {
  throw new Error('not yet implemented')
}

export async function fetchActivityWeather(
  _activityId: string, _userId: string, _client: IntervalsClient, _supabase: SupabaseClient,
): Promise<ActivityWeather | null> {
  throw new Error('not yet implemented')
}
