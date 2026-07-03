import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'

export const dynamic = 'force-dynamic'

interface MonthlyBucket { month: number; km: number; count: number }

export interface ActivityGroupStats {
  key: string
  label: string
  emoji: string
  chartMetric: 'km' | 'count'
  totalActivities: number
  totalKm: number
  totalElevationM: number
  totalMovingTimeSecs: number
  monthly: MonthlyBucket[]
}

export interface YearStats {
  year: number
  groups: ActivityGroupStats[]
}

type GroupKey = 'ride' | 'run' | 'walk' | 'other'

const GROUP_META: Record<GroupKey, { label: string; emoji: string; chartMetric: 'km' | 'count' }> = {
  ride:  { label: 'Rides',    emoji: '🚴', chartMetric: 'km'    },
  run:   { label: 'Runs',     emoji: '🏃', chartMetric: 'km'    },
  walk:  { label: 'Walks',    emoji: '🚶', chartMetric: 'km'    },
  other: { label: 'Other',    emoji: '🏋️', chartMetric: 'count' },
}

const GROUP_ORDER: GroupKey[] = ['ride', 'walk', 'run', 'other']

function classifyActivity(type: string): GroupKey {
  if (/ride|cycl|bike/i.test(type)) return 'ride'
  if (/run/i.test(type))            return 'run'
  if (/walk|hike/i.test(type))      return 'walk'
  return 'other'
}

function makeMonthly(): MonthlyBucket[] {
  return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, km: 0, count: 0 }))
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

    type Accumulator = {
      totalActivities: number
      totalKm: number
      totalElevationM: number
      totalMovingTimeSecs: number
      monthly: MonthlyBucket[]
    }

    const acc: Record<GroupKey, Accumulator> = {
      ride:  { totalActivities: 0, totalKm: 0, totalElevationM: 0, totalMovingTimeSecs: 0, monthly: makeMonthly() },
      run:   { totalActivities: 0, totalKm: 0, totalElevationM: 0, totalMovingTimeSecs: 0, monthly: makeMonthly() },
      walk:  { totalActivities: 0, totalKm: 0, totalElevationM: 0, totalMovingTimeSecs: 0, monthly: makeMonthly() },
      other: { totalActivities: 0, totalKm: 0, totalElevationM: 0, totalMovingTimeSecs: 0, monthly: makeMonthly() },
    }

    for (const a of activities) {
      const key = classifyActivity(a.type)
      const g = acc[key]
      g.totalActivities++
      g.totalKm += (a.distance ?? 0) / 1000
      g.totalElevationM += a.total_elevation_gain ?? 0
      g.totalMovingTimeSecs += a.moving_time ?? 0
      const month = parseInt(a.start_date_local.slice(5, 7), 10)
      g.monthly[month - 1].km += (a.distance ?? 0) / 1000
      g.monthly[month - 1].count++
    }

    for (const g of Object.values(acc)) {
      g.monthly.forEach(b => { b.km = Math.round(b.km * 10) / 10 })
      g.totalKm = Math.round(g.totalKm * 10) / 10
      g.totalElevationM = Math.round(g.totalElevationM)
    }

    const groups: ActivityGroupStats[] = GROUP_ORDER
      .filter(key => acc[key].totalActivities > 0)
      .map(key => ({ key, ...GROUP_META[key], ...acc[key] }))

    return NextResponse.json({ year, groups } as YearStats)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
