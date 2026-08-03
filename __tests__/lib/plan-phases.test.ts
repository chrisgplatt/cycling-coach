import { derivePhases, resolvePhases, getCurrentPhase } from '@/lib/plan/phases'
import type { Workout } from '@/types'

describe('derivePhases', () => {
  it('produces base→build→peak→taper for a ramp-then-taper load series', () => {
    const tss = [50, 60, 70, 80, 90, 100, 70, 40]
    expect(derivePhases(tss, 8)).toEqual([
      'base', 'base', 'build', 'build', 'peak', 'peak', 'taper', 'taper',
    ])
  })

  it('returns all base when there is no load', () => {
    expect(derivePhases([0, 0, 0], 3)).toEqual(['base', 'base', 'base'])
  })

  it('forces a final taper week on a long plan that never drops off', () => {
    const phases = derivePhases([60, 70, 80, 90, 100], 5)
    expect(phases[4]).toBe('taper')
  })
})

describe('resolvePhases', () => {
  it('prefers valid stored phases', () => {
    const stored = ['base', 'build', 'peak', 'taper'] as const
    expect(resolvePhases([...stored], [10, 20, 30, 5], 4)).toEqual([...stored])
  })

  it('falls back to derivation when stored is missing or wrong length', () => {
    expect(resolvePhases(null, [0, 0], 2)).toEqual(['base', 'base'])
    expect(resolvePhases(['base'], [0, 0], 2)).toEqual(['base', 'base'])
  })
})

describe('getCurrentPhase', () => {
  const PLAN_START = '2026-01-01T00:00:00Z' // a Thursday

  function workout(date: string): Workout {
    return {
      id: `w-${date}`, plan_id: 'p1', date, type: 'endurance', duration_minutes: 60,
      description: '', target_zones: '', intervals_icu_event_id: null, status: 'planned',
      icu_activity_id: null, tss: null, ftp_at_completion: null, actual_duration_minutes: null,
      missed_reason: null, optional: false, name: null, steps: null, activity_metrics: null,
      coaching_notes: null, created_at: '2026-01-01T00:00:00Z',
    }
  }

  it('returns the phase for the current week using Claude-supplied week_phases', () => {
    // 4-week plan, stored phases base/build/peak/taper. Jan 22 falls in week 4 (Jan 22-28).
    const result = getCurrentPhase(
      [workout('2026-01-01')],
      [],
      ['base', 'build', 'peak', 'taper'],
      4,
      PLAN_START,
      '2026-01-22',
    )
    expect(result).toBe('taper')
  })

  it('clamps to the last week when today is past the plan end', () => {
    const result = getCurrentPhase(
      [workout('2026-01-01')],
      [],
      ['base', 'build', 'peak', 'taper'],
      4,
      PLAN_START,
      '2026-06-01',
    )
    expect(result).toBe('taper')
  })

  it('clamps to the first week when today is before the plan start', () => {
    const result = getCurrentPhase(
      [workout('2026-01-01')],
      [],
      ['base', 'build', 'peak', 'taper'],
      4,
      PLAN_START,
      '2025-12-01',
    )
    expect(result).toBe('base')
  })

  it('falls back to TSS-derived phases when week_phases length does not match totalWeeks', () => {
    // week_phases has only 2 entries for a 4-week plan — resolvePhases falls back to derivePhases.
    // No workouts at all means every week's plannedTss bucket is 0, so derivePhases' peak-detection
    // sees an all-zero profile and returns 'base' for every week (see derivePhases: "if (peak === 0)
    // return phases" where phases defaults to all-'base').
    const result = getCurrentPhase(
      [],
      [],
      ['base', 'build'],
      4,
      PLAN_START,
      '2026-01-08',
    )
    expect(result).toBe('base')
  })
})
