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

  it('shows goals field on Profile tab', async () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    expect(await screen.findByPlaceholderText(/your goals/i)).toBeInTheDocument()
  })

  it('shows FTP and weight inputs on Profile tab', async () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    expect(await screen.findByLabelText(/ftp/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/weight/i)).toBeInTheDocument()
  })

  it('shows Save Profile button on Profile tab', async () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    expect(await screen.findByRole('button', { name: /save profile/i })).toBeInTheDocument()
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
