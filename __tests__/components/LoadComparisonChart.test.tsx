import { render, screen } from '@testing-library/react'
import LoadComparisonChart from '@/components/plan/LoadComparisonChart'

it('renders a planned and actual bar per week', () => {
  const weeks = [
    { plannedTss: 300, actualTss: 280 },
    { plannedTss: 350, actualTss: 360 },
    { plannedTss: 400, actualTss: 180 },
  ]
  const { container } = render(<LoadComparisonChart weeks={weeks} currentWeek={2} />)
  expect(container.querySelectorAll('[data-week-col]')).toHaveLength(3)
  expect(container.querySelectorAll('[data-bar]')).toHaveLength(6)
})

it('shows an axis scale from 0 to the max TSS value', () => {
  const weeks = [
    { plannedTss: 300, actualTss: 280 },
    { plannedTss: 400, actualTss: 180 },
  ]
  render(<LoadComparisonChart weeks={weeks} currentWeek={1} />)
  expect(screen.getByText('400')).toBeInTheDocument()
  expect(screen.getByText('200')).toBeInTheDocument()
  expect(screen.getByText('0')).toBeInTheDocument()
})

it('renders a color-swatch legend explaining planned, actual, and the current week', () => {
  const weeks = [{ plannedTss: 300, actualTss: 280 }]
  render(<LoadComparisonChart weeks={weeks} currentWeek={0} />)
  expect(screen.getByText('Planned')).toBeInTheDocument()
  expect(screen.getByText('Actual')).toBeInTheDocument()
  expect(screen.getByText('This week (in progress)')).toBeInTheDocument()
})

it('labels the current week bar differently from past weeks', () => {
  const weeks = [
    { plannedTss: 300, actualTss: 280 },
    { plannedTss: 350, actualTss: 200 },
  ]
  const { container } = render(<LoadComparisonChart weeks={weeks} currentWeek={1} />)
  const bars = container.querySelectorAll('[data-bar]')
  expect(bars[1].className).toContain('bg-blue-600')
  expect(bars[3].className).toContain('bg-blue-300')
})
