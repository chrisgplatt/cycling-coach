import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { fetchHrvStatusBestSource } from '@/lib/hrv/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, garmin_email')
    .maybeSingle()

  const today = new Date().toISOString().split('T')[0]
  const garminParams = profile?.garmin_email ? { supabase, userId: user.id } : null
  const icuClient = profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key
    ? new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    : null

  if (!garminParams && !icuClient) {
    return NextResponse.json({ error: 'No HRV source configured' }, { status: 400 })
  }

  try {
    const status = await fetchHrvStatusBestSource(today, garminParams, icuClient)
    return NextResponse.json({ status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
