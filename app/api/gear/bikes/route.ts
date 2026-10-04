import { NextResponse } from 'next/server'
import { getAuthed, unauthorized, badRequest, serverError, readJson } from '@/lib/gear/route-helpers'
import { BIKE_KINDS, cleanName } from '@/lib/gear/validate'
import type { BikeKind } from '@/types'

export async function POST(req: Request) {
  const auth = await getAuthed()
  if (!auth) return unauthorized()
  const { supabase, user } = auth

  const body = await readJson(req)
  const name = cleanName(body?.name)
  if (!name) return badRequest('name must be 1–60 characters')
  const kind = (body?.kind ?? 'road') as BikeKind
  if (!BIKE_KINDS.includes(kind)) return badRequest('invalid kind')

  const { count: existing } = await supabase
    .from('bikes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const { data: bike, error } = await supabase
    .from('bikes')
    .insert({
      user_id: user.id,
      name,
      kind,
      is_default: !existing,
      is_indoor_default: false,
      retired_at: null,
    })
    .select()
    .single()
  if (error || !bike) return serverError(error?.message ?? 'Failed to create bike')

  const { count: unassigned } = await supabase
    .from('workouts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('bike_id', null)
    .not('icu_activity_id', 'is', null)
    .not('activity_metrics', 'is', null)

  return NextResponse.json({ bike, unassignedRideCount: unassigned ?? 0 })
}
