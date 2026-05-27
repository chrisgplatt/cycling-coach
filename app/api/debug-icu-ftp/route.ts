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
    return { status: getRes.status, raw: rawText.slice(0, 300), parsed }
  }

  const withoutPrefix = await probe(athleteId)
  const withPrefix = await probe(`i${athleteId}`)

  // Determine which ID form returns real data
  const workingId = withPrefix.status === 200 && typeof withPrefix.parsed === 'object' && withPrefix.parsed !== null && !Array.isArray(withPrefix.parsed) && Object.keys(withPrefix.parsed).length > 0
    ? `i${athleteId}`
    : athleteId

  // Attempt PUT with the working ID form
  const putRes = await fetch(`${base}/athlete/${workingId}`, {
    method: 'PUT',
    cache: 'no-store',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ftp: current_ftp }),
  })
  const putRaw = await putRes.text()

  return NextResponse.json({
    stored_athlete_id: athleteId,
    current_ftp_in_db: current_ftp,
    probe_without_prefix: { status: withoutPrefix.status, raw: withoutPrefix.raw },
    probe_with_i_prefix: { status: withPrefix.status, raw: withPrefix.raw },
    working_id_used: workingId,
    put_status: putRes.status,
    put_raw: putRaw.slice(0, 300),
  })
}
