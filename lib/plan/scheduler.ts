// lib/plan/scheduler.ts
import type { WorkoutType, PlanPhase, TrainingPhilosophy } from '@/types'

export type SessionKind = 'recovery' | 'endurance' | 'tempo' | 'threshold' | 'intervals' | 'long_ride'

export interface PlanEmphasis {
  climbing: number
  speed: number
  enduranceVolume: number
  weightLoss: number
}

// CLAUDE.md's session-type table only distinguishes 5 stored types; tempo and long_ride
// are scheduling-level concepts (different duration/intensity mix) that both persist as
// 'endurance' — the only place that distinction matters is Tier 2's session content.
export function toWorkoutType(kind: SessionKind): WorkoutType {
  if (kind === 'recovery') return 'recovery'
  if (kind === 'threshold') return 'threshold'
  if (kind === 'intervals') return 'intervals'
  return 'endurance' // tempo, long_ride
}

export const DEFAULT_EMPHASIS: PlanEmphasis = {
  climbing: 0.25,
  speed: 0.25,
  enduranceVolume: 0.25,
  weightLoss: 0.25,
}

// Rough intensity factor per session kind, used only to size a target TSS for Tier 2's
// prompt — not a substitute for the real TSS computed from the session's actual steps
// once Tier 2 fills them in (see lib/claude/plan.ts estimateTss).
const IF_BY_KIND: Record<SessionKind, number> = {
  recovery: 0.5,
  endurance: 0.65,
  tempo: 0.8,
  threshold: 0.95,
  intervals: 1.0,
  long_ride: 0.65,
}

export function targetTssForSession(kind: SessionKind, durationMinutes: number): number {
  const intensityFactor = IF_BY_KIND[kind]
  return Math.round((durationMinutes / 60) * intensityFactor * intensityFactor * 100)
}

// "Every 3rd training week is a de-load week" (CLAUDE.md) — counted across the
// contiguous base+build+peak span, since taper already reduces load through its own
// event-preparation rules and isn't part of this cycle.
export function computeDeloadWeeks(phases: PlanPhase[]): Set<number> {
  const trainingWeekIndices = phases
    .map((phase, i) => ({ phase, i }))
    .filter(({ phase }) => phase !== 'taper')
    .map(({ i }) => i)

  const deload = new Set<number>()
  trainingWeekIndices.forEach((weekIndex, position) => {
    if ((position + 1) % 3 === 0) deload.add(weekIndex)
  })
  return deload
}

// Event window classification and holiday optional sessions (CLAUDE.md's
// event-preparation table and conflict rules).
import type { TrainingEvent } from '@/types'
import { eventCoversDate, eventEndDate } from '@/lib/events'
import { addDaysUtc, daysBetweenUtc } from '@/lib/plan/forecast'
import { weekdayName } from '@/lib/calendar-helpers'

export type EventWindowMode =
  | 'blocked'
  | 'continue_training'
  | 'pre_activation'
  | 'pre_reduce'
  | 'pre_taper_early'
  | 'post_recovery'

export interface EventWindow {
  mode: EventWindowMode
  event: TrainingEvent
}

const PREP_EVENT_TYPES = new Set(['race', 'sportive', 'fitness'])

// Priority order A > B > C so an A event's taper always wins a same-day conflict with a
// lower-priority event's own window (CLAUDE.md's conflict rule).
function byPriority(events: TrainingEvent[]): TrainingEvent[] {
  return [...events].sort((a, b) => a.priority.localeCompare(b.priority))
}

