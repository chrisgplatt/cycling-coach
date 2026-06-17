import {
  calendarMonthDays,
  weekDates,
  formatDuration,
  formatMovingTime,
  toLocalDateStr,
  weekdayName,
  labelDate,
  weekStartsAround,
  weekStartsAfter,
  getDayWorkoutColor,
  getWeeklySummary,
} from '@/lib/calendar-helpers'
import type { Workout } from '@/types'

describe('calendarMonthDays', () => {
  it('returns null-padded grid for May 2026 (Friday 1st → 4 leading nulls)', () => {
    const grid = calendarMonthDays(2026, 4) // month 4 = May
    expect(grid.slice(0, 4)).toEqual([null, null, null, null])
    expect(grid[4]).toBe('2026-05-01')
    expect(grid[grid.length - 1]).toBe('2026-05-31')
  })

  it('returns no leading nulls for a month starting on Monday', () => {
    // June 2026 starts on Monday
    const grid = calendarMonthDays(2026, 5) // month 5 = June
    expect(grid[0]).toBe('2026-06-01')
  })

  it('returns 6 leading nulls for a month starting on Sunday', () => {
    // March 2026 starts on Sunday
    const grid = calendarMonthDays(2026, 2) // month 2 = March
    expect(grid.slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(grid[6]).toBe('2026-03-01')
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

describe('formatDuration', () => {
  it('returns minutes only when under 60', () => {
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(0)).toBe('0m')
  })

  it('returns hours only when evenly divisible', () => {
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(120)).toBe('2h')
  })

  it('returns hours and minutes for mixed values', () => {
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(135)).toBe('2h 15m')
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

// ─── getWeeklySummary ──────────────────────────────────────────────────────────

describe('getWeeklySummary', () => {
  const DATES = ['2026-06-16', '2026-06-17', '2026-06-18']

  it('returns actual TSS and minutes from completed/needs_review; ignores planned', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'completed', tss: 80, duration_minutes: 60 }),
      w({ date: '2026-06-17', status: 'needs_review', tss: 40, duration_minutes: 30 }),
      w({ date: '2026-06-18', status: 'planned', tss: 50, duration_minutes: 45 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result.actualTss).toBe(120)
    expect(result.actualMins).toBe(90)
    expect(result.plannedTss).toBe(50)
    expect(result.plannedMins).toBe(45)
  })

  it('returns planned values when no completed workouts exist', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'planned', tss: 60, duration_minutes: 50 }),
      w({ date: '2026-06-17', status: 'planned', tss: 40, duration_minutes: 35 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result.actualTss).toBe(0)
    expect(result.actualMins).toBe(0)
    expect(result.plannedTss).toBe(100)
    expect(result.plannedMins).toBe(85)
  })

  it('returns zeros for both buckets when week has no workouts', () => {
    const result = getWeeklySummary(DATES, [])
    expect(result).toEqual({ actualTss: 0, actualMins: 0, plannedTss: 0, plannedMins: 0 })
  })
})
