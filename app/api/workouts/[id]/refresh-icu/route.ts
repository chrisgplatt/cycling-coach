import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import type { WorkoutStep } from '@/types'

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
    .select('*')
    .eq('id', id)
    .single()

  if (!workout) return NextResponse.json({ error: 'Workout not found' }, { status: 404 })
  if (workout.status !== 'planned') {
    return NextResponse.json({ error: 'Only planned workouts can be refreshed' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  if (workout.intervals_icu_event_id) {
    try { await client.deleteEvent(workout.intervals_icu_event_id) } catch { /* already gone */ }
  }

  const name = `${workout.type.charAt(0).toUpperCase() + workout.type.slice(1)} — ${workout.duration_minutes}min`
  const description = `${workout.description}\n\nTarget: ${workout.target_zones}`
  const steps = (workout.steps as WorkoutStep[] | null) ?? []

  let newEventId: string
  try {
    newEventId = await client.createEvent({
      date: workout.date,
      name,
      description,
      duration_minutes: workout.duration_minutes,
      steps: steps.length ? steps : undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Failed to create event: ${msg}` }, { status: 502 })
  }

  await supabase
    .from('workouts')
    .update({ intervals_icu_event_id: newEventId })
    .eq('id', id)

  return NextResponse.json({ ok: true, intervals_icu_event_id: newEventId })
}
