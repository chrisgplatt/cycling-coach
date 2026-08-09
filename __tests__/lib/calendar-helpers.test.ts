import {
  calendarMonthDays,
  weekDates,
  formatDurationMins,
  formatMovingTime,
  toLocalDateStr,
  weekdayName,
  labelDate,
  weekStartsAround,
  weekStartsAfter,
  getDayWorkoutColor,
  getWeeklySummary,
  pickTodayWorkout,
} from '@/lib/calendar-helpers'
import type { Workout, ICUActivity } from '@/types'

describe('calendarMonthDays', () => {
  it('returns dimmed leading days from the previous month for May 2026 (Friday 1st → 4 leading days)', () => {
    const grid = calendarMonthDays(2026, 4) // month 4 = May
    expect(grid.slice(0, 4)).toEqual([
      { date: '2026-04-27', inMonth: false },
      { date: '2026-04-28', inMonth: false },
      { date: '2026-04-29', inMonth: false },
      { date: '2026-04-30', inMonth: false },
    ])
    expect(grid[4]).toEqual({ date: '2026-05-01', inMonth: true })
  })

  it('returns no leading days for a month starting on Monday', () => {
    // June 2026 starts on Monday
    const grid = calendarMonthDays(2026, 5) // month 5 = June
    expect(grid[0]).toEqual({ date: '2026-06-01', inMonth: true })
  })

  it('returns 6 leading days from the previous month for a month starting on Sunday', () => {
    // March 2026 starts on Sunday
    const grid = calendarMonthDays(2026, 2) // month 2 = March
    expect(grid.slice(0, 6)).toEqual([
      { date: '2026-02-23', inMonth: false },
      { date: '2026-02-24', inMonth: false },
      { date: '2026-02-25', inMonth: false },
      { date: '2026-02-26', inMonth: false },
      { date: '2026-02-27', inMonth: false },
      { date: '2026-02-28', inMonth: false },
    ])
    expect(grid[6]).toEqual({ date: '2026-03-01', inMonth: true })
  })

  it('adds trailing days from the next month so the grid always ends on a Sunday', () => {
    // July 2026: 1st is Wednesday (2 leading days from June), 31 days, 31st is a
    // Friday (2 trailing days into August needed to reach Sunday).
    const grid = calendarMonthDays(2026, 6) // month 6 = July
    expect(grid).toHaveLength(35) // 2 leading + 31 + 2 trailing = 35 = 5 * 7
    expect(grid[0]).toEqual({ date: '2026-06-29', inMonth: false })
    expect(grid[1]).toEqual({ date: '2026-06-30', inMonth: false })
    expect(grid[2]).toEqual({ date: '2026-07-01', inMonth: true })
    expect(grid[grid.length - 3]).toEqual({ date: '2026-07-31', inMonth: true })
    expect(grid[grid.length - 2]).toEqual({ date: '2026-08-01', inMonth: false })
    expect(grid[grid.length - 1]).toEqual({ date: '2026-08-02', inMonth: false })
  })

  it('adds no trailing days when the month already ends on a Sunday', () => {
    // May 2026 has 31 days starting Friday 1st, so May 31 is a Sunday.
    const grid = calendarMonthDays(2026, 4)
    expect(grid[grid.length - 1]).toEqual({ date: '2026-05-31', inMonth: true })
  })

  it('rolls over the year boundary correctly for December/January', () => {
    // December 2026 starts on a Tuesday (1 leading day from November).
    const grid = calendarMonthDays(2026, 11) // month 11 = December
    expect(grid[0]).toEqual({ date: '2026-11-30', inMonth: false })
    expect(grid[1]).toEqual({ date: '2026-12-01', inMonth: true })
    // December 31 2026 is a Thursday, so 3 trailing days into January 2027 are needed.
    expect(grid[grid.length - 1]).toEqual({ date: '2027-01-03', inMonth: false })
  })
})

