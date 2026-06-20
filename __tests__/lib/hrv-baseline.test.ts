/** @jest-environment node */
import { computeHrvBaseline } from '@/lib/hrv/baseline'
import type { ICUWellness } from '@/types'

function series(n: number, end: string, val: (i: number) => number | null): ICUWellness[] {
  const endMs = new Date(end + 'T00:00:00Z').getTime()
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(endMs - (n - 1 - i) * 864e5).toISOString().split('T')[0]
    return { id: date, ctl: null, atl: null, form: null, hrv: val(i), resting_hr: null, sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null }
  })
}

describe('computeHrvBaseline', () => {
  test('stable series → balanced, bounds bracket the mean', () => {
    const w = series(60, '2026-06-01', () => 50)
    const s = computeHrvBaseline(w, { asOf: '2026-06-01' })
    expect(s.label).toBe('balanced')
    expect(s.sufficient).toBe(true)
    expect(s.baselineMean).toBeCloseTo(50, 0)
    expect(s.sevenDayAvg).toBeCloseTo(50, 0)
    expect(s.lowerBound).toBeLessThanOrEqual(s.baselineMean as number)
    expect(s.upperBound).toBeGreaterThanOrEqual(s.baselineMean as number)
  })

  test('recent drop below band → suppressed, falling', () => {
    const w = series(60, '2026-06-01', i => (i >= 53 ? 38 : 55))
    const s = computeHrvBaseline(w, { asOf: '2026-06-01' })
    expect(s.label).toBe('suppressed')
    expect(s.trend).toBe('falling')
  })

  test('recent rise above band → elevated, rising', () => {
    const w = series(60, '2026-06-01', i => (i >= 53 ? 72 : 55))
    const s = computeHrvBaseline(w, { asOf: '2026-06-01' })
    expect(s.label).toBe('elevated')
    expect(s.trend).toBe('rising')
  })

  test('fewer than 14 readings → building, no false status', () => {
    const w = series(60, '2026-06-01', i => (i >= 50 ? 50 : null))
    const s = computeHrvBaseline(w, { asOf: '2026-06-01' })
    expect(s.label).toBe('building')
    expect(s.sufficient).toBe(false)
    expect(s.daysOfData).toBe(10)
  })

  test('no readings → no_data', () => {
    const w = series(60, '2026-06-01', () => null)
    const s = computeHrvBaseline(w, { asOf: '2026-06-01' })
    expect(s.label).toBe('no_data')
    expect(s.today).toBeNull()
    expect(s.baselineMean).toBeNull()
  })

  test('only counts the 60-day window ending asOf', () => {
    const w = series(120, '2026-06-01', i => (i < 60 ? 90 : 50))
    const s = computeHrvBaseline(w, { asOf: '2026-06-01' })
    expect(s.baselineMean).toBeCloseTo(50, 0)
  })
})

test('accepts plain { id, hrv } objects (no ICUWellness)', () => {
  const data = Array.from({ length: 30 }, (_, i) => ({
    id: new Date(new Date('2026-06-01T00:00:00Z').getTime() - (29 - i) * 864e5).toISOString().split('T')[0],
    hrv: 55 as number | null,
  }))
  const s = computeHrvBaseline(data, { asOf: '2026-06-01' })
  expect(s.label).toBe('balanced')
  expect(s.sufficient).toBe(true)
})
