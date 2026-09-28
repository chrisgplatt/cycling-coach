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

import { eventWindowFor, holidayOptionalSessionDates } from '@/lib/plan/scheduler'
import type { TrainingEvent } from '@/types'

function event(overrides: Partial<TrainingEvent>): TrainingEvent {
  return { name: 'E', date: '2026-09-14', type: 'sportive', priority: 'A', ...overrides }
}

describe('eventWindowFor', () => {
  it('blocks the event date itself', () => {
    const e = event({ date: '2026-09-14' })
    expect(eventWindowFor('2026-09-14', [e])).toEqual({ mode: 'blocked', event: e })
  })
  it('marks a continue_training holiday as not blocked', () => {
    const e = event({ type: 'holiday', date: '2026-09-10', end_date: '2026-09-17', continue_training: true })
    expect(eventWindowFor('2026-09-12', [e])?.mode).toBe('continue_training')
  })
  it('flags 1-2 days before as pre_activation', () => {
    const e = event({ date: '2026-09-14' })
    expect(eventWindowFor('2026-09-13', [e])?.mode).toBe('pre_activation')
    expect(eventWindowFor('2026-09-12', [e])?.mode).toBe('pre_activation')
  })
  it('flags 3-6 days before as pre_reduce', () => {
    const e = event({ date: '2026-09-14' })
    expect(eventWindowFor('2026-09-11', [e])?.mode).toBe('pre_reduce')
    expect(eventWindowFor('2026-09-08', [e])?.mode).toBe('pre_reduce')
  })
  it('flags 7-10 days before an A-priority event as pre_taper_early, but not for a B event', () => {
    const a = event({ date: '2026-09-14', priority: 'A' })
    const b = event({ date: '2026-09-14', priority: 'B' })
    expect(eventWindowFor('2026-09-05', [a])?.mode).toBe('pre_taper_early')
    expect(eventWindowFor('2026-09-05', [b])).toBeNull()
  })
  it('flags 1-2 days after as post_recovery', () => {
    const e = event({ date: '2026-09-14' })
    expect(eventWindowFor('2026-09-15', [e])?.mode).toBe('post_recovery')
    expect(eventWindowFor('2026-09-16', [e])?.mode).toBe('post_recovery')
  })
  it('lets an A event taper override a same-day B event', () => {
    const a = event({ name: 'A-race', date: '2026-09-20', priority: 'A' })
    const b = event({ name: 'B-race', date: '2026-09-14', priority: 'B' })
    // 2026-09-13 is both "1 day before the B event" and "7 days before the A event" —
    // the A taper wins per CLAUDE.md's conflict rule.
    expect(eventWindowFor('2026-09-13', [a, b])?.event.name).toBe('A-race')
  })
  it('returns null outside any event window', () => {
    const e = event({ date: '2026-09-14' })
    expect(eventWindowFor('2026-08-01', [e])).toBeNull()
  })
})

describe('holidayOptionalSessionDates', () => {
  it('places roughly 2 optional sessions per 7 days, alternating threshold and intervals', () => {
    const availability = [
      { day: 'monday', duration_minutes: 60 }, { day: 'wednesday', duration_minutes: 60 },
      { day: 'friday', duration_minutes: 60 },
    ]
    const holiday = event({
      type: 'holiday', date: '2026-09-14', end_date: '2026-09-27', continue_training: true,
    }) // 2 weeks, Mon 2026-09-14
    const overrides = holidayOptionalSessionDates([holiday], availability)
    expect(overrides.size).toBe(4) // ~2 per 7 days over 14 days
    expect(new Set(overrides.values())).toEqual(new Set(['threshold', 'intervals']))
  })
  it('ignores holidays without continue_training', () => {
    const holiday = event({ type: 'holiday', date: '2026-09-14', end_date: '2026-09-20' })
    expect(holidayOptionalSessionDates([holiday], []).size).toBe(0)
  })
})
