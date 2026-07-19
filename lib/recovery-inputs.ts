import type { SupabaseClient } from '@supabase/supabase-js'
import { IntervalsClient } from '@/lib/intervals/client'
import { mergeGarminIntoWellness } from '@/lib/garmin-wellness-merge'
import { HRV_WINDOW_DAYS } from '@/lib/hrv/server'
import { computeHrvStatusBestSource } from '@/lib/hrv/best-source'
import type { RecoveryInputs } from '@/lib/recovery-score'
import type { GarminWellness } from '@/types'

export interface RecoveryInputsRangeResult {
  date: string
  inputs: RecoveryInputs
}

/** Single shared source of Recovery inputs, used identically for a bulk historical range
 * (the charts route) or a single date (the briefing route calls this with from === to).
 * Does every piece of I/O exactly once, widened backward by HRV_WINDOW_DAYS so every
 * visible date has enough trailing history for a sufficient HRV baseline. */
export async function fetchRecoveryInputsForRange(
  supabase: SupabaseClient,
  userId: string,
  icuClient: IntervalsClient,
  range: { from: string; to: string },
): Promise<RecoveryInputsRangeResult[]> {
  const widenedFrom = new Date(new Date(range.from + 'T00:00:00Z').getTime() - HRV_WINDOW_DAYS * 864e5)
    .toISOString().split('T')[0]

  const [rawWellness, { data: garminRows }, { data: dailyWellnessRows }] = await Promise.all([
    icuClient.getWellness(widenedFrom, range.to),
    supabase
      .from('garmin_wellness')
      .select('date, garmin_hrv_overnight, garmin_sleep_deep_secs, garmin_sleep_light_secs, garmin_sleep_rem_secs, garmin_sleep_awake_secs')
      .eq('user_id', userId)
      .gte('date', widenedFrom)
      .lte('date', range.to),
    supabase
      .from('daily_wellness')
      .select('date, energy, leg_freshness')
      .eq('user_id', userId)
      .gte('date', widenedFrom)
      .lte('date', range.to),
  ])

  const garminHistory = (garminRows ?? []) as Array<Pick<GarminWellness,
    'date' | 'garmin_hrv_overnight' | 'garmin_sleep_deep_secs' | 'garmin_sleep_light_secs' | 'garmin_sleep_rem_secs' | 'garmin_sleep_awake_secs'>>

  const wellness = mergeGarminIntoWellness(
    rawWellness,
    garminHistory.map(g => ({ ...g } as GarminWellness)),
  )
  const wellnessByDate = new Map(wellness.map(w => [w.id, w]))
  const dailyWellnessByDate = new Map(
    (dailyWellnessRows ?? []).map(d => [d.date as string, d as { energy: number | null; leg_freshness: number | null }]),
  )

  const icuWellnessHrv = wellness.map(w => ({ id: w.id, hrv: w.hrv }))
  const garminHrvHistory = garminHistory.map(g => ({ id: g.date, hrv: g.garmin_hrv_overnight ?? null }))

  const visibleDates = wellness
    .map(w => w.id)
    .filter(id => id >= range.from && id <= range.to)
    .sort((a, b) => a.localeCompare(b))

  return visibleDates.map((date): RecoveryInputsRangeResult => {
    const w = wellnessByDate.get(date)!
    const hrvStatus = computeHrvStatusBestSource(icuWellnessHrv, garminHrvHistory, date)
    const dw = dailyWellnessByDate.get(date)
    const tsb = w.form ?? (w.ctl != null && w.atl != null ? w.ctl - w.atl : null)
    return {
      date,
      inputs: {
        hrv: hrvStatus.today,
        hrvBaseline: hrvStatus.baselineMean,
        garmin_sleep_deep_secs: w.garmin_sleep_deep_secs ?? null,
        garmin_sleep_light_secs: w.garmin_sleep_light_secs ?? null,
        garmin_sleep_rem_secs: w.garmin_sleep_rem_secs ?? null,
        garmin_sleep_awake_secs: w.garmin_sleep_awake_secs ?? null,
        body_battery_high: w.body_battery_high ?? null,
        energy: dw?.energy ?? null,
        leg_freshness: dw?.leg_freshness ?? null,
        tsb,
      },
    }
  })
}
