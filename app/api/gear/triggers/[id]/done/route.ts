import { NextResponse } from 'next/server'
import { getAuthed, unauthorized, badRequest, notFound, serverError, readJson } from '@/lib/gear/route-helpers'
import { isDateStr, todayStr } from '@/lib/gear/validate'

type Ctx = { params: Promise<{ id: string }> }

/** Marks a recurring trigger done (e.g. chain re-waxed): restarts its count and re-arms notifications. */
export async function POST(req: Request, { params }: Ctx) {
  const auth = await getAuthed()
  if (!auth) return unauthorized()
  const { supabase, user } = auth
  const { id } = await params

  const { data: trigger } = await supabase
    .from('component_triggers').select('id, kind').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!trigger) return notFound('Trigger')
  if (trigger.kind === 'lifetime') return badRequest('Replace the component instead of marking a lifetime trigger done')

  const body = (await readJson(req)) ?? {}
  if (body.date !== undefined && !isDateStr(body.date)) return badRequest('date must be YYYY-MM-DD')
  const date = (body.date as string | undefined) ?? todayStr()
  if (date > todayStr()) return badRequest('date cannot be in the future')

  const { data, error } = await supabase
    .from('component_triggers')
    .update({ last_done_at: date, heads_up_notified_at: null, due_notified_at: null })
    .eq('id', id).eq('user_id', user.id).select().single()
  if (error) return serverError(error.message)
  return NextResponse.json({ trigger: data })
}
