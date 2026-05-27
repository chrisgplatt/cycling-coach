import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// Temporary debug route — delete after confirming FTP sync works
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' })
  }

  const { intervals_icu_athlete_id: athleteId, intervals_icu_api_key: apiKey, current_ftp } = profile
  const authHeader = 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64')
  const base = 'https://intervals.icu/api/v1'

  async function probe(id: string) {
    const getRes = await fetch(`${base}/athlete/${id}`, {
      cache: 'no-store',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    })
    const rawText = await getRes.text()
    let parsed: unknown = null
    try { parsed = JSON.parse(rawText) } catch { parsed = rawText }
    return { status: getRes.status, raw: rawText.slice(0, 2000), parsed }
  }

  // GET full athlete and extract any field with ftp/threshold/power in the name
  const athleteRes = await fetch(`${base}/athlete/${athleteId}`, {
    cache: 'no-store',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
  })
  const athleteJson = await athleteRes.json()
  const relevantFields = Object.fromEntries(
    Object.entries(athleteJson).filter(([k]) =>
      /ftp|threshold|power|zone/i.test(k)
    )
  )

  // Probe the sport-settings endpoint (where per-sport FTP often lives)
  const settingsRes = await fetch(`${base}/athlete/${athleteId}/sport-settings`, {
    cache: 'no-store',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
  })
  const settingsStatus = settingsRes.status
  const settingsBody = settingsStatus === 200 ? await settingsRes.json().catch(() => null) : await settingsRes.text()

  return NextResponse.json({
    stored_athlete_id: athleteId,
    current_ftp_in_db: current_ftp,
    athlete_ftp_related_fields: relevantFields,
    sport_settings_status: settingsStatus,
    sport_settings: settingsBody,
  })
}
