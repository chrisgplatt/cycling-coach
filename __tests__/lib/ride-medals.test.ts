import { buildMedalsByWorkoutId } from '@/lib/ride/ride-medals'
import type { BestRecordRow } from '@/lib/ride/best-records'

function row(overrides: Partial<Omit<BestRecordRow, 'detail'>> & { workoutId: string | null }): BestRecordRow {
  const { workoutId, ...rest } = overrides
  return {
    period: 'all',
    category: 'power',
    sub_key: '',
    value: 100,
    is_indoor: false,
    rank: 1,
    detail: { workoutId, date: '2026-01-01', icuActivityId: 'a1' },
    ...rest,
  }
}

describe('buildMedalsByWorkoutId', () => {
  it('returns an empty object for empty input', () => {
    expect(buildMedalsByWorkoutId([])).toEqual({})
  })

  it('skips rows with a null workoutId (deep-history champions with no local ride)', () => {
    const rows = [row({ workoutId: null, category: 'max_speed' })]
    expect(buildMedalsByWorkoutId(rows)).toEqual({})
  })

  it('puts an "all" period row into the allTime list, carrying its rank', () => {
    const rows = [row({ workoutId: 'w1', period: 'all', category: 'biggest_climb', rank: 1 })]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: { allTime: [{ category: 'biggest_climb', subKey: '', rank: 1 }], year: [] },
    })
  })

  it('puts a non-"all" period row into the year list, carrying its rank', () => {
    const rows = [row({ workoutId: 'w1', period: '2026', category: 'max_speed', rank: 2 })]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: { allTime: [], year: [{ category: 'max_speed', subKey: '', rank: 2 }] },
    })
  })

  it('excludes a category from year when the same ride already holds it all-time', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '300', rank: 1 }),
      row({ workoutId: 'w1', period: '2026', category: 'power', sub_key: '300', rank: 1 }),
    ]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: { allTime: [{ category: 'power', subKey: '300', rank: 1 }], year: [] },
    })
  })

  it('keeps multiple sub_keys of the same category as separate entries (a ride can hold several durations)', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '300', rank: 1 }),
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '1200', rank: 2 }),
    ]
    const result = buildMedalsByWorkoutId(rows)
    expect(result.w1.allTime).toHaveLength(2)
    expect(result.w1.allTime).toEqual(expect.arrayContaining([
      { category: 'power', subKey: '300', rank: 1 },
      { category: 'power', subKey: '1200', rank: 2 },
    ]))
  })

  it('deduplicates an exact repeat of the same category+sub_key', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '300', rank: 1 }),
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '300', rank: 1 }),
    ]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: { allTime: [{ category: 'power', subKey: '300', rank: 1 }], year: [] },
    })
  })

  it('lists different sub_keys of the same category independently across tiers', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '300', rank: 1 }),
      row({ workoutId: 'w1', period: '2026', category: 'power', sub_key: '1200', rank: 3 }),
    ]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: {
        allTime: [{ category: 'power', subKey: '300', rank: 1 }],
        year: [{ category: 'power', subKey: '1200', rank: 3 }],
      },
    })
  })

  it('keeps different categories on the same ride separate', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'biggest_climb', rank: 1 }),
      row({ workoutId: 'w1', period: 'all', category: 'power', sub_key: '300', rank: 2 }),
    ]
    const result = buildMedalsByWorkoutId(rows)
    expect(result.w1.allTime).toHaveLength(2)
    expect(result.w1.allTime).toEqual(expect.arrayContaining([
      { category: 'biggest_climb', subKey: '', rank: 1 },
      { category: 'power', subKey: '300', rank: 2 },
    ]))
  })

  it('keeps different workouts independent', () => {
    const rows = [
      row({ workoutId: 'w1', period: 'all', category: 'max_speed', rank: 1 }),
      row({ workoutId: 'w2', period: '2025', category: 'longest_climb', rank: 3 }),
    ]
    expect(buildMedalsByWorkoutId(rows)).toEqual({
      w1: { allTime: [{ category: 'max_speed', subKey: '', rank: 1 }], year: [] },
      w2: { allTime: [], year: [{ category: 'longest_climb', subKey: '', rank: 3 }] },
    })
  })
})
