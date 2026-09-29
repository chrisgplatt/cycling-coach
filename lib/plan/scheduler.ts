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
