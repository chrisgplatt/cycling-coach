import { computeRecoveryScore, type RecoveryInputs } from '@/lib/recovery-score'

const ALL_DATA: RecoveryInputs = {
  hrv: 55,
  hrvBaseline: 50,             // ratio 1.10 → hrv index = 90
  garmin_sleep_deep_secs: 5760,  // 96 min = 20% of 8h → deepScore = 100
  garmin_sleep_light_secs: 14400, // 240 min
  garmin_sleep_rem_secs: 7200,   // 120 min = 25% of total → remScore = 100
  garmin_sleep_awake_secs: 1440, // 24 min; total = 28800 = 8h → durationScore = 100
  body_battery_high: 80,
  energy: 4,
  leg_freshness: 4,
  tsb: 10,                     // lerp(80,100,(10-5)/20) = 92.5
}

describe('computeRecoveryScore', () => {
  it('returns a score in [0, 100]', () => {
    const result = computeRecoveryScore(ALL_DATA)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })

  it('returns high band when all components are excellent', () => {
    const result = computeRecoveryScore(ALL_DATA)
    expect(result.band).toBe('high')
    expect(result.explanation).toBe('')
  })

  it('returns low band and explanation when HRV is suppressed', () => {
    const result = computeRecoveryScore({
      ...ALL_DATA,
      hrv: 30,          // ratio 0.60 → clamped → hrv index = 0
      energy: 1,
      leg_freshness: 1, // wellness = 0
    })
    expect(result.band).toBe('low')
    expect(result.explanation).toMatch(/HRV suppressed/)
  })

  it('excludes unavailable components from weighted average', () => {
    const noSleep: RecoveryInputs = {
      hrv: 55,
      hrvBaseline: 50,
      garmin_sleep_deep_secs: null,
      garmin_sleep_light_secs: null,
      garmin_sleep_rem_secs: null,
      garmin_sleep_awake_secs: null,
      body_battery_high: null,
      energy: 4,
      leg_freshness: 4,
      tsb: 10,
    }
    const result = computeRecoveryScore(noSleep)
    expect(result.components.sleep).toBeNull()
    expect(result.components.bodyBattery).toBeNull()
    expect(result.score).toBeGreaterThan(0)
  })

  it('returns score 50 and moderate band when no data is available', () => {
    const empty: RecoveryInputs = {
      hrv: null, hrvBaseline: null,
      garmin_sleep_deep_secs: null, garmin_sleep_light_secs: null,
      garmin_sleep_rem_secs: null, garmin_sleep_awake_secs: null,
      body_battery_high: null, energy: null, leg_freshness: null, tsb: null,
    }
    const result = computeRecoveryScore(empty)
    expect(result.score).toBe(50)
    expect(result.band).toBe('moderate')
  })

  it('HRV exactly at baseline → hrv index = 70', () => {
    const r = computeRecoveryScore({ ...ALL_DATA, hrv: 50, hrvBaseline: 50 })
    expect(r.components.hrv).toBeCloseTo(70, 0)
  })

  it('TSB at -25 → tsb index = 10', () => {
    const r = computeRecoveryScore({ ...ALL_DATA, tsb: -25 })
    expect(r.components.tsb).toBe(10)
  })

  it('sleep exactly 8h with 20% deep and 25% REM → sleep index = 100', () => {
    const r = computeRecoveryScore(ALL_DATA)
    expect(r.components.sleep).toBeCloseTo(100, 0)
  })

  it('wellness energy=1, legs=1 → wellness index = 0', () => {
    const r = computeRecoveryScore({ ...ALL_DATA, energy: 1, leg_freshness: 1 })
    expect(r.components.wellness).toBeCloseTo(0, 0)
  })

  it('wellness with one field null uses the other alone', () => {
    const r = computeRecoveryScore({ ...ALL_DATA, energy: 5, leg_freshness: null })
    expect(r.components.wellness).toBeCloseTo(100, 0)
  })

  it('explanation picks the two worst components', () => {
    const r = computeRecoveryScore({
      ...ALL_DATA,
      hrv: 25,          // HRV suppressed (ratio 0.50)
      garmin_sleep_deep_secs: 0,    // no deep sleep
      garmin_sleep_rem_secs: 0,     // no REM sleep
      garmin_sleep_light_secs: 10800, // only 3 hours total
      garmin_sleep_awake_secs: 0,
      tsb: 10,
      energy: 4,
      leg_freshness: 4,
    })
    expect(r.explanation).toMatch(/HRV suppressed/)
    expect(r.explanation).toMatch(/short/)
  })
})
