import { derivePhases, resolvePhases, getCurrentPhase, computeWeekPhases, buildPlanBatches } from '@/lib/plan/phases'
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

describe('computeWeekPhases', () => {
  it('matches the CLAUDE.md matrix exactly for a 4-week plan', () => {
    expect(computeWeekPhases(4)).toEqual(['base', 'build', 'build', 'taper'])
  })

  it('matches the CLAUDE.md matrix exactly for a 12-week plan', () => {
    expect(computeWeekPhases(12)).toEqual([
      'base', 'base', 'base', 'base',
      'build', 'build', 'build', 'build', 'build',
      'peak',
      'taper', 'taper',
    ])
  })

  it('extends base by one week for 13 weeks (nearest anchor is 12)', () => {
    expect(computeWeekPhases(13)).toEqual([
      'base', 'base', 'base', 'base', 'base',
      'build', 'build', 'build', 'build', 'build',
      'peak',
      'taper', 'taper',
    ])
  })

  it('clamps base to 1 week and borrows the rest from build for a very short plan', () => {
    // Nearest anchor to 3 is 4 (base 1, build 2, peak 0, taper 1). delta = -1.
    // base would go to 0, so it clamps to 1 and build absorbs the remaining -1 (2 -> 1).
    expect(computeWeekPhases(3)).toEqual(['base', 'build', 'taper'])
  })

  it('always returns exactly totalWeeks entries', () => {
    for (const weeks of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      expect(computeWeekPhases(weeks)).toHaveLength(weeks)
    }
  })

  it('preserves the taper for a 1-week plan instead of dropping it for base', () => {
    expect(computeWeekPhases(1)).toEqual(['taper'])
  })

  it('preserves both a base week and the taper for a 2-week plan', () => {
    expect(computeWeekPhases(2)).toEqual(['base', 'taper'])
  })
})

describe('buildPlanBatches', () => {
  it('splits an exact multiple of 4 weeks into equal 4-week batches', () => {
    expect(buildPlanBatches(12)).toEqual([
      { startWeek: 0, weekCount: 4 },
      { startWeek: 4, weekCount: 4 },
      { startWeek: 8, weekCount: 4 },
    ])
  })

  it('gives the last batch the remainder when weeks is not a multiple of 4', () => {
    expect(buildPlanBatches(10)).toEqual([
      { startWeek: 0, weekCount: 4 },
      { startWeek: 4, weekCount: 4 },
      { startWeek: 8, weekCount: 2 },
    ])
  })

  it('produces a single batch for a plan of 4 weeks or fewer', () => {
    expect(buildPlanBatches(4)).toEqual([{ startWeek: 0, weekCount: 4 }])
    expect(buildPlanBatches(1)).toEqual([{ startWeek: 0, weekCount: 1 }])
  })
})
