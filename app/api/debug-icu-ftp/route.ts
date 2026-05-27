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

  // Step 1: GET the current athlete record
  const getRes = await fetch(`https://intervals.icu/api/v1/athlete/${athleteId}`, {
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
  })
  const getBody = await getRes.json()

  // Step 2: Attempt PUT with just ftp
  const putRes = await fetch(`https://intervals.icu/api/v1/athlete/${athleteId}`, {
    method: 'PUT',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ftp: current_ftp }),
  })
  const putStatus = putRes.status
  const putBody = putRes.ok ? await putRes.json().catch(() => null) : await putRes.text()

  return NextResponse.json({
    athlete_id: athleteId,
    current_ftp_in_db: current_ftp,
    icu_ftp_from_get: getBody.ftp,
    get_status: getRes.status,
    get_fields: Object.keys(getBody),
    put_status: putStatus,
    put_response: putBody,
  })
}