export function eventWindowFor(dateStr: string, events: TrainingEvent[]): EventWindow | null {
  const ordered = byPriority(events)

  for (const event of ordered) {
    if (eventCoversDate(event, dateStr)) {
      if (event.type === 'holiday' && event.continue_training) return { mode: 'continue_training', event }
      return { mode: 'blocked', event }
    }
  }

  for (const event of ordered) {
    if (!PREP_EVENT_TYPES.has(event.type)) continue
    const daysUntil = daysBetweenUtc(dateStr, event.date)
    if (event.priority === 'A' && daysUntil >= 7 && daysUntil <= 10) return { mode: 'pre_taper_early', event }
    // Priority C: "no significant disruption to surrounding training; treat adjacent
    // days normally" (CLAUDE.md) — only A/B events get the pre/post windows below.
    if (event.priority === 'C') continue
    if (daysUntil >= 1 && daysUntil <= 2) return { mode: 'pre_activation', event }
    if (daysUntil >= 3 && daysUntil <= 6) return { mode: 'pre_reduce', event }
    const daysSince = daysBetweenUtc(eventEndDate(event), dateStr)
    if (daysSince >= 2 && daysSince <= 3) return { mode: 'post_recovery', event }
  }
  return null
}

// ~2 optional sessions per 7 days of a continue-training holiday (1 threshold + 1
// interval/VO2max per CLAUDE.md), spread evenly across the window's trainable days and
// alternating kind. Every other day in the window stays free (the caller treats a day
// with no override as self-directed rest).
export function holidayOptionalSessionDates(
  events: TrainingEvent[],
  availability: Array<{ day: string; duration_minutes: number }>,
): Map<string, SessionKind> {
  const overrides = new Map<string, SessionKind>()
  const trainableDays = new Set(
    availability.filter(a => a.duration_minutes > 0).map(a => a.day.toLowerCase())
  )

  for (const event of events) {
    if (event.type !== 'holiday' || !event.continue_training) continue
    const end = eventEndDate(event)
    const totalDays = daysBetweenUtc(event.date, end) + 1
    const targetSlots = Math.max(1, Math.round((totalDays / 7) * 2))

    const candidateDates: string[] = []
    for (let d = 0; d < totalDays; d++) {
      const dateStr = addDaysUtc(event.date, d)
      if (trainableDays.has(weekdayName(dateStr).toLowerCase())) candidateDates.push(dateStr)
    }
    if (!candidateDates.length) continue

    // Evenly-spaced index sampling (not a fixed step) so slots spread across the whole
    // window instead of clustering in its first half on longer holidays.
    let kindToggle: SessionKind = 'threshold'
    for (let slot = 0; slot < targetSlots; slot++) {
      const idx = Math.floor((slot * candidateDates.length) / targetSlots)
      overrides.set(candidateDates[idx], kindToggle)
      kindToggle = kindToggle === 'threshold' ? 'intervals' : 'threshold'
    }
  }
  return overrides
}

// Session-kind picker for normal weeks (non-de-load, non-event-governed training days).
// Hard caps (max 1 threshold/week, max 1 intervals/week, never two hard days in a row,
// at least 1 recovery/week) are enforced unconditionally; PlanEmphasis only breaks ties
// among the kinds that are still valid once those caps are applied.

export interface WeekState {
  thresholdUsed: boolean
  intervalsUsed: boolean
  recoveryCount: number
  lastKindWasHard: boolean
}

const HARD_KINDS = new Set<SessionKind>(['threshold', 'intervals'])

function allowsThreshold(phase: PlanPhase, isLastBaseWeek: boolean): boolean {
  if (phase === 'base') return isLastBaseWeek
  if (phase === 'taper') return false // taper intensity comes from event windows, not this quota
  return true // build, peak
}

function allowsIntervals(phase: PlanPhase, intensityProfile: TrainingPhilosophy['intensity_profile'] | null): boolean {
  if (intensityProfile === 'simplified') return false
  if (phase === 'base' || phase === 'taper') return false
  return true
}

export function pickNormalSessionKind(
  phase: PlanPhase,
  state: WeekState,
  isLastBaseWeek: boolean,
  intensityProfile: TrainingPhilosophy['intensity_profile'] | null,
  emphasis: PlanEmphasis,
): SessionKind {
  const canThreshold = !state.thresholdUsed && !state.lastKindWasHard && allowsThreshold(phase, isLastBaseWeek)
  const canIntervals = !state.intervalsUsed && !state.lastKindWasHard && allowsIntervals(phase, intensityProfile)

  if (canThreshold && canIntervals) {
    const thresholdScore = emphasis.climbing + emphasis.enduranceVolume
    const intervalsScore = emphasis.speed
    return intervalsScore > thresholdScore ? 'intervals' : 'threshold'
  }
  if (canThreshold) return 'threshold'
  if (canIntervals) return 'intervals'

  if (state.recoveryCount === 0) return 'recovery'

  if (phase === 'base') return emphasis.climbing > 0.3 ? 'tempo' : 'endurance'
  return emphasis.enduranceVolume + emphasis.weightLoss > emphasis.climbing + emphasis.speed ? 'endurance' : 'tempo'
}

