import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { resolveFallbackFtpForWorkout } from '@/lib/ftp/resolve-ftp'
import { enrichActivity } from '@/lib/intervals/enrich'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: workout } = await supabase
    .from('workouts')
    .select('plan_id, date, icu_activity_id, status')
    .eq('id', id)
    .maybeSingle()

  if (!workout) return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
  if (!workout.plan_id || !workout.icu_activity_id) {
    return NextResponse.json({ error: 'Workout is not matched to a ride' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  let activity
  try {
    activity = await client.getActivity(workout.icu_activity_id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Failed to fetch activity: ${msg}` }, { status: 502 })
  }

  const ftpAtCompletion = activity.ftp ?? await resolveFallbackFtpForWorkout(supabase, workout.date, null)

  const { data: inserted, error: insertError } = await supabase.from('workouts').insert({
    user_id: user.id,
    plan_id: null,
    date: workout.date,
    type: 'endurance',
    duration_minutes: Math.max(1, Math.round(activity.moving_time / 60)),
    description: activity.name,
    target_zones: '',
    status: 'completed',
    icu_activity_id: activity.id,
    tss: activity.training_load,
    steps: null,
    ftp_at_completion: ftpAtCompletion,
  }).select('id').single()
  if (insertError || !inserted) return NextResponse.json({ error: insertError?.message ?? 'Insert failed' }, { status: 500 })

  const { error: updateError } = await supabase
    .from('workouts')
    .update({ status: 'planned', icu_activity_id: null, tss: null, actual_duration_minutes: null, ftp_at_completion: null, activity_metrics: null })
    .eq('id', id)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  // Compute full ride stats (power curve, best efforts, stream-derived insights) right
  // away, rather than leaving the new standalone row waiting for the next sync's
  // backfill pass to fill in activity_metrics. Non-fatal: the row still has its basic
  // stats (tss/duration/ftp) even if this fails, and a later sync will retry it.
  try {
    const lthr = await client.getRideLthr().catch(() => null)
    const metrics = await enrichActivity(client, activity, ftpAtCompletion, lthr, null)
    await supabase.from('workouts').update({ activity_metrics: metrics }).eq('id', inserted.id)
  } catch (err) {
    console.error('[disassociate] activity-metrics enrichment failed:', err)
  }

  return NextResponse.json({ ok: true })
}
