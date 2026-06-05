import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { fetchActiveBeliefs } from '@/lib/claude/athlete-model'
import { beliefActionPatch, type BeliefAction } from '@/lib/athlete-model/actions'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const beliefs = await fetchActiveBeliefs(supabase, user.id)
  return NextResponse.json({ beliefs })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { key?: unknown; action?: unknown; value_text?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  if (typeof body.key !== 'string' || (body.action !== 'confirm' && body.action !== 'correct' && body.action !== 'dismiss')) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const valueText = typeof body.value_text === 'string' ? body.value_text : undefined
  const patch = beliefActionPatch(body.action as BeliefAction, valueText, new Date().toISOString())
  if (!patch) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { error } = await supabase
    .from('athlete_beliefs')
    .update(patch)
    .eq('user_id', user.id)
    .eq('key', body.key)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
