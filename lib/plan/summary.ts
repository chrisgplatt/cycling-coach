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
  currentFtp: number | null
  activities: Array<{ start_date_local: string; type: string; ftp?: number | null }>
}): TrainingSummary {
  const { windowMonths, today, archivedPlanWeeks, activePlan, wellness, currentFtp, activities } = input
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

  // FTP-at-time-of-ride (intervals.icu's own athlete FTP history), not confirmed predictions —
  // a ride's ftp is a passive snapshot of what was in effect, unlike a predicted_ftp row (which
  // only ever records the value a change was applied TO, never what it replaced), so it's a
  // trustworthy "before" reading even when it happens to equal the current FTP.
  const rideFtpPoints = activities
    .filter(a => /ride/i.test(a.type) && a.ftp != null)
    .map(a => ({ date: a.start_date_local.split('T')[0], ftp: a.ftp as number }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const beforeWindow = rideFtpPoints.filter(p => p.date <= windowStart)
  let ftpStart: number | null = null
  let ftpStartIsPartial = false
  if (beforeWindow.length) {
    ftpStart = beforeWindow[beforeWindow.length - 1].ftp
  } else if (rideFtpPoints.length) {
    ftpStart = rideFtpPoints[0].ftp
    ftpStartIsPartial = true
  }
  const ftpEnd = currentFtp
  const ftpChange = ftpStart != null && ftpEnd != null ? ftpEnd - ftpStart : null

  return {
    windowMonths, windowStart, ridesCompleted, hoursTrained, weeksWithPlan, weeksActive, weeksInWindow,
    ctlStart, ctlEnd, fitnessChange, ftpStart, ftpEnd, ftpChange, ftpStartIsPartial,
  }
}
