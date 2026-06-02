import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { downsampleStreams } from '@/lib/intervals/streams'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workoutId: string }> },
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { workoutId } = await params

  // RLS scopes this select to the signed-in user, so a foreign workout reads as null.
  const { data: workout } = await supabase
    .from('workouts')
    .select('icu_activity_id')
    .eq('id', workoutId)
    .maybeSingle()

  if (!workout?.icu_activity_id) {
    return NextResponse.json({ error: 'No activity for this workout' }, { status: 404 })
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
    // intervals (detected laps) drive the planned-vs-actual overlay; they degrade to
    // [] so a lap-detection hiccup never breaks the graph.
    const [streams, map, intervals] = await Promise.all([
      client.getActivityStreams(workout.icu_activity_id),
      client.getActivityMap(workout.icu_activity_id).catch(() => ({ latlngs: null })),
      client.getActivityIntervals(workout.icu_activity_id).catch(() => []),
    ])
    if (map.latlngs && map.latlngs.length === streams.time.length) {
      streams.latlng = map.latlngs
    }
    return NextResponse.json({ streams: downsampleStreams(streams, 600), intervals })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
