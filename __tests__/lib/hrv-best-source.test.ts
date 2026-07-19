/** @jest-environment node */
import { computeHrvStatusBestSource } from '@/lib/hrv/best-source'

function rows(n: number, endDate: string, v: number): { id: string; hrv: number }[] {
  const endMs = new Date(endDate + 'T00:00:00Z').getTime()
  return Array.from({ length: n }, (_, i) => ({
    id: new Date(endMs - (n - 1 - i) * 864e5).toISOString().split('T')[0],
    hrv: v,
  }))
}

describe('computeHrvStatusBestSource', () => {
  test('returns Garmin result when sufficient (>=14 readings)', () => {
    const garmin = rows(60, '2026-06-20', 55)
    const result = computeHrvStatusBestSource([], garmin, '2026-06-20')
    expect(result.sufficient).toBe(true)
    expect(result.label).toBe('balanced')
    expect(result.daysOfData).toBe(60)
  })

  test('falls back to ICU when Garmin has fewer than 14 readings', () => {
    const garmin = rows(5, '2026-06-20', 55)
    const icu = rows(60, '2026-06-20', 50)
    const result = computeHrvStatusBestSource(icu, garmin, '2026-06-20')
    expect(result.sufficient).toBe(true)
    expect(result.daysOfData).toBe(60)   // confirms ICU's 60 rows were used, not Garmin's 5
    expect(result.today).toBe(50)        // confirms ICU's value (50), not Garmin's (55)
  })

  test('empty Garmin history falls straight to ICU', () => {
    const icu = rows(60, '2026-06-20', 50)
    const result = computeHrvStatusBestSource(icu, [], '2026-06-20')
    expect(result.sufficient).toBe(true)
    expect(result.daysOfData).toBe(60)
  })

  test('both empty returns no_data', () => {
    const result = computeHrvStatusBestSource([], [], '2026-06-20')
    expect(result.label).toBe('no_data')
    expect(result.sufficient).toBe(false)
  })
})
