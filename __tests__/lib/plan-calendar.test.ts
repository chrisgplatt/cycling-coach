import { formatPlanCalendar } from '@/lib/claude/schedule'

const availability = [
  { day: 'tuesday', duration_minutes: 60 },
  { day: 'saturday', duration_minutes: 180 },
  { day: 'sunday', duration_minutes: 120 },
]

describe('formatPlanCalendar', () => {
  it('labels every date in the window with its correct weekday', () => {
    const cal = formatPlanCalendar('2026-06-01', '2026-06-07', availability)
    // 2026-06-01 is a Monday → the week runs Mon…Sun
    expect(cal).toContain('2026-06-01 Monday')
    expect(cal).toContain('2026-06-06 Saturday')
    expect(cal).toContain('2026-06-07 Sunday')
    // The classic bug: Sunday must never be labelled Saturday
    expect(cal).not.toContain('2026-06-07 Saturday')
  })

  it('marks trainable days with their cap and rest days as REST', () => {
    const cal = formatPlanCalendar('2026-06-01', '2026-06-07', availability)
    expect(cal).toContain('2026-06-02 Tuesday: train — up to 60 min')
    expect(cal).toContain('2026-06-06 Saturday: train — up to 180 min')
    expect(cal).toContain('2026-06-01 Monday: REST — no workout')
  })

  it('blocks event dates regardless of availability', () => {
    const cal = formatPlanCalendar('2026-06-01', '2026-06-07', availability, [
      { date: '2026-06-07', name: 'Dragon Ride' },
    ])
    expect(cal).toContain('2026-06-07 Sunday: BLOCKED — event: Dragon Ride (no workout)')
  })

  it('covers the window inclusively (one line per day)', () => {
    const cal = formatPlanCalendar('2026-06-01', '2026-06-07', availability)
    const dayLines = cal.split('\n').filter(l => /^\s+\d{4}-\d{2}-\d{2}/.test(l))
    expect(dayLines).toHaveLength(7)
  })

  it('blocks every day of a multi-day event range, not just the start date', () => {
    const cal = formatPlanCalendar('2026-06-01', '2026-06-07', availability, [
      { date: '2026-06-05', end_date: '2026-06-07', name: 'Ski Trip' },
    ])
    expect(cal).toContain('2026-06-05 Friday: BLOCKED — event: Ski Trip (no workout)')
    expect(cal).toContain('2026-06-06 Saturday: BLOCKED — event: Ski Trip (no workout)')
    expect(cal).toContain('2026-06-07 Sunday: BLOCKED — event: Ski Trip (no workout)')
  })

  it('does not block a continue-training holiday — it gets a third, distinct status', () => {
    const cal = formatPlanCalendar('2026-06-01', '2026-06-07', availability, [
      { date: '2026-06-05', end_date: '2026-06-07', name: 'Ski Trip', continueTraining: true },
    ])
    expect(cal).toContain('2026-06-05 Friday: HOLIDAY (continuing to train) — optional quality session only, no mandatory workout: Ski Trip')
    expect(cal).not.toContain('2026-06-05 Friday: BLOCKED')
    expect(cal).not.toContain('2026-06-06 Saturday: train — up to 180 min')
  })
})
