import { render, screen, waitFor } from '@testing-library/react'
import CalendarPage from '@/app/calendar/page'

const now = new Date()
const testDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

beforeEach(() => {
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url === '/api/plan') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          name: 'Base Block 1',
          workouts: [{
            id: 'w1', plan_id: 'p1', date: testDate,
            type: 'threshold', duration_minutes: 60,
            description: 'Test', target_zones: 'Zone 4',
            status: 'planned', intervals_icu_event_id: null,
            icu_activity_id: null, tss: null, missed_reason: null, steps: null, created_at: '',
          }],
        }),
      })
    }
    return Promise.resolve({ ok: true, json: async () => ({ athlete_id: 'i123' }) })
  })
})

afterEach(() => { jest.restoreAllMocks() })

describe('CalendarPage', () => {
  it('shows workout type text for a workout day', async () => {
    render(<CalendarPage />)
    await waitFor(() => expect(screen.getByText(/threshold/i)).toBeInTheDocument())
  })

  it('shows workout duration for a workout day', async () => {
    render(<CalendarPage />)
    await waitFor(() => expect(screen.getByText('1h')).toBeInTheDocument())
  })

  it('shows plan name below month heading', async () => {
    render(<CalendarPage />)
    await waitFor(() => expect(screen.getByText('Base Block 1')).toBeInTheDocument())
  })
})
