import { render, screen, fireEvent } from '@testing-library/react'
import DashboardPage from '@/app/dashboard/page'
import { getWeekBounds } from '@/lib/week-bounds'
import { weekDates } from '@/lib/calendar-helpers'
import { localDateStr } from '@/lib/local-date'
import type { Workout } from '@/types'

function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().split('T')[0]
}

function makeWorkout(overrides: Partial<Workout> & Pick<Workout, 'id' | 'date' | 'name'>): Workout {
  return {
    plan_id: 'plan-1', type: 'endurance', duration_minutes: 60, description: '', target_zones: '',
    intervals_icu_event_id: null, status: 'planned', icu_activity_id: null, tss: null,
    ftp_at_completion: null, actual_duration_minutes: null, missed_reason: null, optional: false,
    steps: null, activity_metrics: null, coaching_notes: null, created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const todayStr = localDateStr(new Date())
const currentWeekStart = getWeekBounds(todayStr).start
// Avoid colliding with TodayCard, which independently renders any workout dated
// exactly today — pick a non-today weekday within the current week so this
// fixture only ever shows up in the week list under test.
const currentWeekWorkoutDate = shiftDateStr(currentWeekStart, 1) === todayStr
  ? shiftDateStr(currentWeekStart, 2)
  : shiftDateStr(currentWeekStart, 1)
const lastWeekStart = shiftDateStr(currentWeekStart, -7)
const nextWeekStart = shiftDateStr(currentWeekStart, 7)
const nextWeekDates = weekDates(nextWeekStart)

const lastWeekWorkout = makeWorkout({ id: 'w-last', date: lastWeekStart, name: 'Last week ride' })
const currentWeekWorkout = makeWorkout({ id: 'w-current', date: currentWeekWorkoutDate, name: 'Current week ride' })
const nextWeekWorkout = makeWorkout({ id: 'w-next', date: nextWeekStart, name: 'Next week ride' })

function mockFetch() {
  global.fetch = jest.fn((url: string) => {
    const u = String(url)
    if (u === '/api/sync') {
      return Promise.resolve({ ok: true, json: async () => ({ activities: [], wellness: [], athlete_ftp: null, athlete_weight: null }) })
    }
    if (u === '/api/plan') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          workouts: [lastWeekWorkout, currentWeekWorkout, nextWeekWorkout],
          name: '',
          last_reviewed_week: '9999-W53',
        }),
      })
    }
    if (u === '/api/profile') return Promise.resolve({ ok: true, json: async () => ({}) })
    if (u === '/api/weight-log') return Promise.resolve({ ok: true, json: async () => ({ entries: [] }) })
    if (u.startsWith('/api/wellness')) return Promise.resolve({ ok: true, json: async () => ({ wellness: [] }) })
    if (u === '/api/charts') return Promise.resolve({ ok: true, json: async () => ({ charts: null }) })
    if (u === '/api/weather/week') return Promise.resolve({ ok: true, json: async () => ({ dates: [] }) })
    return Promise.resolve({ ok: false, json: async () => ({}) })
  }) as jest.Mock
}

describe('DashboardPage week navigation', () => {
  beforeEach(() => {
    localStorage.clear()
    mockFetch()
  })

  it('shows the current week by default, with the "This week" heading', async () => {
    render(<DashboardPage />)
    expect(await screen.findByText('Current week ride')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'This week' })).toBeInTheDocument()
    expect(screen.queryByText('Last week ride')).not.toBeInTheDocument()
    expect(screen.queryByText('Next week ride')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument()
  })

  it('clicking Next shows next week and swaps the heading to the date range', async () => {
    render(<DashboardPage />)
    await screen.findByText('Current week ride')

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))

    expect(await screen.findByText('Next week ride')).toBeInTheDocument()
    expect(screen.queryByText('Current week ride')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'This week' })).not.toBeInTheDocument()
    const expectedRange = `${nextWeekDates[0].slice(8)} – ${nextWeekDates[6].slice(8)} ${new Date(nextWeekDates[0]).toLocaleString('en-GB', { month: 'long' })}`
    expect(screen.getByRole('heading', { level: 2, name: expectedRange })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument()
  })

  it('clicking Previous shows last week', async () => {
    render(<DashboardPage />)
    await screen.findByText('Current week ride')

    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))

    expect(await screen.findByText('Last week ride')).toBeInTheDocument()
    expect(screen.queryByText('Current week ride')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument()
  })

  it('clicking Today returns to the current week', async () => {
    render(<DashboardPage />)
    await screen.findByText('Current week ride')
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await screen.findByText('Next week ride')

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))

    expect(await screen.findByText('Current week ride')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'This week' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument()
  })

  it('navigating to a different week does not change the weekly progress stats above the day list', async () => {
    // currentWeekWorkout is 'planned' and not optional, so isSessionCountable/
    // isSessionCompleted classify it as 1 countable session, 0 completed —
    // ProgressStats renders this as a "0/1" Sessions tile. That tile's source
    // (weeklyProgress) must stay pinned to *today's* week regardless of which
    // week the day-list below is currently showing.
    render(<DashboardPage />)
    expect(await screen.findByText('0/1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await screen.findByText('Next week ride')

    expect(screen.getByText('0/1')).toBeInTheDocument()
  })
})
