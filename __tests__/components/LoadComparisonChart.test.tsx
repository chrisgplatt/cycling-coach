import { render } from '@testing-library/react'
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
