import { buildArchiveSummary } from '@/lib/plan/archive'
import { makeWorkout } from '../support/factories'
import type { ICUActivity, ICUWellness } from '@/types'

function activity(over: Partial<ICUActivity>): ICUActivity {
  return {
    id: 'a', start_date_local: '2026-05-01T08:00:00', type: 'Ride', moving_time: 3600,
    name: 'Ride', average_watts: 200, max_watts: 500, weighted_average_watts: 210,
    average_heartrate: 150, training_load: 50, rolling_ftp: null, distance: null,
    total_elevation_gain: null, left_right_balance: null, ...over,
  }
}

function wellness(over: Partial<ICUWellness>): ICUWellness {
  return {
    id: '2026-05-01', ctl: null, atl: null, form: null, hrv: null, resting_hr: null,
    sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null,
    stress_high: null, garmin_training_load: null, sleep_score: null, ...over,
  }
}

describe('buildArchiveSummary', () => {
  const planStart = '2026-05-01'

  it('summarises a fully-completed 2-week plan closed on schedule', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-05-02', status: 'completed', steps: [{ label: 's', duration_minutes: 60, power_pct_ftp: 100 }] }),
      makeWorkout({ id: 'w2', date: '2026-05-09', status: 'completed', steps: [{ label: 's', duration_minutes: 60, power_pct_ftp: 100 }] }),
    ]
    const activities = [
      activity({ id: 'a1', start_date_local: '2026-05-02T08:00:00', training_load: 100, moving_time: 3600 }),
      activity({ id: 'a2', start_date_local: '2026-05-09T08:00:00', training_load: 100, moving_time: 3600 }),
    ]
    const wellnessRows = [
      wellness({ id: '2026-05-01', ctl: 40 }),
      wellness({ id: '2026-05-14', ctl: 48 }),
    ]
    const closureDate = '2026-05-15' // exactly 2 weeks after planStart
    const summary = buildArchiveSummary(workouts, activities, wellnessRows, planStart, 2, closureDate)

    expect(summary).toMatchObject({
      startDate: '2026-05-01',
      closedAt: '2026-05-15',
      plannedEndDate: '2026-05-15',
      closedEarly: false,
      totalPlannedSessions: 2,
      totalCompletedSessions: 2,
      totalHours: 2,
      totalTss: 200,
      ctlStart: 40,
      ctlEnd: 48,
      fitnessChange: 8,
    })
    expect(summary.weeks).toHaveLength(2)
    expect(summary.weeks[0]).toMatchObject({ weekIndex: 0, weekStart: '2026-05-01', completedSessions: 1, hours: 1 })
  })

  it('flags an early closure', () => {
    const closureDate = '2026-05-10' // 9 days in, plan is 4 weeks
    const summary = buildArchiveSummary([], [], [], planStart, 4, closureDate)
    expect(summary.closedEarly).toBe(true)
    expect(summary.plannedEndDate).toBe('2026-05-29')
  })

  it('reports null fitness fields when no wellness data is available', () => {
    const summary = buildArchiveSummary([], [], [], planStart, 1, '2026-05-08')
    expect(summary.ctlStart).toBeNull()
    expect(summary.ctlEnd).toBeNull()
    expect(summary.fitnessChange).toBeNull()
  })

  it('reports zero counts for a plan closed with no completed workouts', () => {
    const summary = buildArchiveSummary([], [], [], planStart, 1, '2026-05-08')
    expect(summary.totalPlannedSessions).toBe(0)
    expect(summary.totalCompletedSessions).toBe(0)
    expect(summary.totalHours).toBe(0)
    expect(summary.totalTss).toBe(0)
  })
})
