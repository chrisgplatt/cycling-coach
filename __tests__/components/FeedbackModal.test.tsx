import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FeedbackModal from '@/components/FeedbackModal'
import type { Workout } from '@/types'

const workout = {
  id: 'w1', date: '2026-06-01', type: 'endurance', duration_minutes: 60,
  icu_activity_id: 'a1',
} as unknown as Workout

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, json: async () => ({ feedback: { id: 'f1' }, proposed: null }),
  }) as unknown as typeof fetch
})

describe('FeedbackModal structured capture', () => {
  it('disables Save until a signal is present, then enables on RPE', () => {
    render(<FeedbackModal workout={workout} onClose={() => {}} />)
    const save = screen.getByRole('button', { name: /save feedback/i })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'RPE 7' }))
    expect(save).toBeEnabled()
  })

  it('submits the structured fields in the POST body', async () => {
    render(<FeedbackModal workout={workout} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'RPE 8' }))
    fireEvent.click(screen.getByRole('button', { name: 'cut short' }))
    fireEvent.click(screen.getByRole('button', { name: /save feedback/i }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body).toMatchObject({ workoutId: 'w1', rpe: 8, completion: 'cut_short', adapt: false })
  })

  it('seeds structured fields from initialFeedback in edit mode', () => {
    render(<FeedbackModal workout={workout} onClose={() => {}} initialFeedback={{
      id: 'f1', workout_id: 'w1', activity_id: 'a1', feedback_text: 'tough',
      activity_tss: null, activity_avg_power: null, activity_avg_hr: null,
      proposed_adjustment: null, approved: null, created_at: '2026-06-01T18:00:00Z',
      rpe: 6, feel: 3, completion: 'as_planned', tags: ['weather'], mood: 2,
    }} />)
    expect(screen.getByRole('button', { name: 'RPE 6' })).toHaveAttribute('aria-pressed', 'true')
  })
})
