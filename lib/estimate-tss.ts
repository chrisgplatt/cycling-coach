import type { WorkoutType, WorkoutStep } from '@/types'

// Assumed intensity factor (IF) per workout type, used to estimate TSS for a
// planned workout that has no steps yet. This is a distinct, deliberately
// separate estimate from lib/plan/progress.ts's plannedTss(), which uses its
// own IF assumptions tuned for weekly plan-progress calculations.
const IF_BY_TYPE: Record<WorkoutType, number> = {
  recovery: 0.50,
  endurance: 0.68,
  threshold: 0.85,
  intervals: 0.90,
  test: 0.90,
}

export function estimateTss(type: WorkoutType, durationMinutes: number): number {
  const intf = IF_BY_TYPE[type] ?? 0.68
  return Math.round((durationMinutes * 60 * intf * intf) / 36)
}

/** Target training stress from a workout's steps: Σ duration × (power/FTP)². */
export function stepsTss(steps: Array<Pick<WorkoutStep, 'duration_minutes' | 'power_pct_ftp'>>): number {
  return Math.round(
    steps.reduce((sum, s) => sum + (s.duration_minutes * 60 * (s.power_pct_ftp / 100) ** 2) / 36, 0),
  )
}

/**
 * The single source of truth for a planned workout's target TSS. Derived from
 * the workout's current steps on every call — never from the stored `tss`
 * column, which goes stale whenever steps are rewritten by a path that forgets
 * to refresh it. Falls back to the per-type heuristic when there are no steps.
 */
export function plannedWorkoutTss(
  workout: { type: WorkoutType; duration_minutes: number; steps?: WorkoutStep[] | null },
): number {
  return workout.steps?.length ? stepsTss(workout.steps) : estimateTss(workout.type, workout.duration_minutes)
}
