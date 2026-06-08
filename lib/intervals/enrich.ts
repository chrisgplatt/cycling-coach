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

// Diagnostics surfaced in the sync response so backfill behaviour is observable
// without server-log access.
export interface BackfillResult {
  candidates: number    // in-scope rows scanned (last 90d, completed, has activity)
  totalNeeding: number  // candidates whose activity_metrics lacks distributions
  processed: number     // how many of those we attempted this run (≤ BACKFILL_LIMIT)
  enriched: number      // successfully written
  failed: number        // threw during enrich/update
  firstError: string | null
}

// Self-healing pass: enrich up to BACKFILL_LIMIT completed rides in the last 90
// days that have an icu_activity_id but no distributions yet. Newest first.
// Per-ride failures are logged and skipped. Returns diagnostics (see BackfillResult).
// Note: zones bucket against the athlete's CURRENT FTP at sync time.
export async function backfillActivityMetrics(
  supabase: SupabaseClient,
  client: IntervalsClient,
  userId: string,
): Promise<BackfillResult> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 864e5).toISOString().split('T')[0]

  const { data: profile } = await supabase
    .from('user_profile')
    .select('current_ftp')
    .maybeSingle()
  const ftp = (profile as { current_ftp?: number | null } | null)?.current_ftp ?? null
  const lthr = await client.getRideLthr().catch(() => null)

  // Fetch the candidates' full activity_metrics and decide in code which still lack
  // distributions. Reading the real JSON and checking the key in JS avoids BOTH a
  // PostgREST `->distributions IS NULL` predicate AND a `->distributions` projection
  // alias — neither filtered reliably, leaving already-enriched rows matching, so the
  // backfill reprocessed the same newest rows forever instead of advancing.
  const { data: rows, error } = await supabase
    .from('workouts')
    .select('id, icu_activity_id, steps, activity_metrics')
    .eq('user_id', userId)
    .in('status', ['completed', 'needs_review'])
    .gte('date', ninetyDaysAgo)
    .not('icu_activity_id', 'is', null)
    .order('date', { ascending: false })

  if (error) {
    console.error('[backfill] query failed:', error.message)
    return { candidates: 0, totalNeeding: 0, processed: 0, enriched: 0, failed: 0, firstError: `query: ${error.message}` }
  }

  const candidates = (rows ?? []) as Array<{
    id: string; icu_activity_id: string; steps: WorkoutStep[] | null
    activity_metrics: { distributions?: unknown } | null
  }>
  const allNeeding = candidates.filter(row => !row.activity_metrics?.distributions)
  const needing = allNeeding.slice(0, BACKFILL_LIMIT)

  let enriched = 0
  let failed = 0
  let firstError: string | null = null
  for (const row of needing) {
    try {
      const metrics = await enrichActivityById(client, row.icu_activity_id, ftp, lthr, row.steps)
      const { error: updateError } = await supabase
        .from('workouts')
        .update({ activity_metrics: metrics })
        .eq('id', row.id)
      if (updateError) throw new Error(updateError.message)
      enriched++
    } catch (err) {
      failed++
      if (!firstError) firstError = err instanceof Error ? err.message : String(err)
      console.error(`[backfill] failed to enrich workout ${row.id}:`, err)
    }
  }
  return { candidates: candidates.length, totalNeeding: allNeeding.length, processed: needing.length, enriched, failed, firstError }
}
