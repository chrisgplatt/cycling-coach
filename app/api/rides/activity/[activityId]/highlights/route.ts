import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// Persisted ride highlights (climbs, effort periods, sprints, personal bests)
// for an activity, read from the linked workout row (keyed by icu_activity_id).
// Each field is null when there's no row or it hasn't been enriched yet.
// Scoped to the signed-in user. Mirrors the /distributions route exactly.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ activityId: string }> },
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { activityId } = await params
  if (!activityId) return NextResponse.json({ error: 'Missing activity id' }, { status: 400 })

  const { data: rows } = await supabase
    .from('workouts')
    .select('activity_metrics')
    .eq('user_id', user.id)
    .eq('icu_activity_id', activityId)
    .limit(1)

  const metrics = (rows?.[0]?.activity_metrics ?? null) as {
    climbs?: unknown; effort_periods?: unknown; sprints?: unknown; personal_bests?: unknown
  } | null
  return NextResponse.json({
    climbs: metrics?.climbs ?? null,
    effort_periods: metrics?.effort_periods ?? null,
    sprints: metrics?.sprints ?? null,
    personal_bests: metrics?.personal_bests ?? null,
  })
}
