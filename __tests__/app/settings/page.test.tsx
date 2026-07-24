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

  it('shows the auto-calculated value as a hint under the manual override input in edit mode', async () => {
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
    await screen.findByText(/estimated from age/i)
    fireEvent.click(screen.getByRole('button', { name: /edit personal details/i }))
    expect(screen.getByText(/leave blank to auto-calculate — currently \d+ bpm \(estimated from age\)/i)).toBeInTheDocument()
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

  it('shows a "Saved." confirmation in the section just saved', async () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: /edit personal details/i }))
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    fireEvent.click(screen.getByRole('button', { name: /save personal details/i }))

    await waitFor(() => {
      expect(screen.getByText('Saved.')).toBeInTheDocument()
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

  it('shows last synced time when Garmin has a recorded sync', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'p1',
        full_name: 'Chris Platt',
        garmin_email: 'chris@example.com',
        garmin_last_sync_at: '2026-07-02T22:14:00.000Z',
        intervals_icu_athlete_id: 'i12345',
        intervals_icu_api_key: 'apikey',
      }),
    })
    render(<SettingsPage />)
    expect(await screen.findByText(/Last synced:/)).toBeInTheDocument()
  })

  it('shows "Not yet synced" when Garmin is connected but has no recorded sync', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'p1',
        full_name: 'Chris Platt',
        garmin_email: 'chris@example.com',
        intervals_icu_athlete_id: 'i12345',
        intervals_icu_api_key: 'apikey',
      }),
    })
    render(<SettingsPage />)
    expect(await screen.findByText('Not yet synced')).toBeInTheDocument()
  })
})

describe('Account page — deep-history bests scan auto-continues across batches', () => {
  function mockAdminProfile() {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      const u = String(url)
      if (u === '/api/profile') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'p1', full_name: 'Chris Platt', is_admin: true, notifications_enabled: true,
            intervals_icu_athlete_id: 'i12345', intervals_icu_api_key: 'apikey',
          }),
        })
      }
      return Promise.resolve({ ok: false, json: async () => ({}) })
    })
  }

  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset()
  })

  it('keeps requesting further batches without another click, until reachedPossibleStart', async () => {
    mockAdminProfile()
    render(<SettingsPage />)
    await screen.findByRole('button', { name: 'Scan further back in ride history' })

    let call = 0
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      const u = String(url)
      if (u === '/api/admin/backfill-deep-history-bests') {
        call += 1
        if (call < 3) {
          return Promise.resolve({ ok: true, json: async () => ({ processed: 50, newCursor: `2020-0${call}-01`, reachedPossibleStart: false }) })
        }
        return Promise.resolve({ ok: true, json: async () => ({ processed: 12, newCursor: '2019-01-01', reachedPossibleStart: true }) })
      }
      return Promise.resolve({ ok: false, json: async () => ({}) })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Scan further back in ride history' }))

    await waitFor(() => expect(screen.getByText(/reached the start of your history/i)).toBeInTheDocument())
    expect(call).toBe(3)
  })

  it('stops issuing further batches once Stop is clicked', async () => {
    mockAdminProfile()
    render(<SettingsPage />)
    await screen.findByRole('button', { name: 'Scan further back in ride history' })

    let call = 0
    let resolveSecondBatch: (() => void) | null = null
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      const u = String(url)
      if (u === '/api/admin/backfill-deep-history-bests') {
        call += 1
        if (call === 1) {
          return Promise.resolve({ ok: true, json: async () => ({ processed: 50, newCursor: '2020-01-01', reachedPossibleStart: false }) })
        }
        return new Promise(resolve => {
          resolveSecondBatch = () => resolve({ ok: true, json: async () => ({ processed: 50, newCursor: '2019-06-01', reachedPossibleStart: false }) })
        })
      }
      return Promise.resolve({ ok: false, json: async () => ({}) })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Scan further back in ride history' }))
    await screen.findByRole('button', { name: 'Stop' })
    await waitFor(() => expect(call).toBe(2))

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    resolveSecondBatch!()

    await waitFor(() => expect(screen.getByText(/stopped after 2 batches/i)).toBeInTheDocument())
    expect(call).toBe(2)
  })
})

describe('Account page — activity-metrics backfill auto-continues across batches', () => {
  function mockAdminProfile() {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      const u = String(url)
      if (u === '/api/profile') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'p1', full_name: 'Chris Platt', is_admin: true, notifications_enabled: true,
            intervals_icu_athlete_id: 'i12345', intervals_icu_api_key: 'apikey',
          }),
        })
      }
      return Promise.resolve({ ok: false, json: async () => ({}) })
    })
  }

  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset()
  })

  it('keeps requesting further batches without another click, until the backlog is exhausted', async () => {
    mockAdminProfile()
    render(<SettingsPage />)
    await screen.findByRole('button', { name: 'Backfill all-time bests (climbs & speed)' })

    let call = 0
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      const u = String(url)
      if (u === '/api/admin/backfill-activity-metrics') {
        call += 1
        // Mimics years of backlog: 60 rides need it, 25 processed per batch (BACKFILL_LIMIT).
        const remaining = Math.max(0, 60 - call * 25)
        return Promise.resolve({ ok: true, json: async () => ({ candidates: 60, totalNeeding: remaining + 25, processed: 25, enriched: 25, failed: 0, firstError: null }) })
      }
      return Promise.resolve({ ok: false, json: async () => ({}) })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Backfill all-time bests (climbs & speed)' }))

    await waitFor(() => expect(screen.getByText(/^75 rides backfilled\.$/)).toBeInTheDocument())
    expect(call).toBe(3)
  })

  it('stops issuing further batches once Stop is clicked', async () => {
    mockAdminProfile()
    render(<SettingsPage />)
    await screen.findByRole('button', { name: 'Backfill all-time bests (climbs & speed)' })

    let call = 0
    let resolveSecondBatch: (() => void) | null = null
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      const u = String(url)
      if (u === '/api/admin/backfill-activity-metrics') {
        call += 1
        if (call === 1) {
          return Promise.resolve({ ok: true, json: async () => ({ candidates: 60, totalNeeding: 60, processed: 25, enriched: 25, failed: 0, firstError: null }) })
        }
        return new Promise(resolve => {
          resolveSecondBatch = () => resolve({ ok: true, json: async () => ({ candidates: 60, totalNeeding: 35, processed: 25, enriched: 25, failed: 0, firstError: null }) })
        })
      }
      return Promise.resolve({ ok: false, json: async () => ({}) })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Backfill all-time bests (climbs & speed)' }))
    await screen.findByRole('button', { name: 'Stop' })
    await waitFor(() => expect(call).toBe(2))

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    resolveSecondBatch!()

    await waitFor(() => expect(screen.getByText(/stopped after 50 rides backfilled/i)).toBeInTheDocument())
    expect(call).toBe(2)
  })
})
