/**
 * @jest-environment node
 */
import {
  icuCategory,
  periodOverlapsWeek,
  coveredDaysInWeek,
  periodDurationDays,
} from '@/lib/utils/unavailability'
import type { UnavailabilityPeriod } from '@/types'

function makePeriod(overrides: Partial<UnavailabilityPeriod> = {}): UnavailabilityPeriod {
  return {
    id: '1',
    type: 'sick',
    start_date: '2026-06-02',
    end_date: '2026-06-05',
    impact_plan: false,
    ...overrides,
  }
}

describe('icuCategory', () => {
  it('maps sick → SICK', () => expect(icuCategory('sick')).toBe('SICK'))
  it('maps injury → INJURY', () => expect(icuCategory('injury')).toBe('INJURY'))
  it('maps holiday → HOLIDAY', () => expect(icuCategory('holiday')).toBe('HOLIDAY'))
  it('maps unavailable → NOTE', () => expect(icuCategory('unavailable')).toBe('NOTE'))
})

describe('periodDurationDays', () => {
  it('returns 1 for same-day period', () =>
    expect(periodDurationDays(makePeriod({ start_date: '2026-06-02', end_date: '2026-06-02' }))).toBe(1))
  it('returns 4 for 2–5 Jun', () =>
    expect(periodDurationDays(makePeriod())).toBe(4))
})

describe('periodOverlapsWeek', () => {
  // week: Mon 1 Jun – Sun 7 Jun 2026
  const week = ['2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05','2026-06-06','2026-06-07']

  it('returns true when period is fully inside week', () =>
    expect(periodOverlapsWeek(makePeriod({ start_date: '2026-06-02', end_date: '2026-06-04' }), week)).toBe(true))
  it('returns true when period spans across week boundary', () =>
    expect(periodOverlapsWeek(makePeriod({ start_date: '2026-05-30', end_date: '2026-06-03' }), week)).toBe(true))
  it('returns false when period ends before week', () =>
    expect(periodOverlapsWeek(makePeriod({ start_date: '2026-05-25', end_date: '2026-05-31' }), week)).toBe(false))
  it('returns false when period starts after week', () =>
    expect(periodOverlapsWeek(makePeriod({ start_date: '2026-06-08', end_date: '2026-06-10' }), week)).toBe(false))
})

describe('coveredDaysInWeek', () => {
  const week = ['2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05','2026-06-06','2026-06-07']

  it('marks correct days as covered', () => {
    const result = coveredDaysInWeek(makePeriod({ start_date: '2026-06-02', end_date: '2026-06-04' }), week)
    expect(result).toEqual([false, true, true, true, false, false, false])
  })

  it('marks all days when period spans whole week', () => {
    const result = coveredDaysInWeek(makePeriod({ start_date: '2026-05-30', end_date: '2026-06-10' }), week)
    expect(result).toEqual([true, true, true, true, true, true, true])
  })
})