describe('weekDates', () => {
  it('returns 7 dates Mon–Sun for a mid-week date', () => {
    const dates = weekDates('2026-05-26') // Tuesday
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe('2026-05-25') // Monday
    expect(dates[6]).toBe('2026-05-31') // Sunday
  })

  it('handles a week crossing a month boundary', () => {
    const dates = weekDates('2026-05-31') // Sunday (end of week)
    expect(dates[0]).toBe('2026-05-25')
    expect(dates[6]).toBe('2026-05-31')
  })

  it('handles a Monday as input', () => {
    const dates = weekDates('2026-05-25')
    expect(dates[0]).toBe('2026-05-25')
    expect(dates[6]).toBe('2026-05-31')
  })
})

describe('formatDurationMins', () => {
  it('returns minutes only when under 60', () => {
    expect(formatDurationMins(45)).toBe('45m')
    expect(formatDurationMins(0)).toBe('0m')
  })

  it('returns hours only when evenly divisible', () => {
    expect(formatDurationMins(60)).toBe('1h')
    expect(formatDurationMins(120)).toBe('2h')
  })

  it('returns hours and minutes for mixed values', () => {
    expect(formatDurationMins(90)).toBe('1h 30m')
    expect(formatDurationMins(135)).toBe('2h 15m')
  })
})

describe('formatMovingTime', () => {
  it('converts seconds to a duration string', () => {
    expect(formatMovingTime(3600)).toBe('1h')
    expect(formatMovingTime(5400)).toBe('1h 30m')
    expect(formatMovingTime(2700)).toBe('45m')
  })
})

describe('weekStartsAround', () => {
  it('returns Mondays from `before` weeks back to `after` weeks forward', () => {
    // 2026-05-27 is a Wednesday; its Monday is 2026-05-25.
    const weeks = weekStartsAround('2026-05-27', 2, 2)
    expect(weeks).toEqual(['2026-05-11', '2026-05-18', '2026-05-25', '2026-06-01', '2026-06-08'])
  })

  it('anchors on the Monday of the given date with before=after=0', () => {
    expect(weekStartsAround('2026-06-07', 0, 0)).toEqual(['2026-06-01']) // Sun 7th → Mon 1st
  })
})

describe('weekStartsAfter', () => {
  it('returns the next `count` Mondays', () => {
    expect(weekStartsAfter('2026-05-25', 3)).toEqual(['2026-06-01', '2026-06-08', '2026-06-15'])
  })
})

describe('weekdayName', () => {
  it('names the day correctly (2026-06-01 is a Monday)', () => {
    expect(weekdayName('2026-06-01')).toBe('Monday')
    expect(weekdayName('2026-06-07')).toBe('Sunday')
    expect(weekdayName('2026-06-08')).toBe('Monday')
  })

  it('is timezone-stable regardless of the machine offset', () => {
    // A pure UTC-calendar read — same answer no matter the server timezone.
    expect(weekdayName('2026-01-01')).toBe('Thursday')
    expect(weekdayName('2026-12-25')).toBe('Friday')
  })
})

describe('labelDate', () => {
  it('renders "YYYY-MM-DD (Weekday)"', () => {
    expect(labelDate('2026-06-07')).toBe('2026-06-07 (Sunday)')
  })
})

describe('toLocalDateStr', () => {
  it('formats a Date as YYYY-MM-DD using local time', () => {
    // May 1 2026 at local midnight
    const d = new Date(2026, 4, 1) // month 4 = May (local time)
    expect(toLocalDateStr(d)).toBe('2026-05-01')
  })
})

// ─── getDayWorkoutColor ────────────────────────────────────────────────────────

function w(overrides: Partial<Workout>): Workout {
  return {
    id: '1', plan_id: null, date: '2026-06-16', type: 'endurance',
    duration_minutes: 60, description: '', target_zones: '',
    intervals_icu_event_id: null, status: 'planned', icu_activity_id: null,
    tss: 50, missed_reason: null, steps: null, activity_metrics: null,
    coaching_notes: null, created_at: '2026-06-16T00:00:00Z',
    ...overrides,
  } as Workout
}

