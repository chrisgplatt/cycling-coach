import { render, screen } from '@testing-library/react'
import SettingsPage from '@/app/settings/page'

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    id: 'p1',
    full_name: 'Chris Platt',
    intervals_icu_athlete_id: 'i12345',
    intervals_icu_api_key: 'apikey',
  }),
})

describe('Account page', () => {
  it('renders Account heading', () => {
    render(<SettingsPage />)
    expect(screen.getByText('Account')).toBeInTheDocument()
  })

  it('does not render Goals textarea', () => {
    render(<SettingsPage />)
    expect(screen.queryByPlaceholderText(/your goals/i)).not.toBeInTheDocument()
  })

  it('does not render Build New Plan button', () => {
    render(<SettingsPage />)
    expect(screen.queryByRole('button', { name: /build new plan/i })).not.toBeInTheDocument()
  })

  it('does not render Clear Future Workouts button', () => {
    render(<SettingsPage />)
    expect(screen.queryByRole('button', { name: /clear future/i })).not.toBeInTheDocument()
  })

  it('shows intervals.icu athlete ID input', () => {
    render(<SettingsPage />)
    expect(screen.getByPlaceholderText(/athlete id/i)).toBeInTheDocument()
  })

  it('shows intervals.icu API key input', () => {
    render(<SettingsPage />)
    expect(screen.getByPlaceholderText(/api key/i)).toBeInTheDocument()
  })

  it('shows Full Name input', () => {
    render(<SettingsPage />)
    expect(screen.getByPlaceholderText(/e\.g\. chris smith/i)).toBeInTheDocument()
  })
})
