import type { ICUWellness, GarminWellness } from '@/types'

export function mergeGarminIntoWellness(
  wellness: ICUWellness[],
  garminRows: GarminWellness[],
): ICUWellness[] {
  const byDate = new Map(garminRows.map(g => [g.date, g]))
  return wellness.map(w => {
    const g = byDate.get(w.id)
    if (!g) return w
    return {
      ...w,
      garmin_training_readiness: g.garmin_training_readiness ?? w.garmin_training_readiness,
      garmin_recovery_time_mins: g.garmin_recovery_time_mins ?? w.garmin_recovery_time_mins,
      garmin_training_status: g.garmin_training_status ?? w.garmin_training_status,
      garmin_body_battery_current: g.garmin_body_battery_current ?? w.garmin_body_battery_current,
      garmin_body_battery_charged: g.garmin_body_battery_charged ?? w.garmin_body_battery_charged,
      garmin_body_battery_drained: g.garmin_body_battery_drained ?? w.garmin_body_battery_drained,
      garmin_stress_avg_direct: g.garmin_stress_avg ?? w.garmin_stress_avg_direct,
      garmin_stress_max: g.garmin_stress_max ?? w.garmin_stress_max,
      garmin_hrv_overnight: g.garmin_hrv_overnight ?? w.garmin_hrv_overnight,
      garmin_hrv_status: g.garmin_hrv_status ?? w.garmin_hrv_status,
      garmin_resting_hr: g.garmin_resting_hr ?? w.garmin_resting_hr,
      garmin_sleep_deep_secs: g.garmin_sleep_deep_secs ?? w.garmin_sleep_deep_secs,
      garmin_sleep_light_secs: g.garmin_sleep_light_secs ?? w.garmin_sleep_light_secs,
      garmin_sleep_rem_secs: g.garmin_sleep_rem_secs ?? w.garmin_sleep_rem_secs,
      garmin_sleep_awake_secs: g.garmin_sleep_awake_secs ?? w.garmin_sleep_awake_secs,
      garmin_sleep_respiration_avg: g.garmin_sleep_respiration_avg ?? w.garmin_sleep_respiration_avg,
    }
  })
}
