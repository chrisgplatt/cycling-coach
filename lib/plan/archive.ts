import { buildWeekBuckets, consistency, planHours } from '@/lib/plan/progress'
import { addDaysUtc } from '@/lib/plan/forecast'
import type { Workout, ICUActivity, ICUWellness, PlanArchiveSummary } from '@/types'

function ctlNearestOnOrBefore(wellness: ICUWellness[], date: string): number | null {
  const rows = wellness
    .filter(w => w.ctl != null && w.id <= date)
    .sort((a, b) => a.id.localeCompare(b.id))
  return rows.length ? rows[rows.length - 1].ctl : null
}

export function buildArchiveSummary(
  workouts: Workout[],
  activities: ICUActivity[],
  wellness: ICUWellness[],
  planStart: string,
  totalWeeks: number,
  closureDate: string,
): PlanArchiveSummary {
  const buckets = buildWeekBuckets(workouts, activities, planStart, totalWeeks)
  const { hitPct } = consistency(buckets, totalWeeks - 1)
  const plannedEndDate = addDaysUtc(planStart, totalWeeks * 7)
  const ctlStart = ctlNearestOnOrBefore(wellness, planStart)
  const ctlEnd = ctlNearestOnOrBefore(wellness, closureDate)

  return {
    startDate: planStart,
    closedAt: closureDate,
    plannedEndDate,
    closedEarly: closureDate < plannedEndDate,
    totalPlannedSessions: buckets.reduce((s, b) => s + b.plannedSessions, 0),
    totalCompletedSessions: buckets.reduce((s, b) => s + b.completedSessions, 0),
    totalHours: planHours(workouts, activities),
    totalTss: buckets.reduce((s, b) => s + b.actualTss, 0),
    ctlStart,
    ctlEnd,
    fitnessChange: ctlStart != null && ctlEnd != null ? Math.round((ctlEnd - ctlStart) * 10) / 10 : null,
    consistencyPct: hitPct,
    weeks: buckets.map(b => ({
      weekIndex: b.weekIndex,
      weekStart: addDaysUtc(planStart, b.weekIndex * 7),
      plannedSessions: b.plannedSessions,
      completedSessions: b.completedSessions,
      plannedTss: b.plannedTss,
      actualTss: b.actualTss,
      hours: b.hours,
    })),
  }
}
