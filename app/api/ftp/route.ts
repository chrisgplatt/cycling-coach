import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { predictFTP } from '@/lib/claude/ftp'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('ftp_predictions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { currentFTP } = await req.json()

  const { data: profileData } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp')
    .maybeSingle()

  if (!profileData?.intervals_icu_athlete_id || !profileData?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const client = new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)

  const newest = new Date().toISOString().split('T')[0]
  const oldest = new Date(Date.now() - 91 * 86400000).toISOString().split('T')[0]

  try {
    const activities = await client.getActivities(oldest, newest)

    const rides = activities.filter(a => a.type === 'Ride')

    // Best NP by duration bucket (for Claude's context)
    const bestNP = (minSecs: number, maxSecs = Infinity) => {
      const best = rides
        .filter(a => a.weighted_average_watts != null && a.moving_time != null &&
                     a.moving_time >= minSecs && a.moving_time < maxSecs)
        .reduce((max, a) => Math.max(max, a.weighted_average_watts!), 0)
      return best > 0 ? best : null
    }
    const mins5  = bestNP(180, 900)
    const mins20 = bestNP(900, 3600)
    const mins60 = bestNP(3600)

    // intervals.icu's own rolling FTP is the best algorithmic estimate available.
    // Fall back to NP-derived estimate if not present.
    const latestRollingFTP = rides
      .filter(a => a.rolling_ftp != null)
      .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))[0]?.rolling_ftp ?? null
    const bestAnyNP = rides
      .filter(a => a.weighted_average_watts != null)
      .reduce((max, a) => Math.max(max, a.weighted_average_watts!), 0) || null
    const algorithmicEstimate =
      latestRollingFTP !== null ? latestRollingFTP :
      mins20 !== null ? Math.round(mins20 * 0.95) :
      mins60 !== null ? Math.round(mins60 * 0.97) :
      bestAnyNP !== null ? Math.round(bestAnyNP * 0.90) : null

    const buckets = new Map<string, { rideCount: number; peakNP: number; totalTSS: number }>()
    for (const act of activities.filter(a => a.type === 'Ride')) {
      const month = act.start_date_local.slice(0, 7)
      const existing = buckets.get(month) ?? { rideCount: 0, peakNP: 0, totalTSS: 0 }
      buckets.set(month, {
        rideCount: existing.rideCount + 1,
        peakNP: Math.max(existing.peakNP, act.weighted_average_watts ?? 0),
        totalTSS: existing.totalTSS + (act.training_load ?? 0),
      })
    }
    const monthlyTrend = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }))

    const resolvedFTP = currentFTP ?? profileData.current_ftp ?? 200

    const result = await predictFTP({
      powerCurve: { mins5, mins20, mins60 },
      algorithmicEstimate,
      monthlyTrend,
      currentFTP: resolvedFTP,
    })

    const { data } = await supabase
      .from('ftp_predictions')
      .insert({
        predicted_ftp: result.predicted_ftp,
        reasoning: result.reasoning,
        confidence: result.confidence,
        activity_ids: activities.map(a => a.id),
        confirmed: false,
        user_id: user.id,
      })
      .select()
      .single()

    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FTP prediction failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
