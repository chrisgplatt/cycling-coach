import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear()
  })

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

  it('does not render Delete Plan button', () => {
    render(<SettingsPage />)
    expect(screen.queryByRole('button', { name: /delete plan/i })).not.toBeInTheDocument()
  })

  it('shows intervals.icu athlete ID input', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: /edit intervals\.icu settings/i }))
    expect(screen.getByPlaceholderText(/athlete id/i)).toBeInTheDocument()
  })

  it('shows intervals.icu API key input', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: /edit intervals\.icu settings/i }))
    expect(screen.getByPlaceholderText(/api key/i)).toBeInTheDocument()
  })

  it('shows Full Name input', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: /edit personal details/i }))
    expect(screen.getByPlaceholderText(/e\.g\. chris smith/i)).toBeInTheDocument()
  })

  it('shows Date of birth input', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: /edit personal details/i }))
    expect(screen.getByLabelText(/date of birth/i)).toBeInTheDocument()
  })

  it('shows Max heart rate input', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: /edit personal details/i }))
    expect(screen.getByLabelText(/max heart rate/i)).toBeInTheDocument()
  })

  it('derives and displays max HR from date of birth when no manual value is set', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'p1',
        full_name: 'Chris Platt',
        date_of_birth: '1990-07-03',
        intervals_icu_athlete_id: 'i12345',
        intervals_icu_api_key: 'apikey',
      }),
    })
    render(<SettingsPage />)
    expect(await screen.findByText(/estimated from age/i)).toBeInTheDocument()
  })

  it('shows the manual max HR value and label when set', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'p1',
        full_name: 'Chris Platt',
        max_hr_manual: 188,
        intervals_icu_athlete_id: 'i12345',
        intervals_icu_api_key: 'apikey',
      }),
    })
    render(<SettingsPage />)
    expect(await screen.findByText('188 bpm · manual')).toBeInTheDocument()
  })

  it('shows "not set" when no max HR can be resolved', () => {
    render(<SettingsPage />)
    expect(screen.getByText(/max hr not set/i)).toBeInTheDocument()
  })

  it('saves max_hr_manual in the PATCH body', async () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: /edit personal details/i }))
    fireEvent.change(screen.getByLabelText(/max heart rate/i), { target: { value: '182' } })
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    fireEvent.click(screen.getByRole('button', { name: /save personal details/i }))

    await waitFor(() => {
      const patchCall = (global.fetch as jest.Mock).mock.calls.find((c: unknown[]) => (c[1] as { method?: string })?.method === 'PATCH')
      expect(patchCall).toBeDefined()
      expect(JSON.parse(patchCall[1].body)).toMatchObject({ max_hr_manual: 182 })
    })
  })

  it('renders Rider personal details as the first section, above intervals.icu', () => {
    render(<SettingsPage />)
    const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)
    expect(headings[0]).toBe('Rider personal details')
    expect(headings.indexOf('Rider personal details')).toBeLessThan(headings.indexOf('intervals.icu'))
  })

  it('derives and displays age from date of birth', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'p1',
        full_name: 'Chris Platt',
        date_of_birth: '1990-03-15',
        intervals_icu_athlete_id: 'i12345',
        intervals_icu_api_key: 'apikey',
      }),
    })
    render(<SettingsPage />)
    expect(await screen.findByText(/^Age \d+$/)).toBeInTheDocument()
  })

  it('shows "not set" when no date of birth is stored', () => {
    render(<SettingsPage />)
    expect(screen.getByText(/date of birth not set/i)).toBeInTheDocument()
  })

  it('saves date_of_birth in the PATCH body', async () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: /edit personal details/i }))
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: '1990-03-15' } })
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    fireEvent.click(screen.getByRole('button', { name: /save personal details/i }))

    await waitFor(() => {
      const patchCall = (global.fetch as jest.Mock).mock.calls.find((c: unknown[]) => (c[1] as { method?: string })?.method === 'PATCH')
      expect(patchCall).toBeDefined()
      expect(JSON.parse(patchCall[1].body)).toMatchObject({ date_of_birth: '1990-03-15' })
    })
  })

  it('shows the location search input', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: /edit location/i }))
    expect(screen.getByPlaceholderText(/town or city/i)).toBeInTheDocument()
  })
})
