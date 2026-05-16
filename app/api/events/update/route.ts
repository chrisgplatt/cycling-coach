import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import type { TrainingEvent } from '@/types'

export async function PUT(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { original_name, original_date, name, date, type, priority } = await req.json()

  if (!original_name || !original_date) {
    return NextResponse.json({ error: 'original_name and original_date are required' }, { status: 400 })
  }
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

  const existing: TrainingEvent[] = profile.events ?? []
  const idx = existing.findIndex(e => e.name === original_name && e.date === original_date)
  if (idx === -1) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  }

  const old = existing[idx]
  let icu_event_id = old.icu_event_id
  let icu_error: string | undefined

  if (profile.intervals_icu_athlete_id && profile.intervals_icu_api_key) {
    const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    if (icu_event_id) {
      try {
        await client.updateTargetEvent(icu_event_id, { date, name: name.trim(), type, priority })
      } catch (err) {
        icu_error = err instanceof Error ? err.message : String(err)
        console.error('[events/update] intervals.icu update failed:', icu_error)
      }
    } else {
      // Event wasn't previously synced — create it now
      try {
        icu_event_id = await client.createTargetEvent({ date, name: name.trim(), type, priority })
      } catch (err) {
        icu_error = err instanceof Error ? err.message : String(err)
        console.error('[events/update] intervals.icu create failed:', icu_error)
      }
    }
  }

  const updated: TrainingEvent = {
    name: name.trim(),
    date,
    type,
    priority,
    ...(icu_event_id ? { icu_event_id } : {}),
  }

  const updatedEvents = [...existing]
  updatedEvents[idx] = updated

  const { error: saveError } = await supabase
    .from('user_profile')
    .update({ events: updatedEvents })
    .eq('id', profile.id)

  if (saveError) {
    return NextResponse.json({ error: 'Failed to save event' }, { status: 500 })
  }

  return NextResponse.json({
    event: updated,
    synced_to_icu: !!icu_event_id && !icu_error,
    ...(icu_error ? { icu_error } : {}),
  })
}
