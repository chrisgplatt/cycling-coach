import { projectCtl, buildForecast, daysBetweenUtc, addDaysUtc } from '@/lib/plan/forecast'
import type { WeekBucket } from '@/lib/plan/progress'

const bucket = (i: number, plannedTss: number): WeekBucket => ({
  weekIndex: i, plannedTss, actualTss: 0, plannedSessions: 4, completedSessions: 0,
})

describe('date helpers', () => {
  it('counts whole UTC days between dates', () => {
    expect(daysBetweenUtc('2026-06-03', '2026-06-10')).toBe(7)
    expect(daysBetweenUtc('2026-06-10', '2026-06-03')).toBe(-7)
  })
  it('adds days in UTC', () => {
    expect(addDaysUtc('2026-06-03', 7)).toBe('2026-06-10')
  })
})

describe('projectCtl', () => {
  it('includes the start value as the first point', () => {
    expect(projectCtl(40, [])).toEqual([40])
  })
  it('rises monotonically toward a TSS above current CTL', () => {
    const series = projectCtl(40, Array(30).fill(82))
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThan(series[i - 1])
    expect(series[series.length - 1]).toBeLessThanOrEqual(82)
  })
  it('decays toward zero with no load', () => {
    const series = projectCtl(40, Array(30).fill(0))
    expect(series[series.length - 1]).toBeLessThan(40)
    expect(series[series.length - 1]).toBeGreaterThan(0)
  })
  it('matches the impulse-response step formula', () => {
    // 40 + (82-40)/42 = 41.0;  41 + (82-41)/42 = 41.9762...
    const [, one, two] = projectCtl(40, [82, 82])
    expect(one).toBeCloseTo(41.0, 3)
    expect(two).toBeCloseTo(41.9762, 3)
  })
})

describe('buildForecast', () => {
  const buckets = [bucket(0, 350), bucket(1, 400), bucket(2, 420)]

  it('returns a no-projection result when the horizon is zero', () => {
    const r = buildForecast({ startCtl: 44, buckets, planStart: '2026-05-20', today: '2026-06-03', horizonDays: 0, hitPct: 80 })
    expect(r.horizonDays).toBe(0)
    expect(r.planCtl).toBe(44)
    expect(r.paceCtl).toBe(44)
    expect(r.planSeries).toEqual([])
  })

  it('projects plan >= pace when adherence is below 100%', () => {
    const r = buildForecast({ startCtl: 44, buckets, planStart: '2026-05-20', today: '2026-06-03', horizonDays: 21, hitPct: 70 })
    expect(r.planCtl).toBeGreaterThanOrEqual(r.paceCtl)
    expect(r.planSeries).toHaveLength(22)   // horizonDays + 1 (includes start)
    expect(r.paceSeries).toHaveLength(22)
    expect(r.planSeries[0]).toBe(44)
  })

  it('equals plan when adherence is 100%', () => {
    const r = buildForecast({ startCtl: 44, buckets, planStart: '2026-05-20', today: '2026-06-03', horizonDays: 14, hitPct: 100 })
    expect(r.paceCtl).toBeCloseTo(r.planCtl, 5)
  })
})
