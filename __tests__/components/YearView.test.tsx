import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import YearView from '@/components/YearView'

const currentYear = new Date().getFullYear()

function makeRideGroup(overrides: Partial<{
  totalActivities: number; totalKm: number; totalElevationM: number; totalMovingTimeSecs: number
}> = {}) {
  return {
    key: 'ride', label: 'Rides', emoji: '🚴', chartMetric: 'km' as const,
    totalActivities: 48,
    totalKm: 1842.5,
    totalElevationM: 21300,
    totalMovingTimeSecs: 226800,  // 63h 0m
    monthly: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      km: i < 6 ? (i + 1) * 20.0 : 0,
      count: i < 6 ? 1 : 0,
    })),
    ...overrides,
  }
}

function makeYearStats(year = currentYear) {
  return { year, groups: [makeRideGroup()] }
}

global.fetch = jest.fn()

describe('YearView', () => {
  afterEach(() => jest.clearAllMocks())

  it('shows loading spinner while fetching', () => {
    ;(global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}))
    render(<YearView />)
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('renders headline stats after successful fetch', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => makeYearStats(),
    })
    render(<YearView />)
    expect(await screen.findByText('48')).toBeInTheDocument()
    expect(screen.getByText('1842.5')).toBeInTheDocument()
    expect(screen.getByText('21300')).toBeInTheDocument()
    expect(screen.getByText('63h 0m')).toBeInTheDocument()
  })

  it('shows error message on fetch failure', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ error: 'intervals.icu not configured' }),
    })
    render(<YearView />)
    expect(await screen.findByText('intervals.icu not configured')).toBeInTheDocument()
  })

  it('renders year selector showing current year', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => makeYearStats() })
    render(<YearView />)
    await screen.findByText('48')
    expect(screen.getByText(String(currentYear))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next year' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous year' })).not.toBeDisabled()
  })

  it('disables previous-year button at minimum year (current - 4)', async () => {
    const currentYear = new Date().getFullYear()
    // Set up mocks: one for initial load, then four more for each year click
    for (let i = 0; i <= 4; i++) {
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ year: currentYear - i, groups: [] }),
      })
    }
    render(<YearView />)
    // Wait for initial load to complete
    await screen.findByRole('button', { name: 'Previous year' })
    expect(screen.getByRole('button', { name: 'Previous year' })).not.toBeDisabled()

    // Click back 4 times to reach minYear; wait for each re-fetch to settle
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))
      // Wait for the next fetch call to complete (button re-appears after loading)
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(i + 2))
      // Wait for loading to clear so the nav buttons are visible again
      if (i < 3) {
        await screen.findByRole('button', { name: 'Previous year' })
      }
    }
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Previous year' })).toBeDisabled()
    )
  })

  it('re-fetches when previous year button is clicked', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => makeYearStats(currentYear) })
      .mockResolvedValueOnce({ ok: true, json: async () => makeYearStats(currentYear - 1) })
    render(<YearView />)
    await screen.findByText('48')
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    expect(global.fetch).toHaveBeenLastCalledWith(`/api/stats/year?year=${currentYear - 1}`)
  })
})
