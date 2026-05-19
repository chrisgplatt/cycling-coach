import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// Temporary debug route — shows raw response from the power curve endpoint.
// Delete this file when done investigating.
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
  const athleteId = profile.intervals_icu_athlete_id

  const results: Record<string, unknown> = {}

  for (const path of [
    `/athlete/${athleteId}/activity-power-curves.json?oldest=${oldest}&newest=${today}&type=Ride`,
    `/athlete/${athleteId}/power_curves?oldest=${oldest}&newest=${today}&type=Ride`,
    `/athlete/${athleteId}/power_curve?oldest=${oldest}&newest=${today}&type=Ride`,
  ]) {
    const res = await fetch(`https://intervals.icu/api/v1${path}`, {
      headers: { Authorization: authHeader },
    })
    const text = await res.text()
    let body: unknown
    try { body = JSON.parse(text) } catch { body = text }
    results[path] = { status: res.status, body: typeof body === 'object' && body !== null && Array.isArray(body) ? { length: (body as unknown[]).length, first: (body as unknown[])[0] } : body }
  }

  return NextResponse.json(results)
}
