import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { analyseFeedback } from '@/lib/claude/feedback'
import type { Workout, ProposedAdjustment } from '@/types'

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const workoutId = searchParams.get('workoutId')
  if (!workoutId) return NextResponse.json({ error: 'workoutId required' }, { status: 400 })

  const { data: feedback } = await supabase
    .from('session_feedback')
    .select('*')
    .eq('workout_id', workoutId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ feedback: feedback ?? null })
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { workoutId, activityId, feedbackText, activityTSS, activityAvgPower, activityAvgHR, adapt } = await req.json()

  const shouldAdapt = adapt !== false

  const { data: workout } = await supabase
    .from('workouts')
    .select('*')
    .eq('id', workoutId)
    .single()

  if (!workout) return NextResponse.json({ error: 'Workout not found' }, { status: 404 })

  let proposed: ProposedAdjustment | null = null
  if (shouldAdapt) {
    const today = new Date().toISOString().split('T')[0]
    const next7 = new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0]
    const { data: upcomingWorkouts } = await supabase
      .from('workouts')
      .select('*')
      .eq('status', 'planned')
      .gte('date', today)
      .lte('date', next7)
      .order('date')

    proposed = await analyseFeedback(
      workout as Workout,
      feedbackText,
      activityTSS ?? null,
      activityAvgPower ?? null,
      activityAvgHR ?? null,
      (upcomingWorkouts ?? []) as Workout[]
    )
  }

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
      user_id: user.id,
    })
    .select()
    .single()

  return NextResponse.json({ feedback, proposed })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  const adjustment = feedback.proposed_adjustment as import('@/types').ProposedAdjustment

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  const client = profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key
    ? new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    : null

  // Apply field changes grouped by workout_id
  const changedWorkoutIds = new Set(adjustment.changes.map(c => c.workout_id))
  for (const change of adjustment.changes) {
    await supabase
      .from('workouts')
      .update({ [change.field]: change.new_value })
      .eq('id', change.workout_id)
  }

  // Apply new steps and push fully structured event to intervals.icu
  const stepsMap = new Map(
    (adjustment.workout_steps ?? []).map(ws => [ws.workout_id, ws.steps])
  )

  for (const workoutId of changedWorkoutIds) {
    const newSteps = stepsMap.get(workoutId)

    // Persist steps to DB
    if (newSteps?.length) {
      await supabase
        .from('workouts')
        .update({ steps: newSteps })
        .eq('id', workoutId)
    }

    if (!client) continue

    const { data: w } = await supabase
      .from('workouts')
      .select('intervals_icu_event_id, type, duration_minutes, description, target_zones, steps')
      .eq('id', workoutId)
      .single()

    if (!w?.intervals_icu_event_id) continue

    const steps = (w.steps as import('@/types').WorkoutStep[] | null) ?? []
    const name = `${w.type.charAt(0).toUpperCase() + w.type.slice(1)} — ${w.duration_minutes}min`
    const description = `${w.description}\n\nTarget: ${w.target_zones}`

    await client.updateEventFull(w.intervals_icu_event_id, {
      name,
      description,
      duration_minutes: w.duration_minutes,
      steps,
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
