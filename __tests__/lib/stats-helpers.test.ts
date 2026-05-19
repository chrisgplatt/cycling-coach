import { findNearestPower, computeLeftRightBalance } from '@/lib/stats-helpers'
import type { ICUPowerCurvePoint } from '@/types'

describe('findNearestPower', () => {
  it('returns null for empty curve', () => {
    expect(findNearestPower([], 300)).toBeNull()
  })

  it('returns watts for exact match', () => {
    const curve: ICUPowerCurvePoint[] = [{ secs: 300, watts: 320 }]
    expect(findNearestPower(curve, 300)).toBe(320)
  })

  it('returns watts for nearest point within 30s', () => {
    const curve: ICUPowerCurvePoint[] = [{ secs: 295, watts: 315 }]
    expect(findNearestPower(curve, 300)).toBe(315)
  })

  it('returns null when nearest point is more than 30s away', () => {
    const curve: ICUPowerCurvePoint[] = [{ secs: 260, watts: 350 }]
    expect(findNearestPower(curve, 300)).toBeNull()
  })

  it('picks the closest of multiple candidates', () => {
    const curve: ICUPowerCurvePoint[] = [
      { secs: 290, watts: 310 },
      { secs: 302, watts: 318 },
    ]
    expect(findNearestPower(curve, 300)).toBe(318)
  })
})

describe('computeLeftRightBalance', () => {
  it('returns null for empty array', () => {
    expect(computeLeftRightBalance([])).toBeNull()
  })

  it('returns null when all values are null', () => {
    expect(computeLeftRightBalance([
      { left_right_balance: null },
      { left_right_balance: null },
    ])).toBeNull()
  })

  it('returns average of non-null values, ignoring nulls', () => {
    expect(computeLeftRightBalance([
      { left_right_balance: 52 },
      { left_right_balance: 50 },
      { left_right_balance: null },
    ])).toBe(51)
  })

  it('returns the single non-null value unchanged', () => {
    expect(computeLeftRightBalance([{ left_right_balance: 48.5 }])).toBe(48.5)
  })
})
