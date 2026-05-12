import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  let { data, error } = await supabase
    .from('user_profile')
    .select('*')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!data) {
    const inserted = await supabase
      .from('user_profile')
      .insert({ goals: '' })
      .select()
      .single()
    if (inserted.error) return NextResponse.json({ error: inserted.error.message }, { status: 500 })
    data = inserted.data
  }

  return NextResponse.json(data)
}

export async function PATCH(req: Request) {
  const body = await req.json()
  const { error } = await supabase
    .from('user_profile')
    .update(body)
    .eq('id', body.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