describe('getDayWorkoutColor', () => {
  it('returns null when no workouts on that date', () => {
    expect(getDayWorkoutColor('2026-06-16', [])).toBeNull()
    expect(getDayWorkoutColor('2026-06-16', [w({ date: '2026-06-17' })])).toBeNull()
  })

  it('returns bg-blue-500 for a single endurance workout', () => {
    expect(getDayWorkoutColor('2026-06-16', [w({ date: '2026-06-16', type: 'endurance' })])).toBe('bg-blue-500')
  })

  it('returns bg-red-500 when threshold and recovery are on the same day (threshold wins)', () => {
    const workouts = [
      w({ date: '2026-06-16', type: 'recovery' }),
      w({ date: '2026-06-16', type: 'threshold' }),
    ]
    expect(getDayWorkoutColor('2026-06-16', workouts)).toBe('bg-red-500')
  })

  it('returns bg-orange-500 when intervals, threshold, and endurance are on the same day (intervals wins)', () => {
    const workouts = [
      w({ date: '2026-06-16', type: 'endurance' }),
      w({ date: '2026-06-16', type: 'threshold' }),
      w({ date: '2026-06-16', type: 'intervals' }),
    ]
    expect(getDayWorkoutColor('2026-06-16', workouts)).toBe('bg-orange-500')
  })
})

// ─── pickTodayWorkout ──────────────────────────────────────────────────────────

describe('pickTodayWorkout', () => {
  it('returns null when there are no workouts that day', () => {
    expect(pickTodayWorkout([])).toBeNull()
  })

  it('returns the scheduled workout when it has not been missed', () => {
    const scheduled = w({ id: 'sched', plan_id: 'p1', status: 'planned' })
    expect(pickTodayWorkout([scheduled])).toBe(scheduled)
  })

  it('returns the scheduled workout even if an unassociated ride exists, when not missed', () => {
    const scheduled = w({ id: 'sched', plan_id: 'p1', status: 'planned' })
    const ride = w({ id: 'ride', plan_id: null, status: 'completed', icu_activity_id: 'a1' })
    expect(pickTodayWorkout([scheduled, ride])).toBe(scheduled)
  })

  it('returns the unassociated completed ride when the scheduled workout was marked missed', () => {
    const scheduled = w({ id: 'sched', plan_id: 'p1', status: 'skipped', missed_reason: 'illness' })
    const ride = w({ id: 'ride', plan_id: null, status: 'completed', icu_activity_id: 'a1' })
    expect(pickTodayWorkout([scheduled, ride])).toBe(ride)
  })

  it('still returns the missed workout when no unassociated completed ride exists', () => {
    const scheduled = w({ id: 'sched', plan_id: 'p1', status: 'skipped', missed_reason: 'illness' })
    expect(pickTodayWorkout([scheduled])).toBe(scheduled)
  })

  it('does not treat a still-planned unassociated ride as a completed ride', () => {
    const scheduled = w({ id: 'sched', plan_id: 'p1', status: 'skipped', missed_reason: 'illness' })
    const plannedRide = w({ id: 'ride', plan_id: null, status: 'planned' })
    expect(pickTodayWorkout([scheduled, plannedRide])).toBe(scheduled)
  })

  it('returns the single unassociated ride when nothing is scheduled that day', () => {
    const ride = w({ id: 'ride', plan_id: null, status: 'completed', icu_activity_id: 'a1' })
    expect(pickTodayWorkout([ride])).toBe(ride)
  })
})

// ─── getWeeklySummary ──────────────────────────────────────────────────────────

