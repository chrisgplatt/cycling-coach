import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import type { UnavailabilityPeriod } from '@/types'

export async function DELETE(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { id?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { id } = body
  if (typeof id !== 'string') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('id, intervals_icu_athlete_id, intervals_icu_api_key, unavailability')
    .maybeSingle()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const existing: UnavailabilityPeriod[] = (profile.unavailability ?? []) as UnavailabilityPeriod[]
  const period = existing.find(p => p.id === id)
  if (!period) return NextResponse.json({ error: 'Period not found' }, { status: 404 })

  if (period.icu_event_id && profile.intervals_icu_athlete_id && profile.intervals_icu_api_key) {
    try {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      await client.deleteEvent(period.icu_event_id)
    } catch (err) {
      console.error('[unavailability/delete] ICU delete failed:', err instanceof Error ? err.message : err)
    }
  }

  const { error: saveError } = await supabase
    .from('user_profile')
    .update({ unavailability: existing.filter(p => p.id !== id) })
    .eq('id', profile.id)

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
