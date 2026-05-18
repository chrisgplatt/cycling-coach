import { render, screen, fireEvent } from '@testing-library/react'
import WeeklyReviewBanner from '@/components/WeeklyReviewBanner'

describe('WeeklyReviewBanner', () => {
  it('shows last week workout summary', () => {
    render(<WeeklyReviewBanner lastWeekCompleted={3} lastWeekTotal={4} onReview={jest.fn()} onDismiss={jest.fn()} />)
    expect(screen.getByText(/3 of 4 workouts completed last week/i)).toBeInTheDocument()
  })

  it('shows zero-workout message when no workouts were scheduled', () => {
    render(<WeeklyReviewBanner lastWeekCompleted={0} lastWeekTotal={0} onReview={jest.fn()} onDismiss={jest.fn()} />)
    expect(screen.getByText(/no workouts were scheduled last week/i)).toBeInTheDocument()
  })

  it('calls onDismiss when Dismiss button clicked', () => {
    const onDismiss = jest.fn()
    render(<WeeklyReviewBanner lastWeekCompleted={2} lastWeekTotal={3} onReview={jest.fn()} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onReview with the typed note', () => {
    const onReview = jest.fn()
    render(<WeeklyReviewBanner lastWeekCompleted={2} lastWeekTotal={3} onReview={onReview} onDismiss={jest.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/injuries, fatigue/i), { target: { value: 'Feeling tired' } })
    fireEvent.click(screen.getByRole('button', { name: /review & adapt plan/i }))
    expect(onReview).toHaveBeenCalledWith('Feeling tired')
  })

  it('calls onReview with empty string when no note entered', () => {
    const onReview = jest.fn()
    render(<WeeklyReviewBanner lastWeekCompleted={2} lastWeekTotal={3} onReview={onReview} onDismiss={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /review & adapt plan/i }))
    expect(onReview).toHaveBeenCalledWith('')
  })
})