import type { UserProfile } from '@/types'

export interface ScheduledSession {
  date: string
  status: 'session'
  sessionKind: SessionKind
  workoutType: WorkoutType
  durationMinutes: number
  phase: PlanPhase
  targetTss: number
  optional: boolean
}

export interface ScheduledOff {
  date: string
  status: 'rest' | 'event_blocked'
  eventName?: string
}

export type ScheduledDay = ScheduledSession | ScheduledOff

export interface BuildSkeletonInput {
  profile: Pick<UserProfile, 'events' | 'weekly_availability'>
  planStartDate: string       // the whole plan's week-0 start date, for absolute week indexing
  phases: PlanPhase[]         // the whole plan's phase-per-week array (computeWeekPhases output)
  fromDate: string            // inclusive — first date to actually emit
  toDate: string              // inclusive — last date to actually emit
  emphasis?: PlanEmphasis
  trainingPhilosophy?: TrainingPhilosophy | null
}

const round5 = (n: number) => Math.max(15, Math.round(n / 5) * 5)

// CLAUDE.md's "Session type definitions" table, as an upper bound per kind — the normal
// picker uses this to cap duration instead of always filling the day's full cap (the
// anti-padding scheduling hard rule). min(dayCap, ceiling) still lets endurance/tempo use
// most of a long day when that's genuinely useful (long Z2 volume), while keeping
// recovery/threshold/intervals from ballooning just because a lot of time happens to be
// available that day.
const DURATION_CEILING_BY_KIND: Record<SessionKind, number> = {
  recovery: 60, endurance: 180, tempo: 120, threshold: 90, intervals: 90, long_ride: 240,
}

function sessionForEventWindow(dateStr: string, window: EventWindow, dayCap: number, phase: PlanPhase): ScheduledSession {
  const make = (sessionKind: SessionKind, rawDuration: number): ScheduledSession => {
    const durationMinutes = Math.min(dayCap, rawDuration)
    return {
      date: dateStr, status: 'session', sessionKind, workoutType: toWorkoutType(sessionKind),
      durationMinutes, phase, targetTss: targetTssForSession(sessionKind, durationMinutes), optional: false,
    }
  }
  switch (window.mode) {
    case 'pre_activation': return make('intervals', round5(dayCap * 0.5))
    case 'pre_reduce': return make('endurance', round5(dayCap * 0.75))
    case 'pre_taper_early': return make('endurance', round5(dayCap * 0.7))
    case 'post_recovery': return make('recovery', round5(dayCap * 0.5))
    default: return make('endurance', dayCap) // unreachable for 'blocked'/'continue_training' — filtered earlier
  }
}

// A session counts toward this week's hard-cap tracking regardless of which branch
// produced it (event window, holiday override, or the normal picker) — otherwise the
// weekly caps from Task 4 are only enforced for normally-picked sessions and can be
// silently defeated by an event-window or holiday session earlier in the same week.
function applyToWeekState(weekState: WeekState, sessionKind: SessionKind): void {
  if (sessionKind === 'threshold') weekState.thresholdUsed = true
  if (sessionKind === 'intervals') weekState.intervalsUsed = true
  if (sessionKind === 'recovery') weekState.recoveryCount++
  weekState.lastKindWasHard = HARD_KINDS.has(sessionKind)
}

