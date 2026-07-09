import type { SupabaseClient } from '@supabase/supabase-js'
import { IntervalsClient } from '@/lib/intervals/client'

// Push a new FTP to intervals.icu's Ride sport-settings entry, mirroring the sync
// PATCH /api/profile already performs when current_ftp changes — best-effort, a
// failure here must never block the caller's own database write from succeeding.
export async function syncFtpToIntervalsIcu(supabase: SupabaseClient, newFtp: number): Promise<void> {
  const { data: profileRow } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()
  if (profileRow?.intervals_icu_athlete_id && profileRow?.intervals_icu_api_key) {
    const client = new IntervalsClient(profileRow.intervals_icu_athlete_id, profileRow.intervals_icu_api_key)
    await client.updateRideFTP(newFtp).catch(() => {})
  }
}
