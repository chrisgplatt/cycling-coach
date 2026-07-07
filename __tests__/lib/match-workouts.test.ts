import { matchWorkoutsToActivities, type PendingWorkout } from '@/lib/sync/match-workouts'
import type { ICUActivity } from '@/types'

function makeActivity(overrides: Partial<ICUActivity> = {}): ICUActivity {
  return {
    id: 'act1',
    start_date_local: '2026-07-06T08:00:00',
    type: 'Ride',
    moving_time: 4500,
    name: 'Morning Ride',
    average_watts: 150,
    max_watts: 300,
    weighted_average_watts: 160,
    average_heartrate: 140,
    training_load: 70,
    rolling_ftp: null,
    distance: null,
    total_elevation_gain: null,
    left_right_balance: null,
    ...overrides,
  } as ICUActivity
}

function makeWorkout(overrides: Partial<PendingWorkout> = {}): PendingWorkout {
  return {
    id: 'w1',
    date: '2026-07-06',
    created_at: '2026-07-01T00:00:00Z',
    ...overrides,
  }
}

describe('matchWorkoutsToActivities', () => {
  it('matches a single pending workout to its single same-day ride as completed', () => {
    const workouts = [makeWorkout({ id: 'w1' })]
    const acts = new Map([['2026-07-06', [makeActivity({ id: 'act1', training_load: 70, moving_time: 4500 })]]])

    const matches = matchWorkoutsToActivities(workouts, acts)

    expect(matches).toEqual([
      { id: 'w1', icu_activity_id: 'act1', tss: 70, actual_duration_minutes: 75, status: 'completed' },
    ])
  })

  it('marks a single pending workout needs_review when multiple candidate rides exist that day', () => {
    const workouts = [makeWorkout({ id: 'w1' })]
    const acts = new Map([['2026-07-06', [
      makeActivity({ id: 'act1', training_load: 50 }),
      makeActivity({ id: 'act2', training_load: 90 }),
    ]]])

    const matches = matchWorkoutsToActivities(workouts, acts)

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ id: 'w1', icu_activity_id: 'act2', status: 'needs_review' })
  })

  it('does NOT match a single ride to two pending workouts on the same day — only the earlier-created workout is matched', () => {
    const workouts = [
      makeWorkout({ id: 'original', created_at: '2026-07-01T00:00:00Z' }),
      makeWorkout({ id: 'duplicate', created_at: '2026-07-06T09:00:00Z' }),
    ]
    const acts = new Map([['2026-07-06', [makeActivity({ id: 'act1', training_load: 70, moving_time: 4500 })]]])

    const matches = matchWorkoutsToActivities(workouts, acts)

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ id: 'original', icu_activity_id: 'act1', status: 'completed' })
    expect(matches.find(m => m.id === 'duplicate')).toBeUndefined()
  })

  it('matches two pending workouts on the same day to two distinct rides, both completed', () => {
    const workouts = [
      makeWorkout({ id: 'morning', created_at: '2026-07-01T00:00:00Z' }),
      makeWorkout({ id: 'afternoon', created_at: '2026-07-02T00:00:00Z' }),
    ]
    const acts = new Map([['2026-07-06', [
      makeActivity({ id: 'act-low', training_load: 40, moving_time: 3000 }),
      makeActivity({ id: 'act-high', training_load: 90, moving_time: 6000 }),
    ]]])

    const matches = matchWorkoutsToActivities(workouts, acts)

    expect(matches).toHaveLength(2)
    // Earliest-created workout pairs with the highest-load ride.
    expect(matches.find(m => m.id === 'morning')).toMatchObject({ icu_activity_id: 'act-high', status: 'completed' })
    expect(matches.find(m => m.id === 'afternoon')).toMatchObject({ icu_activity_id: 'act-low', status: 'completed' })
  })

  it('leaves excess workouts unmatched when there are more pending workouts than rides that day', () => {
    const workouts = [
      makeWorkout({ id: 'a', created_at: '2026-07-01T00:00:00Z' }),
      makeWorkout({ id: 'b', created_at: '2026-07-02T00:00:00Z' }),
      makeWorkout({ id: 'c', created_at: '2026-07-03T00:00:00Z' }),
    ]
    const acts = new Map([['2026-07-06', [makeActivity({ id: 'act1', training_load: 70 })]]])

    const matches = matchWorkoutsToActivities(workouts, acts)

    expect(matches).toHaveLength(1)
    expect(matches[0].id).toBe('a')
  })

  it('produces no matches when there are no rides that day', () => {
    const workouts = [makeWorkout({ id: 'w1' })]
    const acts = new Map<string, ICUActivity[]>()

    expect(matchWorkoutsToActivities(workouts, acts)).toEqual([])
  })

  it('ignores non-ride activity types when matching', () => {
    const workouts = [makeWorkout({ id: 'w1' })]
    const acts = new Map([['2026-07-06', [makeActivity({ id: 'run1', type: 'Run' })]]])

    expect(matchWorkoutsToActivities(workouts, acts)).toEqual([])
  })
})
