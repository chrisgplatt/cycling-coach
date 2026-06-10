import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
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

  const today = new Date().toISOString().split('T')[0]
  const threeDaysAgo = new Date(Date.now() - 3 * 864e5).toISOString().split('T')[0]

  const url = `https://intervals.icu/api/v1/athlete/${profile.intervals_icu_athlete_id}/wellness?start=${threeDaysAgo}&end=${today}`
  const res = await fetch(url, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`API_KEY:${profile.intervals_icu_api_key}`).toString('base64'),
    },
  })

  if (!res.ok) return NextResponse.json({ error: `intervals.icu returned ${res.status}` }, { status: 502 })

  const raw = await res.json()
  // Return last entry's keys + full last entry so we can see field names
  const last = Array.isArray(raw) ? raw[raw.length - 1] : raw
  return NextResponse.json({
    last_entry_keys: last ? Object.keys(last) : [],
    last_entry: last ?? null,
    all_entries_count: Array.isArray(raw) ? raw.length : null,
  })
}
