import { render, screen, fireEvent } from '@testing-library/react'
import WorkoutDetailModal from '@/components/WorkoutDetailModal'
import type { Workout, ICUActivity } from '@/types'

const workout: Workout = {
  id: 'w1', plan_id: 'p1', date: '2026-05-15',
  type: 'threshold', duration_minutes: 60,
  description: '2x20min at threshold', target_zones: 'Zone 4 (91-105% FTP)',
  intervals_icu_event_id: 'evt123', status: 'planned',
  icu_activity_id: null, tss: null,
  created_at: '',
}

const matchedWorkout: Workout = {
  ...workout, status: 'completed', icu_activity_id: 'act456', tss: 94,
}

const reviewWorkout: Workout = {
  ...workout, status: 'needs_review', icu_activity_id: 'act456', tss: 94,
}

const activity: ICUActivity = {
  id: 'act456', start_date_local: '2026-05-15T08:00:00',
  type: 'Ride', moving_time: 3600, name: 'Morning Ride',
  average_watts: 220, max_watts: 350, weighted_average_watts: 225,
  average_heartrate: 155, training_load: 94,
}

describe('WorkoutDetailModal', () => {
  it('renders description and target zones', () => {
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
    expect(screen.getByText('2x20min at threshold')).toBeInTheDocument()
    expect(screen.getByText('Zone 4 (91-105% FTP)')).toBeInTheDocument()
  })

  it('shows intervals.icu calendar link when event id is present', () => {
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
    const link = screen.getByRole('link', { name: /open intervals\.icu calendar/i })
    expect(link).toHaveAttribute('href', 'https://intervals.icu/athlete/i12345/calendar')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('does not show event link when intervals_icu_event_id is null', () => {
    render(
      <WorkoutDetailModal
        workout={{ ...workout, intervals_icu_event_id: null }}
        athleteId="i12345"
        onClose={jest.fn()}
      />
    )
    expect(screen.queryByRole('link', { name: /view planned workout/i })).not.toBeInTheDocument()
  })

  it('shows TSS and activity link for a matched workout', () => {
    render(<WorkoutDetailModal workout={matchedWorkout} athleteId="i12345" onClose={jest.fn()} />)
    expect(screen.getByText(/TSS:.*94/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /view garmin activity/i })
    expect(link).toHaveAttribute('href', 'https://intervals.icu/athlete/i12345/activities/act456')
  })

  it('shows needs_review banner with matched activity name', () => {
    render(
      <WorkoutDetailModal
        workout={reviewWorkout}
        athleteId="i12345"
        activitiesOnDate={[activity]}
        onClose={jest.fn()}
      />
    )
    expect(screen.getByText(/auto-matched to morning ride/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /change/i })).toBeInTheDocument()
  })

  it('calls onClose when Close is clicked', () => {
    const onClose = jest.fn()
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onFeedback when Log feedback is clicked for a completed workout', () => {
    const onFeedback = jest.fn()
    render(
      <WorkoutDetailModal
        workout={matchedWorkout}
        athleteId="i12345"
        onClose={jest.fn()}
        onFeedback={onFeedback}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /log feedback/i }))
    expect(onFeedback).toHaveBeenCalledTimes(1)
  })

  it('does not show Log feedback button for a planned workout', () => {
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} onFeedback={jest.fn()} />)
    expect(screen.queryByRole('button', { name: /log feedback/i })).not.toBeInTheDocument()
  })
})
