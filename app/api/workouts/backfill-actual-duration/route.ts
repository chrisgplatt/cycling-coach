import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'

// Admin-only one-off: fill actual_duration_minutes for already-completed workouts
// that were matched to an activity before the column existed.
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('is_admin, intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!profile.intervals_icu_athlete_id || !profile.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured in settings' }, { status: 400 })
  }

  const { data: missing } = await supabase
    .from('workouts')
    .select('id, date, icu_activity_id')
    .in('status', ['completed', 'needs_review'])
    .not('icu_activity_id', 'is', null)
    .is('actual_duration_minutes', null)

  const workouts = missing ?? []
  if (!workouts.length) {
    return NextResponse.json({ total: 0, updated: 0, failed: 0 })
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  const oldest = workouts.reduce((min, w) => w.date < min ? w.date : min, workouts[0].date)
  const newest = workouts.reduce((max, w) => w.date > max ? w.date : max, workouts[0].date)
  const activities = await client.getActivities(oldest, newest)
  const movingTimeById = new Map(activities.map(a => [a.id, a.moving_time]))

  let updated = 0, failed = 0
  for (const w of workouts) {
    const movingTime = movingTimeById.get(w.icu_activity_id as string)
    if (movingTime == null) { failed++; continue }
    const { error } = await supabase
      .from('workouts')
      .update({ actual_duration_minutes: Math.round(movingTime / 60) })
      .eq('id', w.id)
    if (error) failed++; else updated++
  }

  return NextResponse.json({ total: workouts.length, updated, failed })
}
