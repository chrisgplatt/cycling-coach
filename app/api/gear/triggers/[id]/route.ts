import { NextResponse } from 'next/server'
import { getAuthed, unauthorized, badRequest, notFound, serverError, readJson } from '@/lib/gear/route-helpers'
import { METRICS, cleanName, isDateStr, isInterval } from '@/lib/gear/validate'
import type { ComponentTrigger, TriggerMetric } from '@/types'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await getAuthed()
  if (!auth) return unauthorized()
  const { supabase, user } = auth
  const { id } = await params

  const { data: found } = await supabase
    .from('component_triggers').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!found) return notFound('Trigger')
  const trigger = found as ComponentTrigger

  const body = await readJson(req)
  if (!body) return badRequest('invalid body')
  const patch: Record<string, unknown> = {}
  let rearm = false
  if ('label' in body) {
    const label = cleanName(body.label)
    if (!label) return badRequest('label must be 1–60 characters')
    patch.label = label
  }
  if ('metric' in body) {
    if (!METRICS.includes(body.metric as TriggerMetric)) return badRequest('invalid metric')
    patch.metric = body.metric
    rearm = true
  }
  if ('interval_value' in body) {
    if (!isInterval(body.interval_value)) return badRequest('interval_value must be a positive number')
    patch.interval_value = body.interval_value
    rearm = true
  }
  if ('last_done_at' in body) {
    if (trigger.kind === 'lifetime') return badRequest('lifetime triggers have no last_done_at')
    if (body.last_done_at !== null && !isDateStr(body.last_done_at)) return badRequest('last_done_at must be YYYY-MM-DD')
    patch.last_done_at = body.last_done_at
    rearm = true
  }
  if (Object.keys(patch).length === 0) return badRequest('nothing to update')
  // A changed threshold or reference date means progress must be re-evaluated from scratch.
  if (rearm) {
    patch.heads_up_notified_at = null
    patch.due_notified_at = null
  }

  const { data, error } = await supabase
    .from('component_triggers').update(patch).eq('id', id).eq('user_id', user.id).select().single()
  if (error) return serverError(error.message)
  return NextResponse.json({ trigger: data })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await getAuthed()
  if (!auth) return unauthorized()
  const { supabase, user } = auth
  const { id } = await params

  const { data: found } = await supabase
    .from('component_triggers').select('id').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!found) return notFound('Trigger')

  const { error } = await supabase.from('component_triggers').delete().eq('id', id).eq('user_id', user.id)
  if (error) return serverError(error.message)
  return NextResponse.json({ ok: true })
}
