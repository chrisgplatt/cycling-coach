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

  it('adds a coaching_resonance belief from coach-note ratings', () => {
    const beliefs = buildGroundedBeliefs({
      weeklyTss: [],
      rpeSessions: [],
      recovery: [],
      coachingRatings: ['helpful', 'helpful', 'not_helpful', 'helpful'],
    })
    const r = beliefs.find(b => b.key === 'coaching_resonance')!
    expect(r).toBeDefined()
    expect(r.value_data).toMatchObject({ helpful: 3, total: 4, pct: 75 })
    expect(r.value_text).toContain('landing well')
  })

  it('omits coaching_resonance below 3 ratings', () => {
    const beliefs = buildGroundedBeliefs({
      weeklyTss: [], rpeSessions: [], recovery: [],
      coachingRatings: ['helpful', 'not_helpful'],
    })
    expect(beliefs.find(b => b.key === 'coaching_resonance')).toBeUndefined()
  })

  it('uses the "tracks closely" wording when biases are within the dead-zone', () => {
    const beliefs = buildGroundedBeliefs({
      weeklyTss: [],
      // targetPct 76 → tempo, expectedRpe 5; rpe 5 → zero bias, and 76 is neither
      // easy (<=75) nor hard (>=91), so both splits are null → fallback wording.
      rpeSessions: Array.from({ length: 8 }, () => ({ rpe: 5, targetPct: 76 })),
      recovery: [],
    })
    const rpe = beliefs.find(b => b.key === 'rpe_calibration')!
    expect(rpe.value_text).toContain('tracks prescribed intensity closely')
  })
})
