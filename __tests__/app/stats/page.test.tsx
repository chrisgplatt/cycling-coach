import { render, screen } from '@testing-library/react'
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
})
