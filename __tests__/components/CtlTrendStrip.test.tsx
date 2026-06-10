import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CtlTrendStrip from '@/components/CtlTrendStrip'
import type { ChartsData } from '@/types'

// Build dates relative to today so the 3m filter always includes them
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const mockCharts: ChartsData = {
  wellness: [
    { id: daysAgo(80), ctl: 55, atl: 60, form: -5, hrv: null, resting_hr: null, sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null },
    { id: daysAgo(10), ctl: 62, atl: 65, form: -3, hrv: null, resting_hr: null, sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null },
    { id: daysAgo(5),  ctl: 68, atl: 70, form: -2, hrv: null, resting_hr: null, sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null },
  ],
  weeklyTss: [],
  rides: [
    { date: daysAgo(70), avgHr: 138 },
    { date: daysAgo(9),  avgHr: 142 },
    { date: daysAgo(4),  avgHr: 143 },
  ],
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ charts: mockCharts }),
  } as unknown as Response)
})

afterEach(() => {
  jest.restoreAllMocks()
})

it('renders nothing before data loads', () => {
  const { container } = render(<CtlTrendStrip />)
  expect(container.firstChild).toBeNull()
})

it('renders the strip after data loads', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  expect(screen.getByTestId('ctl-trend-strip')).toBeInTheDocument()
})

it('shows current CTL value', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  expect(screen.getByText(/CTL 68/)).toBeInTheDocument()
})

it('shows current HR value', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  expect(screen.getByText(/HR 143 bpm/)).toBeInTheDocument()
})

it('renders the SVG with CTL path and HR dots', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  const svg = screen.getByTestId('ctl-trend-svg')
  expect(svg.querySelector('path')).not.toBeNull()    // CTL line
  expect(svg.querySelectorAll('circle').length).toBe(2) // 2 HR dots within default 3m window
})

it('renders time-range tabs', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  expect(screen.getByRole('button', { name: /1m/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /3m/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /6m/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /12m/i })).toBeInTheDocument()
})

it('changing range tab re-filters data', async () => {
  const user = userEvent.setup()
  await act(async () => { render(<CtlTrendStrip />) })
  // Switch to 3m — daysAgo(80) CTL point is excluded; only 2 points remain, strip still renders
  await user.click(screen.getByRole('button', { name: /3m/i }))
  expect(screen.getByTestId('ctl-trend-strip')).toBeInTheDocument()
  // HR dots within 3m: daysAgo(9) and daysAgo(4) — 2 dots
  expect(screen.getByTestId('ctl-trend-svg').querySelectorAll('circle').length).toBe(2)
})

it('renders nothing when fetch fails', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network'))
  await act(async () => { render(<CtlTrendStrip />) })
  expect(screen.queryByTestId('ctl-trend-strip')).toBeNull()
})

it('applies embedded styling when embedded prop is true', async () => {
  await act(async () => { render(<CtlTrendStrip embedded />) })
  const strip = screen.getByTestId('ctl-trend-strip')
  // embedded version has no bg-white/border classes
  expect(strip.className).not.toContain('bg-white')
})

it('defaults to the 3m tab', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  const btn = screen.getByRole('button', { name: /3m/i })
  expect(btn.className).toContain('bg-blue-600')
})
