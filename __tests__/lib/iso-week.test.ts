import { isoWeek } from '@/lib/iso-week'

describe('isoWeek', () => {
  it('returns correct ISO week for a Monday', () => {
    expect(isoWeek(new Date('2026-05-18'))).toBe('2026-W21')
  })

  it('returns previous week for a Sunday', () => {
    // Sunday belongs to the preceding ISO week
    expect(isoWeek(new Date('2026-05-17'))).toBe('2026-W20')
  })

  it('handles year-boundary week: Dec 29, 2025 is ISO week 2026-W01', () => {
    expect(isoWeek(new Date('2025-12-29'))).toBe('2026-W01')
  })

  it('pads single-digit week numbers to two digits', () => {
    expect(isoWeek(new Date('2026-01-05'))).toBe('2026-W02')
  })
})
