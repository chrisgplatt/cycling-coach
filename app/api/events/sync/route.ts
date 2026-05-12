import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { IntervalsClient } from '@/lib/intervals/client'
import type { TrainingEvent, ICUEvent } from '@/types'

export async function POST() {
  const { data: profile } = await supabase
    .from('user_profile')
    .select('id, intervals_icu_athlete_id, intervals_icu_api_key, events')
    .single()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  const today = new Date().toISOString().split('T')[0]
  const future = new Date(Date.now() + 18 * 30 * 864e5).toISOString().split('T')[0]

  let icuEvents: ICUEvent[]
  try {
    icuEvents = await client.getEvents(today, future)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch events'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const existing: TrainingEvent[] = profile.events ?? []
  const existingKeys = new Set(
    existing.map(e => `${e.name.trim().toLowerCase()}|${e.date}`)
  )

  const newEvents: TrainingEvent[] = icuEvents
    .filter(e => e.category === 'RACE')
    .filter(e => {
      const date = e.start_date_local.split('T')[0]
      return !existingKeys.has(`${e.name.trim().toLowerCase()}|${date}`)
    })
    .map(e => ({
      name: e.name.trim(),
      date: e.start_date_local.split('T')[0],
      type: 'race' as const,
      priority: 'B' as const,
    }))

  if (!newEvents.length) {
    return NextResponse.json({ added: 0, events: existing })
  }

  const merged = [...existing, ...newEvents]
  const { error: saveError } = await supabase
    .from('user_profile')
    .update({ events: merged })
    .eq('id', profile.id)

  if (saveError) {
    return NextResponse.json({ error: 'Failed to save events' }, { status: 500 })
  }

  return NextResponse.json({ added: newEvents.length, events: merged })
}
