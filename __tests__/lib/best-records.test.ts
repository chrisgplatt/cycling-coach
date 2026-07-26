import {
  reconstructSyntheticRides, flattenAllTimeBestsToRows, assembleAllTimeBests, mergeCandidateIntoBests, fetchBestRecordRows, upsertBestRecordRows,
  type BestRecordRow,
} from '@/lib/ride/best-records'
import { computeAllTimeBests, type AllTimeBests, type BestsRide } from '@/lib/ride/all-time-bests'
import type { SupabaseClient } from '@supabase/supabase-js'

function row(overrides: Partial<BestRecordRow>): BestRecordRow {
  return { period: 'all', category: 'biggest_climb', sub_key: '', value: 0, detail: {}, is_indoor: false, rank: 1, ...overrides }
}

describe('reconstructSyntheticRides', () => {
  it('reconstructs a climb row (biggest or longest) as a single-climb synthetic ride, independent of its rank', () => {
    const rows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, rank: 2, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 } }),
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

  it('reconstructs every stored rank of a category as its own synthetic ride, so all podium slots feed back into recomputation', () => {
    const rows: BestRecordRow[] = [
      row({ category: 'power', sub_key: '300', value: 310, rank: 1, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2' } }),
      row({ category: 'power', sub_key: '300', value: 280, rank: 2, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1' } }),
    ]
    const rides = reconstructSyntheticRides(rows)
    expect(rides).toHaveLength(2)
    expect(rides.map(r => r.activity_metrics?.best_efforts?.[0].watts)).toEqual([310, 280])
  })
})

describe('flattenAllTimeBestsToRows', () => {
  it('flattens a full AllTimeBests into one row per ranked entry, tagged with the given isIndoor value', () => {
    const bests: AllTimeBests = {
      biggestClimb: [{ rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', elev_gain_m: 900, length_km: 3 }],
      longestClimb: [{ rank: 1, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', length_km: 12, elev_gain_m: 400 }],
      powerBests: [{ rank: 1, secs: 300, watts: 310, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-03-01' }],
      speedBests: [{ rank: 1, distance_km: 10, avg_speed_kmh: 38.4, workoutId: 'w4', icuActivityId: 'icu-4', date: '2026-04-01' }],
      maxSpeed: [{ rank: 1, workoutId: 'w5', icuActivityId: 'icu-5', date: '2026-05-01', speed_kmh: 68.5, max_speed_ms: 19.027 }],
    }
    const rows = flattenAllTimeBestsToRows('all', bests, false)
    expect(rows).toEqual([
      { period: 'all', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 }, is_indoor: false, rank: 1 },
      { period: 'all', category: 'longest_climb', sub_key: '', value: 12, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', elev_gain_m: 400 }, is_indoor: false, rank: 1 },
      { period: 'all', category: 'power', sub_key: '300', value: 310, detail: { date: '2026-03-01', workoutId: 'w3', icuActivityId: 'icu-3' }, is_indoor: false, rank: 1 },
      { period: 'all', category: 'speed', sub_key: '10', value: 38.4, detail: { date: '2026-04-01', workoutId: 'w4', icuActivityId: 'icu-4' }, is_indoor: false, rank: 1 },
      { period: 'all', category: 'max_speed', sub_key: '', value: 68.5, detail: { date: '2026-05-01', workoutId: 'w5', icuActivityId: 'icu-5', max_speed_ms: 19.027 }, is_indoor: false, rank: 1 },
    ])
  })

  it('emits one row per podium entry when a category holds 2nd and 3rd place, each carrying its own rank', () => {
    const bests: AllTimeBests = {
      biggestClimb: [
        { rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', elev_gain_m: 900, length_km: 3 },
        { rank: 2, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 700, length_km: 2 },
      ],
      longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [],
    }
    const rows = flattenAllTimeBestsToRows('all', bests, false)
    expect(rows).toEqual([
      { period: 'all', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 }, is_indoor: false, rank: 1 },
      { period: 'all', category: 'biggest_climb', sub_key: '', value: 700, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 2 }, is_indoor: false, rank: 2 },
    ])
  })

  it('tags every row true when isIndoor is true', () => {
    const bests: AllTimeBests = {
      biggestClimb: [], longestClimb: [], powerBests: [],
      speedBests: [], maxSpeed: [{ rank: 1, workoutId: null, icuActivityId: 'icu-9', date: '2026-06-01', speed_kmh: 45.2, max_speed_ms: 12.6 }],
    }
    const rows = flattenAllTimeBestsToRows('all', bests, true)
    expect(rows).toEqual([
      { period: 'all', category: 'max_speed', sub_key: '', value: 45.2, detail: { date: '2026-06-01', workoutId: null, icuActivityId: 'icu-9', max_speed_ms: 12.6 }, is_indoor: true, rank: 1 },
    ])
  })

  it('omits rows for absent categories rather than emitting nulls', () => {
    const empty: AllTimeBests = { biggestClimb: [], longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [] }
    expect(flattenAllTimeBestsToRows('2026', empty, false)).toEqual([])
  })
})

describe('assembleAllTimeBests round-trips with flattenAllTimeBestsToRows', () => {
  it('reassembles a multi-rank category back into a rank-ascending array', () => {
    const bests: AllTimeBests = {
      biggestClimb: [
        { rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', elev_gain_m: 900, length_km: 3 },
        { rank: 2, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 700, length_km: 2 },
        { rank: 3, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-03-01', elev_gain_m: 500, length_km: 1 },
      ],
      longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [],
    }
    const rows = flattenAllTimeBestsToRows('all', bests, false)
    // shuffle the rows to prove assembleAllTimeBests sorts by rank itself, not by input order
    const shuffled = [rows[2], rows[0], rows[1]]
    const reassembled = assembleAllTimeBests(shuffled)
    expect(reassembled.biggestClimb.map(c => c.rank)).toEqual([1, 2, 3])
    expect(reassembled.biggestClimb.map(c => c.workoutId)).toEqual(['w1', 'w2', 'w3'])
  })

  it('sorts power/speed groups by duration/distance first, then rank within each group', () => {
    const bests: AllTimeBests = {
      biggestClimb: [], longestClimb: [], speedBests: [], maxSpeed: [],
      powerBests: [
        { rank: 2, secs: 300, watts: 280, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01' },
        { rank: 1, secs: 300, watts: 310, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01' },
        { rank: 1, secs: 1200, watts: 210, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-03-01' },
      ],
    }
    const rows = flattenAllTimeBestsToRows('all', bests, false)
    const reassembled = assembleAllTimeBests(rows)
    expect(reassembled.powerBests).toEqual([
      { rank: 1, secs: 300, watts: 310, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01' },
      { rank: 2, secs: 300, watts: 280, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01' },
      { rank: 1, secs: 1200, watts: 210, workoutId: 'w3', icuActivityId: 'icu-3', date: '2026-03-01' },
    ])
  })
})

describe('reconstruction and flattening round-trip losslessly', () => {
  it('feeding flattened rows back through reconstructSyntheticRides + computeAllTimeBests reproduces the same bests', () => {
    const original: BestsRide[] = [
      { id: 'w1', icu_activity_id: 'icu-1', date: '2026-01-01', activity_metrics: { climbs: [{ elev_gain_m: 900, length_km: 3 }], best_efforts: [{ secs: 300, watts: 310 }], speed_bests: [{ distance_km: 10, avg_speed_kmh: 38.4 }], max_speed_ms: 19.027 } },
    ]
    const computed = computeAllTimeBests(original)
    const rows = flattenAllTimeBestsToRows('all', computed, false)
    const synthetic = reconstructSyntheticRides(rows)
    const recomputed = computeAllTimeBests(synthetic)
    expect(recomputed).toEqual(computed)
  })
})

describe('fetchBestRecordRows', () => {
  it('coerces value to a real number even when the driver returns it as a string', async () => {
    const rawRow = { period: 'all', category: 'biggest_climb', sub_key: '', value: '900', detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 }, is_indoor: false, rank: 1 }
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: [rawRow], error: null }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient
    const result = await fetchBestRecordRows(supabase, 'u1', 'all', false)
    expect(typeof result[0].value).toBe('number')
    expect(result[0].value).toBe(900)
  })

  it('filters by is_indoor in addition to user_id and period', async () => {
    const eqSpy = jest.fn()
    const supabase = {
      from: () => ({
        select: () => ({
          eq: (...args: unknown[]) => { eqSpy(args); return { eq: (...a2: unknown[]) => { eqSpy(a2); return { eq: (...a3: unknown[]) => { eqSpy(a3); return Promise.resolve({ data: [], error: null }) } } } } },
        }),
      }),
    } as unknown as SupabaseClient
    await fetchBestRecordRows(supabase, 'u1', 'all', true)
    expect(eqSpy).toHaveBeenCalledWith(['user_id', 'u1'])
    expect(eqSpy).toHaveBeenCalledWith(['period', 'all'])
    expect(eqSpy).toHaveBeenCalledWith(['is_indoor', true])
  })
})

describe('upsertBestRecordRows', () => {
  it('upserts on the 6-column conflict target including rank', async () => {
    const upsertSpy = jest.fn()
    const supabase = { from: () => ({ upsert: (rows: unknown[], opts: unknown) => { upsertSpy(rows, opts); return Promise.resolve({ error: null }) } }) } as unknown as SupabaseClient
    await upsertBestRecordRows(supabase, 'u1', [row({ category: 'max_speed', value: 54, is_indoor: false, rank: 1 })])
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.any(Array),
      { onConflict: 'user_id,period,category,sub_key,is_indoor,rank' },
    )
  })

  it('does nothing when given an empty row list', async () => {
    const upsertSpy = jest.fn()
    const supabase = { from: () => ({ upsert: upsertSpy }) } as unknown as SupabaseClient
    await upsertBestRecordRows(supabase, 'u1', [])
    expect(upsertSpy).not.toHaveBeenCalled()
  })
})

describe('mergeCandidateIntoBests', () => {
  it('keeps a full existing podium unchanged when the new candidate beats none of it', () => {
    const existingAllTimeRows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, rank: 1, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 } }),
      row({ category: 'biggest_climb', value: 700, rank: 2, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 2 } }),
      row({ category: 'biggest_climb', value: 500, rank: 3, detail: { date: '2026-03-01', workoutId: 'w3', icuActivityId: 'icu-3', length_km: 1 } }),
    ]
    const candidate: BestsRide = { id: 'w4', icu_activity_id: 'icu-4', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 100, length_km: 0.5 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { allTime } = mergeCandidateIntoBests(existingAllTimeRows, [], candidate)
    expect(allTime.biggestClimb.map(c => c.workoutId)).toEqual(['w1', 'w2', 'w3'])
  })

  it('adds the candidate onto an unfilled podium below the existing champion', () => {
    const existingAllTimeRows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, rank: 1, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 } }),
    ]
    const candidate: BestsRide = { id: 'w2', icu_activity_id: 'icu-2', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 300, length_km: 1 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { allTime } = mergeCandidateIntoBests(existingAllTimeRows, [], candidate)
    expect(allTime.biggestClimb).toEqual([
      { rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', elev_gain_m: 900, length_km: 3 },
      { rank: 2, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-06-01', elev_gain_m: 300, length_km: 1 },
    ])
  })

  it('inserts the new candidate at rank 1 and pushes the existing champion to rank 2 when it beats the podium', () => {
    const existingAllTimeRows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, rank: 1, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 } }),
    ]
    const candidate: BestsRide = { id: 'w2', icu_activity_id: 'icu-2', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 1200, length_km: 8 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { allTime } = mergeCandidateIntoBests(existingAllTimeRows, [], candidate)
    expect(allTime.biggestClimb[0]).toEqual({ rank: 1, workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-06-01', elev_gain_m: 1200, length_km: 8 })
    expect(allTime.biggestClimb[1]).toEqual({ rank: 2, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', elev_gain_m: 900, length_km: 3 })
  })

  it('drops the previous 3rd place once a 4th podium-worthy candidate arrives', () => {
    const existingAllTimeRows: BestRecordRow[] = [
      row({ category: 'biggest_climb', value: 900, rank: 1, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 3 } }),
      row({ category: 'biggest_climb', value: 700, rank: 2, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 2 } }),
      row({ category: 'biggest_climb', value: 500, rank: 3, detail: { date: '2026-03-01', workoutId: 'w3', icuActivityId: 'icu-3', length_km: 1 } }),
    ]
    const candidate: BestsRide = { id: 'w4', icu_activity_id: 'icu-4', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 600, length_km: 1.5 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { allTime } = mergeCandidateIntoBests(existingAllTimeRows, [], candidate)
    expect(allTime.biggestClimb.map(c => c.workoutId)).toEqual(['w1', 'w2', 'w4'])
  })

  it('seeds a category with no prior champion', () => {
    const candidate: BestsRide = { id: 'w1', icu_activity_id: 'icu-1', date: '2026-01-01', activity_metrics: { climbs: null, best_efforts: null, speed_bests: null, max_speed_ms: 15 } }
    const { allTime } = mergeCandidateIntoBests([], [], candidate)
    expect(allTime.maxSpeed).toEqual([{ rank: 1, workoutId: 'w1', icuActivityId: 'icu-1', date: '2026-01-01', speed_kmh: 54, max_speed_ms: 15 }])
  })

  it('updates the yearBests bucket independently from allTime, using the candidate\'s own year', () => {
    const existingYearRows: BestRecordRow[] = [
      row({ period: '2026', category: 'biggest_climb', value: 400, rank: 1, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', length_km: 2 } }),
    ]
    const candidate: BestsRide = { id: 'w2', icu_activity_id: 'icu-2', date: '2026-06-01', activity_metrics: { climbs: [{ elev_gain_m: 900, length_km: 3 }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
    const { year, yearBests } = mergeCandidateIntoBests([], existingYearRows, candidate)
    expect(year).toBe('2026')
    expect(yearBests.biggestClimb[0]?.elev_gain_m).toBe(900)
  })
})
