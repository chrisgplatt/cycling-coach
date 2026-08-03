import { render, screen, fireEvent } from '@testing-library/react'
import PlanKebabMenu from '@/components/PlanKebabMenu'

const handlers = {
  onExtend: jest.fn(),
  onRegenerate: jest.fn(),
  onRename: jest.fn(),
  onClearFuture: jest.fn(),
  onClosePlan: jest.fn(),
}

beforeEach(() => {
  Object.values(handlers).forEach(fn => fn.mockReset())
})

describe('PlanKebabMenu', () => {
  it('renders the ⋯ button', () => {
    render(<PlanKebabMenu {...handlers} />)
    expect(screen.getByRole('button', { name: /plan options/i })).toBeInTheDocument()
  })

  it('menu is closed by default', () => {
    render(<PlanKebabMenu {...handlers} />)
    expect(screen.queryByText('Extend plan')).not.toBeInTheDocument()
  })

  it('opens menu on button click', () => {
    render(<PlanKebabMenu {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /plan options/i }))
    expect(screen.getByText('Extend plan')).toBeInTheDocument()
    expect(screen.getByText('Regenerate plan')).toBeInTheDocument()
    expect(screen.getByText('Rename plan')).toBeInTheDocument()
    expect(screen.getByText('Clear future workouts')).toBeInTheDocument()
    expect(screen.getByText('Close plan')).toBeInTheDocument()
  })

  it('calls onClearFuture and closes', () => {
    render(<PlanKebabMenu {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /plan options/i }))
    fireEvent.click(screen.getByText('Clear future workouts'))
    expect(handlers.onClearFuture).toHaveBeenCalled()
    expect(screen.queryByText('Clear future workouts')).not.toBeInTheDocument()
  })

  it('calls onExtend and closes on "Extend plan" click', () => {
    render(<PlanKebabMenu {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /plan options/i }))
    fireEvent.click(screen.getByText('Extend plan'))
    expect(handlers.onExtend).toHaveBeenCalled()
    expect(screen.queryByText('Extend plan')).not.toBeInTheDocument()
  })

  it('calls onRegenerate and closes', () => {
    render(<PlanKebabMenu {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /plan options/i }))
    fireEvent.click(screen.getByText('Regenerate plan'))
    expect(handlers.onRegenerate).toHaveBeenCalled()
    expect(screen.queryByText('Regenerate plan')).not.toBeInTheDocument()
  })

  it('calls onRename and closes', () => {
    render(<PlanKebabMenu {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /plan options/i }))
    fireEvent.click(screen.getByText('Rename plan'))
    expect(handlers.onRename).toHaveBeenCalled()
    expect(screen.queryByText('Rename plan')).not.toBeInTheDocument()
  })

  it('calls onClosePlan and closes', () => {
    render(<PlanKebabMenu {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /plan options/i }))
    fireEvent.click(screen.getByText('Close plan'))
    expect(handlers.onClosePlan).toHaveBeenCalled()
    expect(screen.queryByText('Close plan')).not.toBeInTheDocument()
  })
})
