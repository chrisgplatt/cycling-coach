import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { computeAllTimeBestsByPeriod, type BestsRide } from '@/lib/ride/all-time-bests'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rows, error } = await supabase
    .from('workouts')
    .select('id, icu_activity_id, date, activity_metrics')
    .eq('user_id', user.id)
    .in('status', ['completed', 'needs_review'])
    .not('activity_metrics', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rides = (rows ?? []) as BestsRide[]
  return NextResponse.json(computeAllTimeBestsByPeriod(rides))
}
