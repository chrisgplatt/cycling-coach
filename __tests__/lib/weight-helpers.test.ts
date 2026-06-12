import { weightAtDate } from '@/lib/weight-helpers'
import type { WeightEntry } from '@/types'

const log: WeightEntry[] = [
  { id: '1', date: '2026-05-01', weight_kg: 76 },
  { id: '2', date: '2026-05-15', weight_kg: 75.5 },
  { id: '3', date: '2026-06-01', weight_kg: 75 },
]

describe('weightAtDate', () => {
  it('returns the entry on the exact ride date', () => {
    expect(weightAtDate(log, '2026-05-15', null)).toBe(75.5)
  })

  it('returns the most recent entry before the ride date', () => {
    expect(weightAtDate(log, '2026-05-20', null)).toBe(75.5)
  })

  it('returns null when no entry exists before the ride date', () => {
    expect(weightAtDate(log, '2026-04-01', null)).toBeNull()
  })

  it('returns fallback when log is empty', () => {
    expect(weightAtDate([], '2026-06-01', 74)).toBe(74)
  })

  it('returns fallback when log is empty and fallback is null', () => {
    expect(weightAtDate([], '2026-06-01', null)).toBeNull()
  })

  it('returns latest entry for a ride date after all entries', () => {
    expect(weightAtDate(log, '2026-07-01', null)).toBe(75)
  })
})
