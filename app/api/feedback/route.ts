import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { analyseFeedback } from '@/lib/claude/feedback'
import { assessSession } from '@/lib/claude/session-note'
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
import type { Workout, ProposedAdjustment } from '@/types'

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const workoutId = searchParams.get('workoutId')

  // No workoutId → return the user's recent feedback as coaching-log entries.
  if (!workoutId) {
    const { toCoachingLogEntries } = await import('@/lib/plan/coaching-log')
    const { data: rows } = await supabase
      .from('session_feedback')
      .select('id, created_at, workout_id, feedback_text, proposed_adjustment, approved, rpe, feel')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(8)

    const feedbackRows = (rows ?? []) as import('@/lib/plan/coaching-log').FeedbackRow[]
    const ids = feedbackRows.map(r => r.workout_id).filter((v): v is string => !!v)
    const workouts = new Map<string, import('@/lib/plan/coaching-log').WorkoutRef>()
    if (ids.length) {
      const { data: ws } = await supabase
        .from('workouts')
        .select('id, date, type')
        .in('id', ids)
      for (const w of (ws ?? []) as Array<{ id: string; date: string; type: import('@/types').WorkoutType }>) {
        workouts.set(w.id, { date: w.date, type: w.type })
      }
    }
    return NextResponse.json({ entries: toCoachingLogEntries(feedbackRows, workouts) })
  }

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
  const { workoutId, activityId, feedbackText, activityTSS, activityAvgPower, activityAvgHR, adapt,
          rpe, feel, completion, tags, mood } = await req.json()

  const shouldAdapt = adapt !== false

  const { data: workout } = await supabase
    .from('workouts')
    .select('*')
    .eq('id', workoutId)
    .single()

  if (!workout) return NextResponse.json({ error: 'Workout not found' }, { status: 404 })

  const w = workout as Workout

  // Built once and shared: the coach note always wants it, and adaptation reuses it.
  const { formatRideExecution, formatRideShape, formatDistributions } = await import('@/lib/claude/activity-metrics')
  const rideExecution = [
    formatRideExecution(w.steps, w.activity_metrics),
    formatRideShape(w.activity_metrics?.shape ?? null),
    formatDistributions(w.activity_metrics?.distributions ?? null),
  ].filter(Boolean).join('\n\n')

  const signals = { rpe: rpe ?? null, feel: feel ?? null, completion: completion ?? null, tags: tags ?? null }

  // The coach's post-ride note runs on EVERY submit, independent of the adapt toggle —
  // best-effort, so a generation failure never blocks saving the feedback.
  const coachNotePromise = assessSession(w, feedbackText, { ...signals, mood: mood ?? null }, rideExecution)
    .catch(() => null)

  let proposed: ProposedAdjustment | null = null
  if (shouldAdapt) {
    const today = new Date().toISOString().split('T')[0]
    const next7 = new Date(Date.now() + 7 * 864e5).toISOString().split('T')[0]
    const [{ data: upcomingWorkouts }, { data: profileData }, dossier] = await Promise.all([
      supabase.from('workouts').select('*').eq('status', 'planned').gte('date', today).lte('date', next7).order('date'),
      supabase.from('user_profile').select('events').maybeSingle(),
      fetchDossier(supabase, user.id),
    ])
    const events = ((profileData as { events?: import('@/types').TrainingEvent[] } | null)?.events ?? [])

    proposed = await analyseFeedback(
      w,
      feedbackText,
      activityTSS ?? null,
      activityAvgPower ?? null,
      activityAvgHR ?? null,
      (upcomingWorkouts ?? []) as Workout[],
      events,
      formatDossier(dossier as AthleteDossier | null),
      rideExecution,
      signals,
    )
  }

  const coachNote = await coachNotePromise

  const { data: feedback } = await supabase
    .from('session_feedback')
    .insert({
      workout_id: workoutId,
      activity_id: activityId,
      feedback_text: feedbackText,
      activity_tss: activityTSS ?? null,
      activity_avg_power: activityAvgPower ?? null,
      activity_avg_hr: activityAvgHR ?? null,
      rpe: rpe ?? null,
      feel: feel ?? null,
      completion: completion ?? null,
      tags: tags ?? null,
      mood: mood ?? null,
      coach_note: coachNote,
      proposed_adjustment: proposed,
      approved: null,
      user_id: user.id,
    })
    .select()
    .single()

  // Push perceived effort + feel to the linked intervals.icu activity. Best-effort:
  // skipped for manual entries and silently ignored on any failure.
  if (activityId && activityId !== 'manual' && (rpe != null || feel != null)) {
    const { data: icuProfile } = await supabase
      .from('user_profile')
      .select('intervals_icu_athlete_id, intervals_icu_api_key')
      .maybeSingle()
    if (icuProfile?.intervals_icu_athlete_id && icuProfile?.intervals_icu_api_key) {
      await new IntervalsClient(icuProfile.intervals_icu_athlete_id, icuProfile.intervals_icu_api_key)
        .updateActivityFeel(activityId, { rpe: rpe ?? null, feel: feel ?? null })
        .catch(() => {})
    }
  }

  return NextResponse.json({ feedback, proposed })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { feedbackId, approved, coachNoteRating } = await req.json()

  // Rating path — record how useful the athlete found the coach's note. Distinct
  // from the adaptation approve/reject path below.
  if (coachNoteRating !== undefined) {
    if (coachNoteRating !== 'helpful' && coachNoteRating !== 'not_helpful' && coachNoteRating !== null) {
      return NextResponse.json({ error: 'Invalid rating' }, { status: 400 })
    }
    const { error } = await supabase
      .from('session_feedback')
      .update({ coach_note_rating: coachNoteRating })
      .eq('id', feedbackId)
      .eq('user_id', user.id)
    if (error) return NextResponse.json({ error: 'Failed to save rating' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

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
