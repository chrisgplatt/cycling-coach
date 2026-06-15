import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: activePlan } = await supabase
    .from('training_plans')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!activePlan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const today = new Date().toISOString().split('T')[0]

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  const { data: futureWorkouts } = await supabase
    .from('workouts')
    .select('id, intervals_icu_event_id')
    .eq('plan_id', activePlan.id)
    .neq('status', 'completed')
    .gte('date', today)

  let failed = 0
  if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
    const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    for (const w of futureWorkouts ?? []) {
      if (!w.intervals_icu_event_id) continue
      try { await client.deleteEvent(w.intervals_icu_event_id) } catch { failed++ }
    }
  }

  const ids = (futureWorkouts ?? []).map(w => w.id)
  if (ids.length > 0) {
    await supabase.from('workouts').delete().in('id', ids)
  }

  return NextResponse.json({ deleted: ids.length, failed })
}
