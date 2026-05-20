import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StatsPage from '@/app/stats/page'
import type { RidingStats } from '@/types'

const mockStats: RidingStats = {
  ride_count: 8,
  total_distance_km: 342.5,
  total_elevation_m: 4200,
  total_duration_secs: 43200,  // 12h 0m
  power_5min: 380,
  power_10min: 355,
  power_20min: 320,
  avg_left_right_balance: 52.3,
  balance_ride_count: 6,
  recent_rides: [
    {
      id: 'a1',
      name: 'Morning Ride',
      start_date_local: '2026-05-19T07:30:00',
      type: 'Ride',
      moving_time: 3600,
      average_watts: 210,
      max_watts: 450,
      weighted_average_watts: 225,
      average_heartrate: 148,
      training_load: 72,
      rolling_ftp: null,
      distance: 40000,
      total_elevation_gain: 350,
      left_right_balance: 52.0,
    },
    {
      id: 'a2',
      name: 'Evening Zone 2',
      start_date_local: '2026-05-17T18:00:00',
      type: 'Ride',
      moving_time: 5400,
      average_watts: 185,
      max_watts: 390,
      weighted_average_watts: 195,
      average_heartrate: null,
      training_load: 58,
      rolling_ftp: null,
      distance: 55000,
      total_elevation_gain: 220,
      left_right_balance: null,
    },
  ],
  cross_training: [],
}

global.fetch = jest.fn()

describe('StatsPage', () => {
  afterEach(() => jest.clearAllMocks())

  it('shows loading spinner initially', () => {
    ;(global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}))
    render(<StatsPage />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders power stats after load', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => ({ stats: mockStats }) })
    render(<StatsPage />)
    expect(await screen.findByText('380')).toBeInTheDocument()
    expect(screen.getByText('355')).toBeInTheDocument()
    expect(screen.getByText('320')).toBeInTheDocument()
  })

  it('renders totals after load', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => ({ stats: mockStats }) })
    render(<StatsPage />)
    expect(await screen.findByText('342.5')).toBeInTheDocument()
    expect(screen.getByText('4200')).toBeInTheDocument()
    expect(screen.getByText('12h 0m')).toBeInTheDocument()
  })

  it('renders balance after load', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => ({ stats: mockStats }) })
    render(<StatsPage />)
    expect(await screen.findByText('52.3% L / 47.7% R')).toBeInTheDocument()
  })

  it('shows — for null power values', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({
        stats: { ...mockStats, power_5min: null, power_10min: null, power_20min: null },
      }),
    })
    render(<StatsPage />)
    await screen.findByText('342.5')
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(3)
  })

  it('shows — for null balance', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ stats: { ...mockStats, avg_left_right_balance: null } }),
    })
    render(<StatsPage />)
    await screen.findByText('342.5')
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })

  it('shows error message on fetch failure', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ error: 'intervals.icu not configured' }),
    })
    render(<StatsPage />)
    expect(await screen.findByText('intervals.icu not configured')).toBeInTheDocument()
  })

  it('renders ride tabs for recent rides', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => ({ stats: mockStats }) })
    render(<StatsPage />)
    expect(await screen.findByRole('button', { name: '28 Days' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tue 19 May' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sun 17 May' })).toBeInTheDocument()
  })

  it('shows per-ride stats when a ride tab is clicked', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => ({ stats: mockStats }) })
    const user = userEvent.setup()
    render(<StatsPage />)
    await screen.findByRole('button', { name: 'Tue 19 May' })
    await user.click(screen.getByRole('button', { name: 'Tue 19 May' }))
    expect(await screen.findByText('210')).toBeInTheDocument()  // avg watts
    expect(screen.getByText('225')).toBeInTheDocument()          // NP
    expect(screen.getByText('72')).toBeInTheDocument()           // TSS
    expect(screen.getByText('Morning Ride')).toBeInTheDocument()
  })

  it('hides cross-training section when cross_training is empty', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ stats: { ...mockStats, cross_training: [] } }),
    })
    render(<StatsPage />)
    await screen.findByText('342.5')
    expect(screen.queryByText(/Other Activity/)).not.toBeInTheDocument()
  })

  it('renders cross-training groups when present', async () => {
    const stats = {
      ...mockStats,
      cross_training: [
        { type: 'Run', count: 2, total_duration_secs: 4800, total_tss: 80 },
        { type: 'Walk', count: 3, total_duration_secs: 9900, total_tss: 45 },
      ],
    }
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => ({ stats }) })
    render(<StatsPage />)
    await screen.findByText('Run')
    expect(screen.getByText('Walk')).toBeInTheDocument()
    expect(screen.getByText('2 sessions')).toBeInTheDocument()
    expect(screen.getByText('3 sessions')).toBeInTheDocument()
  })

  it('shows correct TSS per group', async () => {
    const stats = {
      ...mockStats,
      cross_training: [
        { type: 'Run', count: 2, total_duration_secs: 4800, total_tss: 80 },
        { type: 'Walk', count: 3, total_duration_secs: 9900, total_tss: 45 },
      ],
    }
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => ({ stats }) })
    render(<StatsPage />)
    await screen.findByText('Run')
    expect(screen.getByText('80 TSS')).toBeInTheDocument()
    expect(screen.getByText('45 TSS')).toBeInTheDocument()
  })

  it('shows footer totals across all cross-training groups', async () => {
    const stats = {
      ...mockStats,
      cross_training: [
        { type: 'Run', count: 2, total_duration_secs: 4800, total_tss: 80 },
        { type: 'Walk', count: 3, total_duration_secs: 9900, total_tss: 45 },
      ],
    }
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => ({ stats }) })
    render(<StatsPage />)
    await screen.findByText('Run')
    expect(screen.getByText(/5 activities/)).toBeInTheDocument()
    expect(screen.getByText(/125 TSS contributed/)).toBeInTheDocument()
  })
})
