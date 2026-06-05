import { weeklyTssSeries } from '@/lib/athlete-model/assemble'
import { rpeSessionsFromFeedback, TYPE_TARGET_PCT } from '@/lib/athlete-model/assemble'

describe('weeklyTssSeries', () => {
  it('buckets workouts into Monday-started weeks and sums TSS chronologically', () => {
    const series = weeklyTssSeries([
      { date: '2026-05-04', tss: 50 },
      { date: '2026-05-06', tss: 60 },
      { date: '2026-05-10', tss: 40 },
      { date: '2026-05-11', tss: 70 },
      { date: '2026-05-13', tss: 80 },
    ])
    expect(series).toEqual([150, 150])
  })

  it('treats null TSS as zero and orders weeks ascending regardless of input order', () => {
    const series = weeklyTssSeries([
      { date: '2026-05-13', tss: 80 },
      { date: '2026-05-04', tss: null },
      { date: '2026-05-06', tss: 60 },
    ])
    expect(series).toEqual([60, 80])
  })

  it('returns [] for no workouts', () => {
    expect(weeklyTssSeries([])).toEqual([])
  })
})

describe('rpeSessionsFromFeedback', () => {
  it('maps each rated session to its type target intensity', () => {
    const out = rpeSessionsFromFeedback([
      { rpe: 4, type: 'endurance' },
      { rpe: 8, type: 'intervals' },
    ])
    expect(out).toEqual([
      { rpe: 4, targetPct: TYPE_TARGET_PCT.endurance },
      { rpe: 8, targetPct: TYPE_TARGET_PCT.intervals },
    ])
  })

  it('drops rows with no RPE or no type', () => {
    const out = rpeSessionsFromFeedback([
      { rpe: null, type: 'threshold' },
      { rpe: 7, type: null },
      { rpe: 6, type: 'threshold' },
    ])
    expect(out).toEqual([{ rpe: 6, targetPct: TYPE_TARGET_PCT.threshold }])
  })
})
