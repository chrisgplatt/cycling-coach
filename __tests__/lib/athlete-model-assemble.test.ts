import { weeklyTssSeries } from '@/lib/athlete-model/assemble'

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
