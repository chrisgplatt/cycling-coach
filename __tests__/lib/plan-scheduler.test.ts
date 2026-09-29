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
  it('flags 2-3 days after as post_recovery', () => {
    const e = event({ date: '2026-09-14' })
    expect(eventWindowFor('2026-09-16', [e])?.mode).toBe('post_recovery')
    expect(eventWindowFor('2026-09-17', [e])?.mode).toBe('post_recovery')
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
  it('does not apply pre/post windows to a Priority C event (CLAUDE.md: "no significant disruption")', () => {
    const c = event({ date: '2026-09-14', priority: 'C' })
    expect(eventWindowFor('2026-09-13', [c])).toBeNull()  // would be pre_activation for A/B
    expect(eventWindowFor('2026-09-16', [c])).toBeNull()  // would be post_recovery for A/B
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

import { pickNormalSessionKind } from '@/lib/plan/scheduler'
import type { WeekState } from '@/lib/plan/scheduler'

function freshState(): WeekState {
  return { thresholdUsed: false, intervalsUsed: false, recoveryCount: 0, lastKindWasHard: false }
}

describe('pickNormalSessionKind', () => {
  it('never picks threshold or intervals in base except the final base week', () => {
    const state = freshState()
    expect(pickNormalSessionKind('base', state, false, null, { climbing: 1, speed: 1, enduranceVolume: 0, weightLoss: 0 }))
      .not.toMatch(/threshold|intervals/)
  })
  it('allows one threshold in the final base week', () => {
    const state = freshState()
    expect(pickNormalSessionKind('base', state, true, null, { climbing: 1, speed: 0, enduranceVolume: 0, weightLoss: 0 }))
      .toBe('threshold')
  })
  it('never assigns a second threshold in the same week', () => {
    const state: WeekState = { ...freshState(), thresholdUsed: true }
    expect(pickNormalSessionKind('build', state, false, null, { climbing: 1, speed: 0, enduranceVolume: 0, weightLoss: 0 }))
      .not.toBe('threshold')
  })
  it('never assigns a hard session the day after another hard session', () => {
    const state: WeekState = { ...freshState(), lastKindWasHard: true }
    const kind = pickNormalSessionKind('build', state, false, null, { climbing: 1, speed: 1, enduranceVolume: 0, weightLoss: 0 })
    expect(['threshold', 'intervals']).not.toContain(kind)
  })
  it('disables intervals entirely under the simplified intensity profile', () => {
    const state = freshState()
    expect(pickNormalSessionKind('build', state, false, 'simplified', { climbing: 0, speed: 1, enduranceVolume: 0, weightLoss: 0 }))
      .not.toBe('intervals')
  })
  it('ensures at least one recovery session before repeating easy kinds', () => {
    const state: WeekState = { ...freshState(), thresholdUsed: true, intervalsUsed: true }
    expect(pickNormalSessionKind('build', state, false, null, { climbing: 0, speed: 0, enduranceVolume: 0, weightLoss: 0 }))
      .toBe('recovery')
  })
  it('breaks a threshold-vs-intervals tie toward speed emphasis', () => {
    const state = freshState()
    const speedFocused: PlanEmphasisArg = { climbing: 0, speed: 1, enduranceVolume: 0, weightLoss: 0 }
    expect(pickNormalSessionKind('build', state, false, null, speedFocused)).toBe('intervals')
  })
})
type PlanEmphasisArg = Parameters<typeof pickNormalSessionKind>[4]

import { buildPlanSkeleton } from '@/lib/plan/scheduler'
import type { ScheduledSession } from '@/lib/plan/scheduler'
import type { UserProfile, PlanPhase } from '@/types'

function profile(overrides: Partial<UserProfile> = {}): Pick<UserProfile, 'events' | 'weekly_availability'> {
  return {
    events: [],
    weekly_availability: [
      { day: 'monday', duration_minutes: 60 }, { day: 'wednesday', duration_minutes: 60 },
      { day: 'friday', duration_minutes: 90 }, { day: 'saturday', duration_minutes: 120 },
    ],
    ...overrides,
  }
}

describe('buildPlanSkeleton', () => {
  it('never schedules a session on a rest day', () => {
    const phases: PlanPhase[] = Array(4).fill('base')
    const days = buildPlanSkeleton({
      profile: profile(), planStartDate: '2026-06-01', phases,
      fromDate: '2026-06-01', toDate: '2026-06-28',
    })
    const tuesday = days.find(d => d.date === '2026-06-02') // Tue, not in availability
    expect(tuesday?.status).toBe('rest')
  })
  it('never schedules a session on an event date', () => {
    const phases: PlanPhase[] = Array(4).fill('base')
    const days = buildPlanSkeleton({
      profile: profile({ events: [{ name: 'Race', date: '2026-06-01', type: 'sportive', priority: 'A' }] }),
      planStartDate: '2026-06-01', phases, fromDate: '2026-06-01', toDate: '2026-06-28',
    })
    const raceDay = days.find(d => d.date === '2026-06-01')
    expect(raceDay?.status).toBe('event_blocked')
  })
  it('caps every session at that day\'s available minutes', () => {
    const phases: PlanPhase[] = Array(4).fill('build')
    const days = buildPlanSkeleton({
      profile: profile(), planStartDate: '2026-06-01', phases,
      fromDate: '2026-06-01', toDate: '2026-06-28',
    })
    const sessions = days.filter((d): d is ScheduledSession => d.status === 'session')
    for (const s of sessions) {
      const cap = { monday: 60, wednesday: 60, friday: 90, saturday: 120 }[s.date === s.date ? weekdayOf(s.date) : '']
      expect(s.durationMinutes).toBeLessThanOrEqual(cap!)
    }
  })
  it('respects the max-1-threshold-per-week cap across a whole build phase', () => {
    const phases: PlanPhase[] = Array(8).fill('build')
    const days = buildPlanSkeleton({
      profile: profile(), planStartDate: '2026-06-01', phases,
      fromDate: '2026-06-01', toDate: '2026-07-26',
    })
    const sessions = days.filter((d): d is ScheduledSession => d.status === 'session')
    for (let week = 0; week < 8; week++) {
      const weekStart = new Date('2026-06-01T00:00:00Z')
      weekStart.setUTCDate(weekStart.getUTCDate() + week * 7)
      const weekEnd = new Date(weekStart)
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
      const inWeek = sessions.filter(s => {
        const d = new Date(s.date + 'T00:00:00Z')
        return d >= weekStart && d <= weekEnd
      })
      expect(inWeek.filter(s => s.sessionKind === 'threshold').length).toBeLessThanOrEqual(1)
    }
  })
  it('reduces intensity to easy-only during a de-load week', () => {
    const phases: PlanPhase[] = Array(3).fill('build') // week index 2 (3rd) de-loads
    const days = buildPlanSkeleton({
      profile: profile(), planStartDate: '2026-06-01', phases,
      fromDate: '2026-06-15', toDate: '2026-06-21', // that 3rd week
    })
    const sessions = days.filter((d): d is ScheduledSession => d.status === 'session')
    expect(sessions.every(s => s.sessionKind === 'recovery' || s.sessionKind === 'endurance')).toBe(true)
  })
  it('only emits days within [fromDate, toDate]', () => {
    const phases: PlanPhase[] = Array(4).fill('base')
    const days = buildPlanSkeleton({
      profile: profile(), planStartDate: '2026-06-01', phases,
      fromDate: '2026-06-08', toDate: '2026-06-14',
    })
    expect(days).toHaveLength(7)
    expect(days[0].date).toBe('2026-06-08')
    expect(days[6].date).toBe('2026-06-14')
  })
  it('does not pad a session to the full day cap when the type has a lower natural ceiling (anti-padding rule)', () => {
    const phases: PlanPhase[] = Array(1).fill('build')
    const days = buildPlanSkeleton({
      profile: { events: [], weekly_availability: [{ day: 'saturday', duration_minutes: 120 }] },
      planStartDate: '2026-06-06', phases, fromDate: '2026-06-06', toDate: '2026-06-06',
    })
    const saturday = days.find((d): d is ScheduledSession => d.status === 'session' && d.date === '2026-06-06')
    expect(saturday?.sessionKind).toBe('threshold')
    expect(saturday?.durationMinutes).toBe(90) // capped at threshold's natural ceiling, not padded to the 120min day cap
  })
  it('counts an event-window intervals session toward the weekly intervals cap', () => {
    const phases: PlanPhase[] = Array(2).fill('build')
    const days = buildPlanSkeleton({
      profile: {
        events: [{ name: 'Race', date: '2026-06-03', type: 'sportive', priority: 'B' }],
        weekly_availability: [
          { day: 'monday', duration_minutes: 90 }, { day: 'thursday', duration_minutes: 90 }, { day: 'friday', duration_minutes: 90 },
        ],
      },
      planStartDate: '2026-06-01', phases, fromDate: '2026-06-01', toDate: '2026-06-14',
      emphasis: { climbing: 0, speed: 1, enduranceVolume: 0, weightLoss: 0 },
    })
    const sessions = days.filter((d): d is ScheduledSession => d.status === 'session')
    const monday = sessions.find(s => s.date === '2026-06-01')
    const thursday = sessions.find(s => s.date === '2026-06-04')
    expect(monday?.sessionKind).toBe('intervals')       // from the pre_activation event window (2 days before the race)
    expect(thursday?.sessionKind).not.toBe('intervals')  // weekly intervals cap already used by Monday's event-window session
  })
  it('does not allow a hard session on both sides of an internal week boundary', () => {
    const phases: PlanPhase[] = Array(2).fill('build')
    const days = buildPlanSkeleton({
      profile: {
        events: [],
        weekly_availability: [{ day: 'sunday', duration_minutes: 90 }, { day: 'monday', duration_minutes: 90 }],
      },
      planStartDate: '2026-06-01', phases, fromDate: '2026-06-01', toDate: '2026-06-14',
    })
    const sessions = days.filter((d): d is ScheduledSession => d.status === 'session')
    const sunday = sessions.find(s => s.date === '2026-06-07')  // last day of week 0 (day index 6)
    const monday = sessions.find(s => s.date === '2026-06-08')  // first day of week 1 (day index 7) — calendar-adjacent to the above
    const bothHard = ['threshold', 'intervals'].includes(sunday!.sessionKind) && ['threshold', 'intervals'].includes(monday!.sessionKind)
    expect(bothHard).toBe(false)
  })
  it('scales normal-week session duration by durationMultiplier', () => {
    const phases: PlanPhase[] = Array(4).fill('build')
    const days = buildPlanSkeleton({
      profile: profile(), planStartDate: '2026-06-01', phases,
      fromDate: '2026-06-01', toDate: '2026-06-01', durationMultiplier: 0.5,
    })
    const monday = days.find((d): d is ScheduledSession => d.status === 'session' && d.date === '2026-06-01')
    expect(monday?.durationMinutes).toBe(30) // 60 * 0.5
  })
  it('never exceeds the day cap even when a fractional event-window duration would round above it', () => {
    const phases: PlanPhase[] = Array(1).fill('build')
    const days = buildPlanSkeleton({
      profile: {
        events: [{ name: 'Race', date: '2026-06-03', type: 'sportive', priority: 'A' }],
        weekly_availability: [{ day: 'monday', duration_minutes: 10 }],
      },
      planStartDate: '2026-06-01', phases, fromDate: '2026-06-01', toDate: '2026-06-01',
    })
    const monday = days.find((d): d is ScheduledSession => d.status === 'session' && d.date === '2026-06-01')
    expect(monday!.durationMinutes).toBeLessThanOrEqual(10)
  })
})

function weekdayOf(dateStr: string): string {
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return names[new Date(dateStr + 'T00:00:00Z').getUTCDay()]
}
