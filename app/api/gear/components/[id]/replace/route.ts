import { NextResponse } from 'next/server'
import { getAuthed, unauthorized, badRequest, notFound, serverError, readJson } from '@/lib/gear/route-helpers'
import { cleanName, isDateStr, todayStr } from '@/lib/gear/validate'
import type { BikeComponent, ComponentTrigger } from '@/types'

type Ctx = { params: Promise<{ id: string }> }

/** Retires a component and fits a fresh one (same bike) carrying copies of its triggers, reset. */
export async function POST(req: Request, { params }: Ctx) {
  const auth = await getAuthed()
  if (!auth) return unauthorized()
  const { supabase, user } = auth
  const { id } = await params

  const { data: found } = await supabase
    .from('bike_components').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!found) return notFound('Component')
  const old = found as BikeComponent
  if (old.retired_at) return badRequest('Component is already retired')

  const body = (await readJson(req)) ?? {}
  let name = old.name
  if (body.name !== undefined) {
    const n = cleanName(body.name)
    if (!n) return badRequest('name must be 1–60 characters')
    name = n
  }
  if (body.installed_at !== undefined && !isDateStr(body.installed_at)) return badRequest('installed_at must be YYYY-MM-DD')
  const date = (body.installed_at as string | undefined) ?? todayStr()
  if (date < old.installed_at) return badRequest('Replacement date is before the old component was installed')

  const { data: oldTriggers } = await supabase
    .from('component_triggers').select('*').eq('component_id', old.id).eq('user_id', user.id)

  const { error: retireErr } = await supabase
    .from('bike_components').update({ retired_at: date }).eq('id', old.id).eq('user_id', user.id)
  if (retireErr) return serverError(retireErr.message)

  const { data: fresh, error: insertErr } = await supabase
    .from('bike_components')
    .insert({ user_id: user.id, bike_id: old.bike_id, name, category: old.category, installed_at: date, retired_at: null })
    .select()
    .single()
  if (insertErr || !fresh) {
    await supabase.from('bike_components').update({ retired_at: null }).eq('id', old.id)
    return serverError(insertErr?.message ?? 'Failed to create replacement')
  }

  const copies = ((oldTriggers ?? []) as ComponentTrigger[]).map(t => ({
    user_id: user.id,
    component_id: fresh.id,
    label: t.label,
    kind: t.kind,
    metric: t.metric,
    interval_value: t.interval_value,
    last_done_at: null,
    heads_up_notified_at: null,
    due_notified_at: null,
  }))
  if (copies.length) {
    const { error } = await supabase.from('component_triggers').insert(copies)
    if (error) return serverError(error.message)
  }
  return NextResponse.json({ component: fresh })
}
