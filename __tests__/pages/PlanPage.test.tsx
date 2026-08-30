import { render, screen, fireEvent } from '@testing-library/react'
import PlanPage from '@/app/plan/page'
import { makeTrainingSummary } from '../support/factories'

// The events-sync feature lives in the Events tab of the plan page (it was
// moved here from Settings). These tests cover the sync button and its result
// messaging. The plan page fires three fetches on mount (/api/profile,
// /api/plan, /api/sync) which we stub so the component renders cleanly.

const existingEvents = [
  { name: 'Existing Race', date: '2026-06-01', type: 'race', priority: 'A' },
]

const profileData = {
  id: 1,
  goals: '',
  current_ftp: 250,
  weight_kg: 72,
  weekly_availability: [],
  min_sessions_per_week: 3,
  max_sessions_per_week: 5,
  events: existingEvents,
  unavailability: [],
}

function setupFetch(syncEventsOk: boolean, syncEventsData: unknown) {
  jest.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/profile') {
      return Promise.resolve({ ok: true, json: async () => profileData } as Response)
    }
    if (url === '/api/plan') {
      // no active plan in these tests
      return Promise.resolve({ ok: true, json: async () => ({ workouts: [] }) } as Response)
    }
    if (url === '/api/sync') {
      // suppress the startup intervals.icu sync — not under test here
      return Promise.resolve({ ok: false, json: async () => ({}) } as Response)
    }
    if (url === '/api/events/sync') {
      return Promise.resolve({ ok: syncEventsOk, json: async () => syncEventsData } as Response)
    }
    if (url.includes('/api/plan/history')) {
      // mock for PlanHistoryTab
      return Promise.resolve({ ok: true, json: async () => ({ plans: [] }) } as Response)
    }
    if (url.includes('/api/plan/summary')) {
      // mock for PlanSummaryRollup in PlanHistoryTab
      return Promise.resolve({ ok: true, json: async () => makeTrainingSummary() } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
  })
}

afterEach(() => jest.restoreAllMocks())

// Render the page and switch to the Events tab where the sync button lives.
async function gotoEventsTab() {
  render(<PlanPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Events' }))
}

describe('PlanPage — events sync', () => {
  it('renders the sync button in the events tab', async () => {
    setupFetch(true, { added: 0, events: existingEvents })
    await gotoEventsTab()
    expect(await screen.findByRole('button', { name: /sync from intervals\.icu/i })).toBeInTheDocument()
  })

  it('shows added count when new events are found', async () => {
    setupFetch(true, {
      added: 1,
      events: [...existingEvents, { name: 'New Race', date: '2026-08-01', type: 'race', priority: 'B' }],
    })
    await gotoEventsTab()
    fireEvent.click(await screen.findByRole('button', { name: /sync from intervals\.icu/i }))
    expect(await screen.findByText('Added 1 event(s) from intervals.icu')).toBeInTheDocument()
  })

  it('shows "No new events found" when nothing is added', async () => {
    setupFetch(true, { added: 0, events: existingEvents })
    await gotoEventsTab()
    fireEvent.click(await screen.findByRole('button', { name: /sync from intervals\.icu/i }))
    expect(await screen.findByText('No new events found')).toBeInTheDocument()
  })

  it('shows an error message when sync fails', async () => {
    setupFetch(false, { error: 'intervals.icu not configured' })
    await gotoEventsTab()
    fireEvent.click(await screen.findByRole('button', { name: /sync from intervals\.icu/i }))
    expect(await screen.findByText('Error: intervals.icu not configured')).toBeInTheDocument()
  })
})
