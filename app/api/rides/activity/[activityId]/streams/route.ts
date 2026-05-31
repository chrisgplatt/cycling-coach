import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { downsampleStreams } from '@/lib/intervals/streams'

export const dynamic = 'force-dynamic'

// Streams for an unlinked intervals.icu ride (one with no workout row). Keyed by
// the intervals activity id directly. Uses the signed-in user's own stored creds,
// so it only ever reads that user's intervals account.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ activityId: string }> },
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { activityId } = await params

  if (!activityId) {
    return NextResponse.json({ error: 'Missing activity id' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  try {
    // Streams carry the graph channels; the real route comes from /map (the streams
    // latlng channel is latitude-only). latlngs is index-aligned with the streams.
    const [streams, map] = await Promise.all([
      client.getActivityStreams(activityId),
      client.getActivityMap(activityId).catch(() => ({ latlngs: null })),
    ])
    if (map.latlngs && map.latlngs.length === streams.time.length) {
      streams.latlng = map.latlngs
    }
    return NextResponse.json({ streams: downsampleStreams(streams, 600) })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
