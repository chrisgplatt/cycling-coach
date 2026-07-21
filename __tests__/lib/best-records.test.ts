import {
  reconstructSyntheticRides, flattenAllTimeBestsToRows, mergeCandidateIntoBests,
  type BestRecordRow,
} from '@/lib/ride/best-records'
import { computeAllTimeBests, type AllTimeBests, type BestsRide } from '@/lib/ride/all-time-bests'

function row(overrides: Partial<BestRecordRow>): BestRecordRow {
  return { period: 'all', category: 'biggest_climb', sub_key: '', value: 0, detail: {}, ...overrides }
}

describe('reconstructSyntheticRides', () => {
  it('reconstructs a climb row (biggest or longest) as a single-climb synthetic ride', () => {
    const rows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 } }),
    ]
    const rides = reconstructSyntheticRides(rows)
    expect(rides).toEqual([
      { id: 'w2', icu_activity_id: 'icu-2', date: '2026-02-01', activity_metrics: { climbs: [{ elev_gain_m: 900, length_km: 3 }], best_efforts: null, speed_bests: null, max_speed_ms: null } },
    ])
  })

  it('reconstructs a power row as a single-entry best_efforts synthetic ride', () => {
    const rows: BestRecordRow[] = [
      row({ category: 'power', sub_key: '300', value: 310, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2' } }),
    ]
    const rides = reconstructSyntheticRides(rows)
    expect(rides).toEqual([
      { id: 'w2', icu_activity_id: 'icu-2', date: '2026-02-01', activity_metrics: { climbs: null, best_efforts: [{ secs: 300, watts: 310 }], speed_bests: null, max_speed_ms: null } },
    ])
  })

  it('reconstructs a speed row as a single-entry speed_bests synthetic ride', () => {
    const rows: BestRecordRow[] = [
      row({ category: 'speed', sub_key: '10', value: 38.4, detail: { date: '2026-05-01', workoutId: null, icuActivityId: 'icu-4' } }),
    ]
    const rides = reconstructSyntheticRides(rows)
    expect(rides).toEqual([
      { id: null, icu_activity_id: 'icu-4', date: '2026-05-01', activity_metrics: { climbs: null, best_efforts: null, speed_bests: [{ distance_km: 10, avg_speed_kmh: 38.4 }], max_speed_ms: null } },
    ])
  })

  it('reconstructs a max_speed row using the stored raw max_speed_ms, not a reversed conversion', () => {
    const rows: BestRecordRow[] = [
      row({ category: 'max_speed', value: 68.5, detail: { date: '2024-07-04', workoutId: 'w5', icuActivityId: 'icu-5', max_speed_ms: 19.027 } }),
    ]
    const rides = reconstructSyntheticRides(rows)
    expect(rides).toEqual([
      { id: 'w5', icu_activity_id: 'icu-5', date: '2024-07-04', activity_metrics: { climbs: null, best_efforts: null, speed_bests: null, max_speed_ms: 19.027 } },
    ])
  })
})

describe('flattenAllTimeBestsToRows', () => {
  it('flattens a full AllTimeBests into one row per present category', () => {
    const bests: AllTimeBests = {
      biggestClimb: { workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', elev_gain_m: 900, length_km: 3 },
      longestClimb: { workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', length_km: 12, elev_gain_m: 400 },
      powerBests: [{ secs: 300, watts: 310, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-03-01' }],
      speedBests: [{ distance_km: 10, avg_speed_kmh: 38.4, workoutId: 'w4', icuActivityId: 'icu-4', date: '2026-04-01' }],
      maxSpeed: { workoutId: 'w5', icuActivityId: 'icu-5', date: '2026-05-01', speed_kmh: 68.5, max_speed_ms: 19.027 },
    }
    const rows = flattenAllTimeBestsToRows('all', bests)
    expect(rows).toEqual([
      { period: 'all', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 } },
      { period: 'all', category: 'longest_climb', sub_key: '', value: 12, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', elev_gain_m: 400 } },
      { period: 'all', category: 'power', sub_key: '300', value: 310, detail: { date: '2026-03-01', workoutId: 'w3', icuActivityId: 'icu-3' } },
      { period: 'all', category: 'speed', sub_key: '10', value: 38.4, detail: { date: '2026-04-01', workoutId: 'w4', icuActivityId: 'icu-4' } },
      { period: 'all', category: 'max_speed', sub_key: '', value: 68.5, detail: { date: '2026-05-01', workoutId: 'w5', icuActivityId: 'icu-5', max_speed_ms: 19.027 } },
    ])
  })

  it('omits rows for absent categories rather than emitting nulls', () => {
    const empty: AllTimeBests = { biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null }
    expect(flattenAllTimeBestsToRows('2026', empty)).toEqual([])
  })
})

describe('reconstruction and flattening round-trip losslessly', () => {
  it('feeding flattened rows back through reconstructSyntheticRides + computeAllTimeBests reproduces the same bests', () => {
    const original: BestsRide[] = [
      { id: 'w1', icu_activity_id: 'icu-1', date: '2026-01-01', activity_metrics: { climbs: [{ elev_gain_m: 900, length_km: 3 }], best_efforts: [{ secs: 300, watts: 310 }], speed_bests: [{ distance_km: 10, avg_speed_kmh: 38.4 }], max_speed_ms: 19.027 } },
    ]
    const computed = computeAllTimeBests(original)
    const rows = flattenAllTimeBestsToRows('all', computed)
    const synthetic = reconstructSyntheticRides(rows)
    const recomputed = computeAllTimeBests(synthetic)
    expect(recomputed).toEqual(computed)
  })
})

describe('mergeCandidateIntoBests', () => {
  it('keeps the existing champion when the new candidate does not beat it', () => {
    const existingAllTimeRows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 } }),
    ]
    const candidate: BestsRide = { id: 'w2', icu_activity_id: 'icu-2', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 300, length_km: 1 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { allTime } = mergeCandidateIntoBests(existingAllTimeRows, [], candidate)
    expect(allTime.biggestClimb).toEqual({ workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', elev_gain_m: 900, length_km: 3 })
  })

  it('replaces the champion when the new candidate beats it', () => {
    const existingAllTimeRows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 } }),
    ]
    const candidate: BestsRide = { id: 'w2', icu_activity_id: 'icu-2', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 1200, length_km: 8 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { allTime } = mergeCandidateIntoBests(existingAllTimeRows, [], candidate)
    expect(allTime.biggestClimb).toEqual({ workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-06-01', elev_gain_m: 1200, length_km: 8 })
  })

  it('seeds a category with no prior champion', () => {
    const candidate: BestsRide = { id: 'w1', icu_activity_id: 'icu-1', date: '2026-01-01', activity_metrics: { climbs: null, best_efforts: null, speed_bests: null, max_speed_ms: 15 } }
    const { allTime } = mergeCandidateIntoBests([], [], candidate)
    expect(allTime.maxSpeed).toEqual({ workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', speed_kmh: 54, max_speed_ms: 15 })
  })

  it('updates the yearBests bucket independently from allTime, using the candidate\'s own year', () => {
    const existingYearRows: BestRecordRow[] = [
      row({ period: '2026', category: 'biggest_climb', value: 400, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 2 } }),
    ]
    const candidate: BestsRide = { id: 'w2', icu_activity_id: 'icu-2', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 900, length_km: 3 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { year, yearBests } = mergeCandidateIntoBests([], existingYearRows, candidate)
    expect(year).toBe('2026')
    expect(yearBests.biggestClimb?.elev_gain_m).toBe(900)
  })
})
