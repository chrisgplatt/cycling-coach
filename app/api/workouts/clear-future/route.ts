import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]
  const { data: futureWorkouts, error } = await supabase
    .from('workouts')
    .select('id, intervals_icu_event_id, date')
    .eq('status', 'planned')
    .gte('date', today)

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

  const ids = (futureWorkouts ?? []).map(w => w.id)
  if (ids.length > 0) {
    await supabase.from('workouts').delete().in('id', ids)
  }

  return NextResponse.json({ deleted, failed })
}
