import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const { data, error } = await supabase
    .from('daily_wellness')
    .select('*')
    .eq('user_id', user.id)
    .gte('date', from ?? '1970-01-01')
    .lte('date', to ?? '9999-12-31')
    .order('date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ wellness: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { date, energy, leg_freshness, mood, stress, sleep_quality } = body

  if (typeof date !== 'string') return NextResponse.json({ error: 'date required' }, { status: 400 })

  const { data, error } = await supabase
    .from('daily_wellness')
    .upsert(
      { user_id: user.id, date, energy, leg_freshness, mood, stress, sleep_quality, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,date' }
    )
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ wellness: data })
}
