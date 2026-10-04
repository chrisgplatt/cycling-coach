import { NextResponse } from 'next/server'
import { getAuthed, unauthorized, badRequest, notFound, serverError, readJson } from '@/lib/gear/route-helpers'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Manual bike override for a ride. Kept separate from the workout PATCH so sync-driven workout
 * updates can't clobber it. Note: sync only assigns rides whose bike_id is null, so unassigning
 * (bike_id: null) lets the next sync re-resolve the ride to the default/trainer bike — the UI
 * presents that as "Reset to default".
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await getAuthed()
  if (!auth) return unauthorized()
  const { supabase, user } = auth
  const { id } = await params

  const body = await readJson(req)
  if (!body || !('bike_id' in body)) return badRequest('bike_id required (string or null)')
  const bikeId = body.bike_id
  if (bikeId !== null && typeof bikeId !== 'string') return badRequest('bike_id must be a string or null')

  const { data: workout } = await supabase
    .from('workouts').select('id').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!workout) return notFound('Ride')

  if (bikeId !== null) {
    const { data: bike } = await supabase
      .from('bikes').select('id, retired_at').eq('id', bikeId).eq('user_id', user.id).maybeSingle()
    if (!bike) return notFound('Bike')
    if (bike.retired_at) return badRequest('Cannot assign a retired bike')
  }

  const { error } = await supabase.from('workouts').update({ bike_id: bikeId }).eq('id', id).eq('user_id', user.id)
  if (error) return serverError(error.message)
  return NextResponse.json({ ok: true, bike_id: bikeId })
}
