import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ActivityLogView from '@/components/ActivityLogView'
import type { ICUActivity } from '@/types'

function makeActivity(id: string, overrides: Partial<ICUActivity> = {}): ICUActivity {
  return {
    id,
    name: `Ride ${id}`,
    type: 'Ride',
    start_date_local: '2026-06-15T08:00:00',
    moving_time: 5400,         // 1h 30m
    distance: 45000,           // 45.0 km
    total_elevation_gain: 350,
    average_watts: 200,
    max_watts: 400,
    weighted_average_watts: 215,
    average_heartrate: 145,
    training_load: 85,
    rolling_ftp: null,
    left_right_balance: null,
    ...overrides,
  }
}

// ActivityDetailModal fetches streams; suppress those requests in tests
global.fetch = jest.fn()

function mockPage1(hasMore = false, count = 2) {
  const activities = Array.from({ length: count }, (_, i) => makeActivity(`a${i + 1}`))
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    json: async () => ({ activities, hasMore, total: count }),
  })
  return activities
}

describe('ActivityLogView', () => {
  afterEach(() => jest.clearAllMocks())

  it('shows loading spinner while fetching', () => {
    ;(global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}))
    render(<ActivityLogView />)
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('renders activity rows with name, date, distance, and time', async () => {
    mockPage1()
    render(<ActivityLogView />)
    expect(await screen.findByText('Ride a1')).toBeInTheDocument()
    expect(screen.getAllByText('45.0').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1h 30m').length).toBeGreaterThan(0)
  })

  it('hides "Load more" when hasMore is false', async () => {
    mockPage1(false)
    render(<ActivityLogView />)
    await screen.findByText('Ride a1')
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
  })

  it('shows "Load more" when hasMore is true', async () => {
    mockPage1(true, 30)
    render(<ActivityLogView />)
    await screen.findByText('Ride a1')
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument()
  })

  it('appends activities when "Load more" is clicked', async () => {
    // Page 1: 30 activities, hasMore true
    const page1 = Array.from({ length: 30 }, (_, i) => makeActivity(`p1-${i + 1}`))
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({ activities: page1, hasMore: true, total: 35 }),
    })
    render(<ActivityLogView />)
    await screen.findByText('Ride p1-1')

    // Page 2: 5 activities, hasMore false
    const page2 = Array.from({ length: 5 }, (_, i) => makeActivity(`p2-${i + 1}`))
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({ activities: page2, hasMore: false, total: 35 }),
    })
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    await screen.findByText('Ride p2-1')
    expect(screen.getByText('Ride p1-1')).toBeInTheDocument()  // page 1 still visible
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
  })

  it('opens ActivityDetailModal when a row is clicked', async () => {
    mockPage1()
    // Suppress ActivityDetailModal's own fetch calls
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false, json: async () => ({ streams: null }),
    })
    render(<ActivityLogView />)
    const row = await screen.findByText('Ride a1')
    fireEvent.click(row.closest('button')!)
    await waitFor(() => expect(screen.getByText(/Activity/i)).toBeInTheDocument())
  })

  it('shows empty state when no activities returned', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ activities: [], hasMore: false, total: 0 }),
    })
    render(<ActivityLogView />)
    expect(await screen.findByText(/No activities found/i)).toBeInTheDocument()
  })

  it('shows error message on fetch failure', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ error: 'intervals.icu not configured' }),
    })
    render(<ActivityLogView />)
    expect(await screen.findByText('intervals.icu not configured')).toBeInTheDocument()
  })
})
