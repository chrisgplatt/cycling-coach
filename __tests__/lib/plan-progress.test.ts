import { plannedTss, buildWeekBuckets, weekState, consistency, planHours } from '@/lib/plan/progress'
import { makeWorkout } from '../support/factories'
import type { ICUActivity } from '@/types'

function activity(over: Partial<ICUActivity>): ICUActivity {
  return {
    id: 'a', start_date_local: '2026-05-01T08:00:00', type: 'Ride', moving_time: 3600,
    name: 'Ride', average_watts: 200, max_watts: 500, weighted_average_watts: 210,
    average_heartrate: 150, training_load: 50, rolling_ftp: null, distance: null,
    total_elevation_gain: null, left_right_balance: null, ...over,
  }
}

describe('plannedTss', () => {
  it('sums TSS from steps (duration × intensity²)', () => {
    // 60 min @ 100% FTP = 1.0² × 1h × 100 = 100 TSS
    const w = makeWorkout({ steps: [{ label: 'FTP', duration_minutes: 60, power_pct_ftp: 100 }] })
    expect(plannedTss(w)).toBe(100)
  })

  it('falls back to a type intensity factor when there are no steps', () => {
    // recovery IF 0.55 → 60min: 0.55² × 100 = ~30
    expect(plannedTss(makeWorkout({ type: 'recovery', steps: null }))).toBe(30)
  })
})

describe('buildWeekBuckets', () => {
  const planStart = '2026-05-01'
  it('buckets planned workouts and actual activity TSS by plan week', () => {
    const workouts = [
      makeWorkout({ id: 'w1', date: '2026-05-02', status: 'completed', steps: [{ label: 's', duration_minutes: 60, power_pct_ftp: 100 }] }),
      makeWorkout({ id: 'w2', date: '2026-05-10', status: 'planned', steps: [{ label: 's', duration_minutes: 60, power_pct_ftp: 100 }] }),
    ]
    const activities = [activity({ id: 'a1', start_date_local: '2026-05-03T08:00:00', training_load: 70 })]
    const buckets = buildWeekBuckets(workouts, activities, planStart, 2)
    expect(buckets[0]).toMatchObject({ weekIndex: 0, plannedTss: 100, actualTss: 70, plannedSessions: 1, completedSessions: 1 })
    expect(buckets[1]).toMatchObject({ weekIndex: 1, plannedTss: 100, plannedSessions: 1, completedSessions: 0 })
  })
})

describe('weekState', () => {
  it('classifies current, done, partial, missed and upcoming', () => {
    expect(weekState({ weekIndex: 2, plannedTss: 0, actualTss: 0, plannedSessions: 3, completedSessions: 1 }, 2)).toBe('current')
    expect(weekState({ weekIndex: 0, plannedTss: 0, actualTss: 0, plannedSessions: 3, completedSessions: 3 }, 2)).toBe('done')
    expect(weekState({ weekIndex: 0, plannedTss: 0, actualTss: 0, plannedSessions: 3, completedSessions: 1 }, 2)).toBe('partial')
    expect(weekState({ weekIndex: 0, plannedTss: 0, actualTss: 0, plannedSessions: 3, completedSessions: 0 }, 2)).toBe('missed')
    expect(weekState({ weekIndex: 5, plannedTss: 0, actualTss: 0, plannedSessions: 3, completedSessions: 0 }, 2)).toBe('upcoming')
  })
})

describe('consistency', () => {
  it('computes hit % over due weeks and a streak that stops below 80%', () => {
    const buckets = [
      { weekIndex: 0, plannedTss: 0, actualTss: 0, plannedSessions: 4, completedSessions: 4 },
      { weekIndex: 1, plannedTss: 0, actualTss: 0, plannedSessions: 4, completedSessions: 2 }, // 50% → breaks streak
      { weekIndex: 2, plannedTss: 0, actualTss: 0, plannedSessions: 4, completedSessions: 4 },
    ]
    const res = consistency(buckets, 3)
    expect(res.hitPct).toBe(83) // 10/12
    expect(res.streak).toBe(1)  // week 2 only (week 1 breaks it)
  })
})

describe('planHours', () => {
  it('uses linked activity moving time, else planned duration, for completed sessions', () => {
    const workouts = [
      makeWorkout({ id: 'w1', status: 'completed', icu_activity_id: 'a1', duration_minutes: 60 }),
      makeWorkout({ id: 'w2', status: 'completed', icu_activity_id: null, duration_minutes: 30 }),
      makeWorkout({ id: 'w3', status: 'planned', duration_minutes: 90 }),
    ]
    const activities = [activity({ id: 'a1', moving_time: 5400 })] // 1.5h
    expect(planHours(workouts, activities)).toBe(2) // 1.5h + 0.5h
  })
})
