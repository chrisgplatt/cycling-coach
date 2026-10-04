import { NextResponse } from 'next/server'
import { getAuthed, unauthorized, badRequest, notFound, serverError, readJson } from '@/lib/gear/route-helpers'
import { isDateStr, parseTriggerInput } from '@/lib/gear/validate'

export async function POST(req: Request) {
  const auth = await getAuthed()
  if (!auth) return unauthorized()
  const { supabase, user } = auth

  const body = await readJson(req)
  if (!body) return badRequest('invalid body')
  const input = parseTriggerInput(body)
  if (!input) return badRequest('invalid trigger')
  if (typeof body.component_id !== 'string') return badRequest('component_id required')
  if (body.last_done_at !== undefined && body.last_done_at !== null) {
    if (!isDateStr(body.last_done_at)) return badRequest('last_done_at must be YYYY-MM-DD')
    if (input.kind === 'lifetime') return badRequest('lifetime triggers have no last_done_at')
  }

  const { data: component } = await supabase
    .from('bike_components').select('id, retired_at').eq('id', body.component_id).eq('user_id', user.id).maybeSingle()
  if (!component) return notFound('Component')
  if (component.retired_at) return badRequest('Cannot add triggers to a retired component')

  const { data, error } = await supabase
    .from('component_triggers')
    .insert({
      ...input,
      user_id: user.id,
      component_id: component.id,
      last_done_at: (body.last_done_at as string | null | undefined) ?? null,
    })
    .select()
    .single()
  if (error) return serverError(error.message)
  return NextResponse.json({ trigger: data })
}
