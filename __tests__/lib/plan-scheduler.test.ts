/** @jest-environment node */
import { toWorkoutType, targetTssForSession, DEFAULT_EMPHASIS, computeDeloadWeeks } from '@/lib/plan/scheduler'

describe('toWorkoutType', () => {
  it('maps tempo and long_ride onto the stored endurance type', () => {
    expect(toWorkoutType('tempo')).toBe('endurance')
    expect(toWorkoutType('long_ride')).toBe('endurance')
    expect(toWorkoutType('endurance')).toBe('endurance')
  })
  it('passes recovery, threshold, and intervals through unchanged', () => {
    expect(toWorkoutType('recovery')).toBe('recovery')
    expect(toWorkoutType('threshold')).toBe('threshold')
    expect(toWorkoutType('intervals')).toBe('intervals')
  })
})

describe('targetTssForSession', () => {
  it('scales with duration for the same kind', () => {
    expect(targetTssForSession('endurance', 60)).toBe(42)
    expect(targetTssForSession('endurance', 120)).toBe(85)
  })
  it('ranks kinds by intensity for a fixed duration', () => {
    const tssFor = (k: Parameters<typeof targetTssForSession>[0]) => targetTssForSession(k, 60)
    expect(tssFor('recovery')).toBeLessThan(tssFor('endurance'))
    expect(tssFor('endurance')).toBeLessThan(tssFor('tempo'))
    expect(tssFor('tempo')).toBeLessThan(tssFor('threshold'))
    expect(tssFor('threshold')).toBeLessThanOrEqual(tssFor('intervals'))
  })
})

describe('DEFAULT_EMPHASIS', () => {
  it('is an even weighting across all four qualities', () => {
    expect(DEFAULT_EMPHASIS).toEqual({ climbing: 0.25, speed: 0.25, enduranceVolume: 0.25, weightLoss: 0.25 })
  })
})

describe('computeDeloadWeeks', () => {
  it('marks every 3rd non-taper training week as de-load', () => {
    const phases: Parameters<typeof computeDeloadWeeks>[0] = ['base', 'base', 'base', 'build', 'build', 'build', 'build', 'build', 'taper', 'taper']
    // Non-taper weeks are indices 0-7 (8 weeks); the 3rd, 6th within that sequence de-load.
    expect(computeDeloadWeeks(phases)).toEqual(new Set([2, 5]))
  })
  it('never marks a taper week as de-load', () => {
    const phases: Parameters<typeof computeDeloadWeeks>[0] = ['build', 'build', 'build', 'taper', 'taper']
    expect(computeDeloadWeeks(phases).has(3)).toBe(false)
    expect(computeDeloadWeeks(phases).has(4)).toBe(false)
  })
  it('returns an empty set for plans shorter than 3 non-taper weeks', () => {
    const phases: Parameters<typeof computeDeloadWeeks>[0] = ['base', 'build', 'taper']
    expect(computeDeloadWeeks(phases)).toEqual(new Set())
  })
})
