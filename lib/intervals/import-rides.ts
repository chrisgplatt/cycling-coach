import type { SupabaseClient } from '@supabase/supabase-js'
import type { ICUActivity } from '@/types'
import { resolveFallbackFtp, type FtpAnchor } from '@/lib/ftp/resolve-ftp'

/**
 * Creates workout rows for ICU ride activities that have no matching row in the DB.
 * Called by the sync endpoint (recent activities) and the backfill endpoint (3-month history).
 */
export async function importUnplannedRides(
  supabase: SupabaseClient,
  userId: string,
  activities: ICUActivity[],
): Promise<number> {
  const rides = activities.filter(a => /ride/i.test(a.type))
  if (rides.length === 0) return 0

  const activityIds = rides.map(a => a.id)

  // Find which activity IDs already have a workout row
  const { data: existing } = await supabase
    .from('workouts')
    .select('icu_activity_id')
    .in('icu_activity_id', activityIds)

  const existingIds = new Set((existing ?? []).map(w => w.icu_activity_id))
  const newRides = rides.filter(a => !existingIds.has(a.id))
  if (newRides.length === 0) return 0

  // Unplanned rides never have a plan_id, so the only fallback source is the confirmed
  // predictions timeline — fetched lazily, once, only if some ride actually needs it.
  let fallbackAnchors: FtpAnchor[] | null = null
  async function resolveFtp(a: ICUActivity): Promise<number | null> {
    if (a.ftp != null) return a.ftp
    if (fallbackAnchors === null) {
      const { data: predictions } = await supabase
        .from('ftp_predictions')
        .select('created_at, predicted_ftp')
        .eq('confirmed', true)
      fallbackAnchors = (predictions ?? []).map((p: { created_at: string; predicted_ftp: number }) => ({
        createdAt: p.created_at,
        predictedFtp: p.predicted_ftp,
      }))
    }
    return resolveFallbackFtp(a.start_date_local.split('T')[0], fallbackAnchors, null)
  }

  const toInsert = await Promise.all(newRides.map(async a => ({
    user_id: userId,
    plan_id: null,
    date: a.start_date_local.split('T')[0],
    type: 'endurance' as const,
    duration_minutes: Math.max(1, Math.round(a.moving_time / 60)),
    description: a.name,
    target_zones: '',
    status: 'completed' as const,
    icu_activity_id: a.id,
    tss: a.training_load,
    steps: null,
    ftp_at_completion: await resolveFtp(a),
  })))

  const { error } = await supabase.from('workouts').insert(toInsert)
  if (error) throw new Error(`Failed to insert unplanned rides: ${error.message}`)
  return toInsert.length
}
