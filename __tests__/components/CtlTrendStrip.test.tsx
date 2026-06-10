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
    { id: daysAgo(100), ctl: 55, atl: 60, form: -5, hrv: null, resting_hr: null, sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null },
    { id: daysAgo(10), ctl: 62, atl: 65, form: -3, hrv: null, resting_hr: 52,   sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null },
    { id: daysAgo(5),  ctl: 68, atl: 70, form: -2, hrv: null, resting_hr: 50,   sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null },
  ],
  weeklyTss: [],
  rides: [
    { date: daysAgo(100), avgHr: 138, tss: 80 },
    { date: daysAgo(10),  avgHr: 142, tss: 95 },
    { date: daysAgo(5),   avgHr: 143, tss: 60 },
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
  expect(screen.getByText(/Progress \(CTL\) 68/)).toBeInTheDocument()
})

it('shows current RHR value', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  expect(screen.getByText(/RHR 50 bpm/)).toBeInTheDocument()
})

it('renders CTL path and session dot circles', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  const svg = screen.getByTestId('ctl-trend-svg')
  expect(svg.querySelector('path')).not.toBeNull()        // CTL line
  // daysAgo(10) and daysAgo(5) rides match wellness dates → 2 session dots in 1m window
  expect(svg.querySelectorAll('circle').length).toBe(2)
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
  // Switch to 12m — all 3 wellness entries included; daysAgo(10) and daysAgo(5)
  // both have resting_hr, so rhrPath renders (2 points)
  await user.click(screen.getByRole('button', { name: /12m/i }))
  const svg = screen.getByTestId('ctl-trend-svg')
  expect(screen.getByTestId('ctl-trend-strip')).toBeInTheDocument()
  expect(svg.querySelectorAll('path').length).toBe(2)   // CTL line + RHR line
  expect(svg.querySelectorAll('circle').length).toBe(3) // session dots for all 3 rides in 12m
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

it('defaults to the 1m tab', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  const btn = screen.getByRole('button', { name: /1m/i })
  expect(btn.className).toContain('bg-blue-600')
})
