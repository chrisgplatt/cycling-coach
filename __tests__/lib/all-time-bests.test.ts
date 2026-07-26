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

function ride(id: string, date: string, metrics: ActivityMetrics | null, icuActivityId = `icu-${id}`) {
  return { id, icu_activity_id: icuActivityId, date, activity_metrics: metrics }
}

describe('computeAllTimeBests', () => {
  it('ranks the top 3 climbs by elev_gain_m, best first, each tagged with its rank', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400, length_km: 5 })] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900, length_km: 3 })] })),
      ride('w3', '2026-03-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 600, length_km: 4 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb).toEqual([
      { rank: 1, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 },
      { rank: 2, workoutId: 'w3', icuActivityId: 'icu-w3', date: '2026-03-01', elev_gain_m: 600, length_km: 4 },
      { rank: 3, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01', elev_gain_m: 400, length_km: 5 },
    ])
  })

  it('drops a 4th climb once 3 higher-elevation climbs already fill the podium', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400 })] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900 })] })),
      ride('w3', '2026-03-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 600 })] })),
      ride('w4', '2026-04-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 300 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb).toHaveLength(3)
    expect(result.biggestClimb.map(c => c.workoutId)).toEqual(['w2', 'w3', 'w1'])
  })

  it('finds the longest climb podium by length_km, independent of elevation', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900, length_km: 3 })] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400, length_km: 12.5 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.longestClimb).toEqual([
      { rank: 1, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01', length_km: 12.5, elev_gain_m: 400 },
      { rank: 2, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01', length_km: 3, elev_gain_m: 900 },
    ])
  })

  it('ranks the top 3 watts per duration independently across durations', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 280 }, { secs: 1200, watts: 210 }] })),
      ride('w2', '2026-02-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 310 }] })),
      ride('w3', '2026-03-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 250 }] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.powerBests).toEqual([
      { rank: 1, secs: 300, watts: 310, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01' },
      { rank: 2, secs: 300, watts: 280, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01' },
      { rank: 3, secs: 300, watts: 250, workoutId: 'w3', icuActivityId: 'icu-w3', date: '2026-03-01' },
      { rank: 1, secs: 1200, watts: 210, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01' },
    ])
  })

  it("drops a 4th power result once 3 higher watts already fill that duration's podium", () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 280 }] })),
      ride('w2', '2026-02-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 310 }] })),
      ride('w3', '2026-03-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 250 }] })),
      ride('w4', '2026-04-01', makeMetrics({ best_efforts: [{ secs: 300, watts: 200 }] })),
    ]
    const result = computeAllTimeBests(rides)
    const at300 = result.powerBests.filter(p => p.secs === 300)
    expect(at300).toHaveLength(3)
    expect(at300.map(p => p.watts)).toEqual([310, 280, 250])
  })

  it('ranks the top 3 speeds per distance split', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ speed_bests: [makeSpeedBest({ distance_km: 1, avg_speed_kmh: 35 })] })),
      ride('w2', '2026-02-01', makeMetrics({ speed_bests: [makeSpeedBest({ distance_km: 1, avg_speed_kmh: 42 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.speedBests).toEqual([
      { rank: 1, distance_km: 1, avg_speed_kmh: 42, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01' },
      { rank: 2, distance_km: 1, avg_speed_kmh: 35, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01' },
    ])
  })

  it('ranks the top 3 all-time max speeds from max_speed_ms, converted to km/h', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ max_speed_ms: 15 })),   // 54 km/h
      ride('w2', '2026-02-01', makeMetrics({ max_speed_ms: 19 })),   // 68.4 km/h
    ]
    const result = computeAllTimeBests(rides)
    expect(result.maxSpeed).toEqual([
      { rank: 1, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01', speed_kmh: 68.4, max_speed_ms: 19 },
      { rank: 2, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01', speed_kmh: 54, max_speed_ms: 15 },
    ])
  })

  it('excludes speed bests and max speed from rides before the 2018 trusted-era cutoff, keeping later rides', () => {
    const rides = [
      ride('w1', '2017-12-31', makeMetrics({ speed_bests: [makeSpeedBest({ distance_km: 20, avg_speed_kmh: 69.5 })], max_speed_ms: 30 })),
      ride('w2', '2018-01-01', makeMetrics({ speed_bests: [makeSpeedBest({ distance_km: 20, avg_speed_kmh: 45 })], max_speed_ms: 15 })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.speedBests).toEqual([
      { rank: 1, distance_km: 20, avg_speed_kmh: 45, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2018-01-01' },
    ])
    expect(result.maxSpeed).toEqual([
      { rank: 1, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2018-01-01', speed_kmh: 54, max_speed_ms: 15 },
    ])
  })

  it('produces no speed bests or max speed when every candidate ride predates the trusted era', () => {
    const rides = [
      ride('w1', '2017-06-01', makeMetrics({ speed_bests: [makeSpeedBest({ avg_speed_kmh: 40 })], max_speed_ms: 20 })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.speedBests).toEqual([])
    expect(result.maxSpeed).toEqual([])
  })

  it('leaves climbs and power bests unaffected by the speed-era cutoff', () => {
    const rides = [
      ride('w1', '2017-06-01', makeMetrics({
        climbs: [makeClimb({ elev_gain_m: 900, length_km: 3 })],
        best_efforts: [{ secs: 300, watts: 310 }],
      })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb[0]?.elev_gain_m).toBe(900)
    expect(result.powerBests).toEqual([{ rank: 1, secs: 300, watts: 310, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2017-06-01' }])
  })

  it('skips rides with null activity_metrics without throwing', () => {
    const rides = [
      ride('w1', '2026-01-01', null),
      ride('w2', '2026-02-01', makeMetrics({ max_speed_ms: 15 })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.maxSpeed).toEqual([{ rank: 1, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01', speed_kmh: 54, max_speed_ms: 15 }])
  })

  it('returns all-empty arrays when no rides have any qualifying data', () => {
    const result = computeAllTimeBests([ride('w1', '2026-01-01', makeMetrics())])
    expect(result).toEqual({
      biggestClimb: [], longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [],
    })
  })

  it('ignores climbs missing length_km (un-backfilled historical data) when ranking longestClimb, while biggestClimb still ranks correctly by elevation', () => {
    const oldClimb = { start_km: 5, duration_secs: 480, elev_gain_m: 700, avg_watts: 268, vam: 675 } as unknown as ClimbSegment
    const newClimb = makeClimb({ elev_gain_m: 300, length_km: 8 })
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [oldClimb] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [newClimb] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb).toEqual([
      { rank: 1, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01', elev_gain_m: 700, length_km: null },
      { rank: 2, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01', elev_gain_m: 300, length_km: 8 },
    ])
    expect(result.longestClimb).toEqual([
      { rank: 1, workoutId: 'w2', icuActivityId: 'icu-w2', date: '2026-02-01', length_km: 8, elev_gain_m: 300 },
    ])
  })

  it('returns an empty longestClimb when no climb anywhere has a backfilled length_km yet', () => {
    const oldClimb = { start_km: 5, duration_secs: 480, elev_gain_m: 700, avg_watts: 268, vam: 675 } as unknown as ClimbSegment
    const result = computeAllTimeBests([ride('w1', '2026-01-01', makeMetrics({ climbs: [oldClimb] }))])
    expect(result.longestClimb).toEqual([])
    expect(result.biggestClimb).toEqual([{ rank: 1, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01', elev_gain_m: 700, length_km: null }])
  })

  it('supports a workoutless ride (no local workouts row) via a null id', () => {
    const rides = [
      { id: null, icu_activity_id: 'icu-only', date: '2026-04-01', activity_metrics: makeMetrics({ climbs: [makeClimb({ elev_gain_m: 700, length_km: 6 })] }) },
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb).toEqual([{ rank: 1, workoutId: null, icuActivityId: 'icu-only', date: '2026-04-01', elev_gain_m: 700, length_km: 6 }])
  })

  it('stores max_speed_ms alongside speed_kmh, exactly as provided (no derived reconstruction)', () => {
    const rides = [ride('w1', '2026-01-01', makeMetrics({ max_speed_ms: 19.027 }))]
    const result = computeAllTimeBests(rides)
    expect(result.maxSpeed).toEqual([{ rank: 1, workoutId: 'w1', icuActivityId: 'icu-w1', date: '2026-01-01', speed_kmh: 68.5, max_speed_ms: 19.027 }])
  })

  it('gives the earlier-processed ride the better rank when two climbs tie exactly on elev_gain_m', () => {
    const rides = [
      ride('w1', '2026-01-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 500 })] })),
      ride('w2', '2026-02-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 500 })] })),
    ]
    const result = computeAllTimeBests(rides)
    expect(result.biggestClimb.map(c => c.workoutId)).toEqual(['w1', 'w2'])
  })
})

describe('computeAllTimeBestsByPeriod', () => {
  it('groups rides by year and computes ranked bests both all-time and per-year', () => {
    const rides = [
      ride('w1', '2025-06-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 400 })] })),
      ride('w2', '2026-03-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 900 })] })),
      ride('w3', '2026-08-01', makeMetrics({ climbs: [makeClimb({ elev_gain_m: 300 })] })),
    ]
    const result = computeAllTimeBestsByPeriod(rides)
    expect(result.allTime.biggestClimb[0]?.elev_gain_m).toBe(900)
    expect(result.byYear['2025'].biggestClimb[0]?.elev_gain_m).toBe(400)
    expect(result.byYear['2026'].biggestClimb[0]?.elev_gain_m).toBe(900)
    expect(result.byYear['2026'].biggestClimb[1]?.elev_gain_m).toBe(300)
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
      biggestClimb: [], longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [],
    })
  })
})
