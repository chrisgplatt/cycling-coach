import { fitCriticalPower } from '@/lib/critical-power'
import type { ICUPowerCurvePoint } from '@/types'

describe('fitCriticalPower', () => {
  it('recovers known CP and W-prime from a synthetic curve at all 5 target durations', () => {
    const CP = 250
    const W_PRIME = 20000
    const durations = [180, 300, 480, 720, 1200]
    const curve: ICUPowerCurvePoint[] = durations.map(secs => ({
      secs,
      watts: CP + W_PRIME / secs,
    }))

    const result = fitCriticalPower(curve)

    expect(result).not.toBeNull()
    expect(result!.cp).toBe(250)
    expect(result!.wPrimeJ).toBe(20000)
    expect(result!.pointsUsed).toBe(5)
  })

  it('recovers CP and W-prime from exactly 3 of the 5 target durations (minimum fit)', () => {
    const CP = 200
    const W_PRIME = 15000
    const curve: ICUPowerCurvePoint[] = [300, 720, 1200].map(secs => ({
      secs,
      watts: CP + W_PRIME / secs,
    }))

    const result = fitCriticalPower(curve)

    expect(result).not.toBeNull()
    expect(result!.cp).toBe(200)
    expect(result!.wPrimeJ).toBe(15000)
    expect(result!.pointsUsed).toBe(3)
  })

  it('returns null when fewer than 3 of the 5 target durations are present', () => {
    const curve: ICUPowerCurvePoint[] = [
      { secs: 180, watts: 300 },
      { secs: 300, watts: 280 },
    ]
    expect(fitCriticalPower(curve)).toBeNull()
  })

  it('returns null for an empty curve', () => {
    expect(fitCriticalPower([])).toBeNull()
  })
})
