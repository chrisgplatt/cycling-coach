import type { SupabaseClient } from '@supabase/supabase-js'
import type { ICUActivity } from '@/types'

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

  const toInsert = rides
    .filter(a => !existingIds.has(a.id))
    .map(a => ({
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
    }))

  if (toInsert.length === 0) return 0

  await supabase.from('workouts').insert(toInsert)
  return toInsert.length
}
