import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { backfillActivityMetrics } from '@/lib/intervals/enrich'

export const dynamic = 'force-dynamic'

/** One-time (safely re-runnable) backfill: re-enriches completed rides whose
 * activity_metrics predate the current METRICS_VERSION — used to populate climb
 * length/path and speed-over-distance bests on historical rides. Wraps the same
 * backfillActivityMetrics call /api/sync?deep=1 already triggers, without also
 * re-syncing activities/wellness/athlete data. */
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

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  const result = await backfillActivityMetrics(supabase, client, user.id, { allTime: true })
  return NextResponse.json(result)
}
