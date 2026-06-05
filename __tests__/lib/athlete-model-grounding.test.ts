import { computeRampTolerance } from '@/lib/athlete-model/grounding'

describe('computeRampTolerance', () => {
  it('returns null below four weeks of data', () => {
    expect(computeRampTolerance([300, 320, 340])).toBeNull()
  })

  it('estimates the sustained week-over-week ramp the athlete kept building from', () => {
    // +10%, +10% (both held the following week), then a ramp that BACKED OFF.
    // Sustained ramps are the two +10%s → median 10.
    const out = computeRampTolerance([300, 330, 363, 399, 300])!
    expect(out.pct).toBe(10)
    expect(out.weeks).toBe(5)
  })

  it('falls back to the median positive ramp when none were sustained', () => {
    // Every ramp is followed by a drop → no sustained ramps; median of +20,+25 ≈ 23.
    const out = computeRampTolerance([200, 240, 200, 250, 200])!
    expect(out.pct).toBe(23)
  })

  it('ignores weeks following a zero/blank week', () => {
    const out = computeRampTolerance([0, 300, 330, 363])!
    expect(out.pct).toBe(10)
  })
})
