import { getWeekBounds } from '@/lib/week-bounds'

describe('getWeekBounds', () => {
  it('returns Mon and Sun for a mid-week date (Friday 2026-05-15)', () => {
    const { start, end } = getWeekBounds('2026-05-15')
    expect(start).toBe('2026-05-11')
    expect(end).toBe('2026-05-17')
  })

  it('returns the input date as start for a Monday', () => {
    const { start, end } = getWeekBounds('2026-05-18')
    expect(start).toBe('2026-05-18')
    expect(end).toBe('2026-05-24')
  })

  it('returns the input date as end for a Sunday', () => {
    const { start, end } = getWeekBounds('2026-05-17')
    expect(start).toBe('2026-05-11')
    expect(end).toBe('2026-05-17')
  })

  it('handles a week that crosses a month boundary', () => {
    // 2026-05-31 is a Sunday
    const { start, end } = getWeekBounds('2026-05-31')
    expect(start).toBe('2026-05-25')
    expect(end).toBe('2026-05-31')
  })

  it('handles a week that crosses a year boundary', () => {
    // 2026-12-31 is a Thursday; week is Mon 28 Dec – Sun 3 Jan 2027
    const { start, end } = getWeekBounds('2026-12-31')
    expect(start).toBe('2026-12-28')
    expect(end).toBe('2027-01-03')
  })
})
