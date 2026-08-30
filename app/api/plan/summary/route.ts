import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { buildWeekBuckets } from '@/lib/plan/progress'
import { buildTrainingSummary } from '@/lib/plan/summary'
import { addDaysUtc } from '@/lib/plan/forecast'
import type { Workout, ICUActivity, ICUWellness, PlanArchiveSummary } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const monthsParam = new URL(req.url).searchParams.get('months')
  const windowMonths: 6 | 12 = monthsParam === '6' ? 6 : 12
  const today = new Date().toISOString().split('T')[0]
  const windowStart = addDaysUtc(today, -windowMonths * 30)

  const [
    { data: archivedPlans, error: archivedPlansError },
    { data: activePlanRow, error: activePlanError },
    { data: profile },
    { data: predictions },
  ] = await Promise.all([
    supabase.from('training_plans').select('archive_summary').eq('user_id', user.id).eq('status', 'archived'),
    supabase.from('training_plans').select('id, created_at, plan_weeks, workouts(*)').eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('user_profile').select('current_ftp, intervals_icu_athlete_id, intervals_icu_api_key').maybeSingle(),
    supabase.from('ftp_predictions').select('predicted_ftp, created_at').eq('confirmed', true),
  ])

  if (archivedPlansError || activePlanError) {
    return NextResponse.json({ error: 'Failed to load training summary' }, { status: 500 })
  }

  const archivedPlanWeeks = (archivedPlans ?? [])
    .map(p => p.archive_summary as PlanArchiveSummary | null)
    .filter((s): s is PlanArchiveSummary => s != null)
    .flatMap(s => s.weeks.filter(w => w.weekStart <= s.closedAt))

  const planStart = activePlanRow ? (activePlanRow.created_at as string).split('T')[0] : null
  const hasIcu = !!profile?.intervals_icu_athlete_id && !!profile?.intervals_icu_api_key

  let wellness: ICUWellness[] = []
  let activities: ICUActivity[] = []

  if (hasIcu) {
    const client = new IntervalsClient(profile!.intervals_icu_athlete_id as string, profile!.intervals_icu_api_key as string)
    // Activities only ever affect weeks that survive the window clip inside buildTrainingSummary,
    // so this range is sufficient for the plan-week buckets too — no need to widen it to planStart
    // separately for that purpose. Fetched unconditionally (not just when a plan is active) since
    // weeksActive tracks ride activity independent of any plan.
    const wellnessFrom = planStart && planStart < windowStart ? planStart : windowStart
    try {
      ;[wellness, activities] = await Promise.all([
        client.getWellness(wellnessFrom, today),
        client.getActivities(wellnessFrom, today),
      ])
    } catch {
      // intervals.icu unreachable — CTL fields fall back to null, active-plan hours fall
      // back to zero (no activities to sum); everything else is unaffected.
      wellness = []
      activities = []
    }
  }

  const activePlan = activePlanRow && planStart
    ? {
        planStart,
        buckets: buildWeekBuckets(
          (activePlanRow.workouts ?? []) as Workout[],
          activities,
          planStart,
          (activePlanRow.plan_weeks as number | null) ?? 1,
        ),
      }
    : null

  const summary = buildTrainingSummary({
    windowMonths,
    today,
    archivedPlanWeeks,
    activePlan,
    wellness,
    confirmedPredictions: (predictions ?? []) as Array<{ predicted_ftp: number; created_at: string }>,
    currentFtp: (profile?.current_ftp as number | null) ?? null,
    activities,
  })

  return NextResponse.json(summary)
}
