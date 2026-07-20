import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StatsPage from '@/app/stats/page'
import type { RidingStats } from '@/types'
import { makeRidingStats } from '../../support/factories'

const mockStats = makeRidingStats({
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
      id: 'a1', name: 'Morning Ride', start_date_local: '2026-05-19T07:30:00', type: 'Ride',
      moving_time: 3600, average_watts: 210, max_watts: 450, weighted_average_watts: 225,
      average_heartrate: 148, training_load: 72, rolling_ftp: null,
      distance: 40000, total_elevation_gain: 350, left_right_balance: 52.0,
    },
    {
      id: 'a2', name: 'Evening Zone 2', start_date_local: '2026-05-17T18:00:00', type: 'Ride',
      moving_time: 5400, average_watts: 185, max_watts: 390, weighted_average_watts: 195,
      average_heartrate: null, training_load: 58, rolling_ftp: null,
      distance: 55000, total_elevation_gain: 220, left_right_balance: null,
    },
  ],
  cross_training: [],
})

// Minimal valid YearStats — returned by default for /api/stats/year
const minimalYearStats = {
  year: new Date().getFullYear(),
  groups: [{
    key: 'ride', label: 'Rides', emoji: '🚴', chartMetric: 'km',
    totalActivities: 99, totalKm: 0, totalElevationM: 0, totalMovingTimeSecs: 0,
    monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, km: 0, count: 0 })),
  }],
}

// Mock fetch with URL routing: year endpoint returns minimalYearStats; stats returns
// provided stats object; weight-log returns empty.
function mockWithYear(statsOverride?: Partial<RidingStats>) {
  ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
    if (String(url).includes('/api/stats/year')) {
      return Promise.resolve({ ok: true, json: async () => minimalYearStats })
    }
    if (String(url).includes('/api/weight-log')) {
      return Promise.resolve({ ok: true, json: async () => ({ entries: [] }) })
    }
    const stats = statsOverride ? { ...mockStats, ...statsOverride } : mockStats
    return Promise.resolve({ ok: true, json: async () => ({ stats }) })
  })
}

