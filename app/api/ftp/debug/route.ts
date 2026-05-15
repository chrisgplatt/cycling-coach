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
      id: a.id,
      name: a.name,
      date: a.start_date_local,
      moving_time_secs: a.moving_time,
      moving_time_mins: a.moving_time ? Math.round(a.moving_time / 60) : null,
      weighted_average_watts: a.weighted_average_watts,
      average_watts: a.average_watts,
      training_load: a.training_load,
      raw_keys: Object.keys(a),
    })),
    power_summary: {
      rides_with_np: rides.filter(a => a.weighted_average_watts != null).length,
      rides_with_moving_time: rides.filter(a => a.moving_time != null).length,
      max_np: rides.reduce((max, a) => Math.max(max, a.weighted_average_watts ?? 0), 0),
      duration_range_mins: rides.length ? {
        min: Math.round(Math.min(...rides.filter(a => a.moving_time).map(a => a.moving_time! / 60))),
        max: Math.round(Math.max(...rides.filter(a => a.moving_time).map(a => a.moving_time! / 60))),
      } : null,
    },
  })
}
