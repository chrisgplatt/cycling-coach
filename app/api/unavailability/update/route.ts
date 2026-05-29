import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import type { UnavailabilityPeriod, UnavailabilityType } from '@/types'

export async function PUT(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { id?: unknown; type?: unknown; start_date?: unknown; end_date?: unknown; notes?: unknown; impact_plan?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { id, type, start_date, end_date, notes, impact_plan } = body
  if (typeof id !== 'string' || typeof type !== 'string' || typeof start_date !== 'string' || typeof end_date !== 'string') {
    return NextResponse.json({ error: 'id, type, start_date, and end_date are required' }, { status: 400 })
  }

  // IMPORTANT: Add these validations (learned from create route review):
  const validTypes = ['sick', 'injury', 'holiday', 'unavailable'] as const
  if (!validTypes.includes(type as UnavailabilityType)) {
    return NextResponse.json({ error: 'type must be one of: sick, injury, holiday, unavailable' }, { status: 400 })
  }
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(start_date) || !dateRegex.test(end_date)) {
    return NextResponse.json({ error: 'start_date and end_date must be YYYY-MM-DD format' }, { status: 400 })
  }
  if (impact_plan !== undefined && typeof impact_plan !== 'boolean') {
    return NextResponse.json({ error: 'impact_plan must be a boolean' }, { status: 400 })
  }

  if (end_date < start_date) {
    return NextResponse.json({ error: 'end_date must be >= start_date' }, { status: 400 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('id, intervals_icu_athlete_id, intervals_icu_api_key, unavailability')
    .maybeSingle()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  const existing: UnavailabilityPeriod[] = (profile.unavailability ?? []) as UnavailabilityPeriod[]
  const idx = existing.findIndex(p => p.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Period not found' }, { status: 404 })

  const old = existing[idx]

  let icu_event_id = old.icu_event_id
  let icu_error: string | undefined
  if (profile.intervals_icu_athlete_id && profile.intervals_icu_api_key) {
    try {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      if (icu_event_id) {
        await client.updateUnavailabilityEvent(icu_event_id, {
          type: type as UnavailabilityType,
          start_date: start_date as string,
          end_date: end_date as string,
          notes: typeof notes === 'string' ? notes : undefined,
        })
      } else {
        icu_event_id = await client.createUnavailabilityEvent({
          type: type as UnavailabilityType,
          start_date: start_date as string,
          end_date: end_date as string,
          notes: typeof notes === 'string' ? notes : undefined,
        })
      }
    } catch (err) {
      icu_error = err instanceof Error ? err.message : String(err)
      console.error('[unavailability/update] ICU sync failed:', icu_error)
    }
  }

  const updated: UnavailabilityPeriod = {
    ...old,
    type: type as UnavailabilityType,
    start_date: start_date as string,
    end_date: end_date as string,
    impact_plan: impact_plan === true,
    notes: typeof notes === 'string' && notes.trim() ? notes.trim() : undefined,
    ...(icu_event_id ? { icu_event_id } : {}),
  }

  const updatedList = [...existing]
  updatedList[idx] = updated

  const { error: saveError } = await supabase
    .from('user_profile')
    .update({ unavailability: updatedList })
    .eq('id', profile.id)

  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 })

  return NextResponse.json({
    period: updated,
    synced_to_icu: !!icu_event_id,
    ...(icu_error ? { icu_error } : {}),
  })
}