export function buildPlanSkeleton(input: BuildSkeletonInput): ScheduledDay[] {
  const { profile, planStartDate, phases, fromDate, toDate } = input
  const emphasis = input.emphasis ?? DEFAULT_EMPHASIS
  const intensityProfile = input.trainingPhilosophy?.intensity_profile ?? null
  const events = profile.events ?? []
  const availability = profile.weekly_availability ?? []
  const capByDay = new Map(availability.filter(a => a.duration_minutes > 0).map(a => [a.day.toLowerCase(), a.duration_minutes]))
  const deloadWeeks = computeDeloadWeeks(phases)
  const holidayOverrides = holidayOptionalSessionDates(events, availability)
  const lastBaseWeekIndex = phases.lastIndexOf('base')

  const days: ScheduledDay[] = []
  const totalDays = daysBetweenUtc(fromDate, toDate) + 1
  // lastKindWasHard is a ROLLING day-to-day flag (yesterday vs. today), not week-scoped —
  // it must survive the weekly reset below and be explicitly maintained on every branch,
  // including rest/blocked days, or "no two hard sessions on consecutive days" silently
  // stops holding across a week boundary or a rest day.
  let weekState: WeekState = { thresholdUsed: false, intervalsUsed: false, recoveryCount: 0, lastKindWasHard: false }
  let lastWeekIndex = -1

  for (let i = 0; i < totalDays; i++) {
    const dateStr = addDaysUtc(fromDate, i)
    const weekIndex = Math.floor(daysBetweenUtc(planStartDate, dateStr) / 7)
    const phase = phases[weekIndex] ?? phases[phases.length - 1] ?? 'base'
    if (weekIndex !== lastWeekIndex) {
      weekState = { thresholdUsed: false, intervalsUsed: false, recoveryCount: 0, lastKindWasHard: weekState.lastKindWasHard }
      lastWeekIndex = weekIndex
    }

    const weekday = weekdayName(dateStr).toLowerCase()
    const dayCap = capByDay.get(weekday) ?? 0
    const window = eventWindowFor(dateStr, events)

    if (window?.mode === 'blocked') {
      days.push({ date: dateStr, status: 'event_blocked', eventName: window.event.name })
      weekState.lastKindWasHard = false
      continue
    }
    if (dayCap <= 0 && window?.mode !== 'continue_training') {
      days.push({ date: dateStr, status: 'rest' })
      weekState.lastKindWasHard = false
      continue
    }
    if (window && window.mode !== 'continue_training') {
      const session = sessionForEventWindow(dateStr, window, dayCap, phase)
      days.push(session)
      applyToWeekState(weekState, session.sessionKind)
      continue
    }

    const holidayKind = holidayOverrides.get(dateStr)
    if (holidayKind) {
      const duration = Math.min(dayCap, holidayKind === 'intervals' ? 75 : 90)
      days.push({
        date: dateStr, status: 'session', sessionKind: holidayKind, workoutType: toWorkoutType(holidayKind),
        durationMinutes: duration, phase, targetTss: targetTssForSession(holidayKind, duration), optional: true,
      })
      applyToWeekState(weekState, holidayKind)
      continue
    }
    if (window?.mode === 'continue_training') {
      days.push({ date: dateStr, status: 'rest' }) // self-directed; no mandatory workout
      weekState.lastKindWasHard = false
      continue
    }

    if (deloadWeeks.has(weekIndex)) {
      const kind: SessionKind = dayCap <= 60 ? 'recovery' : 'endurance'
      const duration = Math.min(dayCap, Math.max(20, round5(dayCap * 0.5)))
      days.push({
        date: dateStr, status: 'session', sessionKind: kind, workoutType: toWorkoutType(kind),
        durationMinutes: duration, phase, targetTss: targetTssForSession(kind, duration), optional: false,
      })
      applyToWeekState(weekState, kind) // always recovery/endurance during de-load, never hard
      continue
    }

    const kind = pickNormalSessionKind(phase, weekState, weekIndex === lastBaseWeekIndex, intensityProfile, emphasis)
    const duration = Math.min(dayCap, DURATION_CEILING_BY_KIND[kind])
    applyToWeekState(weekState, kind)
    days.push({
      date: dateStr, status: 'session', sessionKind: kind, workoutType: toWorkoutType(kind),
      durationMinutes: duration, phase, targetTss: targetTssForSession(kind, duration), optional: false,
    })
  }
  return days
}
