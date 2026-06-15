import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'

// Removes duplicate completed workouts on today's date, keeping only the one
// with the highest TSS (most likely the real completed ride).
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

  const { data: todayCompleted } = await supabase
    .from('workouts')
    .select('id, tss, intervals_icu_event_id, type')
    .eq('plan_id', activePlan.id)
    .eq('date', today)
    .eq('status', 'completed')
    .order('tss', { ascending: false })

  if (!todayCompleted || todayCompleted.length <= 1) {
    return NextResponse.json({ removed: 0, message: 'No duplicates found' })
  }

  // Keep the first (highest TSS = most likely the real completed ride), delete the rest
  const toRemove = todayCompleted.slice(1)

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  let failed = 0
  if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
    const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    for (const w of toRemove) {
      if (!w.intervals_icu_event_id) continue
      try { await client.deleteEvent(w.intervals_icu_event_id) } catch { failed++ }
    }
  }

  const ids = toRemove.map(w => w.id)
  await supabase.from('workouts').delete().in('id', ids)

  return NextResponse.json({ removed: ids.length, failed, kept: todayCompleted[0].type })
}
