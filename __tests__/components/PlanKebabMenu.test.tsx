import { render, screen, fireEvent } from '@testing-library/react'
import PlanKebabMenu from '@/components/PlanKebabMenu'

const handlers = {
  onExtend: jest.fn(),
  onRegenerate: jest.fn(),
  onRename: jest.fn(),
  onDelete: jest.fn(),
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
    expect(screen.getByText('Delete plan')).toBeInTheDocument()
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

  it('calls onDelete and closes', () => {
    render(<PlanKebabMenu {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /plan options/i }))
    fireEvent.click(screen.getByText('Delete plan'))
    expect(handlers.onDelete).toHaveBeenCalled()
    expect(screen.queryByText('Delete plan')).not.toBeInTheDocument()
  })
})
