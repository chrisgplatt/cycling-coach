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
    const streams = await client.getActivityStreams(workout.icu_activity_id)
    return NextResponse.json({ streams: downsampleStreams(streams, 600) })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
