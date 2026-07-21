import type { SupabaseClient } from '@supabase/supabase-js'
import type { IntervalsClient } from './client'
import { extractActivityMetrics, extractStreamInsights } from '@/lib/claude/activity-metrics'
import { fetchBestRecordRows, upsertBestRecordRows, mergeCandidateIntoBests, flattenAllTimeBestsToRows } from '@/lib/ride/best-records'
import type { BestsRide } from '@/lib/ride/all-time-bests'

const DEEP_HISTORY_BATCH_SIZE = 50
const DEEP_HISTORY_FETCH_WINDOW_DAYS = 3 * 365

export interface DeepHistoryBestsResult {
  fetched: number             // ride activities found in the fetched window
  processed: number           // how many were attempted this run (<= DEEP_HISTORY_BATCH_SIZE)
  newCursor: string | null    // date to resume from next time; null if nothing was found at all
  reachedPossibleStart: boolean  // fetched < batch size — a heuristic, not a certainty
}

// One chunk of the resumable deep-history scan: fetches ride activities older
// than `cursor`, computes bests-relevant candidates purely in memory (no FTP,
// no laps, no workouts writes — ride data is discarded immediately after
// merging), and updates best_records for both "all-time" and each ride's own
// year. Mirrors this app's existing BACKFILL_LIMIT convention of a bounded,
// resumable batch (50 items/run).
export async function runDeepHistoryBestsBatch(
  supabase: SupabaseClient,
  client: IntervalsClient,
  userId: string,
  cursor: string,
): Promise<DeepHistoryBestsResult> {
  const newest = cursor
  const oldestFloor = new Date(new Date(`${cursor}T00:00:00Z`).getTime() - DEEP_HISTORY_FETCH_WINDOW_DAYS * 86400000)
    .toISOString().split('T')[0]

  const fetchedActivities = (await client.getActivities(oldestFloor, newest))
    .filter(a => /ride/i.test(a.type) && a.start_date_local.split('T')[0] < cursor)
    .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))

  if (fetchedActivities.length === 0) {
    return { fetched: 0, processed: 0, newCursor: null, reachedPossibleStart: true }
  }

  const batch = fetchedActivities.slice(0, DEEP_HISTORY_BATCH_SIZE)

  for (const activity of batch) {
    try {
      const date = activity.start_date_local.split('T')[0]
      const year = date.slice(0, 4)
      const [curve, streams] = await Promise.all([
        client.getPowerCurve(date, date).catch(() => null),
        client.getActivityStreams(activity.id).catch(() => null),
      ])
      const base = extractActivityMetrics(activity, curve, null)
      const insights = streams ? extractStreamInsights(streams, null, null, null) : { climbs: null, speed_bests: null }
      const isIndoor = base.is_indoor ?? false
      const candidate: BestsRide = {
        id: null,
        icu_activity_id: activity.id,
        date,
        activity_metrics: {
          climbs: insights.climbs,
          speed_bests: insights.speed_bests,
          best_efforts: base.best_efforts,
          max_speed_ms: base.max_speed_ms,
        },
      }

      const [allTimeRows, yearRows] = await Promise.all([
        fetchBestRecordRows(supabase, userId, 'all', isIndoor),
        fetchBestRecordRows(supabase, userId, year, isIndoor),
      ])
      const { allTime, yearBests } = mergeCandidateIntoBests(allTimeRows, yearRows, candidate)
      await upsertBestRecordRows(supabase, userId, [
        ...flattenAllTimeBestsToRows('all', allTime, isIndoor),
        ...flattenAllTimeBestsToRows(year, yearBests, isIndoor),
      ])
    } catch (err) {
      console.error(`[deep-history-bests] failed to process activity ${activity.id}:`, err)
    }
  }

  const oldestProcessedDate = batch[batch.length - 1].start_date_local.split('T')[0]
  return {
    fetched: fetchedActivities.length,
    processed: batch.length,
    newCursor: oldestProcessedDate,
    reachedPossibleStart: fetchedActivities.length < DEEP_HISTORY_BATCH_SIZE,
  }
}
