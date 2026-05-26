import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let { data, error } = await supabase
    .from('user_profile')
    .select('*')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!data) {
    const inserted = await supabase
      .from('user_profile')
      .insert({ goals: '', user_id: user.id })
      .select()
      .single()
    if (inserted.error) return NextResponse.json({ error: inserted.error.message }, { status: 500 })
    data = inserted.data
  }

  return NextResponse.json(data)
}

export async function PATCH(req: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, is_admin, ...fields } = body

  let error
  if (id) {
    ({ error } = await supabase.from('user_profile').update(fields).eq('id', id))
  } else {
    const { data: row, error: fetchError } = await supabase
      .from('user_profile').select('id').maybeSingle()
    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
    if (row) {
      ({ error } = await supabase.from('user_profile').update(fields).eq('id', row.id))
    } else {
      ({ error } = await supabase.from('user_profile').insert({ ...fields, user_id: user.id }))
    }
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
