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

  // Step 1: Get sport settings and find the Ride entry
  const settingsRes = await fetch(`${base}/athlete/${athleteId}/sport-settings`, {
    cache: 'no-store',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
  })
  const settings = await settingsRes.json() as Array<{ id: number; types: string[]; ftp: number | null }>
  const rideEntry = settings.find(s => s.types.includes('Ride'))

  if (!rideEntry) {
    return NextResponse.json({ error: 'No Ride sport-settings entry found', settings })
  }

  // Step 2: PUT to the Ride entry with the new FTP
  const putRes = await fetch(`${base}/athlete/${athleteId}/sport-settings/${rideEntry.id}`, {
    method: 'PUT',
    cache: 'no-store',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ftp: current_ftp }),
  })
  const putStatus = putRes.status
  const putRaw = await putRes.text()

  // Step 3: Re-fetch to confirm
  const confirmRes = await fetch(`${base}/athlete/${athleteId}/sport-settings`, {
    cache: 'no-store',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
  })
  const confirmSettings = await confirmRes.json() as Array<{ id: number; types: string[]; ftp: number | null }>
  const confirmEntry = confirmSettings.find(s => s.types.includes('Ride'))

  return NextResponse.json({
    ride_settings_id: rideEntry.id,
    ftp_before: rideEntry.ftp,
    ftp_in_db: current_ftp,
    put_status: putStatus,
    put_response: putRaw.slice(0, 500),
    ftp_after_confirm: confirmEntry?.ftp,
  })
}
