import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { estimateEventTss } from '@/lib/events'
import type { TrainingEvent } from '@/types'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, date, end_date, type, priority, race_type, start_time, rpe, duration_minutes, distance_km, continue_training } = await req.json() as TrainingEvent

  if (!name?.trim() || !date) {
    return NextResponse.json({ error: 'name and date are required' }, { status: 400 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('id, intervals_icu_athlete_id, intervals_icu_api_key, events')
    .maybeSingle()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  let icu_event_id: string | undefined
  let icu_error: string | undefined
  if (profile.intervals_icu_athlete_id && profile.intervals_icu_api_key) {
    try {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      icu_event_id = await client.createTargetEvent({
        date, end_date, name: name.trim(), type, priority,
        race_type, start_time, rpe, duration_minutes, distance_km,
      })
    } catch (err) {
      icu_error = err instanceof Error ? err.message : String(err)
      console.error('[events/create] intervals.icu push failed:', icu_error)
    }
  }

  const newEvent: TrainingEvent = {
    name: name.trim(),
    date,
    type,
    priority,
    ...(end_date && end_date !== date ? { end_date } : {}),
    ...(type === 'holiday' && continue_training ? { continue_training } : {}),
    ...(icu_event_id ? { icu_event_id } : {}),
    ...(type === 'race' && race_type ? { race_type } : {}),
    ...(start_time ? { start_time } : {}),
    ...(rpe ? { rpe } : {}),
    ...(duration_minutes ? { duration_minutes } : {}),
    ...(distance_km ? { distance_km } : {}),
  }
  const est = estimateEventTss({ duration_minutes, rpe })
  if (est !== null) newEvent.estimated_tss = est

  const existing: TrainingEvent[] = profile.events ?? []
  const { error: saveError } = await supabase
    .from('user_profile')
    .update({ events: [...existing, newEvent] })
    .eq('id', profile.id)

  if (saveError) {
    return NextResponse.json({ error: 'Failed to save event' }, { status: 500 })
  }

  return NextResponse.json({
    event: newEvent,
    synced_to_icu: !!icu_event_id,
    ...(icu_error ? { icu_error } : {}),
  })
}
