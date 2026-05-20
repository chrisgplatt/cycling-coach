import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { findNearestPower, computeLeftRightBalance, groupCrossTraining } from '@/lib/stats-helpers'
import type { ICUPowerCurvePoint, RidingStats } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 })

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const today = new Date()
  const oldest = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const newest = today.toISOString().split('T')[0]

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  try {
    const [activities, powerCurve] = await Promise.all([
      client.getActivities(oldest, newest),
      client.getPowerCurve(oldest, newest).catch((): ICUPowerCurvePoint[] => []),
    ])

    const rides = activities.filter(a => /ride/i.test(a.type))

    const sortedRides = [...rides].sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))

    // Enrich the 2 most recent rides with per-ride best power
    const recentTwo = sortedRides.slice(0, 2)
    await Promise.all(recentTwo.map(async ride => {
      try {
        const curve = await client.getActivityPowerCurve(ride.id)
        ride.power_5min = findNearestPower(curve, 300)
        ride.power_10min = findNearestPower(curve, 600)
        ride.power_20min = findNearestPower(curve, 1200)
      } catch {
        ride.power_5min = null
        ride.power_10min = null
        ride.power_20min = null
      }
    }))

    const stats: RidingStats = {
      ride_count: rides.length,
      total_distance_km: rides.reduce((sum, r) => sum + (r.distance ?? 0), 0) / 1000,
      total_elevation_m: rides.reduce((sum, r) => sum + (r.total_elevation_gain ?? 0), 0),
      total_duration_secs: rides.reduce((sum, r) => sum + r.moving_time, 0),
      power_5min: findNearestPower(powerCurve, 300),
      power_10min: findNearestPower(powerCurve, 600),
      power_20min: findNearestPower(powerCurve, 1200),
      avg_left_right_balance: computeLeftRightBalance(rides),
      balance_ride_count: rides.filter(r => r.left_right_balance !== null).length,
      recent_rides: sortedRides.slice(0, 2),
      cross_training: groupCrossTraining(activities),
    }

    return NextResponse.json({ stats })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
