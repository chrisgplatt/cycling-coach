import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
  average_heartrate: 155, training_load: 94, rolling_ftp: null,
  distance: null, total_elevation_gain: null, left_right_balance: null,
}

describe('WorkoutDetailModal', () => {
  afterEach(() => { jest.restoreAllMocks() })

  it('renders description and target zones', () => {
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
    expect(screen.getByText('2x20min at threshold')).toBeInTheDocument()
    expect(screen.getByText('Zone 4 (91-105% FTP)')).toBeInTheDocument()
  })

  it('shows intervals.icu week link for the workout date when event id is present', () => {
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
    // workout date is 2026-05-15 (Friday) → Monday of that week is 2026-05-11
    const link = screen.getByRole('link', { name: /view week in intervals\.icu/i })
    expect(link).toHaveAttribute('href', 'https://intervals.icu/?w=2026-05-11')
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
    expect(screen.getByText(/TSS.*94/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /view garmin activity/i })
    expect(link).toHaveAttribute('href', 'https://intervals.icu/activities/act456')
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
    expect(screen.getByText('Morning Ride')).toBeInTheDocument()
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

  it('renders date input for a planned workout with correct min and max', () => {
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
    // workout.date = '2026-05-15' (Fri) → Mon 2026-05-11, Sun 2026-05-17
    const input = screen.getByDisplayValue('2026-05-15')
    expect(input).toHaveAttribute('type', 'date')
    expect(input).toHaveAttribute('min', '2026-05-11')
    expect(input).toHaveAttribute('max', '2026-05-17')
  })

  it('does not render date input for a completed workout', () => {
    render(<WorkoutDetailModal workout={matchedWorkout} athleteId="i12345" onClose={jest.fn()} />)
    expect(screen.queryByDisplayValue('2026-05-15')).not.toBeInTheDocument()
  })

  it('shows inline confirmation when date is changed to a different day', () => {
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
    fireEvent.change(screen.getByDisplayValue('2026-05-15'), { target: { value: '2026-05-13' } })
    expect(screen.getByText(/move to 2026-05-13/i)).toBeInTheDocument()
  })

  it('hides confirmation when inline Cancel is clicked', () => {
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
    fireEvent.change(screen.getByDisplayValue('2026-05-15'), { target: { value: '2026-05-13' } })
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByText(/move to/i)).not.toBeInTheDocument()
  })

  it('calls PATCH with new date and then onReschedule on confirm', async () => {
    const onReschedule = jest.fn()
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({}),
    } as unknown as Response)
    render(
      <WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} onReschedule={onReschedule} />
    )
    fireEvent.change(screen.getByDisplayValue('2026-05-15'), { target: { value: '2026-05-13' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onReschedule).toHaveBeenCalledTimes(1))
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/workouts/w1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ date: '2026-05-13' }),
    }))
  })

  it('shows inline error on failed reschedule PATCH', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, json: async () => ({ error: 'Reschedule failed' }),
    } as unknown as Response)
    render(
      <WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} onReschedule={jest.fn()} />
    )
    fireEvent.change(screen.getByDisplayValue('2026-05-15'), { target: { value: '2026-05-13' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(screen.getByText('Reschedule failed')).toBeInTheDocument())
  })
})
