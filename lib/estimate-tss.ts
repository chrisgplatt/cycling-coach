import type { WorkoutType } from '@/types'

// Assumed intensity factor (IF) per workout type, used to estimate TSS for a
// planned workout's UI display (workout cards, detail modal, dashboard week
// summary) before it has an actual result. This is a distinct, deliberately
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
