import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30

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

  const searchParams = new URL(req.url).searchParams
  const dateParam = searchParams.get('date')
  const pageParam = searchParams.get('page')
  const parsedPage = parseInt(pageParam ?? '', 10)
  const page = isNaN(parsedPage) ? 1 : Math.max(1, parsedPage)

  const today = new Date()
  const oldest = `${today.getFullYear() - 4}-01-01`
  const newest = today.toISOString().split('T')[0]

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  try {
    const all = await client.getActivities(oldest, newest)
    const sorted = [...all].sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))

    if (dateParam) {
      const activities = sorted.filter(a => a.start_date_local.startsWith(dateParam))
      return NextResponse.json({ activities })
    }

    const total = sorted.length
    const start = (page - 1) * PAGE_SIZE
    const activities = sorted.slice(start, start + PAGE_SIZE)
    const hasMore = start + PAGE_SIZE < total
    return NextResponse.json({ activities, hasMore, total })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
