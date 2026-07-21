import type { ActivityMetrics, ClimbSegment, SpeedBest } from '@/types'

export interface AllTimeBests {
  biggestClimb: { workoutId: string | null; icuActivityId: string; date: string; elev_gain_m: number; length_km: number | null } | null
  longestClimb: { workoutId: string | null; icuActivityId: string; date: string; length_km: number; elev_gain_m: number } | null
  powerBests: Array<{ secs: number; watts: number; workoutId: string | null; icuActivityId: string; date: string }>
  speedBests: Array<{ distance_km: number; avg_speed_kmh: number; workoutId: string | null; icuActivityId: string; date: string }>
  maxSpeed: { workoutId: string | null; icuActivityId: string; date: string; speed_kmh: number; max_speed_ms: number } | null
}

export interface AllTimeBestsResponse {
  allTime: AllTimeBests
  byYear: Record<string, AllTimeBests>
}

export interface IndoorOutdoorBestsResponse {
  outdoor: AllTimeBestsResponse
  indoor: AllTimeBestsResponse
}

// Only the fields computeAllTimeBests actually reads — decoupled from the full
// ActivityMetrics shape so a "synthetic" candidate (reconstructed from a stored
// champion, or produced by the deep-history scan with no local workouts row)
// never needs to fake unrelated fields like decoupling_pct or shape.
export interface BestsCandidateMetrics {
  // length_km is nullable here — unlike ClimbSegment's own always-present field —
  // because un-backfilled historical climbs (see computeAllTimeBests below) and
  // synthetic champions reconstructed for a climb whose length was never measured
  // both need to represent "no length yet" without faking a numeric value.
  climbs: Array<{ elev_gain_m: ClimbSegment['elev_gain_m']; length_km: ClimbSegment['length_km'] | null }> | null
  best_efforts: Array<{ secs: number; watts: number }> | null
  speed_bests: Array<Pick<SpeedBest, 'distance_km' | 'avg_speed_kmh'>> | null
  max_speed_ms?: number | null
}

export interface BestsRide {
  id: string | null           // workouts.id — null when this ride has no local row (deep-history scan)
  icu_activity_id: string     // always present — every ride reaching this reducer came from an intervals.icu activity
  date: string
  activity_metrics: BestsCandidateMetrics | null
}

// A single pass over the given rides, tracking running maxima per category and
// remembering which ride each came from. Stays generic over whatever subset of
// rides it's given — the caller decides "all-time" vs. "just this year" by
// choosing which rides to pass in.
export function computeAllTimeBests(rides: BestsRide[]): AllTimeBests {
  let biggestClimb: AllTimeBests['biggestClimb'] = null
  let longestClimb: AllTimeBests['longestClimb'] = null
  let maxSpeed: AllTimeBests['maxSpeed'] = null
  const powerBestsByDuration = new Map<number, { watts: number; workoutId: string | null; icuActivityId: string; date: string }>()
  const speedBestsByDistance = new Map<number, { avg_speed_kmh: number; workoutId: string | null; icuActivityId: string; date: string }>()

  for (const r of rides) {
    const m = r.activity_metrics
    if (!m) continue

    for (const climb of m.climbs ?? []) {
      if (!biggestClimb || climb.elev_gain_m > biggestClimb.elev_gain_m) {
        biggestClimb = { workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date, elev_gain_m: climb.elev_gain_m, length_km: climb.length_km ?? null }
      }
      // Un-backfilled historical climbs don't have length_km yet — never let one
      // become (or beat) the longest-climb record until it's actually measured.
      if (climb.length_km != null && (!longestClimb || climb.length_km > longestClimb.length_km)) {
        longestClimb = { workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date, length_km: climb.length_km, elev_gain_m: climb.elev_gain_m }
      }
    }

    for (const effort of m.best_efforts ?? []) {
      const existing = powerBestsByDuration.get(effort.secs)
      if (!existing || effort.watts > existing.watts) {
        powerBestsByDuration.set(effort.secs, { watts: effort.watts, workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date })
      }
    }

    for (const speed of m.speed_bests ?? []) {
      const existing = speedBestsByDistance.get(speed.distance_km)
      if (!existing || speed.avg_speed_kmh > existing.avg_speed_kmh) {
        speedBestsByDistance.set(speed.distance_km, { avg_speed_kmh: speed.avg_speed_kmh, workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date })
      }
    }

    if (m.max_speed_ms != null) {
      const speed_kmh = Math.round(m.max_speed_ms * 3.6 * 10) / 10
      if (!maxSpeed || speed_kmh > maxSpeed.speed_kmh) {
        maxSpeed = { workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date, speed_kmh, max_speed_ms: m.max_speed_ms }
      }
    }
  }

  const powerBests = [...powerBestsByDuration.entries()]
    .map(([secs, v]) => ({ secs, ...v }))
    .sort((a, b) => a.secs - b.secs)
  const speedBests = [...speedBestsByDistance.entries()]
    .map(([distance_km, v]) => ({ distance_km, ...v }))
    .sort((a, b) => a.distance_km - b.distance_km)

  return { biggestClimb, longestClimb, powerBests, speedBests, maxSpeed }
}

// Groups rides by calendar year (from their `date`) and computes bests once for
// the full set and once per distinct year found. Only years with at least one
// ride carrying activity_metrics get an entry — a ride with null metrics
// contributes to neither the all-time computation nor any year bucket.
export function computeAllTimeBestsByPeriod(rides: BestsRide[]): AllTimeBestsResponse {
  const allTime = computeAllTimeBests(rides)
  const byYearRides = new Map<string, BestsRide[]>()
  for (const r of rides) {
    if (!r.activity_metrics) continue
    const year = r.date.slice(0, 4)
    const arr = byYearRides.get(year) ?? []
    arr.push(r)
    byYearRides.set(year, arr)
  }
  const byYear: Record<string, AllTimeBests> = {}
  for (const [year, yearRides] of byYearRides) {
    byYear[year] = computeAllTimeBests(yearRides)
  }
  return { allTime, byYear }
}
