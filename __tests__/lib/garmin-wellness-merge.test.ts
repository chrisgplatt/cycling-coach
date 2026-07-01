import { mergeGarminIntoWellness } from '@/lib/garmin-wellness-merge'
import type { ICUWellness, GarminWellness } from '@/types'

function icuRow(id: string): ICUWellness {
  return {
    id, ctl: 60, atl: 65, form: -5, hrv: 52, resting_hr: 58,
    sleep_secs: 28800, body_battery_low: 30, body_battery_high: 85,
    stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null,
  }
}

function garminRow(date: string, overrides: Partial<GarminWellness> = {}): GarminWellness {
  return {
    date,
    garmin_training_readiness: 75,
    garmin_recovery_time_mins: 12,
    garmin_training_status: 'productive',
    garmin_body_battery_current: 60,
    garmin_body_battery_charged: 80,
    garmin_body_battery_drained: 40,
    garmin_stress_avg: 25,
    garmin_stress_max: 55,
    garmin_hrv_overnight: 50,
    garmin_hrv_status: 'balanced',
    garmin_resting_hr: 56,
    garmin_sleep_deep_secs: 5760,
    garmin_sleep_light_secs: 14400,
    garmin_sleep_rem_secs: 7200,
    garmin_sleep_awake_secs: 1440,
    garmin_sleep_respiration_avg: 14,
    ...overrides,
  }
}

describe('mergeGarminIntoWellness', () => {
  it('merges garmin sleep-stage fields into the matching-date wellness row', () => {
    const result = mergeGarminIntoWellness([icuRow('2026-06-30')], [garminRow('2026-06-30')])
    expect(result[0].garmin_sleep_deep_secs).toBe(5760)
    expect(result[0].garmin_sleep_light_secs).toBe(14400)
    expect(result[0].garmin_sleep_rem_secs).toBe(7200)
    expect(result[0].garmin_sleep_awake_secs).toBe(1440)
  })

  it('maps garmin_stress_avg to garmin_stress_avg_direct (field name differs between tables)', () => {
    const result = mergeGarminIntoWellness([icuRow('2026-06-30')], [garminRow('2026-06-30', { garmin_stress_avg: 33 })])
    expect(result[0].garmin_stress_avg_direct).toBe(33)
  })

  it('merges training readiness, body battery, and hrv-overnight fields', () => {
    const result = mergeGarminIntoWellness([icuRow('2026-06-30')], [garminRow('2026-06-30')])
    expect(result[0].garmin_training_readiness).toBe(75)
    expect(result[0].garmin_recovery_time_mins).toBe(12)
    expect(result[0].garmin_body_battery_current).toBe(60)
    expect(result[0].garmin_hrv_overnight).toBe(50)
    expect(result[0].garmin_resting_hr).toBe(56)
  })

  it('leaves the wellness row unchanged when no matching-date garmin row exists', () => {
    const result = mergeGarminIntoWellness([icuRow('2026-06-30')], [garminRow('2026-06-29')])
    expect(result[0].garmin_sleep_deep_secs).toBeUndefined()
    expect(result[0].id).toBe('2026-06-30')
    expect(result[0].hrv).toBe(52) // untouched ICU field
  })

  it('preserves an existing ICU value when the garmin row has null for that field', () => {
    const wellness: ICUWellness = { ...icuRow('2026-06-30'), garmin_resting_hr: 62 }
    const result = mergeGarminIntoWellness([wellness], [garminRow('2026-06-30', { garmin_resting_hr: null })])
    expect(result[0].garmin_resting_hr).toBe(62)
  })

  it('returns wellness unchanged when garminRows is empty', () => {
    const wellness = [icuRow('2026-06-30')]
    const result = mergeGarminIntoWellness(wellness, [])
    expect(result).toEqual(wellness)
  })

  it('does not mutate the input wellness array', () => {
    const wellness = [icuRow('2026-06-30')]
    mergeGarminIntoWellness(wellness, [garminRow('2026-06-30')])
    expect(wellness[0].garmin_sleep_deep_secs).toBeUndefined()
  })
})
