import type { SupabaseClient } from '@supabase/supabase-js'
import { computeProgressMetrics } from './metrics'
import { generateProgressBrief } from '@/lib/claude/progress-brief'
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
): Promise<void> {
  // Check debounce
  const { data: existing } = await supabase
    .from('progress_briefs')
    .select('generated_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing?.generated_at) {
    const hoursSince = (Date.now() - new Date(existing.generated_at).getTime()) / 3600000
    if (hoursSince < DEBOUNCE_HOURS) return
  }

  // Fetch plan and weight log
  const [{ data: plan }, { data: rawWeightLog }] = await Promise.all([
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
  if (plan) {
    const { data: workouts } = await supabase
      .from('workouts')
      .select('status, date')
      .eq('plan_id', plan.id)
    planWorkouts = (workouts ?? []) as Array<{ status: WorkoutStatus; date: string }>
  }

  const metrics = computeProgressMetrics(
    syncData.wellness,
    profile.current_ftp,
    profile.weight_kg,
    plan ?? null,
    weightLog,
    planWorkouts,
    syncData.activities,
    profile.min_sessions_per_week,
  )

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
