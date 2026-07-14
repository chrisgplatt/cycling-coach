import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { plannedWorkoutId, unplannedWorkoutId } = body
  if (typeof plannedWorkoutId !== 'string' || typeof unplannedWorkoutId !== 'string') {
    return NextResponse.json({ error: 'plannedWorkoutId and unplannedWorkoutId are required' }, { status: 400 })
  }

  const { data: plannedWorkout } = await supabase
    .from('workouts')
    .select('plan_id, icu_activity_id, status, date')
    .eq('id', plannedWorkoutId)
    .maybeSingle()
  const { data: unplannedWorkout } = await supabase
    .from('workouts')
    .select('plan_id, icu_activity_id, tss, duration_minutes, ftp_at_completion, date')
    .eq('id', unplannedWorkoutId)
    .maybeSingle()

  if (!plannedWorkout || !unplannedWorkout) {
    return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
  }
  if (!plannedWorkout.plan_id || plannedWorkout.icu_activity_id || plannedWorkout.status !== 'planned') {
    return NextResponse.json({ error: 'plannedWorkoutId must be an unmatched planned workout' }, { status: 400 })
  }
  if (unplannedWorkout.plan_id || !unplannedWorkout.icu_activity_id) {
    return NextResponse.json({ error: 'unplannedWorkoutId must be an unplanned ride' }, { status: 400 })
  }
  if (plannedWorkout.date !== unplannedWorkout.date) {
    return NextResponse.json({ error: 'Workout and ride must be on the same date' }, { status: 400 })
  }

  const { error: updateError } = await supabase
    .from('workouts')
    .update({
      status: 'completed',
      icu_activity_id: unplannedWorkout.icu_activity_id,
      tss: unplannedWorkout.tss,
      actual_duration_minutes: unplannedWorkout.duration_minutes,
      ftp_at_completion: unplannedWorkout.ftp_at_completion,
    })
    .eq('id', plannedWorkoutId)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  const { error: deleteError } = await supabase.from('workouts').delete().eq('id', unplannedWorkoutId)
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
