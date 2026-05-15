import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { analyseFeedback } from '@/lib/claude/feedback'
import type { Workout } from '@/types'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { workoutId, activityId, feedbackText, activityTSS, activityAvgPower, activityAvgHR } = await req.json()

  const { data: workout } = await supabase
    .from('workouts')
    .select('*')
    .eq('id', workoutId)
    .single()

  if (!workout) return NextResponse.json({ error: 'Workout not found' }, { status: 404 })

  const today = new Date().toISOString().split('T')[0]
  const next7 = new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0]
  const { data: upcomingWorkouts } = await supabase
    .from('workouts')
    .select('*')
    .eq('status', 'planned')
    .gte('date', today)
    .lte('date', next7)
    .order('date')

  const proposed = await analyseFeedback(
    workout as Workout,
    feedbackText,
    activityTSS ?? null,
    activityAvgPower ?? null,
    activityAvgHR ?? null,
    (upcomingWorkouts ?? []) as Workout[]
  )

  const { data: feedback } = await supabase
    .from('session_feedback')
    .insert({
      workout_id: workoutId,
      activity_id: activityId,
      feedback_text: feedbackText,
      activity_tss: activityTSS ?? null,
      activity_avg_power: activityAvgPower ?? null,
      activity_avg_hr: activityAvgHR ?? null,
      proposed_adjustment: proposed,
      approved: null,
      user_id: user!.id,
    })
    .select()
    .single()

  return NextResponse.json({ feedback, proposed })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { feedbackId, approved } = await req.json()

  const { data: feedback } = await supabase
    .from('session_feedback')
    .update({ approved })
    .eq('id', feedbackId)
    .select()
    .single()

  if (!approved || !feedback?.proposed_adjustment) {
    return NextResponse.json({ ok: true })
  }

  const adjustment = feedback.proposed_adjustment as { changes: Array<{ workout_id: string; field: string; new_value: string | number }> }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  const client = profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key
    ? new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    : null

  for (const change of adjustment.changes) {
    await supabase
      .from('workouts')
      .update({ [change.field]: change.new_value })
      .eq('id', change.workout_id)

    if (client && (change.field === 'duration_minutes' || change.field === 'description')) {
      const { data: w } = await supabase
        .from('workouts')
        .select('intervals_icu_event_id, description, duration_minutes')
        .eq('id', change.workout_id)
        .single()

      if (w?.intervals_icu_event_id) {
        await client.updateEvent(w.intervals_icu_event_id, {
          description: w.description,
          duration_minutes: w.duration_minutes,
        }).catch(() => {})
      }
    }
  }

  return NextResponse.json({ ok: true })
}
