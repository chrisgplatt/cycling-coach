import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
// A second, differently-countable workout in next week only. This makes next
// week's countable-session total (2) diverge from the current week's (1), so
// the "stays pinned to today's week" test below is only satisfied if
// weeklyProgress genuinely reads todayWeekDates rather than the navigable
// weekDates — if the pinning were broken, the Sessions tile would flip from
// "0/1" to "0/2" after clicking Next.
const nextWeekWorkout2 = makeWorkout({ id: 'w-next-2', date: shiftDateStr(nextWeekStart, 1), name: 'Next week ride 2' })

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
          workouts: [lastWeekWorkout, currentWeekWorkout, nextWeekWorkout, nextWeekWorkout2],
          name: '',
          last_reviewed_week: '9999-W53',
          created_at: shiftDateStr(todayStr, -35), // exactly 5 weeks ago, landing in week 6 of 12 — mid-build
          plan_weeks: 12,
          week_phases: ['base', 'base', 'base', 'base', 'build', 'build', 'build', 'build', 'build', 'peak', 'taper', 'taper'],
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
    // week the day-list below is currently showing. Next week has TWO
    // countable workouts (nextWeekWorkout + nextWeekWorkout2), so if the tile
    // were ever wired to the navigable weekDates instead of todayWeekDates,
    // it would show "0/2" after clicking Next — making this assertion
    // load-bearing rather than vacuous.
    render(<DashboardPage />)
    expect(await screen.findByText('0/1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await screen.findByText('Next week ride')

    expect(screen.getByText('0/1')).toBeInTheDocument()
  })

  it('shows the real current-week phase, not a hardcoded value', async () => {
    render(<DashboardPage />)
    await screen.findByText('Current week ride')
    expect(screen.getByText('Build phase')).toBeInTheDocument()
    expect(screen.queryByText('Base phase')).not.toBeInTheDocument()
  })

  it('shows the week header duration in minutes with a planned → actual arrow, matching the TSS format', async () => {
    // currentWeekWorkout: endurance, 60 min, status 'planned' (estimateTss IF=0.68 → 46 TSS)
    render(<DashboardPage />)
    await screen.findByText('Current week ride')
    const header = screen.getByText('~46').parentElement!
    expect(header.textContent).toBe('~46 TSS · 60 min')
  })

  it('shows planned → completed minutes once a workout is completed, same arrow style as TSS', async () => {
    // currentWeekWorkout: endurance, 60 min, planned (46 est. TSS) — still outstanding.
    // completedRide: endurance, 45 min, completed with tss=40 (est. 35) — only this one
    // counts toward the "completed" side, so planned (105/81) and completed (45/40)
    // diverge, proving the arrow shows two genuinely different numbers, not a static pair.
    const completedRide = makeWorkout({
      id: 'w-current-2', date: shiftDateStr(currentWeekStart, 4), name: 'Completed ride',
      duration_minutes: 45, status: 'completed', tss: 40, icu_activity_id: 'act-1',
    })
    global.fetch = jest.fn((url: string) => {
      const u = String(url)
      if (u === '/api/sync') {
        return Promise.resolve({ ok: true, json: async () => ({ activities: [], wellness: [], athlete_ftp: null, athlete_weight: null }) })
      }
      if (u === '/api/plan') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            workouts: [currentWeekWorkout, completedRide],
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

    render(<DashboardPage />)
    await screen.findByText('Current week ride')
    const header = screen.getByText('~81 → 40').parentElement!
    expect(header.textContent).toBe('~81 → 40 TSS · 105 → 45 min')
  })
})

describe('DashboardPage wellness save refreshes recovery', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // Recovery is derived entirely from chartsData (fetched once from /api/charts
  // on mount) — saving wellness must refetch it, or the Recovery card keeps
  // showing whatever was computed before the athlete's just-logged energy/leg
  // freshness values existed. Uses its own fetch mock (not the shared
  // mockFetch() above) since it needs to distinguish GET from POST on
  // /api/wellness and count /api/charts calls precisely.
  it('refetches /api/charts after saving wellness, so the recovery card reflects the new entry', async () => {
    let chartsCallCount = 0
    global.fetch = jest.fn((url: string, init?: RequestInit) => {
      const u = String(url)
      if (u === '/api/sync') {
        return Promise.resolve({ ok: true, json: async () => ({ activities: [], wellness: [], athlete_ftp: null, athlete_weight: null }) })
      }
      if (u === '/api/plan') {
        return Promise.resolve({ ok: true, json: async () => ({ workouts: [], name: '', last_reviewed_week: '9999-W53' }) })
      }
      if (u === '/api/profile') return Promise.resolve({ ok: true, json: async () => ({}) })
      if (u === '/api/weight-log') return Promise.resolve({ ok: true, json: async () => ({ entries: [] }) })
      if (u.startsWith('/api/wellness')) {
        if (init?.method === 'POST') {
          return Promise.resolve({ ok: true, json: async () => ({ wellness: { date: todayStr, energy: 3, leg_freshness: null, mood: null, stress: null, sleep_quality: null } }) })
        }
        return Promise.resolve({ ok: true, json: async () => ({ wellness: [] }) })
      }
      if (u === '/api/charts') {
        chartsCallCount++
        return Promise.resolve({ ok: true, json: async () => ({ charts: null }) })
      }
      if (u === '/api/weather/week') return Promise.resolve({ ok: true, json: async () => ({ dates: [] }) })
      return Promise.resolve({ ok: false, json: async () => ({}) })
    }) as jest.Mock

    render(<DashboardPage />)
    await waitFor(() => expect(chartsCallCount).toBe(1))

    // With no workouts/activities in this fixture, every day renders as a
    // "rest day" — WellnessCard's compact "+ wellness" variant, not its
    // longer "How are you feeling?" prompt (see components/WellnessCard.tsx).
    fireEvent.click(screen.getAllByText('+ wellness')[0])
    fireEvent.click(screen.getAllByLabelText('3')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(chartsCallCount).toBe(2))
  })
})
