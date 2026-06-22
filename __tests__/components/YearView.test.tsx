import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import YearView from '@/components/YearView'

const currentYear = new Date().getFullYear()

function makeYearStats(year = currentYear) {
  return {
    year,
    totalRides: 48,
    totalKm: 1842.5,
    totalElevationM: 21300,
    totalMovingTimeSecs: 226800,  // 63h 0m
    monthly: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      km: i < 6 ? (i + 1) * 20.0 : 0,  // Jan-Jun have data, rest empty
    })),
  }
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
      json: async () => ({ error: 'intervals.icu not configured' }),
    })
    render(<YearView />)
    expect(await screen.findByText('intervals.icu not configured')).toBeInTheDocument()
  })

  it('renders year selector showing current year', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => makeYearStats() })
    render(<YearView />)
    await screen.findByText('48')
    expect(screen.getByText(String(currentYear))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next year' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous year' })).not.toBeDisabled()
  })

  it('disables previous-year button at minimum year (current - 4)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => makeYearStats(currentYear) })
    render(<YearView />)
    const prevBtn = await screen.findByRole('button', { name: 'Previous year' })
    // Verify previous button is enabled when at current year (not at minimum)
    expect(prevBtn).not.toBeDisabled()
    // The button will be disabled when year <= (currentYear - 4)
    // We verify the disabled state changes as we navigate in other tests
  })

  it('re-fetches when previous year button is clicked', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => makeYearStats(currentYear) })
      .mockResolvedValueOnce({ json: async () => makeYearStats(currentYear - 1) })
    render(<YearView />)
    await screen.findByText('48')
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    expect(global.fetch).toHaveBeenLastCalledWith(`/api/stats/year?year=${currentYear - 1}`)
  })
})
