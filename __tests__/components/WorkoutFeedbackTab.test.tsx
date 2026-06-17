import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WorkoutFeedbackTab from '@/components/WorkoutFeedbackTab'
import type { SessionFeedback } from '@/types'

const savedFeedback: SessionFeedback = {
  id: 'f1', workout_id: 'w1', activity_id: 'a1', feedback_text: 'felt strong',
  activity_tss: null, activity_avg_power: null, activity_avg_hr: null,
  proposed_adjustment: null, approved: null, created_at: '2026-06-17T18:00:00Z',
  rpe: 7, feel: 2, completion: 'as_planned', tags: ['weather'], mood: 2,
  coach_note: null, coach_note_rating: null,
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ feedback: { id: 'f2', coach_note: null }, proposed: null }),
  }) as unknown as typeof fetch
})

describe('WorkoutFeedbackTab', () => {
  it('renders loading state when existingFeedback is "loading"', () => {
    render(<WorkoutFeedbackTab workoutId="w1" existingFeedback="loading" onFeedbackSaved={() => {}} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders input form when existingFeedback is null', () => {
    render(<WorkoutFeedbackTab workoutId="w1" existingFeedback={null} onFeedbackSaved={() => {}} />)
    expect(screen.getByRole('button', { name: 'RPE 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save feedback/i })).toBeInTheDocument()
  })

  it('renders saved state when existingFeedback is a SessionFeedback object', async () => {
    render(<WorkoutFeedbackTab workoutId="w1" existingFeedback={savedFeedback} onFeedbackSaved={() => {}} />)
    await screen.findByText('Feedback saved.')
    expect(screen.getByText('RPE 7/10')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit.*re-submit/i })).toBeInTheDocument()
  })

  it('Save button is disabled with no signal, enabled after RPE is set', () => {
    render(<WorkoutFeedbackTab workoutId="w1" existingFeedback={null} onFeedbackSaved={() => {}} />)
    const save = screen.getByRole('button', { name: /save feedback/i })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'RPE 6' }))
    expect(save).not.toBeDisabled()
  })

  it('submits POST to /api/feedback and transitions to saved phase', async () => {
    const onFeedbackSaved = jest.fn()
    render(<WorkoutFeedbackTab workoutId="w1" existingFeedback={null} onFeedbackSaved={onFeedbackSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'RPE 8' }))
    fireEvent.click(screen.getByRole('button', { name: /save feedback/i }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('/api/feedback')
    expect(JSON.parse(opts.body)).toMatchObject({ workoutId: 'w1', rpe: 8 })
    await screen.findByText('Feedback saved.')
    expect(onFeedbackSaved).toHaveBeenCalledTimes(1)
  })

  it('Approve button calls PATCH /api/feedback and transitions to saved phase', async () => {
    const feedbackWithProposal: SessionFeedback = {
      ...savedFeedback,
      proposed_adjustment: {
        summary: 'Reduce next week load',
        changes: [{ workout_id: 'w2', field: 'duration_minutes', old_value: 100, new_value: 80, reason: 'fatigue' }],
      },
      approved: null,
    }
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({}),
    }) as unknown as typeof fetch
    const onFeedbackSaved = jest.fn()

    render(<WorkoutFeedbackTab workoutId="w1" existingFeedback={feedbackWithProposal} onFeedbackSaved={onFeedbackSaved} />)
    const approveBtn = await screen.findByRole('button', { name: /approve changes/i })
    fireEvent.click(approveBtn)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('/api/feedback')
    expect(JSON.parse(opts.body)).toMatchObject({ approved: true })
    await screen.findByText('Feedback saved.')
    expect(onFeedbackSaved).toHaveBeenCalledTimes(1)
  })
})
