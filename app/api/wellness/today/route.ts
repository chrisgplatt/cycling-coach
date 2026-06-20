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
  const url = `https://intervals.icu/api/v1/athlete/${profile.intervals_icu_athlete_id}/wellness?start=${today}&end=${today}`

  const res = await fetch(url, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`API_KEY:${profile.intervals_icu_api_key}`).toString('base64'),
    },
    next: { revalidate: 0 },
  })

  if (!res.ok) return NextResponse.json({ error: `intervals.icu returned ${res.status}` }, { status: 502 })

  const raw = await res.json()
  const w = Array.isArray(raw) ? (raw.find((item: Record<string, unknown>) => item.id === today) ?? null) : null

  if (!w) return NextResponse.json({ today: null })

  return NextResponse.json({
    today: {
      id: w.id as string,
      updated: (w.updated ?? null) as string | null,
      bodyBatteryMax: (w.BodyBatteryMax ?? w.bodyBatteryMax ?? w.bodyBatteryHigh ?? w.body_battery_high ?? null) as number | null,
      bodyBatteryMin: (w.BodyBatteryMin ?? w.bodyBatteryMin ?? w.bodyBatteryLow ?? w.body_battery_low ?? null) as number | null,
      sleepScore: (w.sleepScore ?? w.sleep_score ?? null) as number | null,
      sleepSecs: (w.sleepSecs ?? w.sleep_secs ?? null) as number | null,
      restingHR: (w.restingHR ?? w.resting_hr ?? null) as number | null,
      steps: (w.steps ?? null) as number | null,
    },
  })
}
