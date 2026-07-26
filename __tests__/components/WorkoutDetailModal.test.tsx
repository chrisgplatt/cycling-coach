import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WorkoutDetailModal from '@/components/WorkoutDetailModal'
import type { Workout, ICUActivity } from '@/types'
import { makeWorkout, makeActivityMetrics } from '../support/factories'

const plannedWorkout: Workout = {
  id: 'w1', plan_id: 'p1', date: '2026-06-01', type: 'threshold',
  duration_minutes: 60, description: 'Test session', target_zones: 'Zone 4',
  status: 'planned', intervals_icu_event_id: null, icu_activity_id: null,
  tss: null, actual_duration_minutes: null, missed_reason: null, ftp_at_completion: null,
  optional: false, name: null,
  steps: [{ label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 }],
  activity_metrics: null,
  coaching_notes: null,
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
  it('shows an unavailable note when a completed linked ride has no usable power data', async () => {
    const completed = {
      ...plannedWorkout, status: 'completed' as const, icu_activity_id: 'a1',
    }
    const fetchMock = jest.fn((url: string) =>
      String(url).includes('/streams')
        ? Promise.resolve({ ok: true, json: async () => ({ streams: { time: [0, 60], power: null }, intervals: [] }) })
        : String(url).includes('/weather/')
          ? Promise.resolve({ ok: false })
          : Promise.resolve({ ok: true, json: async () => ({ feedback: null }) }),
    )
    global.fetch = fetchMock as never
    render(<WorkoutDetailModal workout={completed} athleteId="i1" ftp={250} onClose={() => {}} />)
    expect(await screen.findByText(/actual power unavailable/i)).toBeInTheDocument()
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
  average_heartrate: 155, training_load: 94, rolling_ftp: null, ftp: 245,
  distance: null, total_elevation_gain: null, left_right_balance: null,
}

describe('WorkoutDetailModal', () => {
  beforeEach(() => {
    // Completed / needs_review workouts fetch existing feedback on mount.
    // Weather URLs return ok:false so the weather panel stays hidden (no air_speed_kph to crash on).
    ;(global.fetch as jest.Mock).mockImplementation((url: string) =>
      String(url).includes('/weather/')
        ? Promise.resolve({ ok: false })
        : Promise.resolve({ ok: true, json: async () => ({ feedback: null }) }),
    )
  })
  afterEach(() => { jest.restoreAllMocks() })

  it('renders description and target zones', () => {
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
    expect(screen.getByText('2x20min at threshold')).toBeInTheDocument()
    expect(screen.getByText('Zone 4 (91-105% FTP)')).toBeInTheDocument()
  })

  it('shows the workout name at the top when set', () => {
    const named = { ...workout, name: 'Sa Batalla - 60' }
    render(<WorkoutDetailModal workout={named} athleteId="i12345" onClose={jest.fn()} />)
    expect(screen.getByText('Sa Batalla - 60')).toBeInTheDocument()
  })

  it('renders no name line when name is null', () => {
    const unnamed = { ...workout, name: null }
    render(<WorkoutDetailModal workout={unnamed} athleteId="i12345" onClose={jest.fn()} />)
    expect(screen.queryByText(/Sa Batalla/)).not.toBeInTheDocument()
  })

  it('does not show an intervals.icu week link, even when an event id is present', () => {
    // The "View week in intervals.icu" link was removed; the workout fixture has an
    // intervals_icu_event_id, so this confirms it no longer renders.
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={jest.fn()} />)
    expect(screen.queryByRole('link', { name: /view week in intervals\.icu/i })).not.toBeInTheDocument()
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

  it('calls PATCH with ftp_at_completion from the matched activity when confirming a match', async () => {
    const onStatusChange = jest.fn()
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({}),
    } as unknown as Response)
    render(
      <WorkoutDetailModal
        workout={reviewWorkout}
        athleteId="i12345"
        activitiesOnDate={[activity]}
        onClose={jest.fn()}
        onStatusChange={onStatusChange}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1))
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/workouts/w1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed', ftp_at_completion: 245 }),
    }))
  })

  it('calls PATCH with ftp_at_completion from the selected activity when picking a different match', async () => {
    const onStatusChange = jest.fn()
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({}),
    } as unknown as Response)
    const otherActivity: ICUActivity = { ...activity, id: 'act789', name: 'Afternoon Ride', ftp: 250 }
    render(
      <WorkoutDetailModal
        workout={reviewWorkout}
        athleteId="i12345"
        activitiesOnDate={[activity, otherActivity]}
        onClose={jest.fn()}
        onStatusChange={onStatusChange}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: /change/i }))
    fireEvent.click(screen.getByText('Afternoon Ride'))
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledTimes(1))
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/workouts/w1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ icu_activity_id: 'act789', tss: 94, status: 'completed', ftp_at_completion: 250 }),
    }))
  })

  it('shows the FTP chip for a completed workout with ftp_at_completion set', async () => {
    const withFtp = { ...matchedWorkout, ftp_at_completion: 245 }
    render(<WorkoutDetailModal workout={withFtp} athleteId="i12345" onClose={jest.fn()} />)
    expect(await screen.findByText('245W FTP')).toBeInTheDocument()
  })

  it('does not show the FTP chip when ftp_at_completion is null', async () => {
    render(<WorkoutDetailModal workout={matchedWorkout} athleteId="i12345" onClose={jest.fn()} />)
    await screen.findByText('✓ Completed')
    expect(screen.queryByText(/W FTP/)).not.toBeInTheDocument()
  })

  it('calls onClose when Close is clicked', () => {
    const onClose = jest.fn()
    render(<WorkoutDetailModal workout={workout} athleteId="i12345" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
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

  it('renders an all-time medal line when present', async () => {
    render(
      <WorkoutDetailModal
        workout={matchedWorkout}
        athleteId="i12345"
        onClose={jest.fn()}
        medals={{ allTime: [{ category: 'biggest_climb', subKey: '', rank: 1 }], year: [] }}
      />,
    )
    expect(await screen.findByText('All-time · Biggest climb')).toBeInTheDocument()
  })

  it("labels a year-best medal with the ride's own year", async () => {
    render(
      <WorkoutDetailModal
        workout={matchedWorkout}
        athleteId="i12345"
        onClose={jest.fn()}
        medals={{ allTime: [], year: [{ category: 'power', subKey: '300', rank: 1 }] }}
      />,
    )
    expect(await screen.findByText('2026 best · Power 5 min')).toBeInTheDocument()
  })

  it('renders nothing extra when medals is absent', async () => {
    render(<WorkoutDetailModal workout={matchedWorkout} athleteId="i12345" onClose={jest.fn()} />)
    await screen.findByText('✓ Completed')
    expect(screen.queryByText(/All-time ·/)).not.toBeInTheDocument()
    expect(screen.queryByText(/best ·/)).not.toBeInTheDocument()
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

describe('WorkoutDetailModal coach notes', () => {
  it('renders the coach notes card when present', () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) as never
    const withNotes = {
      ...plannedWorkout,
      coaching_notes: { summary: 'Build your aerobic base.', focus: [{ label: 'Cadence', detail: 'Hold 90 rpm' }] },
    }
    render(<WorkoutDetailModal workout={withNotes} athleteId="i1" ftp={250} onClose={() => {}} />)
    expect(screen.getByText("Coach's notes")).toBeInTheDocument()
    expect(screen.getByText('Build your aerobic base.')).toBeInTheDocument()
    expect(screen.getByText('Cadence')).toBeInTheDocument()
  })

  it('renders no coach notes card when absent', () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) as never
    render(<WorkoutDetailModal workout={plannedWorkout} athleteId="i1" ftp={250} onClose={() => {}} />)
    expect(screen.queryByText("Coach's notes")).toBeNull()
  })
})

describe('WorkoutDetailModal tabs', () => {
  const completedLinked = {
    ...plannedWorkout, status: 'completed' as const, icu_activity_id: 'a1', activity_metrics: null,
  }

  it('shows no tab bar for a planned, unlinked workout', () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) as never
    render(<WorkoutDetailModal workout={plannedWorkout} athleteId="i1" ftp={250} onClose={() => {}} />)
    expect(screen.queryByRole('tab', { name: 'Stats' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Map' })).toBeNull()
  })

  it('shows Overview/Stats/Map/Feedback tabs for a completed linked ride', async () => {
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/streams')
        ? Promise.resolve({ ok: true, json: async () => ({ streams: { time: [0, 60], power: [100, 110] }, intervals: [] }) })
        : Promise.resolve({ ok: true, json: async () => ({ feedback: null }) }),
    ) as never
    render(<WorkoutDetailModal workout={completedLinked} athleteId="i1" ftp={250} onClose={() => {}} />)
    expect(await screen.findByRole('tab', { name: 'Stats' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Map' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /feedback/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Stats' }))
    expect(screen.getByText(/ride stats not available yet/i)).toBeInTheDocument()
  })

  it('shows actual duration, not planned, in the Stats tab for a completed ride', async () => {
    const completedWithMetrics = {
      ...plannedWorkout,
      status: 'completed' as const,
      icu_activity_id: 'a1',
      duration_minutes: 60,
      actual_duration_minutes: 75,
      activity_metrics: makeActivityMetrics(),
    }
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/streams')
        ? Promise.resolve({ ok: true, json: async () => ({ streams: { time: [0, 60], power: [100, 110] }, intervals: [] }) })
        : String(url).includes('/weather/')
          ? Promise.resolve({ ok: false })
          : Promise.resolve({ ok: true, json: async () => ({ feedback: null }) }),
    ) as never
    render(<WorkoutDetailModal workout={completedWithMetrics} athleteId="i1" ftp={250} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Stats' }))
    expect(screen.getByText('1h 15m')).toBeInTheDocument()
    expect(screen.queryByText('1h 0m')).not.toBeInTheDocument()
  })

  it('shows Feedback tab for a completed workout with no linked ride', async () => {
    const completedNoRide = { ...plannedWorkout, status: 'completed' as const }
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ feedback: null }) })) as never
    render(<WorkoutDetailModal workout={completedNoRide} athleteId="i1" ftp={250} onClose={() => {}} />)
    expect(await screen.findByRole('tab', { name: /feedback/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Stats' })).not.toBeInTheDocument()
  })

  it('does not show Feedback tab for a planned workout', () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) as never
    render(<WorkoutDetailModal workout={plannedWorkout} athleteId="i1" ftp={250} onClose={() => {}} />)
    expect(screen.queryByRole('tab', { name: /feedback/i })).not.toBeInTheDocument()
  })

  it('shows amber dot on Feedback tab when no feedback is logged', async () => {
    const completedNoRide = { ...plannedWorkout, status: 'completed' as const }
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ feedback: null }) })) as never
    render(<WorkoutDetailModal workout={completedNoRide} athleteId="i1" ftp={250} onClose={() => {}} />)
    await screen.findByRole('tab', { name: /feedback/i })
    expect(screen.getByTestId('tab-dot-feedback')).toBeInTheDocument()
  })

  it('confirms before closing when the feedback tab has unsaved input', async () => {
    const onClose = jest.fn()
    const completedNoRide = { ...plannedWorkout, status: 'completed' as const }
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ feedback: null }) })) as never
    render(<WorkoutDetailModal workout={completedNoRide} athleteId="i1" ftp={250} onClose={onClose} />)

    fireEvent.click(await screen.findByRole('tab', { name: /feedback/i }))
    fireEvent.click(screen.getByRole('button', { name: 'RPE 6' }))

    fireEvent.click(screen.getByRole('button', { name: /^close$/i }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText(/discard feedback/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /keep editing/i }))
    expect(screen.queryByText(/discard feedback/i)).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /^close$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes immediately (no confirm) once unsaved feedback has been submitted', async () => {
    const onClose = jest.fn()
    const completedNoRide = { ...plannedWorkout, status: 'completed' as const }
    global.fetch = jest.fn((_url: string, opts?: { method?: string }) =>
      opts?.method === 'POST'
        ? Promise.resolve({ ok: true, json: async () => ({ feedback: { id: 'f2', coach_note: null }, proposed: null }) })
        : Promise.resolve({ ok: true, json: async () => ({ feedback: null }) }),
    ) as never
    render(<WorkoutDetailModal workout={completedNoRide} athleteId="i1" ftp={250} onClose={onClose} />)

    fireEvent.click(await screen.findByRole('tab', { name: /feedback/i }))
    fireEvent.click(screen.getByRole('button', { name: 'RPE 6' }))
    fireEvent.click(screen.getByRole('button', { name: /save feedback/i }))
    await screen.findByText('Feedback saved.')

    fireEvent.click(screen.getByRole('button', { name: /^close$/i }))
    expect(screen.queryByText(/discard feedback/i)).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hides amber dot on Feedback tab when feedback is already saved', async () => {
    const completedNoRide = { ...plannedWorkout, status: 'completed' as const }
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({
        feedback: {
          id: 'f1', workout_id: 'w1', activity_id: 'a1', feedback_text: '',
          activity_tss: null, activity_avg_power: null, activity_avg_hr: null,
          proposed_adjustment: null, approved: null, created_at: '2026-06-17T18:00:00Z',
          rpe: 7, feel: null, completion: null, tags: [], mood: null,
          coach_note: null, coach_note_rating: null,
        },
      }),
    })) as never
    render(<WorkoutDetailModal workout={completedNoRide} athleteId="i1" ftp={250} onClose={() => {}} />)
    await screen.findByRole('tab', { name: /feedback/i })
    expect(screen.queryByTestId('tab-dot-feedback')).not.toBeInTheDocument()
  })

  it('never shows a Highlights tab (highlights moved into the Map tab)', async () => {
    const withClimb = {
      ...completedLinked,
      activity_metrics: makeActivityMetrics({
        climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675, length_km: 3.2, path: null }],
      }),
    }
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/weather/')
        ? Promise.resolve({ ok: false })
        : Promise.resolve({ ok: true, json: async () => ({ feedback: null }) }),
    ) as never
    render(<WorkoutDetailModal workout={withClimb} athleteId="i1" ftp={250} onClose={() => {}} />)
    await screen.findByRole('tab', { name: 'Stats' })
    expect(screen.queryByRole('tab', { name: 'Highlights' })).toBeNull()
  })

  it('renders highlight cards under the Map tab when the linked ride has highlights', async () => {
    const withClimb = {
      ...completedLinked,
      activity_metrics: makeActivityMetrics({
        climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675, length_km: 3.2, path: null }],
      }),
    }
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/streams')
        ? Promise.resolve({ ok: true, json: async () => ({
            streams: { time: [0, 60, 120], distance: [0, 2500, 5000], latlng: null, power: [100, 100, 100], hr: null, altitude: null, cadence: null, velocity: null },
            intervals: [],
          }) })
        : String(url).includes('/weather/')
          ? Promise.resolve({ ok: false })
          : Promise.resolve({ ok: true, json: async () => ({ feedback: null }) }),
    ) as never
    render(<WorkoutDetailModal workout={withClimb} athleteId="i1" ftp={250} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Map' }))
    expect(await screen.findByText(/Climb/)).toBeInTheDocument()
  })
})
