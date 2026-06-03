import { render, screen } from '@testing-library/react'
import FitnessTrendChart from '@/components/plan/FitnessTrendChart'
import type { ForecastResult } from '@/lib/plan/forecast'

const points = [
  { date: '2026-05-01', ctl: 40, form: 2 },
  { date: '2026-05-08', ctl: 44, form: -3 },
  { date: '2026-05-15', ctl: 48, form: -6 },
]

const forecast: ForecastResult = {
  planCtl: 54, paceCtl: 49,
  planSeries: [48, 50, 52, 54],
  paceSeries: [48, 49, 49, 49],
  horizonDays: 3,
}

it('renders two trend lines and the CTL delta when enough data', () => {
  const { container } = render(<FitnessTrendChart points={points} />)
  expect(container.querySelectorAll('polyline')).toHaveLength(2)
  expect(screen.getByText(/\+8/)).toBeInTheDocument() // 48 − 40
})

it('shows an empty state with fewer than three points', () => {
  render(<FitnessTrendChart points={points.slice(0, 2)} />)
  expect(screen.getByText('Not enough data yet.')).toBeInTheDocument()
})

it('draws plan + pace projections and a forecast caption when forecast is given', () => {
  const { container } = render(<FitnessTrendChart points={points} forecast={forecast} />)
  expect(container.querySelectorAll('polyline')).toHaveLength(4) // CTL, Form, plan, pace
  expect(screen.getByText(/Stick to plan: CTL ~54/)).toBeInTheDocument()
  expect(screen.getByText(/current pace: ~49/i)).toBeInTheDocument()
})

it('ignores a zero-horizon forecast (behaves as no forecast)', () => {
  const { container } = render(
    <FitnessTrendChart points={points} forecast={{ ...forecast, horizonDays: 0, planSeries: [], paceSeries: [] }} />,
  )
  expect(container.querySelectorAll('polyline')).toHaveLength(2)
})
