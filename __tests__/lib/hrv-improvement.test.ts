/** @jest-environment node */
import { computeHrvImprovement, focusSignature } from '@/lib/hrv/improvement'
import type { ICUWellness, ICUActivity } from '@/types'

const DAY = 864e5
function dayStr(offsetFromEnd: number, end: string): string {
  return new Date(new Date(end + 'T00:00:00Z').getTime() - offsetFromEnd * DAY).toISOString().split('T')[0]
}

function wellness(days: number, end: string, hrv: (i: number) => number | null, sleepH: (i: number) => number | null): ICUWellness[] {
  return Array.from({ length: days }, (_, i) => ({
    id: dayStr(days - 1 - i, end),
    ctl: null, atl: null, form: null,
    hrv: hrv(i),
    resting_hr: null,
    sleep_secs: sleepH(i) === null ? null : (sleepH(i) as number) * 3600,
  }))
}

function ride(date: string, watts: number, tss: number, secs = 3600): ICUActivity {
  return {
    id: 'a' + date + watts, start_date_local: date + 'T08:00:00', type: 'Ride',
    moving_time: secs, name: 'Ride', average_watts: watts, max_watts: watts + 50,
    weighted_average_watts: watts, average_heartrate: 140, training_load: tss,
    rolling_ftp: null, distance: null, total_elevation_gain: null, left_right_balance: null,
  }
}

const END = '2026-06-01'

describe('computeHrvImprovement', () => {
  test('rising baseline yields a positive delta and rising trend', () => {
    const w = wellness(200, END, i => 40 + (i / 199) * 20, () => 7)
    const r = computeHrvImprovement(w, [], 250, { asOf: END })
    expect(r.hasEnoughHistory).toBe(true)
    expect(r.baselineSeries.length).toBeGreaterThan(4)
    expect(r.baselineDeltaMs as number).toBeGreaterThan(0)
    expect(r.baselineTrend).toBe('rising')
  })

  test('sleep coupled to HRV surfaces as a strong, helpful lever', () => {
    const w = wellness(180, END, i => 50 + 8 * Math.sin(i / 7), i => 7 + 1.2 * Math.sin(i / 7))
    const r = computeHrvImprovement(w, [], 250, { asOf: END })
    const sleep = r.levers.find(l => l.key === 'sleep')!
    expect(sleep.sufficient).toBe(true)
    expect(sleep.direction).toBe('helps')
    expect(['moderate', 'strong']).toContain(sleep.strength)
  })

  test('short history reports not-enough-history and falls back to sleep focus', () => {
    const w = wellness(20, END, () => 50, () => 6)
    const r = computeHrvImprovement(w, [], 250, { asOf: END })
    expect(r.hasEnoughHistory).toBe(false)
    expect(r.focus.reason).toBe('fallback_sleep')
    expect(r.focus.caveat).toBeTruthy()
  })

  test('focus picks the helpful lever with the biggest gap (low sleep)', () => {
    const w = wellness(180, END, i => 50 + 6 * Math.sin(i / 7), i => 6 + 1.0 * Math.sin(i / 7))
    const rides = Array.from({ length: 120 }, (_, k) => ride(dayStr(119 - k, END), 120, 40)) // IF 0.48 → easy, daily
    const r = computeHrvImprovement(w, rides, 250, { asOf: END })
    expect(r.focus.key).toBe('sleep')
    expect(r.focus.reason).toBe('gap_and_association')
    expect(r.focus.progressPct).not.toBeNull()
  })

  test('intensity uses per-ride IF (weighted_average_watts / ftp)', () => {
    const w = wellness(180, END, () => 50, () => 7.5)
    const hard = Array.from({ length: 60 }, (_, k) => ride(dayStr(120 - k, END), 230, 70))
    const r = computeHrvImprovement(w, hard, 250, { asOf: END })
    const intensity = r.levers.find(l => l.key === 'intensity')!
    expect(intensity.recentValue as number).toBeLessThan(0.2)
  })

  test('focusSignature is stable for the same focus and changes when it moves', () => {
    const base = { key: 'sleep' as const, reason: 'gap_and_association' as const, caveat: null, target: 7.5, recentValue: 6.4, progressPct: 85, unit: 'h' }
    expect(focusSignature(base)).toBe(focusSignature({ ...base, progressPct: 86 }))
    expect(focusSignature(base)).not.toBe(focusSignature({ ...base, recentValue: 7.1 }))
    expect(focusSignature(base)).not.toBe(focusSignature({ ...base, key: 'load', unit: 'ACWR', target: 1.3 }))
  })
})
