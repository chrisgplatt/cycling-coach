import { buildWeekBuckets, consistency, planHours } from '@/lib/plan/progress'
import { addDaysUtc } from '@/lib/plan/forecast'
import type { Workout, ICUActivity, ICUWellness, PlanArchiveSummary } from '@/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { IntervalsClient } from '@/lib/intervals/client'

export function ctlNearestOnOrBefore(wellness: ICUWellness[], date: string): number | null {
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

export async function archivePlan(
  supabase: SupabaseClient,
  client: IntervalsClient | null,
  planId: string,
  closureDate: string,
): Promise<{ archived: boolean; deleted: number; failed: number }> {
  const { data: plan } = await supabase
    .from('training_plans')
    .select('id, created_at, plan_weeks')
    .eq('id', planId)
    .single()
  if (!plan) return { archived: false, deleted: 0, failed: 0 }

  const planStart = (plan.created_at as string).split('T')[0]
  const totalWeeks = (plan.plan_weeks as number | null) ?? 1

  const { data: allWorkouts } = await supabase
    .from('workouts')
    .select('*')
    .eq('plan_id', planId)
  const workouts = (allWorkouts ?? []) as Workout[]

  let activities: ICUActivity[] = []
  let wellness: ICUWellness[] = []
  if (client) {
    try {
      ;[activities, wellness] = await Promise.all([
        client.getActivities(planStart, closureDate),
        client.getWellness(planStart, closureDate),
      ])
    } catch { /* archive proceeds using local workout data only */ }
  }

  const summary = buildArchiveSummary(workouts, activities, wellness, planStart, totalWeeks, closureDate)

  const toDelete = workouts.filter(w => w.status === 'planned' && w.date >= closureDate)
  let failed = 0
  if (client) {
    for (const w of toDelete) {
      if (!w.intervals_icu_event_id) continue
      try { await client.deleteEvent(w.intervals_icu_event_id) } catch { failed++ }
    }
  }
  const deleteIds = toDelete.map(w => w.id)
  if (deleteIds.length > 0) {
    await supabase.from('workouts').delete().in('id', deleteIds)
  }

  const { data: updated } = await supabase
    .from('training_plans')
    .update({ status: 'archived', closed_at: closureDate, archive_summary: summary })
    .eq('id', planId)
    .eq('status', 'active')
    .select('id')

  return { archived: (updated?.length ?? 0) > 0, deleted: deleteIds.length, failed }
}
