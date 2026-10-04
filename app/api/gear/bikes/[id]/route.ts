import { NextResponse } from 'next/server'
import { getAuthed, unauthorized, badRequest, notFound, serverError, readJson } from '@/lib/gear/route-helpers'
import { BIKE_KINDS, cleanName } from '@/lib/gear/validate'
import type { Bike, BikeKind } from '@/types'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await getAuthed()
  if (!auth) return unauthorized()
  const { supabase, user } = auth
  const { id } = await params

  const { data: bike } = await supabase
    .from('bikes').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!bike) return notFound('Bike')
  const current = bike as Bike

  const body = await readJson(req)
  if (!body) return badRequest('invalid body')

  const patch: Record<string, unknown> = {}
  if ('name' in body) {
    const name = cleanName(body.name)
    if (!name) return badRequest('name must be 1–60 characters')
    patch.name = name
  }
  if ('kind' in body) {
    if (!BIKE_KINDS.includes(body.kind as BikeKind)) return badRequest('invalid kind')
    patch.kind = body.kind
  }

  if (body.retired === true) {
    if (current.is_default) return badRequest('Choose another default bike before retiring this one')
    patch.retired_at = new Date().toISOString()
    patch.is_indoor_default = false
  } else if (body.retired === false) {
    patch.retired_at = null
  }
  const willBeRetired = patch.retired_at !== undefined ? patch.retired_at !== null : current.retired_at !== null

  if (body.is_default === false) return badRequest('Set another bike as the default instead')
  const wantsDefault = body.is_default === true
  const wantsTrainer = body.is_indoor_default === true
  if ((wantsDefault || wantsTrainer) && willBeRetired) return badRequest('A retired bike cannot be the default or trainer bike')
  if (body.is_indoor_default === false) patch.is_indoor_default = false

  // Partial unique indexes allow only one of each per user, so clear the old holder first.
  if (wantsDefault) {
    const { error } = await supabase.from('bikes').update({ is_default: false })
      .eq('user_id', user.id).eq('is_default', true).neq('id', id)
    if (error) return serverError(error.message)
    patch.is_default = true
  }
  if (wantsTrainer) {
    const { error } = await supabase.from('bikes').update({ is_indoor_default: false })
      .eq('user_id', user.id).eq('is_indoor_default', true).neq('id', id)
    if (error) return serverError(error.message)
    patch.is_indoor_default = true
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ bike: current })
  const { data: updated, error } = await supabase
    .from('bikes').update(patch).eq('id', id).eq('user_id', user.id).select().single()
  if (error) return serverError(error.message)
  return NextResponse.json({ bike: updated })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await getAuthed()
  if (!auth) return unauthorized()
  const { supabase, user } = auth
  const { id } = await params

  const { data: bike } = await supabase
    .from('bikes').select('id, is_default').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!bike) return notFound('Bike')
  if (bike.is_default) return badRequest('Choose another default bike before deleting this one')

  const { error } = await supabase.from('bikes').delete().eq('id', id).eq('user_id', user.id)
  if (error) return serverError(error.message)
  return NextResponse.json({ ok: true })
}
