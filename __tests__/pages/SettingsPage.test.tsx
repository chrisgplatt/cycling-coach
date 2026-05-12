import { render, screen, fireEvent } from '@testing-library/react'
import SettingsPage from '@/app/settings/page'

const profileData = {
  id: 1,
  goals: '',
  events: [{ name: 'Existing Race', date: '2026-06-01', type: 'race', priority: 'A' }],
  weekly_hours: 8,
  rest_days: ['monday'],
  current_ftp: 250,
  weight_kg: 72,
  intervals_icu_athlete_id: 'i12345',
  intervals_icu_api_key: 'key123',
}

function setupFetch(syncEventsOk: boolean, syncEventsData: unknown) {
  global.fetch = jest.fn()
  jest.spyOn(global, 'fetch').mockImplementation((input) => {
    const url = String(input)
    if (url === '/api/profile') {
      return Promise.resolve({ ok: true, json: async () => profileData } as Response)
    }
    if (url === '/api/sync') {
      // suppress the startup intervals.icu sync — not under test here
      return Promise.resolve({ ok: false, json: async () => ({}) } as Response)
    }
    if (url === '/api/events/sync') {
      return Promise.resolve({ ok: syncEventsOk, json: async () => syncEventsData } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
  })
}

afterEach(() => jest.restoreAllMocks())

describe('SettingsPage — sync events button', () => {
  it('renders sync button in the events section', async () => {
    setupFetch(true, { added: 0, events: profileData.events })
    render(<SettingsPage />)
    expect(await screen.findByRole('button', { name: /sync from intervals\.icu/i })).toBeInTheDocument()
  })

  it('shows added count when new events are found', async () => {
    const newEvents = [
      ...profileData.events,
      { name: 'Dragon Ride', date: '2026-09-14', type: 'race', priority: 'B' },
    ]
    setupFetch(true, { added: 1, events: newEvents })
    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /sync from intervals\.icu/i }))
    expect(await screen.findByText('Added 1 event(s) from intervals.icu')).toBeInTheDocument()
  })

  it('shows "No new events found" when all events already exist', async () => {
    setupFetch(true, { added: 0, events: profileData.events })
    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /sync from intervals\.icu/i }))
    expect(await screen.findByText('No new events found')).toBeInTheDocument()
  })

  it('shows error message when sync fails', async () => {
    setupFetch(false, { error: 'intervals.icu not configured' })
    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /sync from intervals\.icu/i }))
    expect(await screen.findByText('Error: intervals.icu not configured')).toBeInTheDocument()
  })
})
