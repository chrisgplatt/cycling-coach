import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveBikeForRide, type BikeRef } from '@/lib/gear/resolve-bike'

/**
 * Assigns a bike to completed, enriched rides that don't have one yet.
 * Runs after enrichment because `is_indoor` only exists in activity_metrics once a ride is
 * enriched; unenriched rides are left null and picked up by a later sync. Only rows with a
 * null bike_id are touched, so a manual override is never overwritten.
 */
export async function assignBikesToRides(
  supabase: SupabaseClient,
  userId: string,
  opts: { from?: string } = {},
): Promise<number> {
  const { data: bikes } = await supabase
    .from('bikes')
    .select('id, is_default, is_indoor_default, retired_at')
    .eq('user_id', userId)
  if (!bikes?.length) return 0

  let q = supabase
    .from('workouts')
    .select('id, activity_metrics')
    .eq('user_id', userId)
    .is('bike_id', null)
    .not('icu_activity_id', 'is', null)
    .not('activity_metrics', 'is', null)
  if (opts.from) q = q.gte('date', opts.from)
  const { data: rows } = await q

  const byBike = new Map<string, string[]>()
  for (const row of rows ?? []) {
    const isIndoor = (row.activity_metrics as { is_indoor?: boolean } | null)?.is_indoor ?? false
    const bikeId = resolveBikeForRide({ isIndoor }, bikes as BikeRef[])
    if (!bikeId) continue
    byBike.set(bikeId, [...(byBike.get(bikeId) ?? []), row.id as string])
  }

  let assigned = 0
  for (const [bikeId, ids] of byBike) {
    const { error } = await supabase.from('workouts').update({ bike_id: bikeId }).in('id', ids)
    if (error) throw new Error(`Failed to assign bike: ${error.message}`)
    assigned += ids.length
  }
  return assigned
}
