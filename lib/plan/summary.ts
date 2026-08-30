import { addDaysUtc, daysBetweenUtc } from '@/lib/plan/forecast'
import { ctlNearestOnOrBefore } from '@/lib/plan/archive'
import { isoWeekStart } from '@/lib/chart-helpers'
import type { PlanWeekSummary, ICUWellness } from '@/types'
import type { WeekBucket } from '@/lib/plan/progress'

export interface TrainingSummary {
  windowMonths: 6 | 12
  windowStart: string
  ridesCompleted: number
  hoursTrained: number
  weeksWithPlan: number
  weeksActive: number
  weeksInWindow: number
  ctlStart: number | null
  ctlEnd: number | null
  fitnessChange: number | null
  ftpStart: number | null
  ftpEnd: number | null
  ftpChange: number | null
  ftpStartIsPartial: boolean
}

export function buildTrainingSummary(input: {
  windowMonths: 6 | 12
  today: string
  archivedPlanWeeks: PlanWeekSummary[]
  activePlan: { planStart: string; buckets: WeekBucket[] } | null
  wellness: ICUWellness[]
  confirmedPredictions: Array<{ predicted_ftp: number; created_at: string }>
  currentFtp: number | null
  activities: Array<{ start_date_local: string; type: string }>
}): TrainingSummary {
  const { windowMonths, today, archivedPlanWeeks, activePlan, wellness, confirmedPredictions, currentFtp, activities } = input
  const windowStart = addDaysUtc(today, -windowMonths * 30)

  const activeWeeks: PlanWeekSummary[] = activePlan
    ? activePlan.buckets.map(b => ({
        weekIndex: b.weekIndex,
        weekStart: addDaysUtc(activePlan.planStart, b.weekIndex * 7),
        plannedSessions: b.plannedSessions,
        completedSessions: b.completedSessions,
        plannedTss: b.plannedTss,
        actualTss: b.actualTss,
        hours: b.hours,
      }))
    : []

  const clippedWeeks = [...archivedPlanWeeks, ...activeWeeks]
    .filter(w => w.weekStart >= windowStart && w.weekStart <= today)

  const ridesCompleted = clippedWeeks.reduce((sum, w) => sum + w.completedSessions, 0)
  const hoursTrained = Math.round(clippedWeeks.reduce((sum, w) => sum + w.hours, 0) * 10) / 10
  const weeksWithPlan = new Set(
    clippedWeeks.filter(w => w.plannedSessions > 0).map(w => w.weekStart)
  ).size
  const weeksInWindow = Math.max(1, Math.round(daysBetweenUtc(windowStart, today) / 7))

  const weeksActive = new Set(
    activities
      .filter(a => /ride/i.test(a.type))
      .map(a => a.start_date_local.split('T')[0])
      .filter(d => d >= windowStart && d <= today)
      .map(d => isoWeekStart(d))
  ).size

  const ctlStart = ctlNearestOnOrBefore(wellness, windowStart)
  const ctlEnd = ctlNearestOnOrBefore(wellness, today)
  const fitnessChange = ctlStart != null && ctlEnd != null ? Math.round((ctlEnd - ctlStart) * 10) / 10 : null

  const sortedConfirmed = [...confirmedPredictions].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const beforeWindow = sortedConfirmed.filter(p => p.created_at.split('T')[0] <= windowStart)
  let ftpStart: number | null = null
  let ftpStartIsPartial = false
  if (beforeWindow.length) {
    ftpStart = beforeWindow[beforeWindow.length - 1].predicted_ftp
  } else if (sortedConfirmed.length) {
    const earliest = sortedConfirmed[0].predicted_ftp
    // A confirmed prediction only ever records the value a change was applied TO, never what it
    // replaced — so if the earliest one we have equals the current FTP, it isn't a genuine
    // "before" data point (most likely it's the only confirmed prediction that exists at all).
    // Reporting a "+0W" from it would fabricate a change that was never actually measured.
    if (earliest !== currentFtp) {
      ftpStart = earliest
      ftpStartIsPartial = true
    }
  }
  const ftpEnd = currentFtp
  const ftpChange = ftpStart != null && ftpEnd != null ? ftpEnd - ftpStart : null

  return {
    windowMonths, windowStart, ridesCompleted, hoursTrained, weeksWithPlan, weeksActive, weeksInWindow,
    ctlStart, ctlEnd, fitnessChange, ftpStart, ftpEnd, ftpChange, ftpStartIsPartial,
  }
}
