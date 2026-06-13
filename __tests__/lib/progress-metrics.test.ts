import { computeProgressMetrics } from '@/lib/progress/metrics'
import type { ICUWellness, WeightEntry } from '@/types'

const baseWellness = {
  atl: 60, form: -5, hrv: null, resting_hr: null, sleep_secs: null,
  body_battery_low: null, body_battery_high: null, stress_avg: null,
  stress_high: null, garmin_training_load: null, sleep_score: null,
}

const wellness: ICUWellness[] = [
  { id: '2026-04-01', ctl: 55, ...baseWellness },
  { id: '2026-06-13', ctl: 70, ...baseWellness },
]

const weightLog: WeightEntry[] = [
  { id: 'w1', date: '2026-04-01', weight_kg: 75.0 },
  { id: 'w2', date: '2026-06-13', weight_kg: 73.5 },
]

const plan = {
  created_at: '2026-04-01T00:00:00Z',
  baseline_ftp: 230,
  phase: 'build',
  target_event_name: 'Dragon Ride',
  target_event_date: '2026-09-01',
}

describe('computeProgressMetrics', () => {
  it('computes FTP delta from baseline_ftp', () => {
    const result = computeProgressMetrics([], 245, 73.5, plan, [], [])
    expect(result.ftp).toEqual({ current: 245, baseline: 230, delta: 15 })
  })

  it('returns null ftp when plan has no baseline_ftp', () => {
    const result = computeProgressMetrics([], 245, 73.5, { ...plan, baseline_ftp: null }, [], [])
    expect(result.ftp).toBeNull()
  })

  it('returns null ftp when there is no plan', () => {
    const result = computeProgressMetrics([], 245, 73.5, null, [], [])
    expect(result.ftp).toBeNull()
  })

  it('computes CTL delta from wellness array relative to plan start', () => {
    const result = computeProgressMetrics(wellness, 245, 73.5, plan, [], [])
    expect(result.ctl).toEqual({ current: 70, baseline: 55, delta: 15 })
  })

  it('computes CTL delta using oldest entry when no plan', () => {
    const result = computeProgressMetrics(wellness, 245, 73.5, null, [], [])
    expect(result.ctl).toEqual({ current: 70, baseline: 55, delta: 15 })
  })

  it('returns null CTL when wellness is empty', () => {
    const result = computeProgressMetrics([], 245, 73.5, plan, [], [])
    expect(result.ctl).toBeNull()
  })

  it('computes weight delta against plan start entry', () => {
    const result = computeProgressMetrics([], 245, 73.5, plan, weightLog, [])
    expect(result.weight).toEqual({ current: 73.5, baseline: 75.0, delta: -1.5 })
  })

  it('computes w/kg delta when both ftp and weight baselines exist', () => {
    const result = computeProgressMetrics([], 245, 73.5, plan, weightLog, [])
    expect(result.wkg?.current).toBeCloseTo(245 / 73.5, 2)
    expect(result.wkg?.baseline).toBeCloseTo(230 / 75.0, 2)
    expect(result.wkg?.delta).toBeCloseTo((245 / 73.5) - (230 / 75.0), 2)
  })

  it('computes adherence from completed workouts up to today', () => {
    const workouts = [
      { status: 'completed' as const, date: '2026-05-01' },
      { status: 'completed' as const, date: '2026-05-03' },
      { status: 'skipped' as const, date: '2026-05-05' },
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], workouts)
    expect(result.adherence).toEqual({ completed: 2, total: 3 })
  })

  it('returns null adherence when there is no plan', () => {
    const result = computeProgressMetrics([], 245, 73.5, null, [], [])
    expect(result.adherence).toBeNull()
  })

  it('exposes planPhase and targetEvent from plan', () => {
    const result = computeProgressMetrics([], 245, 73.5, plan, [], [])
    expect(result.planPhase).toBe('build')
    expect(result.targetEvent).toBe('Dragon Ride')
    expect(result.targetDate).toBe('2026-09-01')
    expect(result.planStartDate).toBe('2026-04-01')
  })
})
