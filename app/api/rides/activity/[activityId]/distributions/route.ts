import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// Persisted within-session distributions for an activity, read from the linked
// workout row (keyed by icu_activity_id). Null when there is no row or it has not
// been enriched yet. Scoped to the signed-in user.
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

  const metrics = (rows?.[0]?.activity_metrics ?? null) as { distributions?: unknown } | null
  return NextResponse.json({ distributions: metrics?.distributions ?? null })
}
