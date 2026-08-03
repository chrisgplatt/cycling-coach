import { computeProgressMetrics } from '@/lib/progress/metrics'
import type { ICUActivity, ICUWellness, WeightEntry } from '@/types'

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

// Helper to build a minimal ICUActivity fixture
function act(date: string, type: string = 'Ride'): ICUActivity {
  return { start_date_local: `${date}T09:00:00`, category: 'WORKOUT', name: 'Ride', type } as unknown as ICUActivity
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

  it('excludes a pending optional workout from adherence total', () => {
    const workouts = [
      { status: 'completed' as const, date: '2026-05-01' },
      { status: 'planned' as const, date: '2026-05-03', optional: true },
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], workouts)
    expect(result.adherence).toEqual({ completed: 1, total: 1 })
  })

  it('excludes a skipped optional workout from adherence total', () => {
    const workouts = [
      { status: 'completed' as const, date: '2026-05-01' },
      { status: 'skipped' as const, date: '2026-05-03', optional: true },
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], workouts)
    expect(result.adherence).toEqual({ completed: 1, total: 1 })
  })

  it('counts a needs_review optional workout as done in both total and completed', () => {
    const workouts = [
      { status: 'completed' as const, date: '2026-05-01' },
      { status: 'needs_review' as const, date: '2026-05-03', optional: true },
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], workouts)
    expect(result.adherence).toEqual({ completed: 2, total: 2 })
  })

  it('counts a completed optional workout the same as a non-optional one', () => {
    const workouts = [
      { status: 'completed' as const, date: '2026-05-01', optional: true },
      { status: 'completed' as const, date: '2026-05-03' },
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], workouts)
    expect(result.adherence).toEqual({ completed: 2, total: 2 })
  })

  it('does not count a non-optional needs_review workout as completed', () => {
    const workouts = [
      { status: 'completed' as const, date: '2026-05-01' },
      { status: 'needs_review' as const, date: '2026-05-03' },
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], workouts)
    expect(result.adherence).toEqual({ completed: 1, total: 2 })
  })

  it('exposes planPhase and targetEvent from plan', () => {
    const result = computeProgressMetrics([], 245, 73.5, plan, [], [])
    expect(result.planPhase).toBe('build')
    expect(result.targetEvent).toBe('Dragon Ride')
    expect(result.targetDate).toBe('2026-09-01')
    expect(result.planStartDate).toBe('2026-04-01')
  })

  it('does not expose wkg', () => {
    const result = computeProgressMetrics([], 245, 73.5, plan, weightLog, [])
    expect(result).not.toHaveProperty('wkg')
  })

  // Rides tests
  it('counts activities since plan start', () => {
    const activities = [
      act('2026-04-02'), // after plan start (2026-04-01) → counted
      act('2026-04-15'), // after → counted
      act('2026-03-15'), // before → not counted
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], [], activities)
    expect(result.totalRides).toBe(2)
  })

  it('returns null totalRides when activities array is empty', () => {
    const result = computeProgressMetrics([], 245, 73.5, plan, [], [], [])
    expect(result.totalRides).toBeNull()
  })

  it('counts an activity on the exact plan start date', () => {
    const activities = [
      act('2026-04-01'), // exact plan start date → should count (>=)
      act('2026-03-31'), // day before → should NOT count
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], [], activities)
    expect(result.totalRides).toBe(1)
  })

  it('uses 6-week fallback baseline when there is no plan', () => {
    // Baseline is 42 days before the current date, computed at test-run time
    // to avoid hardcoded dates drifting out of the fallback window.
    const withinWindow = new Date()
    withinWindow.setDate(withinWindow.getDate() - 10)
    const outsideWindow = new Date()
    outsideWindow.setDate(outsideWindow.getDate() - 50)
    const activities = [
      act(withinWindow.toISOString().split('T')[0]), // within 6 weeks → counted
      act(outsideWindow.toISOString().split('T')[0]), // older than 6 weeks → NOT counted
    ]
    const result = computeProgressMetrics([], 245, 73.5, null, [], [], activities)
    expect(result.totalRides).toBe(1)
  })

  it('excludes non-ride activity types (Run, Walk) from the rides count', () => {
    const activities = [
      act('2026-04-02', 'Ride'),
      act('2026-04-03', 'VirtualRide'),
      act('2026-04-04', 'Run'),
      act('2026-04-05', 'Walk'),
    ]
    const result = computeProgressMetrics([], 245, 73.5, plan, [], [], activities)
    expect(result.totalRides).toBe(2)
  })
})
