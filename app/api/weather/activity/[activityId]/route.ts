import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { fetchActivityWeather } from '@/lib/weather/activity-weather'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ activityId: string }> },
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activityId } = await params

  // Cache hit — return instantly
  const { data: cached } = await supabase
    .from('activity_weather')
    .select('activity_id,temp_min_c,temp_max_c,precip_mm,wind_avg_kph,wind_dir_deg,headwind_pct,tailwind_pct,crosswind_pct,air_speed_kph,weather_impact_pct')
    .eq('activity_id', activityId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (cached) return NextResponse.json(cached)

  // Cache miss — compute
  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json(null)
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  try {
    const result = await fetchActivityWeather(activityId, user.id, client, supabase)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[weather/activity] compute failed:', err)
    return NextResponse.json(null)
  }
}
