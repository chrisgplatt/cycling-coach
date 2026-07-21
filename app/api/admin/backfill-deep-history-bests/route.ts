import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { runDeepHistoryBestsBatch } from '@/lib/intervals/deep-history-bests'

export const dynamic = 'force-dynamic'

/** One chunk of the resumable deep-history bests scan. Defaults the cursor to
 * the oldest ride already in workouts (so it never wastes calls re-covering
 * ground normal sync/import already handles), then persists wherever the
 * batch left off for next time. Click again to keep going further back. */
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, deep_history_bests_cursor')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  let cursor = profile.deep_history_bests_cursor as string | null
  if (!cursor) {
    const { data: oldestWorkout } = await supabase
      .from('workouts')
      .select('date')
      .eq('user_id', user.id)
      .order('date', { ascending: true })
      .limit(1)
      .maybeSingle()
    cursor = (oldestWorkout?.date ?? new Date().toISOString().split('T')[0]) as string
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  const result = await runDeepHistoryBestsBatch(supabase, client, user.id, cursor)

  if (result.newCursor) {
    await supabase.from('user_profile').update({ deep_history_bests_cursor: result.newCursor }).eq('user_id', user.id)
  }

  return NextResponse.json(result)
}
