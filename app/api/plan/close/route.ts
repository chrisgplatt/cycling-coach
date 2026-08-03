import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { archivePlan } from '@/lib/plan/archive'

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

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()
  const client = profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key
    ? new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    : null

  const today = new Date().toISOString().split('T')[0]
  const result = await archivePlan(supabase, client, activePlan.id, today)
  if (!result.archived) return NextResponse.json({ error: 'Plan already closed' }, { status: 400 })

  return NextResponse.json({ deleted: result.deleted, failed: result.failed })
}
