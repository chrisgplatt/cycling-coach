import { NextResponse } from 'next/server'
import { getAuthed, unauthorized, badRequest, notFound, serverError, readJson } from '@/lib/gear/route-helpers'
import { CATEGORY_VALUES, cleanName, isDateStr } from '@/lib/gear/validate'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await getAuthed()
  if (!auth) return unauthorized()
  const { supabase, user } = auth
  const { id } = await params

  const { data: existing } = await supabase
    .from('bike_components').select('id').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!existing) return notFound('Component')

  const body = await readJson(req)
  if (!body) return badRequest('invalid body')
  const patch: Record<string, unknown> = {}
  if ('name' in body) {
    const name = cleanName(body.name)
    if (!name) return badRequest('name must be 1–60 characters')
    patch.name = name
  }
  if ('category' in body) {
    if (!CATEGORY_VALUES.includes(body.category as string)) return badRequest('invalid category')
    patch.category = body.category
  }
  if ('installed_at' in body) {
    if (!isDateStr(body.installed_at)) return badRequest('installed_at must be YYYY-MM-DD')
    patch.installed_at = body.installed_at
  }
  if (Object.keys(patch).length === 0) return badRequest('nothing to update')

  const { data, error } = await supabase
    .from('bike_components').update(patch).eq('id', id).eq('user_id', user.id).select().single()
  if (error) return serverError(error.message)
  return NextResponse.json({ component: data })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const auth = await getAuthed()
  if (!auth) return unauthorized()
  const { supabase, user } = auth
  const { id } = await params

  const { data: existing } = await supabase
    .from('bike_components').select('id').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!existing) return notFound('Component')

  const { error } = await supabase.from('bike_components').delete().eq('id', id).eq('user_id', user.id)
  if (error) return serverError(error.message)
  return NextResponse.json({ ok: true })
}
