import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { buildArchiveSummary } from '@/lib/plan/archive'
import { addDaysUtc } from '@/lib/plan/forecast'
import type { Workout, ICUActivity, ICUWellness } from '@/types'

// Admin-only one-off: freeze archive_summary/closed_at for training_plans archived
// before this feature existed (only archivePlan() sets these now, so any archived
// plan missing archive_summary predates it). The true closure date isn't recorded
// for these, so we assume each ran its planned full course (created_at + plan_weeks) —
// closedEarly is therefore always false for backfilled rows, since we have no way
// to know otherwise.
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('is_admin, intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client = profile.intervals_icu_athlete_id && profile.intervals_icu_api_key
    ? new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    : null

  const { data: rows } = await supabase
    .from('training_plans')
    .select('id, created_at, plan_weeks')
    .eq('user_id', user.id)
    .eq('status', 'archived')
    .is('archive_summary', null)

  const plans = (rows ?? []) as Array<{ id: string; created_at: string; plan_weeks: number | null }>
  if (!plans.length) {
    return NextResponse.json({ total: 0, backfilled: 0, failed: 0 })
  }

  let backfilled = 0
  let failed = 0

  for (const plan of plans) {
    try {
      const planStart = plan.created_at.split('T')[0]
      const totalWeeks = plan.plan_weeks ?? 1
      const closureDate = addDaysUtc(planStart, totalWeeks * 7)

      const { data: workoutRows } = await supabase
        .from('workouts')
        .select('*')
        .eq('plan_id', plan.id)
      const workouts = (workoutRows ?? []) as Workout[]

      let activities: ICUActivity[] = []
      let wellness: ICUWellness[] = []
      if (client) {
        try {
          ;[activities, wellness] = await Promise.all([
            client.getActivities(planStart, closureDate),
            client.getWellness(planStart, closureDate),
          ])
        } catch { /* backfill proceeds using local workout data only */ }
      }

      const summary = buildArchiveSummary(workouts, activities, wellness, planStart, totalWeeks, closureDate)

      const { error } = await supabase
        .from('training_plans')
        .update({ closed_at: closureDate, archive_summary: summary })
        .eq('id', plan.id)
      if (error) throw new Error(error.message)
      backfilled++
    } catch {
      failed++
    }
  }

  return NextResponse.json({ total: plans.length, backfilled, failed })
}
