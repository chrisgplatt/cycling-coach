import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'

export const dynamic = 'force-dynamic'

interface MonthlyBucket { month: number; km: number }

export interface YearStats {
  year: number
  totalRides: number
  totalKm: number
  totalElevationM: number
  totalMovingTimeSecs: number
  monthly: MonthlyBucket[]
}

export async function GET(req: NextRequest) {
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

  const currentYear = new Date().getFullYear()
  const yearParam = new URL(req.url).searchParams.get('year')
  const year = yearParam ? parseInt(yearParam, 10) : currentYear

  if (isNaN(year) || year < currentYear - 4 || year > currentYear) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
  }

  const start = `${year}-01-01`
  const end = year === currentYear
    ? new Date().toISOString().split('T')[0]
    : `${year}-12-31`

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  try {
    const activities = await client.getActivities(start, end)

    const monthly: MonthlyBucket[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, km: 0 }))
    let totalRides = 0
    let totalKm = 0
    let totalElevationM = 0
    let totalMovingTimeSecs = 0

    for (const a of activities) {
      totalRides++
      totalKm += (a.distance ?? 0) / 1000
      totalElevationM += a.total_elevation_gain ?? 0
      totalMovingTimeSecs += a.moving_time
      const month = parseInt(a.start_date_local.slice(5, 7), 10)
      monthly[month - 1].km += (a.distance ?? 0) / 1000
    }

    monthly.forEach(b => { b.km = Math.round(b.km * 10) / 10 })

    const stats: YearStats = {
      year,
      totalRides,
      totalKm: Math.round(totalKm * 10) / 10,
      totalElevationM: Math.round(totalElevationM),
      totalMovingTimeSecs,
      monthly,
    }

    return NextResponse.json(stats)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
