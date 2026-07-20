import { computeAllTimeBests, computeAllTimeBestsByPeriod } from '@/lib/ride/all-time-bests'
import type { ActivityMetrics, ClimbSegment, SpeedBest } from '@/types'

function makeClimb(overrides: Partial<ClimbSegment> = {}): ClimbSegment {
  return { start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675, length_km: 3.2, path: null, ...overrides }
}

function makeSpeedBest(overrides: Partial<SpeedBest> = {}): SpeedBest {
  return { distance_km: 10, avg_speed_kmh: 30, start_km: 2, duration_secs: 1200, ...overrides }
}

function makeMetrics(overrides: Partial<ActivityMetrics> = {}): ActivityMetrics {
  return {
    np: null, avg_power: null, max_power: null, avg_hr: null, distance_m: null, elevation_m: null,
    lr_balance: null, best_efforts: null, intervals: null, decoupling_pct: null, climbs: null,
    time_in_zone: null, shape: null, distributions: null, effort_periods: null, sprints: null,
    speed_bests: null, personal_bests: null, synced_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function ride(id: string, date: string, metrics: ActivityMetrics | null) {
  return { id, date, activity_metrics: metrics }
}

describe('computeAllTimeBests', () => {
  it('finds the biggest climb by elev_gain_m across rides', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400, length_km: 5 })] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900, length_km: 3 })] })),
      ride('w3', '2026-03-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 600, length_km: 4 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb).toEqual({ workoutId: 'w2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 })
  })

  it('finds the longest climb by length_km across rides, independent of elevation', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900, length_km: 3 })] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400, length_km: 12.5 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.longestClimb).toEqual({ workoutId: 'w2', date: '2026-02-01', length_km: 12.5, elev_gain_m: 400 })
  })

  it('finds the max watts per duration across rides, keeping durations independent', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 280 }, { secs: 1200, watts: 210 }] })),
      ride('w2', '2026-02-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 310 }] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.powerBests).toEqual([
      { secs: 300, watts: 310, workoutId: 'w2', date: '2026-02-01' },
      { secs: 1200, watts: 210, workoutId: 'w1', date: '2026-01-01' },
    ])
  })

  it('finds the fastest speed per distance split across rides', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ speed_bests: [makeSpeedBest({ distance_km: 1, avg_speed_kmh: 35 })] })),
      ride('w2', '2026-02-01', makeMetrics({ speed_bests: [makeSpeedBest({ distance_km: 1, avg_speed_kmh: 42 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.speedBests).toEqual([
      { distance_km: 1, avg_speed_kmh: 42, workoutId: 'w2', date: '2026-02-01' },
    ])
  })

  it('finds the all-time max speed from max_speed_ms, converted to km/h', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ max_speed_ms: 15 })),   // 54 km/h
      ride('w2', '2026-02-01', makeMetrics({ max_speed_ms: 19 })),   // 68.4 km/h
    ]
    const result = computeAllTimeBests(rides)
    expect(result.maxSpeed).toEqual({ workoutId: 'w2', date: '2026-02-01', speed_kmh: 68.4 })
  })

  it('skips rides with null activity_metrics without throwing', () => {
    const rides = [
      ride('w1', '2026-01-01', null),
      ride('w2', '2026-02-01', makeMetrics({ max_speed_ms: 15 })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.maxSpeed).toEqual({ workoutId: 'w2', date: '2026-02-01', speed_kmh: 54 })
  })

  it('returns all-null/empty when no rides have any qualifying data', () => {
    const result = computeAllTimeBests([ride('w1', '2026-01-01', makeMetrics())])
    expect(result).toEqual({
      biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null,
    })
  })

  it('ignores climbs missing length_km (un-backfilled historical data) when tracking longestClimb, while biggestClimb still surfaces correctly by elevation', () => {
    const oldClimb = { start_km: 5, duration_secs: 480, elev_gain_m: 700, avg_watts: 268, vam: 675 } as unknown as ClimbSegment
    const newClimb = makeClimb({ elev_gain_m: 300, length_km: 8 })
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [oldClimb] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [newClimb] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb).toEqual({ workoutId: 'w1', date: '2026-01-01', elev_gain_m: 700, length_km: null })
    expect(result.longestClimb).toEqual({ workoutId: 'w2', date: '2026-02-01', length_km: 8, elev_gain_m: 300 })
  })

  it('returns longestClimb null when no climb anywhere has a backfilled length_km yet', () => {
    const oldClimb = { start_km: 5, duration_secs: 480, elev_gain_m: 700, avg_watts: 268, vam: 675 } as unknown as ClimbSegment
    const result = computeAllTimeBests([ride('w1', '2026-01-01', makeMetrics({ climbs: [oldClimb] }))])
    expect(result.longestClimb).toBeNull()
    expect(result.biggestClimb).toEqual({ workoutId: 'w1', date: '2026-01-01', elev_gain_m: 700, length_km: null })
  })
})

describe('computeAllTimeBestsByPeriod', () => {
  it('groups rides by year and computes bests both all-time and per-year', () => {
    const rides = [
      ride('w1', '2025-06-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400 })] })),
      ride('w2', '2026-03-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900 })] })),
      ride('w3', '2026-08-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 300 })] })),
    ]
    const result = computeAllTimeBestsByPeriod(rides)
    expect(result.allTime.biggestClimb?.elev_gain_m).toBe(900)
    expect(result.byYear['2025'].biggestClimb?.elev_gain_m).toBe(400)
    expect(result.byYear['2026'].biggestClimb?.elev_gain_m).toBe(900)
  })

  it('only includes years that have at least one ride with activity_metrics', () => {
    const rides = [
      ride('w1', '2024-01-01', null),   // no metrics — shouldn't produce a 2024 entry
      ride('w2', '2026-01-01', makeMetrics({ max_speed_ms: 10 })),
    ]
    const result = computeAllTimeBestsByPeriod(rides)
    expect(Object.keys(result.byYear)).toEqual(['2026'])
  })

  it('returns an empty byYear map when given no rides', () => {
    const result = computeAllTimeBestsByPeriod([])
    expect(result.byYear).toEqual({})
    expect(result.allTime).toEqual({
      biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null,
    })
  })
})
