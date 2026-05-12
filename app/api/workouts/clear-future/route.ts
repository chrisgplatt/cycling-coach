import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { IntervalsClient } from '@/lib/intervals/client'

export async function POST() {
  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .single()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]
  const { data: futureWorkouts, error } = await supabase
    .from('workouts')
    .select('id, intervals_icu_event_id, date')
    .gte('date', today)
    .not('intervals_icu_event_id', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  let deleted = 0
  let failed = 0

  for (const w of futureWorkouts ?? []) {
    if (!w.intervals_icu_event_id) continue
    try {
      await client.deleteEvent(w.intervals_icu_event_id)
      deleted++
    } catch {
      failed++
    }
  }

  return NextResponse.json({ deleted, failed })
}
