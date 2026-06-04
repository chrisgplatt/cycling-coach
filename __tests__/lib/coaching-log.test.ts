import { toCoachingLogEntries } from '@/lib/plan/coaching-log'
import type { FeedbackRow, WorkoutRef } from '@/lib/plan/coaching-log'

const row = (over: Partial<FeedbackRow>): FeedbackRow => ({
  id: 'f1', created_at: '2026-06-02T18:00:00Z', workout_id: 'w1',
  feedback_text: 'legs felt flat', proposed_adjustment: null, approved: null,
  rpe: null, feel: null, ...over,
})

const workouts = new Map<string, WorkoutRef>([
  ['w1', { date: '2026-06-02', type: 'threshold' }],
])

describe('toCoachingLogEntries', () => {
  it('joins the workout date/type and derives summary + had_proposal', () => {
    const rows: FeedbackRow[] = [row({
      proposed_adjustment: { summary: 'eased Wed intervals', changes: [] },
      approved: true, rpe: 7, feel: 2,
    })]
    const [entry] = toCoachingLogEntries(rows, workouts)
    expect(entry).toEqual({
      id: 'f1', created_at: '2026-06-02T18:00:00Z',
      session_date: '2026-06-02', session_type: 'threshold',
      feedback_text: 'legs felt flat', summary: 'eased Wed intervals',
      approved: true, had_proposal: true, rpe: 7, feel: 2,
    })
  })

  it('marks rows without a proposal as had_proposal=false and summary=null', () => {
    const [entry] = toCoachingLogEntries([row({ proposed_adjustment: null })], workouts)
    expect(entry.had_proposal).toBe(false)
    expect(entry.summary).toBeNull()
  })

  it('handles manual feedback with no linked workout', () => {
    const [entry] = toCoachingLogEntries([row({ workout_id: null })], workouts)
    expect(entry.session_date).toBeNull()
    expect(entry.session_type).toBeNull()
  })

  it('leaves session fields null when the workout is not in the map', () => {
    const [entry] = toCoachingLogEntries([row({ workout_id: 'missing' })], workouts)
    expect(entry.session_date).toBeNull()
  })
})
