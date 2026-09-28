// lib/plan/scheduler.ts
import type { WorkoutType, PlanPhase } from '@/types'

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
