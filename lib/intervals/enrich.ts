import type { SupabaseClient } from '@supabase/supabase-js'
import type { ICUActivity, ActivityMetrics, WorkoutStep, RideStreams } from '@/types'
import type { IntervalsClient } from './client'
import { extractActivityMetrics, extractStreamInsights, extractDistributions } from '@/lib/claude/activity-metrics'

// An empty streams object: lets a stream-less ride still produce a (fully-null)
// distributions object instead of a bare null, so the backfill predicate
// (activity_metrics->distributions IS NULL) treats it as processed.
const EMPTY_STREAMS: RideStreams = {
  time: [], distance: [], latlng: null, power: null, hr: null, altitude: null, cadence: null, velocity: null,
}

// Build the full metrics blob for an activity already in hand. Each extra call
// degrades gracefully — a failure leaves that tier null. Streams (full
// resolution) feed the four derived coaching insights; zones/shape need FTP.
export async function enrichActivity(
  client: IntervalsClient,
  activity: ICUActivity,
  ftp: number | null,
  lthr: number | null,
  plannedSteps: WorkoutStep[] | null,
): Promise<ActivityMetrics> {
  const date = activity.start_date_local.split('T')[0]
  const [curve, intervals, streams] = await Promise.all([
    client.getPowerCurve(date, date).catch(() => null),
    client.getActivityIntervals(activity.id).catch(() => null),
    client.getActivityStreams(activity.id).catch(() => null),
  ])
  const base = extractActivityMetrics(activity, curve, intervals)
  if (!streams) {
    return { ...base, distributions: extractDistributions(EMPTY_STREAMS, ftp, lthr, base.np, base.avg_power) }
  }
  return {
    ...base,
    ...extractStreamInsights(streams, ftp, plannedSteps, intervals),
    distributions: extractDistributions(streams, ftp, lthr, base.np, base.avg_power),
  }
}

export async function enrichActivityById(
  client: IntervalsClient,
  activityId: string,
  ftp: number | null,
  lthr: number | null,
  plannedSteps: WorkoutStep[] | null,
): Promise<ActivityMetrics> {
  const activity = await client.getActivity(activityId)
  return enrichActivity(client, activity, ftp, lthr, plannedSteps)
}

const BACKFILL_LIMIT = 25

// Self-healing pass: enrich up to BACKFILL_LIMIT completed rides in the last 90
// days that have an icu_activity_id but no distributions yet. Newest first.
// Per-ride failures are logged and skipped. Returns the number enriched.
// Note: zones bucket against the athlete's CURRENT FTP at sync time.
export async function backfillActivityMetrics(
  supabase: SupabaseClient,
  client: IntervalsClient,
  userId: string,
): Promise<number> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0]

  const { data: profile } = await supabase
    .from('user_profile')
    .select('current_ftp')
    .maybeSingle()
  const ftp = (profile as { current_ftp?: number | null } | null)?.current_ftp ?? null
  const lthr = await client.getRideLthr().catch(() => null)

  // Project the distributions sub-value (null when the key is absent or JSON-null)
  // and filter in code. A PostgREST `activity_metrics->distributions IS NULL`
  // predicate does NOT filter as expected — it left already-enriched rows matching,
  // so the backfill kept reprocessing the same newest rows and never advanced.
  const { data: rows, error } = await supabase
    .from('workouts')
    .select('id, icu_activity_id, steps, dist:activity_metrics->distributions')
    .eq('user_id', userId)
    .in('status', ['completed', 'needs_review'])
    .gte('date', ninetyDaysAgo)
    .not('icu_activity_id', 'is', null)
    .order('date', { ascending: false })

  if (error) {
    console.error('[backfill] query failed:', error.message)
    return 0
  }

  const needing = ((rows ?? []) as Array<{ id: string; icu_activity_id: string; steps: WorkoutStep[] | null; dist: unknown }>)
    .filter(row => row.dist == null)
    .slice(0, BACKFILL_LIMIT)

  let count = 0
  for (const row of needing) {
    try {
      const metrics = await enrichActivityById(client, row.icu_activity_id, ftp, lthr, row.steps)
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
