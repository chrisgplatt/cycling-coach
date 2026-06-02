import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WorkoutDetailModal from '@/components/WorkoutDetailModal'
import type { Workout, ICUActivity } from '@/types'
import { makeWorkout } from '../support/factories'

const plannedWorkout: Workout = {
  id: 'w1', plan_id: 'p1', date: '2026-06-01', type: 'threshold',
  duration_minutes: 60, description: 'Test session', target_zones: 'Zone 4',
  status: 'planned', intervals_icu_event_id: null, icu_activity_id: null,
  tss: null, missed_reason: null,
  steps: [{ label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 }],
  activity_metrics: null,
  created_at: '',
}

describe('WorkoutDetailModal planned-vs-actual', () => {
  it('shows the target-only chart and never fetches streams when not completed/linked', () => {
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }))
    global.fetch = fetchMock as never
    render(<WorkoutDetailModal workout={plannedWorkout} athleteId="i1" ftp={250} onClose={() => {}} />)
    expect(screen.getByLabelText('Workout power profile')).toBeInTheDocument()
    const hitStreams = fetchMock.mock.calls.some(c => String((c as unknown[])[0]).includes('/streams'))
    expect(hitStreams).toBe(false)
  })
})

const workout = makeWorkout({
  date: '2026-05-15',
  type: 'threshold',
  duration_minutes: 60,
  description: '2x20min at threshold',
  target_zones: 'Zone 4 (91-105% FTP)',
  intervals_icu_event_id: 'evt123',
})

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
  beforeEach(() => {
    // Completed / needs_review workouts fetch existing feedback on mount.
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ feedback: null }) })
  })
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

  it('shows completed badge, planned → actual TSS, and activity link for a matched workout', async () => {
    render(<WorkoutDetailModal workout={matchedWorkout} athleteId="i12345" onClose={jest.fn()} />)
    expect(await screen.findByText('✓ Completed')).toBeInTheDocument()
    // threshold 60min: IF=0.85, planned = round(60*60*0.85*0.85/36) = 72
    expect(screen.getByText(/~72 → 94 TSS/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /view completed activity in intervals\.icu/i })
    expect(link).toHaveAttribute('href', 'https://intervals.icu/activities/act456')
  })

  it('shows needs_review banner with matched activity name', async () => {
    render(
      <WorkoutDetailModal
        workout={reviewWorkout}
        athleteId="i12345"
        activitiesOnDate={[activity]}
        onClose={jest.fn()}
      />
    )
    expect(await screen.findByText('Morning Ride')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /change/i })).toBeInTheDocument()
  })

  it('calls onClose when Close is clicked', () => {
    const onClose = jest.fn()
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onFeedback when Log feedback is clicked for a completed workout', async () => {
    const onFeedback = jest.fn()
    render(
      <WorkoutDetailModal
        workout={matchedWorkout}
        athleteId="i12345"
        onClose={jest.fn()}
        onFeedback={onFeedback}
      />
    )
    // The button only appears once the existing-feedback fetch resolves.
    fireEvent.click(await screen.findByRole('button', { name: /log feedback/i }))
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

  it('does not render date input for a completed workout', async () => {
    render(<WorkoutDetailModal workout={matchedWorkout} athleteId="i12345" onClose={jest.fn()} />)
    await screen.findByText('✓ Completed')
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

  describe('Mark as missed', () => {
    it('shows "Mark as missed" button for a planned workout', () => {
      render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
      expect(screen.getByRole('button', { name: /mark as missed/i })).toBeInTheDocument()
    })

    it('does not show "Mark as missed" button for a completed workout', () => {
      render(<WorkoutDetailModal workout={matchedWorkout} athleteId="i12345" onClose={jest.fn()} />)
      expect(screen.queryByRole('button', { name: /mark as missed/i })).not.toBeInTheDocument()
    })

    it('does not show "Mark as missed" button for a skipped workout', () => {
      const skipped = { ...workout, status: 'skipped' as const }
      render(<WorkoutDetailModal workout={skipped} athleteId="i12345" onClose={jest.fn()} />)
      expect(screen.queryByRole('button', { name: /mark as missed/i })).not.toBeInTheDocument()
    })

    it('reveals reason picker when "Mark as missed" is clicked', () => {
      render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /mark as missed/i }))
      expect(screen.getByText(/why was it missed/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /too tired/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /illness/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /confirm missed/i })).toBeInTheDocument()
    })

    it('selecting a reason chip and confirming calls PATCH with that reason', async () => {
      const onStatusChange = jest.fn()
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, json: async () => ({}),
      } as unknown as Response)
      render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} onStatusChange={onStatusChange} />)
      fireEvent.click(screen.getByRole('button', { name: /mark as missed/i }))
      fireEvent.click(screen.getByRole('button', { name: /illness/i }))
      fireEvent.click(screen.getByRole('button', { name: /confirm missed/i }))
      await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1))
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/workouts/w1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'skipped', missed_reason: 'Illness' }),
      }))
    })

    it('confirming without a reason calls PATCH with missed_reason: null', async () => {
      const onStatusChange = jest.fn()
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true, json: async () => ({}),
      } as unknown as Response)
      render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} onStatusChange={onStatusChange} />)
      fireEvent.click(screen.getByRole('button', { name: /mark as missed/i }))
      fireEvent.click(screen.getByRole('button', { name: /confirm missed/i }))
      await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1))
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/workouts/w1', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'skipped', missed_reason: null }),
      }))
    })

    it('Cancel hides the reason picker', () => {
      render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /mark as missed/i }))
      expect(screen.getByText(/why was it missed/i)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
      expect(screen.queryByText(/why was it missed/i)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /mark as missed/i })).toBeInTheDocument()
    })

    it('shows error when PATCH fails', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false, json: async () => ({ error: 'Server error' }),
      } as unknown as Response)
      render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /mark as missed/i }))
      fireEvent.click(screen.getByRole('button', { name: /confirm missed/i }))
      await waitFor(() => expect(screen.getByText('Server error')).toBeInTheDocument())
    })
  })
})
