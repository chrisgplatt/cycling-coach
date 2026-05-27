import {
  calendarMonthDays,
  weekDates,
  formatDuration,
  formatMovingTime,
  toLocalDateStr,
} from '@/lib/calendar-helpers'

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

describe('toLocalDateStr', () => {
  it('formats a Date as YYYY-MM-DD using local time', () => {
    // May 1 2026 at local midnight
    const d = new Date(2026, 4, 1) // month 4 = May (local time)
    expect(toLocalDateStr(d)).toBe('2026-05-01')
  })
})
