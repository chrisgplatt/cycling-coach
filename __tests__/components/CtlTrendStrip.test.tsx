import { render, screen, act, fireEvent, within } from '@testing-library/react'
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
  dailyStrain: [],
  rides: [
    { date: daysAgo(100), avgHr: 138, tss: 80, name: 'Century Ride', durationSecs: 14400 },
    { date: daysAgo(10),  avgHr: 142, tss: 95, name: 'Threshold Intervals', durationSecs: 5400 },
    { date: daysAgo(5),   avgHr: 143, tss: 60, name: 'Morning Endurance Ride', durationSecs: 6300 },
    { date: daysAgo(5),   avgHr: 110, tss: 18, name: 'Evening Recovery Spin', durationSecs: 2400 },
  ],
  activities: [],
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

it('shows a ride breakdown tooltip when a 1m hit-target is tapped', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  // ctlPoints in the 1m window are [daysAgo(10), daysAgo(5)] in that order,
  // so slot index 1 is nearest the daysAgo(5) session dot (the 2-ride day).
  fireEvent.click(screen.getByTestId('ctl-hit-1'))
  const tooltip = screen.getByTestId('ctl-ride-tooltip')
  expect(tooltip).toBeInTheDocument()
  expect(screen.getByText(/Morning Endurance Ride/)).toBeInTheDocument()
  expect(screen.getByText(/60 TSS/)).toBeInTheDocument()
  expect(screen.getByText(/1h 45m/)).toBeInTheDocument()
  expect(screen.getByText(/Evening Recovery Spin/)).toBeInTheDocument()
  expect(screen.getByText(/18 TSS/)).toBeInTheDocument()
  expect(screen.getByText(/0h 40m/)).toBeInTheDocument()
  expect(screen.getByText(/Total 78 TSS/)).toBeInTheDocument()
  expect(screen.getByText(/CTL 68/)).toBeInTheDocument()
  // "RHR 50" also appears in the header badge ("RHR 50 bpm"), so scope to the tooltip
  expect(within(tooltip).getByText(/RHR 50/)).toBeInTheDocument()
})

it('clicking the same hit-target again closes the tooltip', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  const hit = screen.getByTestId('ctl-hit-1')
  fireEvent.click(hit)
  expect(screen.getByTestId('ctl-ride-tooltip')).toBeInTheDocument()
  fireEvent.click(hit)
  expect(screen.queryByTestId('ctl-ride-tooltip')).toBeNull()
})

it('has no hit-targets or tooltip on the 3m tab', async () => {
  const user = userEvent.setup()
  await act(async () => { render(<CtlTrendStrip />) })
  fireEvent.click(screen.getByTestId('ctl-hit-1'))
  expect(screen.getByTestId('ctl-ride-tooltip')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /3m/i }))
  expect(screen.queryByTestId('ctl-ride-tooltip')).toBeNull()
  expect(screen.queryAllByTestId(/^ctl-hit-/).length).toBe(0)
})

it('grows the tooltip rightward (not centered) for the leftmost session dot', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  // ctl-hit-0 snaps to the daysAgo(10) dot, which sits at the chart's left edge.
  fireEvent.click(screen.getByTestId('ctl-hit-0'))
  const tooltip = screen.getByTestId('ctl-ride-tooltip')
  expect(tooltip.style.transform).toContain('translate(0,')
  expect(tooltip.className).toContain('max-w-[130px]')
})

it('grows the tooltip leftward (not centered) for the rightmost session dot', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  // ctl-hit-1 snaps to the daysAgo(5) dot, which sits at the chart's right edge.
  fireEvent.click(screen.getByTestId('ctl-hit-1'))
  const tooltip = screen.getByTestId('ctl-ride-tooltip')
  expect(tooltip.style.transform).toContain('translate(-100%,')
})
