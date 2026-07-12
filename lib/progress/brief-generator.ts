import type { SupabaseClient } from '@supabase/supabase-js'
import { computeProgressMetrics } from './metrics'
import { generateProgressBrief } from '@/lib/claude/progress-brief'
import type { IntervalsClient } from '@/lib/intervals/client'
import type { ICUSyncData, WeightEntry, WorkoutStatus } from '@/types'

const DEBOUNCE_HOURS = 4

interface BriefProfile {
  current_ftp: number
  weight_kg: number
  goals: string
  min_sessions_per_week: number
}

export async function maybeGenerateProgressBrief(
  supabase: SupabaseClient,
  userId: string,
  syncData: ICUSyncData,
  profile: BriefProfile,
  client: IntervalsClient,
): Promise<void> {
  const [{ data: existing }, { data: plan }, { data: rawWeightLog }] = await Promise.all([
    supabase
      .from('progress_briefs')
      .select('generated_at')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('training_plans')
      .select('id, created_at, baseline_ftp, phase, target_event_name, target_event_date')
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('weight_log')
      .select('id, date, weight_kg')
      .eq('user_id', userId)
      .order('date', { ascending: false }),
  ])

  const weightLog: WeightEntry[] = (rawWeightLog ?? []) as WeightEntry[]

  let planWorkouts: Array<{ status: WorkoutStatus; date: string }> = []
  // syncData.activities is always just the trailing 6-week sync window, which
  // undercounts "rides since start" once a plan has run longer than that — so
  // whenever a plan is active, fetch its full actual duration directly instead.
  let ridesActivities = syncData.activities
  if (plan) {
    const { data: workouts } = await supabase
      .from('workouts')
      .select('status, date')
      .eq('plan_id', plan.id)
    planWorkouts = (workouts ?? []) as Array<{ status: WorkoutStatus; date: string }>

    const planStartDate = plan.created_at.split('T')[0]
    const todayStr = new Date().toISOString().split('T')[0]
    ridesActivities = await client.getActivities(planStartDate, todayStr)
  }

  const metrics = computeProgressMetrics(
    syncData.wellness,
    profile.current_ftp,
    profile.weight_kg,
    plan ?? null,
    weightLog,
    planWorkouts,
    ridesActivities,
    profile.min_sessions_per_week,
  )

  // Numeric stats are cheap (no Claude call) and safe to refresh on every
  // sync, so tiles like "Rides" never sit stale behind the debounce below —
  // which exists only to limit Claude calls for the written text. Only
  // update here once a brief row already exists: the very first brief for a
  // new user is created further down, together with its AI text, so the
  // `content` column's NOT NULL constraint is always satisfied on insert.
  if (existing) {
    await supabase
      .from('progress_briefs')
      .upsert({ user_id: userId, metrics_snapshot: metrics }, { onConflict: 'user_id' })
  }

  if (existing?.generated_at) {
    const hoursSince = (Date.now() - new Date(existing.generated_at).getTime()) / 3600000
    if (hoursSince < DEBOUNCE_HOURS) return
  }

  const content = await generateProgressBrief({ metrics, goals: profile.goals ?? '' })
  if (!content) return

  await supabase
    .from('progress_briefs')
    .upsert(
      {
        user_id: userId,
        content,
        metrics_snapshot: metrics,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
}
