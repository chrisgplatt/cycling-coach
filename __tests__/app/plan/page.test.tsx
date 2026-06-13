import { render, screen, fireEvent } from '@testing-library/react'
import PlanPage from '@/app/plan/page'

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({}),
})

describe('PlanPage tabs', () => {
  it('renders all three tab buttons', () => {
    render(<PlanPage />)
    expect(screen.getByRole('button', { name: /my plan/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /profile/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /events/i })).toBeInTheDocument()
  })

  it('shows My Plan panel by default and hides others', () => {
    render(<PlanPage />)
    expect(screen.getByTestId('tab-plan')).toBeVisible()
    expect(screen.getByTestId('tab-profile')).not.toBeVisible()
    expect(screen.getByTestId('tab-events')).not.toBeVisible()
  })

  it('switches to Profile panel on tab click', () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    expect(screen.getByTestId('tab-profile')).toBeVisible()
    expect(screen.getByTestId('tab-plan')).not.toBeVisible()
  })

  it('switches to Events panel on tab click', () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /events/i }))
    expect(screen.getByTestId('tab-events')).toBeVisible()
    expect(screen.getByTestId('tab-plan')).not.toBeVisible()
  })
})

describe('Profile & Schedule tab', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'p1',
        current_ftp: 265,
        weight_kg: 78.5,
        goals: 'Complete Dragon Ride',
        weekly_availability: [
          { day: 'monday', duration_minutes: 90 },
          { day: 'saturday', duration_minutes: 180 },
        ],
        events: [],
      }),
    })
  })

  it('shows goals textarea when Goals Edit is clicked', async () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    fireEvent.click(await screen.findByRole('button', { name: /edit goals/i }))
    expect(screen.getByPlaceholderText(/your goals/i)).toBeInTheDocument()
  })

  it('shows FTP input when Stats Edit is clicked', async () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    fireEvent.click(await screen.findByRole('button', { name: /edit stats/i }))
    expect(screen.getByLabelText(/ftp/i)).toBeInTheDocument()
  })

  it('shows save and cancel buttons when a section is being edited', async () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    fireEvent.click(await screen.findByRole('button', { name: /edit goals/i }))
    expect(screen.getByRole('button', { name: /save goals/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })
})

describe('Events tab', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'p1',
        goals: '',
        current_ftp: 200,
        weight_kg: 70,
        weekly_availability: [],
        events: [
          { name: 'Dragon Ride', date: '2026-06-25', type: 'sportive', priority: 'A', icu_event_id: 'evt1' },
        ],
      }),
    })
  })

  it('lists events on Events tab', async () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /events/i }))
    expect(await screen.findByText('Dragon Ride')).toBeInTheDocument()
  })

  it('shows Add event button', async () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /events/i }))
    expect(await screen.findByRole('button', { name: /add event/i })).toBeInTheDocument()
  })

  it('shows Sync from intervals.icu button', async () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /events/i }))
    expect(await screen.findByRole('button', { name: /sync from intervals/i })).toBeInTheDocument()
  })
})

describe('My Plan tab', () => {
  it('shows plan name in hero card when plan exists', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/plan') return Promise.resolve({
        ok: true,
        json: async () => ({
          name: 'Dragon Ride Build',
          workouts: [
            { id: 'w1', date: '2026-05-12', type: 'endurance', duration_minutes: 90, status: 'planned', tss: null, icu_activity_id: null, missed_reason: null, steps: null, description: '', target_zones: '', intervals_icu_event_id: null, plan_id: 'p1', created_at: '' },
            { id: 'w2', date: '2026-06-15', type: 'threshold', duration_minutes: 60, status: 'planned', tss: null, icu_activity_id: null, missed_reason: null, steps: null, description: '', target_zones: '', intervals_icu_event_id: null, plan_id: 'p1', created_at: '' },
          ],
        }),
      })
      return Promise.resolve({ ok: true, json: async () => ({ id: 'p1', goals: '', current_ftp: 200, weight_kg: 70, weekly_availability: [], events: [] }) })
    })
    render(<PlanPage />)
    expect(await screen.findByText('Dragon Ride Build')).toBeInTheDocument()
  })

  it('shows Build New Plan button when plan exists', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/plan') return Promise.resolve({
        ok: true,
        json: async () => ({ name: 'Dragon Ride Build', workouts: [] }),
      })
      return Promise.resolve({ ok: true, json: async () => ({ id: 'p1', goals: '', current_ftp: 200, weight_kg: 70, weekly_availability: [], events: [{ name: 'Dragon Ride', date: '2026-06-25', type: 'sportive', priority: 'A' }] }) })
    })
    render(<PlanPage />)
    expect(await screen.findByRole('button', { name: /build new plan/i })).toBeInTheDocument()
  })

  it('shows empty state when no plan', async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/plan') return Promise.resolve({ ok: true, json: async () => null })
      return Promise.resolve({ ok: true, json: async () => ({ id: 'p1', goals: '', current_ftp: 200, weight_kg: 70, weekly_availability: [], events: [] }) })
    })
    render(<PlanPage />)
    expect(await screen.findByText(/no active plan/i)).toBeInTheDocument()
  })
})
