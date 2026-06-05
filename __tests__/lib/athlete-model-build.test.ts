import { buildGroundedBeliefs, confidenceFromCount } from '@/lib/athlete-model/build-beliefs'

describe('confidenceFromCount', () => {
  it('steps low → medium → high at the thresholds', () => {
    expect(confidenceFromCount(3, 4, 8)).toBe('low')
    expect(confidenceFromCount(4, 4, 8)).toBe('medium')
    expect(confidenceFromCount(8, 4, 8)).toBe('high')
  })
})

describe('buildGroundedBeliefs', () => {
  it('produces a belief per non-null grounding result with stable keys', () => {
    const beliefs = buildGroundedBeliefs({
      weeklyTss: [300, 330, 363, 399, 432, 300, 330, 363, 399, 432],
      rpeSessions: Array.from({ length: 12 }, () => ({ rpe: 5, targetPct: 70 })),
      recovery: Array.from({ length: 6 }, (_, i) => ({
        date: `2026-05-${String(i + 1).padStart(2, '0')}`, isHard: i % 2 === 0, completedWell: true, feel: 3,
      })),
    })
    const byKey = Object.fromEntries(beliefs.map(b => [b.key, b]))
    expect(Object.keys(byKey).sort()).toEqual(['ramp_tolerance', 'recovery', 'rpe_calibration'])
    expect(byKey.ramp_tolerance.source).toBe('computed')
    expect(byKey.ramp_tolerance.value_data).toHaveProperty('pct')
    expect(byKey.ramp_tolerance.value_text.length).toBeGreaterThan(0)
    expect(byKey.rpe_calibration.value_data).toMatchObject({ overall: 1 })
    expect(['low', 'medium', 'high']).toContain(byKey.recovery.confidence)
  })

  it('omits a belief when its grounding result is null (insufficient data)', () => {
    const beliefs = buildGroundedBeliefs({
      weeklyTss: [300, 320],
      rpeSessions: [],
      recovery: [],
    })
    expect(beliefs).toEqual([])
  })
})
