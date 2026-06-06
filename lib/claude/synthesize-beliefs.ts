import type { SupabaseClient } from '@supabase/supabase-js'
import type { AthleteBelief, WorkoutType, FeedbackCompletion } from '@/types'
import { weeklyTssSeries, rpeSessionsFromFeedback, recoverySessions } from '@/lib/athlete-model/assemble'
import { buildGroundedBeliefs } from '@/lib/athlete-model/build-beliefs'
import { reconcileBeliefs } from '@/lib/athlete-model/reconcile'

type WorkoutRow = { id: string; date: string; type: WorkoutType; tss: number | null; status: string }
type FeedbackRow = { workout_id: string | null; rpe: number | null; feel: number | null; completion: FeedbackCompletion | null; coach_note_rating: 'helpful' | 'not_helpful' | null }

// Build/refresh the athlete's grounded beliefs from the last 120 days of training.
// `now` is injected for deterministic timestamps. Pure pipeline + a single upsert.
export async function synthesizeBeliefs(
  supabase: SupabaseClient,
  userId: string,
  now: string,
): Promise<void> {
  const since = new Date(new Date(now).getTime() - 120 * 864e5).toISOString().slice(0, 10)

  const [
    { data: workoutData, error: workoutError },
    { data: feedbackData, error: feedbackError },
    { data: beliefData, error: beliefError },
  ] = await Promise.all([
    supabase.from('workouts').select('id, date, type, tss, status')
      .eq('user_id', userId).gte('date', since).order('date'),
    supabase.from('session_feedback').select('workout_id, rpe, feel, completion, coach_note_rating, created_at')
      .eq('user_id', userId).gte('created_at', since),
    supabase.from('athlete_beliefs').select('*').eq('user_id', userId),
  ])

  const readError = workoutError ?? feedbackError ?? beliefError
  if (readError) throw new Error(`synthesizeBeliefs read failed: ${readError.message}`)

  const workouts = (workoutData ?? []) as WorkoutRow[]
  const feedback = (feedbackData ?? []) as FeedbackRow[]
  const existing = (beliefData ?? []) as AthleteBelief[]

  const workoutById = new Map(workouts.map(w => [w.id, w]))
  // feedback rows with no workout_id can't be linked to a session's intensity/recovery
  const fbByWorkout = new Map(feedback.filter(f => f.workout_id).map(f => [f.workout_id as string, f]))

  const candidates = buildGroundedBeliefs({
    weeklyTss: weeklyTssSeries(workouts.map(w => ({ date: w.date, tss: w.tss }))),
    rpeSessions: rpeSessionsFromFeedback(
      feedback.map(f => ({ rpe: f.rpe, type: (f.workout_id ? workoutById.get(f.workout_id)?.type : null) ?? null })),
    ),
    recovery: recoverySessions(
      workouts.map(w => {
        const f = fbByWorkout.get(w.id)
        return { date: w.date, type: w.type, status: w.status, completion: f?.completion ?? null, feel: f?.feel ?? null }
      }),
    ),
    coachingRatings: feedback
      .map(f => f.coach_note_rating)
      .filter((r): r is 'helpful' | 'not_helpful' => r === 'helpful' || r === 'not_helpful'),
  })

  const upserts = reconcileBeliefs(existing, candidates, now)
  if (!upserts.length) return

  const { error } = await supabase
    .from('athlete_beliefs')
    .upsert(upserts.map(r => ({ ...r, user_id: userId })), { onConflict: 'user_id,key' })
  if (error) throw new Error(`synthesizeBeliefs upsert failed: ${error.message}`)
}
