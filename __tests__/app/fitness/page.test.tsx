import { render, screen } from '@testing-library/react'
import FitnessPage from '@/app/fitness/page'
import type { ChartsData } from '@/types'

const mockCharts: ChartsData = {
  wellness: [
    { id: '2026-02-01', ctl: 40, atl: 45, form: -5, hrv: null, resting_hr: null, sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null },
    { id: '2026-03-01', ctl: 48, atl: 52, form: -4, hrv: null, resting_hr: null, sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null },
    { id: '2026-05-20', ctl: 54, atl: 61, form: -7, hrv: null, resting_hr: null, sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null },
  ],
  weeklyTss: [
    { weekStart: '2026-02-02', tss: 280 },
    { weekStart: '2026-02-09', tss: 320 },
    { weekStart: '2026-05-18', tss: 180 },
  ],
  rides: [],
  dailyStrain: [],
  activities: [],
  recoveryHistory: [],
}

global.fetch = jest.fn()

describe('FitnessPage charts', () => {
  afterEach(() => jest.clearAllMocks())

  it('shows spinner while charts are loading', () => {
    ;(global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}))
    render(<FitnessPage />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders PMC stat pills after load', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/charts') return Promise.resolve({ json: async () => ({ charts: mockCharts }) })
      if (url === '/api/weight-log') return Promise.resolve({ json: async () => ({ entries: [] }) })
      return Promise.resolve({ json: async () => [] })
    })
    render(<FitnessPage />)
    expect(await screen.findByText('54')).toBeInTheDocument()  // CTL
    expect(screen.getByText('61')).toBeInTheDocument()          // ATL
    expect(screen.getByText('-7')).toBeInTheDocument()          // Form
    expect(screen.getAllByText('CTL').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('ATL').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Form').length).toBeGreaterThanOrEqual(1)
  })

  it('renders weekly TSS bars (one rect per week)', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/charts') return Promise.resolve({ json: async () => ({ charts: mockCharts }) })
      if (url === '/api/weight-log') return Promise.resolve({ json: async () => ({ entries: [] }) })
      return Promise.resolve({ json: async () => [] })
    })
    render(<FitnessPage />)
    await screen.findByText('54')  // Use a unique identifier instead
    // One SVG rect per week in the TSS chart
    const rects = document.querySelectorAll('svg rect')
    expect(rects.length).toBe(mockCharts.weeklyTss.length)
  })

  it('shows charts error message on fetch failure', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/charts') return Promise.resolve({ json: async () => ({ error: 'intervals.icu not configured' }) })
      if (url === '/api/weight-log') return Promise.resolve({ json: async () => ({ entries: [] }) })
      return Promise.resolve({ json: async () => [] })
    })
    render(<FitnessPage />)
    expect(await screen.findByText('intervals.icu not configured')).toBeInTheDocument()
  })

  it('shows placeholder when wellness is empty', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/charts') return Promise.resolve({ json: async () => ({ charts: { wellness: [], weeklyTss: [], recoveryHistory: [] } }) })
      if (url === '/api/weight-log') return Promise.resolve({ json: async () => ({ entries: [] }) })
      return Promise.resolve({ json: async () => [] })
    })
    render(<FitnessPage />)
    expect(await screen.findByText('No fitness data yet.')).toBeInTheDocument()
    expect(screen.getByText('No training load data yet.')).toBeInTheDocument()
  })
})
