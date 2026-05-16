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
    .select('intervals_icu_event_id, plan_id')
    .eq('id', id)
    .maybeSingle()

  if (workout?.intervals_icu_event_id) {
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

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('workouts')
    .update(update)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
