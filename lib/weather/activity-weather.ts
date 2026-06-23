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

interface HistoricalWeatherResult {
  temp_min_c: number
  temp_max_c: number
  precip_mm: number
  wind_avg_kph: number
  wind_dir_deg: number
}

export async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  dateStr: string,
  rideHour: number,
): Promise<HistoricalWeatherResult | null> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: dateStr,
    end_date: dateStr,
    hourly: 'temperature_2m,wind_speed_10m,wind_direction_10m,precipitation',
    wind_speed_unit: 'kmh',
    timezone: 'auto',
  })
  try {
    const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`)
    if (!res.ok) return null
    const data = await res.json() as {
      hourly?: {
        time?: string[]
        temperature_2m?: (number | null)[]
        wind_speed_10m?: (number | null)[]
        wind_direction_10m?: (number | null)[]
        precipitation?: (number | null)[]
      }
    }
    const h = data.hourly
    if (!h?.time?.length) return null

    // Find the index of the matching hour in the time array (archive API returns
    // 24 hourly entries in normal use, so rideHour aligns with the array index,
    // but we search explicitly to be safe with sparse responses).
    const hourIdx = h.time.findIndex(t => {
      const h24 = parseInt(t.split('T')[1]?.split(':')[0] ?? '-1', 10)
      return h24 === rideHour
    })
    if (hourIdx === -1) return null
    // Temp range: cover up to 3 hours of ride duration
    const endIdx = Math.min(hourIdx + 3, h.time.length - 1)
    const temps = (h.temperature_2m ?? [])
      .slice(hourIdx, endIdx + 1)
      .filter((v): v is number => v != null)

    return {
      temp_min_c: temps.length ? Math.min(...temps) : (h.temperature_2m?.[hourIdx] ?? 0),
      temp_max_c: temps.length ? Math.max(...temps) : (h.temperature_2m?.[hourIdx] ?? 0),
      precip_mm:  h.precipitation?.[hourIdx] ?? 0,
      wind_avg_kph:  h.wind_speed_10m?.[hourIdx] ?? 0,
      wind_dir_deg:  h.wind_direction_10m?.[hourIdx] ?? 0,
    }
  } catch {
    return null
  }
}

export async function fetchActivityWeather(
  activityId: string,
  userId: string,
  client: IntervalsClient,
  supabase: SupabaseClient,
): Promise<ActivityWeather | null> {
  // 1. GPS track (null = indoor ride)
  const { latlngs } = await client.getActivityMap(activityId)
  if (!latlngs || latlngs.length < 2) return null

  // 2. Activity metadata for timing + speed
  const activity = await client.getActivity(activityId)
  const dateStr = activity.start_date_local.split('T')[0]
  // Parse hour from local datetime string (e.g. "2026-06-20T12:21:00")
  const rideHour = parseInt(activity.start_date_local.split('T')[1]?.split(':')[0] ?? '12', 10)
  const avgSpeedKph = activity.distance != null && activity.moving_time > 0
    ? (activity.distance / 1000) / (activity.moving_time / 3600)
    : 20  // fallback if no GPS distance

  // 3. Historical weather at start location
  const [startLat, startLon] = latlngs[0]
  const historicalWeather = await fetchHistoricalWeather(startLat, startLon, dateStr, rideHour)
  if (!historicalWeather) return null

  // 4. Headwind analysis
  const analysis = computeHeadwindAnalysis({
    latlngs,
    windDirDeg: historicalWeather.wind_dir_deg,
    windSpeedKph: historicalWeather.wind_avg_kph,
    avgSpeedKph,
  })

  // 5. Assemble + cache
  const result: ActivityWeather = {
    activity_id: activityId,
    ...historicalWeather,
    ...analysis,
  }

  await supabase.from('activity_weather').upsert(
    { ...result, user_id: userId, computed_at: new Date().toISOString() },
    { onConflict: 'activity_id' },
  )

  return result
}
