import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { IntervalsClient } from '@/lib/intervals/client'
import type { TrainingEvent } from '@/types'

export async function POST(req: Request) {
  const { name, date } = await req.json() as { name: string; date: string }

  if (!name || !date) {
    return NextResponse.json({ error: 'name and date are required' }, { status: 400 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('id, intervals_icu_athlete_id, intervals_icu_api_key, events')
    .maybeSingle()

  if (profileError) {
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 })
  }

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const existing: TrainingEvent[] = profile.events ?? []
  const target = existing.find(
    e => e.name.trim().toLowerCase() === name.trim().toLowerCase() && e.date === date
  )

  if (!target) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  }

  const updated = existing.filter(e => !(e.name.trim().toLowerCase() === name.trim().toLowerCase() && e.date === date))

  const { error: saveError } = await supabase
    .from('user_profile')
    .update({ events: updated })
    .eq('id', profile.id)

  if (saveError) {
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }

  if (target.icu_event_id && profile.intervals_icu_athlete_id && profile.intervals_icu_api_key) {
    try {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      await client.deleteEvent(target.icu_event_id)
    } catch {
      return NextResponse.json({ deleted: true, icu_delete_failed: true })
    }
  }

  return NextResponse.json({ deleted: true })
}
