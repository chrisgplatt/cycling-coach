import { render, screen, fireEvent } from '@testing-library/react'
import PlanPage from '@/app/plan/page'

global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({}),
})

describe('PlanPage tabs', () => {
  it('renders all three tab buttons', () => {
    render(<PlanPage />)
    expect(screen.getByRole('button', { name: /my plan/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /profile/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /events/i })).toBeInTheDocument()
  })

  it('shows My Plan panel by default and hides others', () => {
    render(<PlanPage />)
    expect(screen.getByTestId('tab-plan')).toBeVisible()
    expect(screen.getByTestId('tab-profile')).not.toBeVisible()
    expect(screen.getByTestId('tab-events')).not.toBeVisible()
  })

  it('switches to Profile panel on tab click', () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /profile/i }))
    expect(screen.getByTestId('tab-profile')).toBeVisible()
    expect(screen.getByTestId('tab-plan')).not.toBeVisible()
  })

  it('switches to Events panel on tab click', () => {
    render(<PlanPage />)
    fireEvent.click(screen.getByRole('button', { name: /events/i }))
    expect(screen.getByTestId('tab-events')).toBeVisible()
    expect(screen.getByTestId('tab-plan')).not.toBeVisible()
  })
})
