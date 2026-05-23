import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/push'

export async function POST() {
  const authClient = await createSupabaseServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: subs } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', user.id)

  if (!subs?.length) {
    return NextResponse.json({ error: 'No push subscriptions found. Enable notifications first.' }, { status: 400 })
  }

  let sent = 0
  const errors: string[] = []

  for (const sub of subs) {
    try {
      await sendPush(sub, {
        title: 'My Cycling Coach',
        body: 'Test notification — push is working correctly.',
        url: '/dashboard',
      })
      sent++
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode
      if (statusCode === 410) {
        await db.from('push_subscriptions').delete().eq('id', sub.id)
        errors.push('One subscription was expired and has been removed.')
      } else {
        errors.push(`Push failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  if (sent === 0) {
    return NextResponse.json({ error: errors.join(' ') || 'Push delivery failed.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, sent })
}
