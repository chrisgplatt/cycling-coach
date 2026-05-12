import { render, screen, fireEvent } from '@testing-library/react'
import FeedbackModal from '@/components/FeedbackModal'
import type { Workout } from '@/types'

const workout: Workout = {
  id: 'w1', plan_id: 'p1', date: '2026-05-10',
  type: 'threshold', duration_minutes: 60, description: '2x20min threshold',
  target_zones: 'Zone 4', intervals_icu_event_id: null, status: 'completed',
  icu_activity_id: null, tss: null,
  created_at: '',
}

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
