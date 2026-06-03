import { render, screen } from '@testing-library/react'
import ReadinessBadge from '@/components/ReadinessBadge'

it('renders the headline and a green style for a green verdict', () => {
  render(<ReadinessBadge verdict="green" headline="Go hard" />)
  const badge = screen.getByTestId('readiness-badge')
  expect(badge).toHaveTextContent(/GO HARD/i)
  expect(badge.className).toMatch(/emerald/)
})

it('uses red styling for a red verdict', () => {
  render(<ReadinessBadge verdict="red" headline="Ease today" />)
  expect(screen.getByTestId('readiness-badge').className).toMatch(/red/)
})