describe('getWeeklySummary', () => {
  const DATES = ['2026-06-16', '2026-06-17', '2026-06-18']

  it('computes actual from completed/needs_review, and planned from every workout\'s original schedule', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'completed', tss: 80, duration_minutes: 60 }),
      w({ date: '2026-06-17', status: 'needs_review', tss: 40, duration_minutes: 30 }),
      w({ date: '2026-06-18', status: 'planned', tss: 50, duration_minutes: 45 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result.actualTss).toBe(120)
    expect(result.actualMins).toBe(90)
    // estimateTss('endurance', 60) + estimateTss('endurance', 30) + estimateTss('endurance', 45) = 46 + 23 + 35
    expect(result.plannedTss).toBe(104)
    expect(result.plannedMins).toBe(135) // 60 + 30 + 45 — every workout's own scheduled duration, regardless of status
  })

  it('computes planned TSS from estimateTss, not the tss field, when workouts are still planned', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'planned', tss: 60, duration_minutes: 50 }),
      w({ date: '2026-06-17', status: 'planned', tss: 40, duration_minutes: 35 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result.actualTss).toBe(0)
    expect(result.actualMins).toBe(0)
    // estimateTss('endurance', 50) + estimateTss('endurance', 35) = 39 + 27 — NOT the fixture's tss field (60 + 40 = 100)
    expect(result.plannedTss).toBe(66)
    expect(result.plannedMins).toBe(85)
  })

  it('shows nonzero planned totals for a fully-completed week (the reported bug)', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'completed', tss: 80, duration_minutes: 60 }),
      w({ date: '2026-06-17', status: 'completed', tss: 40, duration_minutes: 30 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result.plannedMins).toBe(90) // 60 + 30 — not 0, even though nothing is still status: 'planned'
    expect(result.plannedTss).toBe(69) // estimateTss('endurance', 60) + estimateTss('endurance', 30) = 46 + 23
  })

  it('uses actual_duration_minutes, not duration_minutes, for actualMins when a completed workout has both', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'completed', tss: 80, duration_minutes: 45, actual_duration_minutes: 51 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result.actualMins).toBe(51) // the real synced duration, not the 45-minute plan
    expect(result.plannedMins).toBe(45) // planned bucket still uses the original scheduled duration
  })

  it('returns zeros for both buckets when week has no workouts', () => {
    const result = getWeeklySummary(DATES, [])
    expect(result).toEqual({ actualTss: 0, actualMins: 0, plannedTss: 0, plannedMins: 0 })
  })

  it('counts a skipped (missed) workout toward planned but excludes it from actual', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'skipped', tss: 50, duration_minutes: 45 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    // estimateTss('endurance', 45) = 35 — the missed session still counted toward
    // the week's original plan, since it was scheduled regardless of what happened to it
    expect(result).toEqual({ actualTss: 0, actualMins: 0, plannedTss: 35, plannedMins: 45 })
  })

  it('adds unlinked activities TSS and minutes to the actual bucket', () => {
    const activity: ICUActivity = {
      id: 'a1', start_date_local: '2026-06-16T07:00:00', type: 'Ride',
      moving_time: 3600, name: 'Morning ride', training_load: 55,
      average_watts: null, max_watts: null, weighted_average_watts: null,
      average_heartrate: null, max_heartrate: null, rolling_ftp: null,
      distance: null, total_elevation_gain: null, left_right_balance: null,
    } as unknown as ICUActivity
    const result = getWeeklySummary(DATES, [], [activity])
    expect(result.actualTss).toBe(55)
    expect(result.actualMins).toBe(60)
    expect(result.plannedTss).toBe(0)
    expect(result.plannedMins).toBe(0)
  })

  it('combines planned workout actuals with unlinked activity actuals', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'completed', tss: 80, duration_minutes: 60 }),
    ]
    const activity: ICUActivity = {
      id: 'a1', start_date_local: '2026-06-17T08:00:00', type: 'Ride',
      moving_time: 1800, name: 'Easy spin', training_load: 30,
      average_watts: null, max_watts: null, weighted_average_watts: null,
      average_heartrate: null, max_heartrate: null, rolling_ftp: null,
      distance: null, total_elevation_gain: null, left_right_balance: null,
    } as unknown as ICUActivity
    const result = getWeeklySummary(DATES, workouts, [activity])
    expect(result.actualTss).toBe(110)
    expect(result.actualMins).toBe(90)
  })

  it('ignores unlinked activities outside the date range', () => {
    const activity: ICUActivity = {
      id: 'a1', start_date_local: '2026-06-19T07:00:00', type: 'Ride',
      moving_time: 3600, name: 'Outside week', training_load: 60,
      average_watts: null, max_watts: null, weighted_average_watts: null,
      average_heartrate: null, max_heartrate: null, rolling_ftp: null,
      distance: null, total_elevation_gain: null, left_right_balance: null,
    } as unknown as ICUActivity
    const result = getWeeklySummary(DATES, [], [activity])
    expect(result).toEqual({ actualTss: 0, actualMins: 0, plannedTss: 0, plannedMins: 0 })
  })
})
