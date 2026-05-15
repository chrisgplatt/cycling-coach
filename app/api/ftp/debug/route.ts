import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profileData } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profileData?.intervals_icu_athlete_id || !profileData?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const client = new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)
  const newest = new Date().toISOString().split('T')[0]
  const oldest = new Date(Date.now() - 91 * 86400000).toISOString().split('T')[0]

  const activities = await client.getActivities(oldest, newest)
  const rides = activities.filter(a => a.type === 'Ride')

  return NextResponse.json({
    total_activities: activities.length,
    total_rides: rides.length,
    sample: rides.slice(0, 5).map(a => ({
      name: a.name,
      date: a.start_date_local,
      moving_time_mins: a.moving_time ? Math.round(a.moving_time / 60) : null,
      weighted_average_watts: a.weighted_average_watts,
      training_load: a.training_load,
      rolling_ftp: a.rolling_ftp,
    })),
    power_summary: {
      rides_with_np: rides.filter(a => a.weighted_average_watts != null).length,
      rides_with_rolling_ftp: rides.filter(a => a.rolling_ftp != null).length,
      max_np: rides.reduce((max, a) => Math.max(max, a.weighted_average_watts ?? 0), 0),
      latest_rolling_ftp: rides
        .filter(a => a.rolling_ftp != null)
        .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))[0]?.rolling_ftp ?? null,
    },
  })
}
