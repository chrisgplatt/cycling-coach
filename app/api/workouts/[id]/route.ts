import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const { data: workout } = await supabase
    .from('workouts')
    .select('intervals_icu_event_id, plan_id, date, status')
    .eq('id', id)
    .maybeSingle()

  const today = new Date().toISOString().split('T')[0]
  if (workout?.intervals_icu_event_id && workout.date >= today && workout.status === 'planned') {
    const { data: profile } = await supabase
      .from('user_profile')
      .select('intervals_icu_athlete_id, intervals_icu_api_key')
      .maybeSingle()
    if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      try { await client.deleteEvent(workout.intervals_icu_event_id) } catch { /* already gone */ }
    }
  }

  const { error } = await supabase.from('workouts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json()

  const update: Record<string, unknown> = {}
  if (body.status !== undefined) update.status = body.status
  if (body.icu_activity_id !== undefined) update.icu_activity_id = body.icu_activity_id
  if (body.tss !== undefined) update.tss = body.tss
  if (body.missed_reason !== undefined) update.missed_reason = body.missed_reason ?? null
  if (body.type !== undefined) update.type = body.type
  if (body.duration_minutes !== undefined) update.duration_minutes = body.duration_minutes
  if (body.description !== undefined) update.description = body.description
  if (body.target_zones !== undefined) update.target_zones = body.target_zones
  if (body.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 })
    }
    if (isNaN(new Date(body.date as string).getTime())) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }
    update.date = body.date
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  // Fetch existing workout before update — needed for event id (date moves) and status guard
  let eventId: string | null = null
  if (body.date !== undefined) {
    const { data: existing } = await supabase
      .from('workouts')
      .select('intervals_icu_event_id, status')
      .eq('id', id)
      .maybeSingle()
    if (existing?.status !== 'planned') {
      return NextResponse.json({ error: 'Only planned workouts can be rescheduled' }, { status: 400 })
    }
    eventId = existing?.intervals_icu_event_id ?? null
  }

  const { error } = await supabase.from('workouts').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (eventId) {
    const { data: profile, error: profileErr } = await supabase
      .from('user_profile')
      .select('intervals_icu_athlete_id, intervals_icu_api_key')
      .maybeSingle()
    if (profileErr) {
      return NextResponse.json({ ok: true, icu_warning: profileErr.message })
    }
    if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      try {
        await client.updateEvent(eventId, { date: body.date as string })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return NextResponse.json({ ok: true, icu_warning: msg })
      }
    }
  }

  return NextResponse.json({ ok: true })
}
