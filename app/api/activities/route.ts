import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  const start = searchParams.get('start') ?? date
  const end = searchParams.get('end') ?? date

  if (!start || !end) {
    return NextResponse.json({ error: 'date or start+end required' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ activities: [] })
  }

  try {
    const client = new IntervalsClient(
      profile.intervals_icu_athlete_id,
      profile.intervals_icu_api_key,
    )
    const all = await client.getActivities(start, end)
    const rides = all.filter(a => /ride/i.test(a.type))
    return NextResponse.json({ activities: rides })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch activities' }, { status: 500 })
  }
}
