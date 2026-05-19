import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// Temporary debug route — shows raw fields from the first intervals.icu activity.
// Delete this file when done investigating field names.
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'not configured' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]
  const oldest = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const authHeader = 'Basic ' + Buffer.from(`API_KEY:${profile.intervals_icu_api_key}`).toString('base64')
  const res = await fetch(
    `https://intervals.icu/api/v1/athlete/${profile.intervals_icu_athlete_id}/activities?oldest=${oldest}&newest=${today}`,
    { headers: { Authorization: authHeader } }
  )
  const raw = await res.json()
  const first = Array.isArray(raw) ? raw[0] : raw

  // Return all keys and the specific balance/elevation fields we care about
  return NextResponse.json({
    keys: first ? Object.keys(first).sort() : [],
    balance_fields: first ? Object.fromEntries(
      Object.entries(first).filter(([k]) => k.toLowerCase().includes('balance') || k.toLowerCase().includes('left') || k.toLowerCase().includes('right'))
    ) : {},
    elevation_fields: first ? Object.fromEntries(
      Object.entries(first).filter(([k]) => k.toLowerCase().includes('elev') || k.toLowerCase().includes('gain'))
    ) : {},
  })
}
