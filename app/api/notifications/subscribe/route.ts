import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function serviceClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(req: NextRequest) {
  const authClient = await createSupabaseServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { endpoint, p256dh, auth } = await req.json()
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Missing subscription fields' }, { status: 400 })
  }

  const db = serviceClient()

  const { error } = await db
    .from('push_subscriptions')
    .upsert({ user_id: user.id, endpoint, p256dh, auth }, { onConflict: 'endpoint' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await db
    .from('user_profile')
    .update({ notifications_enabled: true })
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const authClient = await createSupabaseServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = serviceClient()

  // Delete all subscriptions for this user — clears stale entries from other browsers/devices too
  await db.from('push_subscriptions').delete().eq('user_id', user.id)
  await db.from('user_profile').update({ notifications_enabled: false }).eq('user_id', user.id)

  return NextResponse.json({ ok: true })
}
