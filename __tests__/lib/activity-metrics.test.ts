/** @jest-environment node */
import { extractActivityMetrics, formatActivityMetrics, formatRideExecution } from '@/lib/claude/activity-metrics'
import type { ICUActivity, ICUPowerCurvePoint, ActivityInterval, WorkoutStep, ActivityMetrics } from '@/types'
import { makeActivityMetrics } from '../support/factories'

const act: ICUActivity = {
  id: 'a1', start_date_local: '2026-05-28T08:00:00', type: 'Ride',
  moving_time: 3600, name: 'Threshold', average_watts: 231, max_watts: 612,
  weighted_average_watts: 248, average_heartrate: 152, training_load: 78,
  rolling_ftp: 250, distance: 32500, total_elevation_gain: 84, left_right_balance: 51,
}

const curve: ICUPowerCurvePoint[] = [
  { secs: 5, watts: 600 }, { secs: 15, watts: 520 }, { secs: 60, watts: 400 },
  { secs: 300, watts: 312 }, { secs: 1200, watts: 264 },
]

const intervals: ActivityInterval[] = [
  { label: 'Work', duration_secs: 480, avg_watts: 248, avg_hr: 161 },
]

describe('extractActivityMetrics', () => {
  it('maps tier-1 scalars from the activity', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.np).toBe(248)
    expect(m.avg_power).toBe(231)
    expect(m.max_power).toBe(612)
    expect(m.avg_hr).toBe(152)
    expect(m.distance_m).toBe(32500)
    expect(m.elevation_m).toBe(84)
    expect(m.lr_balance).toBe(51)
    expect(typeof m.synced_at).toBe('string')
  })

  it('samples best efforts at canonical durations present in the curve', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.best_efforts).toEqual([
      { secs: 5, watts: 600 }, { secs: 15, watts: 520 }, { secs: 60, watts: 400 },
      { secs: 300, watts: 312 }, { secs: 1200, watts: 264 },
    ])
  })

  it('omits canonical durations with no nearby curve point (no fabricated 60min best)', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.best_efforts?.some(e => e.secs === 3600)).toBe(false)
  })

  it('sets best_efforts and intervals to null when not provided', () => {
    const m = extractActivityMetrics(act, null, null)
    expect(m.best_efforts).toBeNull()
    expect(m.intervals).toBeNull()
  })

  it('passes intervals through', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.intervals).toEqual(intervals)
  })
})

describe('formatActivityMetrics', () => {
  const base = makeActivityMetrics({
    np: 248, avg_power: 231, max_power: 612, avg_hr: 152,
    distance_m: 32500, elevation_m: 84, lr_balance: 51,
    best_efforts: [{ secs: 300, watts: 312 }, { secs: 1200, watts: 264 }],
    synced_at: '2026-05-28T09:00:00Z',
  })

  it('formats a compact summary line with present fields', () => {
    const s = formatActivityMetrics(base)
    expect(s).toContain('NP 248W')
    expect(s).toContain('avg 231W')
    expect(s).toContain('max 612W')
    expect(s).toContain('32.5km')
    expect(s).toContain('84m climb')
    expect(s).toContain('HR 152')
    expect(s).toContain('5min best 312W')
    expect(s).toContain('20min best 264W')
    expect(s).toContain(' · ')
  })

  it('omits null fields', () => {
    const s = formatActivityMetrics({ ...base, max_power: null, avg_hr: null, best_efforts: null })
    expect(s).not.toContain('max')
    expect(s).not.toContain('HR')
    expect(s).not.toContain('best')
  })

  it('returns a fallback when nothing is present', () => {
    const s = formatActivityMetrics(makeActivityMetrics({
      np: null, avg_power: null, max_power: null, avg_hr: null, distance_m: null,
      elevation_m: null, lr_balance: null, best_efforts: null, intervals: null,
    }))
    expect(s).toBe('no power data')
  })
})

describe('formatRideExecution', () => {
  const steps: WorkoutStep[] = [
    { label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 },
    { label: 'Work', duration_minutes: 8, power_pct_ftp: 95 },
    { label: 'Recovery', duration_minutes: 4, power_pct_ftp: 55 },
  ]
  const metricsWithIntervals = makeActivityMetrics({
    np: 248, avg_power: 231, max_power: 612, avg_hr: 152, distance_m: 32500,
    elevation_m: 84, lr_balance: 51, best_efforts: null,
    intervals: [
      { label: 'Warm Up', duration_secs: 602, avg_watts: 142, avg_hr: 120 },
      { label: 'Work', duration_secs: 480, avg_watts: 244, avg_hr: 161 },
    ],
    synced_at: '2026-05-28T09:00:00Z',
  })

  it('lays planned steps and actual intervals side by side', () => {
    const s = formatRideExecution(steps, metricsWithIntervals)
    expect(s).toContain('Planned steps:')
    expect(s).toContain('Warm Up 10min @ 60%')
    expect(s).toContain('Work 8min @ 95%')
    expect(s).toContain('Actual intervals:')
    expect(s).toContain('Work 8:00 avg 244W HR 161')
  })

  it('returns empty string when there are no planned steps', () => {
    expect(formatRideExecution(null, metricsWithIntervals)).toBe('')
    expect(formatRideExecution([], metricsWithIntervals)).toBe('')
  })

  it('returns empty string when there are no detected intervals', () => {
    expect(formatRideExecution(steps, { ...metricsWithIntervals, intervals: null })).toBe('')
  })
})

import { formatRideShape } from '@/lib/claude/activity-metrics'
import type { ActivityMetrics as AM } from '@/types'

describe('insight formatting', () => {
  const m: AM = {
    np: 240, avg_power: 230, max_power: 600, avg_hr: 150, distance_m: 40000,
    elevation_m: 500, lr_balance: 50, best_efforts: null, intervals: null,
    decoupling_pct: 6.2,
    time_in_zone: { z1: 0, z2: 6800, z3: 2200, z4: 800, z5: 0, z6: 0 },
    climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
    shape: [{ label: 'Work', planned_w: 250, actual_w: 238 }],
    synced_at: '2026-05-31T00:00:00Z',
  }

  it('formatActivityMetrics appends decoupling, zones and climbs', () => {
    const s = formatActivityMetrics(m)
    expect(s).toContain('decoupling 6.2%')
    expect(s).toContain('Z2 69%')
    expect(s).toContain('1 climb: 8min@268W')
  })

  it('formatRideShape renders planned vs actual per step', () => {
    expect(formatRideShape(m.shape)).toContain('Work: planned 250W, actual 238W')
    expect(formatRideShape(null)).toBe('')
  })
})
