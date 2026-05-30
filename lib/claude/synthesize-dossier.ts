import type { SupabaseClient } from '@supabase/supabase-js'
import type { TrainingEvent } from '@/types'
import { generateDossier } from './dossier'
import { formatActivityMetrics } from './activity-metrics'

export interface SynthesisProfile {
  user_id: string
  goals: string | null
  current_ftp: number | null
  weight_kg: number | null
  events: TrainingEvent[] | null
}

export async function synthesizeDossier(
  supabase: SupabaseClient,
  profile: SynthesisProfile,
): Promise<void> {
  const cutoff = new Date(Date.now() - 90 * 864e5)
  const ninetyDaysAgoDate = cutoff.toISOString().split('T')[0]
  const ninetyDaysAgoTs = cutoff.toISOString()

  const [
    { data: workouts, error: workoutsError },
    { data: feedbacks, error: feedbacksError },
    { data: chatMessages, error: chatError },
    { data: existing },
  ] =
    await Promise.all([
      supabase.from('workouts')
        .select('date, type, duration_minutes, tss, status, missed_reason, activity_metrics')
        .eq('user_id', profile.user_id)
        .in('status', ['completed', 'skipped'])
        .gte('date', ninetyDaysAgoDate)
        .order('date'),
      supabase.from('session_feedback')
        .select('created_at, feedback_text')
        .eq('user_id', profile.user_id)
        .gte('created_at', ninetyDaysAgoTs)
        .order('created_at'),
      supabase.from('chat_messages')
        .select('role, content')
        .eq('user_id', profile.user_id)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('athlete_dossier')
        .select('explicit_notes')
        .eq('user_id', profile.user_id)
        .maybeSingle(),
    ])

  const readError = workoutsError ?? feedbacksError ?? chatError
  if (readError) throw new Error(`synthesizeDossier read failed: ${readError.message}`)

  const eventResults = ((profile.events ?? []) as TrainingEvent[]).filter(e => e.icu_activity_id)

  const content = await generateDossier(
    profile.goals ?? '',
    profile.current_ftp ?? 200,
    profile.weight_kg ?? 70,
    'No inline fitness data — see workout history.',
    ((workouts ?? []) as Array<{
      date: string; type: string; duration_minutes: number
      tss: number | null; status: string; missed_reason: string | null
      activity_metrics: import('@/types').ActivityMetrics | null
    }>).map(w => ({
      date: w.date, type: w.type, duration_minutes: w.duration_minutes,
      tss: w.tss, status: w.status, missed_reason: w.missed_reason,
      metrics_summary: w.activity_metrics ? formatActivityMetrics(w.activity_metrics) : null,
    })),
    (feedbacks ?? []) as Array<{ created_at: string; feedback_text: string }>,
    eventResults,
    [...((chatMessages ?? []) as Array<{ role: string; content: string }>)].reverse(),
  )

  const explicitNotes = (existing?.explicit_notes ?? []) as Array<{ note: string; added_at: string }>

  const { error } = await supabase.from('athlete_dossier').upsert(
    {
      user_id: profile.user_id,
      synthesized_at: new Date().toISOString(),
      content,
      explicit_notes: explicitNotes,
    },
    { onConflict: 'user_id' },
  )
  if (error) throw new Error(`synthesizeDossier upsert failed: ${error.message}`)
}
