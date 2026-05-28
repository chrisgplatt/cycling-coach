import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { ExplicitNote } from '@/lib/claude/dossier'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { note?: unknown; forget?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { data: row } = await supabase
    .from('athlete_dossier')
    .select('explicit_notes, content')
    .eq('user_id', user.id)
    .maybeSingle()

  const notes: ExplicitNote[] = (row?.explicit_notes ?? []) as ExplicitNote[]

  if (typeof body.note === 'string' && body.note.trim()) {
    const updated = [...notes, { note: body.note.trim(), added_at: new Date().toISOString() }]
    const { error } = row
      ? await supabase.from('athlete_dossier').update({ explicit_notes: updated }).eq('user_id', user.id)
      : await supabase.from('athlete_dossier').insert({ user_id: user.id, explicit_notes: updated, content: {} })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (typeof body.forget === 'string' && body.forget.trim()) {
    const target = body.forget.trim().toLowerCase()
    let bestIdx = -1; let bestScore = 0
    notes.forEach((n, i) => {
      const s = wordOverlap(n.note.toLowerCase(), target)
      if (s > bestScore) { bestScore = s; bestIdx = i }
    })
    if (bestIdx !== -1) {
      const updated = notes.filter((_, i) => i !== bestIdx)
      const { error } = await supabase.from('athlete_dossier').update({ explicit_notes: updated }).eq('user_id', user.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Must provide note or forget' }, { status: 400 })
}

export function wordOverlap(a: string, b: string): number {
  const aW = new Set(a.split(/\s+/).filter(Boolean))
  const bW = new Set(b.split(/\s+/).filter(Boolean))
  if (aW.size === 0 || bW.size === 0) return 0
  let overlap = 0
  for (const w of bW) if (aW.has(w)) overlap++
  return overlap / Math.max(aW.size, bW.size)
}