// Wait for YearView to finish loading (totalRides=99 appears), then click "28 Days".
async function go28d() {
  expect(await screen.findByText('99')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: '28 Days' }))
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
    mockWithYear()
    render(<StatsPage />)
    await go28d()
    expect(await screen.findByText('380')).toBeInTheDocument()
    expect(screen.getByText('355')).toBeInTheDocument()
    expect(screen.getByText('320')).toBeInTheDocument()
  })

  it('renders totals after load', async () => {
    mockWithYear()
    render(<StatsPage />)
    await go28d()
    expect(await screen.findByText('342.5')).toBeInTheDocument()
    expect(screen.getByText('4200')).toBeInTheDocument()
    expect(screen.getByText('12h 0m')).toBeInTheDocument()
  })

  it('renders balance after load', async () => {
    mockWithYear()
    render(<StatsPage />)
    await go28d()
    expect(await screen.findByText('47.7% L / 52.3% R')).toBeInTheDocument()
  })

  it('shows — for null power values', async () => {
    mockWithYear({ power_5min: null, power_10min: null, power_20min: null })
    render(<StatsPage />)
    await go28d()
    await screen.findByText('342.5')
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(3)
  })

  it('shows — for null balance', async () => {
    mockWithYear({ avg_left_right_balance: null })
    render(<StatsPage />)
    await go28d()
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
    mockWithYear()
    render(<StatsPage />)
    expect(await screen.findByRole('tab', { name: '28 Days' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Tue 19 May' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sun 17 May' })).toBeInTheDocument()
  })

  it('shows per-ride stats when a ride tab is clicked', async () => {
    mockWithYear()
    const user = userEvent.setup()
    render(<StatsPage />)
    await screen.findByRole('tab', { name: 'Tue 19 May' })
    await user.click(screen.getByRole('tab', { name: 'Tue 19 May' }))
    expect(await screen.findByText('210')).toBeInTheDocument()  // avg watts
    expect(screen.getByText('225')).toBeInTheDocument()          // NP
    expect(screen.getByText('72')).toBeInTheDocument()           // TSS
    expect(screen.getByText('Morning Ride')).toBeInTheDocument()
  })

  it('hides cross-training section when cross_training is empty', async () => {
    mockWithYear({ cross_training: [] })
    render(<StatsPage />)
    await go28d()
    await screen.findByText('342.5')
    expect(screen.queryByText(/Other Activity/)).not.toBeInTheDocument()
  })

  it('renders cross-training groups when present', async () => {
    mockWithYear({
      cross_training: [
        { type: 'Run', count: 2, total_duration_secs: 4800, total_distance_m: 16000, total_tss: 80 },
        { type: 'Walk', count: 3, total_duration_secs: 9900, total_distance_m: 12000, total_tss: 45 },
      ],
    })
    render(<StatsPage />)
    await go28d()
    expect(await screen.findByText('Run')).toBeInTheDocument()
    expect(screen.getByText('Walk')).toBeInTheDocument()
    expect(screen.getByText('2 sessions')).toBeInTheDocument()
    expect(screen.getByText('3 sessions')).toBeInTheDocument()
  })

  it('shows correct TSS and distance per group', async () => {
    mockWithYear({
      cross_training: [
        { type: 'Run', count: 2, total_duration_secs: 4800, total_distance_m: 16000, total_tss: 80 },
        { type: 'Walk', count: 3, total_duration_secs: 9900, total_distance_m: 0, total_tss: 45 },
      ],
    })
    render(<StatsPage />)
    await go28d()
    expect(await screen.findByText('Run')).toBeInTheDocument()
    expect(screen.getAllByText(/16\.0 km/).length).toBeGreaterThan(0)
    expect(screen.getByText(/80 TSS/)).toBeInTheDocument()
    expect(screen.getByText(/45 TSS/)).toBeInTheDocument()
  })

  it('shows footer totals across all cross-training groups', async () => {
    mockWithYear({
      cross_training: [
        { type: 'Run', count: 2, total_duration_secs: 4800, total_distance_m: 16000, total_tss: 80 },
        { type: 'Walk', count: 3, total_duration_secs: 9900, total_distance_m: 12000, total_tss: 45 },
      ],
    })
    render(<StatsPage />)
    await go28d()
    expect(await screen.findByText('Run')).toBeInTheDocument()
    expect(screen.getByText(/5 activities/)).toBeInTheDocument()
    expect(screen.getByText(/125 TSS contributed/)).toBeInTheDocument()
  })

  // ── New tab tests ──────────────────────────────────────────────────────────

  it('defaults to the "This Year" tab and shows year totals', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (String(url).includes('/api/stats/year')) {
        return Promise.resolve({ ok: true, json: async () => ({
          year: new Date().getFullYear(),
          groups: [{
            key: 'ride', label: 'Rides', emoji: '🚴', chartMetric: 'km',
            totalActivities: 42, totalKm: 1500, totalElevationM: 15000, totalMovingTimeSecs: 180000,
            monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, km: 0, count: 0 })),
          }],
        }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ stats: mockStats }) })
    })
    render(<StatsPage />)
    expect(await screen.findByText('42')).toBeInTheDocument()  // totalActivities from YearView
  })

  it('shows "Activity Log" tab and renders activities when clicked', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (String(url).includes('/api/stats/year')) {
        return Promise.resolve({ ok: true, json: async () => minimalYearStats })
      }
      if (String(url).includes('/api/activities')) {
        return Promise.resolve({ ok: true, json: async () => ({
          activities: [{ id: 'ax', name: 'Test Log Ride', type: 'Ride',
            start_date_local: '2026-06-01T08:00:00', moving_time: 3600, distance: 40000,
            total_elevation_gain: 300, average_watts: null, max_watts: null,
            weighted_average_watts: null, average_heartrate: null, training_load: null,
            rolling_ftp: null, left_right_balance: null }],
          hasMore: false, total: 1,
        }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ stats: mockStats }) })
    })
    render(<StatsPage />)
    await screen.findByText('99')  // YearView loaded (minimalYearStats.totalRides)
    fireEvent.click(screen.getByRole('tab', { name: 'Activity Log' }))
    expect(await screen.findByText('Test Log Ride')).toBeInTheDocument()
  })

  it('shows "28 Days" tab with ride count when clicked', async () => {
    mockWithYear()
    render(<StatsPage />)
    await go28d()
    expect(await screen.findByText('342.5')).toBeInTheDocument()
  })

  it('shows "Bests" tab and renders bests when clicked', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (String(url).includes('/api/stats/year')) {
        return Promise.resolve({ ok: true, json: async () => minimalYearStats })
      }
      if (String(url).includes('/api/bests')) {
        return Promise.resolve({ ok: true, json: async () => ({
          allTime: {
            biggestClimb: { workoutId: 'w1', date: '2026-03-15', elev_gain_m: 620, length_km: 8.4 },
            longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null,
          },
          byYear: {},
        }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({ stats: mockStats }) })
    })
    render(<StatsPage />)
    await screen.findByText('99')
    fireEvent.click(screen.getByRole('tab', { name: 'Bests' }))
    expect(await screen.findByText('620')).toBeInTheDocument()
  })
})
