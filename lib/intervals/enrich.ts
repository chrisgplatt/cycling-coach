import type { SupabaseClient } from '@supabase/supabase-js'
import type { ICUActivity, ActivityMetrics } from '@/types'
import type { IntervalsClient } from './client'
import { extractActivityMetrics } from '@/lib/claude/activity-metrics'

// Build the full metrics blob for an activity already in hand. The two extra
// calls degrade gracefully — a failure leaves that tier null. The power curve
// is fetched via the day-scoped getPowerCurve (the proven endpoint the stats
// page uses for per-ride bests); if multiple rides share a day it reflects the
// day's best, which is acceptable for a best-effort summary.
export async function enrichActivity(client: IntervalsClient, activity: ICUActivity): Promise<ActivityMetrics> {
  const date = activity.start_date_local.split('T')[0]
  const [curve, intervals] = await Promise.all([
    client.getPowerCurve(date, date).catch(() => null),
    client.getActivityIntervals(activity.id).catch(() => null),
  ])
  return extractActivityMetrics(activity, curve, intervals)
}

// Fetch an activity by id (for historical rides outside the windowed list) and enrich it.
export async function enrichActivityById(client: IntervalsClient, activityId: string): Promise<ActivityMetrics> {
  const activity = await client.getActivity(activityId)
  return enrichActivity(client, activity)
}

const BACKFILL_LIMIT = 25

// Self-healing pass: enrich up to BACKFILL_LIMIT completed rides in the last 90
// days that have an icu_activity_id but no activity_metrics yet. Newest first, so
// a ride finished today is prioritised over old backlog. Per-ride failures are
// logged and skipped. Returns the number of rides successfully enriched.
export async function backfillActivityMetrics(
  supabase: SupabaseClient,
  client: IntervalsClient,
  userId: string,
): Promise<number> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0]

  const { data: rows, error } = await supabase
    .from('workouts')
    .select('id, icu_activity_id')
    .eq('user_id', userId)
    .in('status', ['completed', 'needs_review'])
    .gte('date', ninetyDaysAgo)
    .not('icu_activity_id', 'is', null)
    .is('activity_metrics', null)
    .order('date', { ascending: false })
    .limit(BACKFILL_LIMIT)

  if (error) {
    console.error('[backfill] query failed:', error.message)
    return 0
  }

  let count = 0
  for (const row of (rows ?? []) as Array<{ id: string; icu_activity_id: string }>) {
    try {
      const metrics = await enrichActivityById(client, row.icu_activity_id)
      const { error: updateError } = await supabase
        .from('workouts')
        .update({ activity_metrics: metrics })
        .eq('id', row.id)
      if (updateError) throw new Error(updateError.message)
      count++
    } catch (err) {
      console.error(`[backfill] failed to enrich workout ${row.id}:`, err)
    }
  }
  return count
}
