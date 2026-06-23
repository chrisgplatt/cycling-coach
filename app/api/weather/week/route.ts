import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { fetchWeekForecast } from '@/lib/weather/open-meteo'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('latitude, longitude, timezone')
    .maybeSingle()

  const lat = (profile as { latitude?: number | null } | null)?.latitude ?? null
  const lon = (profile as { longitude?: number | null } | null)?.longitude ?? null
  const tz = (profile as { timezone?: string | null } | null)?.timezone ?? 'Europe/London'

  if (!lat || !lon) return NextResponse.json({ dates: [] })

  // Current week: Monday through Sunday
  const today = new Date()
  const dayOfWeek = (today.getDay() + 6) % 7  // 0=Mon
  const monday = new Date(today)
  monday.setDate(today.getDate() - dayOfWeek)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const fmt = (d: Date) => d.toISOString().split('T')[0]
  const dates = await fetchWeekForecast(lat, lon, fmt(monday), fmt(sunday), tz)

  return NextResponse.json({ dates })
}
