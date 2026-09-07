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
    { data: coachMessages, error: coachMessagesError },
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
        .select('created_at, feedback_text, rpe, feel, completion, tags')
        .eq('user_id', profile.user_id)
        .gte('created_at', ninetyDaysAgoTs)
        .order('created_at'),
      supabase.from('coach_messages')
        .select('role, content, surface, created_at')
        .eq('user_id', profile.user_id)
        .gte('created_at', ninetyDaysAgoTs)
        .order('created_at', { ascending: true })
        .limit(200),
      supabase.from('athlete_dossier')
        .select('explicit_notes, synthesized_at')
        .eq('user_id', profile.user_id)
        .maybeSingle(),
    ])

  const readError = workoutsError ?? feedbacksError ?? coachMessagesError
  if (readError) throw new Error(`synthesizeDossier read failed: ${readError.message}`)

  // Re-synthesizing costs a full Opus 5 call over 90 days of history, so skip nights where
  // nothing new has happened since the last dossier — a 7-day staleness backstop still
  // forces a refresh even if none of these signals ever fire (e.g. a status edited long
  // after the fact, which `workouts` has no updated_at column to detect).
  const lastSynth = (existing as { synthesized_at?: string } | null)?.synthesized_at
  if (lastSynth) {
    const lastSynthDate = lastSynth.split('T')[0]
    const daysSinceSynth = (Date.now() - new Date(lastSynth).getTime()) / 864e5
    const hasNewWorkout = ((workouts ?? []) as Array<{ date: string }>).some(w => w.date > lastSynthDate)
    const hasNewFeedback = ((feedbacks ?? []) as Array<{ created_at: string }>).some(f => f.created_at > lastSynth)
    const hasNewMessage = ((coachMessages ?? []) as Array<{ created_at: string }>).some(m => m.created_at > lastSynth)
    if (!hasNewWorkout && !hasNewFeedback && !hasNewMessage && daysSinceSynth < 7) return
  }

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
    (feedbacks ?? []) as import('./dossier').DossierFeedback[],
    eventResults,
    (coachMessages ?? []) as Array<{ role: string; content: string }>,
    [],
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
