import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { IntervalsClient } from '@/lib/intervals/client'

export async function POST() {
  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .single()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured in settings' }, { status: 400 })
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  try {
    const syncData = await client.sync(6)
    return NextResponse.json(syncData)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
