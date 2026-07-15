const streamMock = jest.fn()
jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-opus-4-8',
  anthropic: { messages: { stream: (...a: unknown[]) => streamMock(...a) } },
}))

import { analyseFeedback } from '@/lib/claude/feedback'
import type { Workout } from '@/types'

const workout = {
  id: 'w1', date: '2026-06-01', type: 'endurance', duration_minutes: 60,
  description: 'Easy Z2', target_zones: 'Z2',
} as unknown as Workout

beforeEach(() => {
  jest.clearAllMocks()
  streamMock.mockReturnValue({
    finalMessage: async () => ({
      content: [{ type: 'text', text: '{"summary":"none","changes":[],"workout_steps":[]}' }],
    }),
  })
})

function sentPrompt(): string {
  return streamMock.mock.calls[0][0].messages[0].content
}

describe('analyseFeedback prompt', () => {
  it('includes the reported-signal line when signals are present', async () => {
    await analyseFeedback(workout, 'felt rough', null, null, null, [], [], '', '', {
      rpe: 8, feel: 2, completion: 'cut_short', tags: ['poor_sleep'],
    })
    expect(sentPrompt()).toContain('Athlete-reported: RPE 8/10 · legs good (2/5) · cut short · flags: poor sleep')
  })

  it('omits the reported-signal line when nothing is reported', async () => {
    await analyseFeedback(workout, 'fine', null, null, null, [], [], '', '', {})
    expect(sentPrompt()).not.toContain('Athlete-reported:')
  })
})
