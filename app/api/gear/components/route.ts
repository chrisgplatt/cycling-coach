import { NextResponse } from 'next/server'
import { getAuthed, unauthorized, badRequest, notFound, serverError, readJson } from '@/lib/gear/route-helpers'
import { CATEGORY_VALUES, cleanName, isDateStr, parseTriggerInput, todayStr } from '@/lib/gear/validate'

export async function POST(req: Request) {
  const auth = await getAuthed()
  if (!auth) return unauthorized()
  const { supabase, user } = auth

  const body = await readJson(req)
  if (!body) return badRequest('invalid body')
  const name = cleanName(body.name)
  if (!name) return badRequest('name must be 1–60 characters')
  if (!CATEGORY_VALUES.includes(body.category as string)) return badRequest('invalid category')
  if (body.installed_at !== undefined && !isDateStr(body.installed_at)) return badRequest('installed_at must be YYYY-MM-DD')
  if (typeof body.bike_id !== 'string') return badRequest('bike_id required')

  const rawTriggers = body.triggers === undefined ? [] : body.triggers
  if (!Array.isArray(rawTriggers)) return badRequest('triggers must be an array')
  const triggers = rawTriggers.map(parseTriggerInput)
  if (triggers.some(t => t === null)) return badRequest('invalid trigger')

  const { data: bike } = await supabase
    .from('bikes').select('id, retired_at').eq('id', body.bike_id).eq('user_id', user.id).maybeSingle()
  if (!bike) return notFound('Bike')
  if (bike.retired_at) return badRequest('Cannot add components to a retired bike')

  const { data: component, error } = await supabase
    .from('bike_components')
    .insert({
      user_id: user.id,
      bike_id: bike.id,
      name,
      category: body.category,
      installed_at: (body.installed_at as string | undefined) ?? todayStr(),
      retired_at: null,
    })
    .select()
    .single()
  if (error || !component) return serverError(error?.message ?? 'Failed to create component')

  if (triggers.length) {
    const { error: tErr } = await supabase.from('component_triggers').insert(
      triggers.map(t => ({ ...t!, user_id: user.id, component_id: component.id, last_done_at: null })),
    )
    if (tErr) {
      await supabase.from('bike_components').delete().eq('id', component.id)
      return serverError(tErr.message)
    }
  }
  return NextResponse.json({ component })
}
