import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { TrainingEvent } from '@/types'

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    event_name, event_date, remove,
    icu_activity_id, result_tss, result_duration_minutes, result_avg_power, result_note,
  } = body

  if (!event_name || !event_date) {
    return NextResponse.json({ error: 'event_name and event_date are required' }, { status: 400 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('id, events')
    .maybeSingle()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const existing: TrainingEvent[] = profile.events ?? []
  const idx = existing.findIndex(e => e.name === event_name && e.date === event_date)
  if (idx === -1) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 })
  }

  const old = existing[idx]
  let updated: TrainingEvent

  if (remove) {
    // Strip all five result fields
    const {
      icu_activity_id: _a, result_tss: _b, result_duration_minutes: _c,
      result_avg_power: _d, result_note: _e, ...rest
    } = old
    updated = rest
  } else {
    updated = { ...old }
    if (icu_activity_id !== undefined) updated.icu_activity_id = icu_activity_id
    if (result_tss !== undefined) updated.result_tss = result_tss
    if (result_duration_minutes !== undefined) updated.result_duration_minutes = result_duration_minutes
    if (result_avg_power !== undefined) updated.result_avg_power = result_avg_power
    if (result_note !== undefined) updated.result_note = result_note
  }

  const updatedEvents = [...existing]
  updatedEvents[idx] = updated

  const { error: saveError } = await supabase
    .from('user_profile')
    .update({ events: updatedEvents })
    .eq('id', profile.id)

  if (saveError) {
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }

  return NextResponse.json({ event: updated })
}
