import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: entries, error } = await supabase
    .from('weight_log')
    .select('id, date, weight_kg')
    .eq('user_id', user.id)
    .order('date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entries: entries ?? [] })
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const weight_kg = typeof body.weight_kg === 'number' ? body.weight_kg : null
  if (weight_kg === null) return NextResponse.json({ error: 'weight_kg required' }, { status: 400 })

  const today = new Date().toISOString().split('T')[0]
  const date: string = typeof body.date === 'string' ? body.date : today

  const { data: entry, error } = await supabase
    .from('weight_log')
    .upsert({ user_id: user.id, date, weight_kg }, { onConflict: 'user_id,date' })
    .select('id, date, weight_kg')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Update user_profile.weight_kg if this is the most recent entry
  const { data: latest } = await supabase
    .from('weight_log')
    .select('date, weight_kg')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (latest && latest.date === date) {
    await supabase.from('user_profile').update({ weight_kg }).eq('user_id', user.id)

    const { data: profile } = await supabase
      .from('user_profile')
      .select('intervals_icu_athlete_id, intervals_icu_api_key')
      .maybeSingle()

    if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      await client.updateAthleteWeight(weight_kg).catch(() => {})
    }
  }

  return NextResponse.json({ entry })
}

export async function DELETE(req: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase.from('weight_log').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Re-sync user_profile.weight_kg to the new most-recent entry after deletion
  const { data: latest } = await supabase
    .from('weight_log')
    .select('date, weight_kg')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (latest) {
    await supabase.from('user_profile').update({ weight_kg: latest.weight_kg }).eq('user_id', user.id)
    const { data: profile } = await supabase
      .from('user_profile')
      .select('intervals_icu_athlete_id, intervals_icu_api_key')
      .maybeSingle()
    if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
      const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
      await client.updateAthleteWeight(latest.weight_kg).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true })
}
