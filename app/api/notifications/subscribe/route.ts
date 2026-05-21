import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { endpoint, p256dh, auth } = await req.json()
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Missing subscription fields' }, { status: 400 })
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ user_id: user.id, endpoint, p256dh, auth }, { onConflict: 'endpoint' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Mark notifications as enabled in profile
  const { data: row } = await supabase.from('user_profile').select('id').maybeSingle()
  if (row) await supabase.from('user_profile').update({ notifications_enabled: true }).eq('id', row.id)

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { endpoint } = await req.json()
  if (endpoint) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', user.id)
  }

  // Disable if no subscriptions remain
  const { count } = await supabase
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if (count === 0) {
    const { data: row } = await supabase.from('user_profile').select('id').maybeSingle()
    if (row) await supabase.from('user_profile').update({ notifications_enabled: false }).eq('id', row.id)
  }

  return NextResponse.json({ ok: true })
}
