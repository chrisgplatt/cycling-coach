import { normalizeY, isoWeekStart } from '@/lib/chart-helpers'

describe('normalizeY', () => {
  it('maps min value to svgBottom', () => {
    expect(normalizeY(0, 0, 100, 10, 110)).toBe(110)
  })

  it('maps max value to svgTop', () => {
    expect(normalizeY(100, 0, 100, 10, 110)).toBe(10)
  })

  it('maps midpoint to vertical centre', () => {
    expect(normalizeY(50, 0, 100, 10, 110)).toBe(60)
  })

  it('returns midpoint when min equals max', () => {
    expect(normalizeY(50, 50, 50, 10, 110)).toBe(60)
  })
})

describe('isoWeekStart', () => {
  it('Monday returns itself', () => {
    // 2026-05-18 is a Monday
    expect(isoWeekStart('2026-05-18')).toBe('2026-05-18')
  })

  it('Sunday rolls back to the previous Monday', () => {
    // 2026-05-17 is a Sunday
    expect(isoWeekStart('2026-05-17')).toBe('2026-05-11')
  })

  it('Saturday rolls back to Monday', () => {
    // 2026-05-23 is a Saturday
    expect(isoWeekStart('2026-05-23')).toBe('2026-05-18')
  })

  it('Wednesday rolls back to Monday', () => {
    // 2026-05-20 is a Wednesday
    expect(isoWeekStart('2026-05-20')).toBe('2026-05-18')
  })
})
