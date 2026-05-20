import { analyseFeedback } from '@/lib/claude/feedback'
import type { Workout, ProposedAdjustment } from '@/types'

jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-sonnet-4-6',
  anthropic: { messages: { create: jest.fn() } },
}))

import { anthropic } from '@/lib/claude/client'
const mockCreate = anthropic.messages.create as jest.Mock

const workout: Workout = {
  id: 'wk1', plan_id: 'p1', date: '2026-05-10',
  type: 'threshold', duration_minutes: 60,
  description: '2x20min at threshold', target_zones: 'Zone 4 (91-105% FTP)',
  intervals_icu_event_id: null, status: 'completed',
  icu_activity_id: null, tss: null, missed_reason: null,
  created_at: '',
}

const upcomingWorkouts: Workout[] = [
  { ...workout, id: 'wk2', date: '2026-05-12', type: 'endurance',
    duration_minutes: 90, description: 'Zone 2 ride', status: 'planned', icu_activity_id: null, tss: null },
]

describe('analyseFeedback', () => {
  it('returns ProposedAdjustment with changes', async () => {
    const adjustment: ProposedAdjustment = {
      summary: 'Reduce Wednesday intensity due to reported fatigue',
      changes: [{
        workout_id: 'wk2', field: 'duration_minutes',
        old_value: 90, new_value: 60, reason: 'Athlete reported heavy legs',
      }],
    }
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(adjustment) }],
    })

    const result = await analyseFeedback(
      workout, 'Legs felt really heavy, barely held power', 75, 195, 155, upcomingWorkouts
    )
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].workout_id).toBe('wk2')
  })

  it('returns empty changes when no adjustment needed', async () => {
    const adjustment: ProposedAdjustment = { summary: 'No adjustments needed', changes: [] }
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(adjustment) }],
    })

    const result = await analyseFeedback(
      workout, 'Felt great, hit all targets', 80, 240, 148, upcomingWorkouts
    )
    expect(result.changes).toHaveLength(0)
  })
})
