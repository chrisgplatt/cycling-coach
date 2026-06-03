import { render, screen } from '@testing-library/react'
import FitnessTrendChart from '@/components/plan/FitnessTrendChart'

const points = [
  { date: '2026-05-01', ctl: 40, form: 2 },
  { date: '2026-05-08', ctl: 44, form: -3 },
  { date: '2026-05-15', ctl: 48, form: -6 },
]

it('renders two trend lines and the CTL delta when enough data', () => {
  const { container } = render(<FitnessTrendChart points={points} />)
  expect(container.querySelectorAll('polyline')).toHaveLength(2)
  expect(screen.getByText(/\+8/)).toBeInTheDocument() // 48 − 40
})

it('shows an empty state with fewer than three points', () => {
  render(<FitnessTrendChart points={points.slice(0, 2)} />)
  expect(screen.getByText('Not enough data yet.')).toBeInTheDocument()
})
