import { calculateAge } from '@/lib/age'

describe('calculateAge', () => {
  it('returns the correct age when the birthday has already passed this year', () => {
    expect(calculateAge('1990-03-15', new Date('2026-07-03'))).toBe(36)
  })

  it('returns the correct age when the birthday has not yet happened this year', () => {
    expect(calculateAge('1990-12-15', new Date('2026-07-03'))).toBe(35)
  })

  it('returns the correct age on the exact birthday', () => {
    expect(calculateAge('1990-07-03', new Date('2026-07-03'))).toBe(36)
  })

  it('returns the correct age the day before the birthday', () => {
    expect(calculateAge('1990-07-04', new Date('2026-07-03'))).toBe(35)
  })

  it('handles a leap-day birthday', () => {
    expect(calculateAge('2000-02-29', new Date('2026-03-01'))).toBe(26)
  })
})
