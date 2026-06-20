import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { GarminClient } from '@/lib/garmin/client'

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { email?: string; password?: string }
  const { email, password } = body
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: 'Email and password required' })
  }

  try {
    await GarminClient.fromCredentials(email, password)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authentication failed'
    return NextResponse.json({ ok: false, error: message })
  }
}
