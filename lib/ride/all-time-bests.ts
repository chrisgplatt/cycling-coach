import type { ActivityMetrics, ClimbSegment, SpeedBest } from '@/types'

// Speed data from before this date comes from an era (2017-era Garmin Edge 520)
// with known unreliable GPS/speed readings — excluded from Speed Bests and Max
// Speed entirely, regardless of the plausibility ceilings in activity-metrics.ts.
// Climbs and power bests are unaffected; only speed-derived categories are era-gated.
const SPEED_BESTS_TRUSTED_FROM = '2018-01-01'

// Every ranked slot keeps the top 3 candidates (gold/silver/bronze), best first.
const PODIUM_SIZE = 3

export interface RankedEntry {
  rank: 1 | 2 | 3
  workoutId: string | null
  icuActivityId: string
  date: string
}

export interface AllTimeBests {
  biggestClimb: (RankedEntry & { elev_gain_m: number; length_km: number | null })[]
  longestClimb: (RankedEntry & { length_km: number; elev_gain_m: number })[]
  powerBests: (RankedEntry & { secs: number; watts: number })[]
  speedBests: (RankedEntry & { distance_km: number; avg_speed_kmh: number })[]
  maxSpeed: (RankedEntry & { speed_kmh: number; max_speed_ms: number })[]
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

// Inserts candidate into a podium array (already sorted best-first, length <=
// PODIUM_SIZE), re-sorts by value descending, and keeps only the top 3.
// Array.sort is stable, so when two candidates tie exactly, whichever was
// already in the array (i.e. processed earlier) keeps the better rank — no
// separate tie-break logic needed. Ranks (1-3) are assigned later, by final
// array position, once every ride has been folded in — see withRanks.
function insertRanked<T>(existing: T[], candidate: T, valueOf: (t: T) => number): T[] {
  return [...existing, candidate]
    .sort((a, b) => valueOf(b) - valueOf(a))
    .slice(0, PODIUM_SIZE)
}

function withRanks<T>(entries: T[]): (T & { rank: 1 | 2 | 3 })[] {
  return entries.map((e, i) => ({ ...e, rank: (i + 1) as 1 | 2 | 3 }))
}

// A single pass over the given rides, tracking a top-3 podium per category and
// remembering which ride each entry came from. Stays generic over whatever subset
// of rides it's given — the caller decides "all-time" vs. "just this year" by
// choosing which rides to pass in.
export function computeAllTimeBests(rides: BestsRide[]): AllTimeBests {
  type ClimbCandidate = { workoutId: string | null; icuActivityId: string; date: string; elev_gain_m: number; length_km: number | null }
  type LongestClimbCandidate = { workoutId: string | null; icuActivityId: string; date: string; length_km: number; elev_gain_m: number }
  type PowerCandidate = { workoutId: string | null; icuActivityId: string; date: string; watts: number }
  type SpeedCandidate = { workoutId: string | null; icuActivityId: string; date: string; avg_speed_kmh: number }
  type MaxSpeedCandidate = { workoutId: string | null; icuActivityId: string; date: string; speed_kmh: number; max_speed_ms: number }

  let biggestClimb: ClimbCandidate[] = []
  let longestClimb: LongestClimbCandidate[] = []
  let maxSpeed: MaxSpeedCandidate[] = []
  const powerBestsByDuration = new Map<number, PowerCandidate[]>()
  const speedBestsByDistance = new Map<number, SpeedCandidate[]>()

  for (const r of rides) {
    const m = r.activity_metrics
    if (!m) continue

    for (const climb of m.climbs ?? []) {
      biggestClimb = insertRanked(
        biggestClimb,
        { workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date, elev_gain_m: climb.elev_gain_m, length_km: climb.length_km ?? null },
        c => c.elev_gain_m,
      )
      // Un-backfilled historical climbs don't have length_km yet — never let one
      // enter (or beat) the longest-climb podium until it's actually measured.
      if (climb.length_km != null) {
        longestClimb = insertRanked(
          longestClimb,
          { workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date, length_km: climb.length_km, elev_gain_m: climb.elev_gain_m },
          c => c.length_km,
        )
      }
    }

    for (const effort of m.best_efforts ?? []) {
      const existing = powerBestsByDuration.get(effort.secs) ?? []
      powerBestsByDuration.set(
        effort.secs,
        insertRanked(existing, { watts: effort.watts, workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date }, p => p.watts),
      )
    }

    const trustSpeed = r.date >= SPEED_BESTS_TRUSTED_FROM
    if (trustSpeed) {
      for (const speed of m.speed_bests ?? []) {
        const existing = speedBestsByDistance.get(speed.distance_km) ?? []
        speedBestsByDistance.set(
          speed.distance_km,
          insertRanked(existing, { avg_speed_kmh: speed.avg_speed_kmh, workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date }, s => s.avg_speed_kmh),
        )
      }

      if (m.max_speed_ms != null) {
        const speed_kmh = Math.round(m.max_speed_ms * 3.6 * 10) / 10
        maxSpeed = insertRanked(
          maxSpeed,
          { workoutId: r.id, icuActivityId: r.icu_activity_id, date: r.date, speed_kmh, max_speed_ms: m.max_speed_ms },
          s => s.speed_kmh,
        )
      }
    }
  }

  const powerBests = [...powerBestsByDuration.entries()]
    .flatMap(([secs, entries]) => withRanks(entries).map(e => ({ secs, ...e })))
    .sort((a, b) => a.secs - b.secs || a.rank - b.rank)
  const speedBests = [...speedBestsByDistance.entries()]
    .flatMap(([distance_km, entries]) => withRanks(entries).map(e => ({ distance_km, ...e })))
    .sort((a, b) => a.distance_km - b.distance_km || a.rank - b.rank)

  return {
    biggestClimb: withRanks(biggestClimb),
    longestClimb: withRanks(longestClimb),
    powerBests,
    speedBests,
    maxSpeed: withRanks(maxSpeed),
  }
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
