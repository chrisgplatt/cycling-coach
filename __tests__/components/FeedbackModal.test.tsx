import { render, screen, fireEvent } from '@testing-library/react'
import FeedbackModal from '@/components/FeedbackModal'
import { makeWorkout } from '../support/factories'

const workout = makeWorkout({
  date: '2026-05-10',
  type: 'threshold',
  duration_minutes: 60,
  description: '2x20min threshold',
  target_zones: 'Zone 4',
  status: 'completed',
})

describe('FeedbackModal', () => {
  it('renders the feedback textarea', () => {
    render(<FeedbackModal workout={workout} onClose={jest.fn()} />)
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0)
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = jest.fn()
    render(<FeedbackModal workout={workout} onClose={onClose} />)
    fireEvent.click(screen.getByText(/cancel/i))
    expect(onClose).toHaveBeenCalled()
  })
})
