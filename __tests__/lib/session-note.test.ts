import { assessSession } from '@/lib/claude/session-note'
import { makeWorkout } from '../support/factories'

const mockFinalMessage = jest.fn()
jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-opus-4-8',
  anthropic: {
    messages: {
      stream: jest.fn(() => ({ finalMessage: mockFinalMessage })),
    },
  },
}))

import { anthropic } from '@/lib/claude/client'
const mockStream = anthropic.messages.stream as jest.Mock

const workout = makeWorkout({
  id: 'wk1',
  date: '2026-05-10',
  type: 'threshold',
  duration_minutes: 60,
  description: '2x20min at threshold',
  target_zones: 'Zone 4 (91-105% FTP)',
  status: 'completed',
})

function lastPrompt(): string {
  const call = mockStream.mock.calls[mockStream.mock.calls.length - 1]
  return call[0].messages[0].content
}

beforeEach(() => jest.clearAllMocks())

describe('assessSession', () => {
  it('returns the model prose assessment, trimmed', async () => {
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: '  Solid threshold work — you held the back half better than last week.  ' }],
    })

    const note = await assessSession(workout, 'felt strong', { rpe: 7, feel: 2 }, '')

    expect(note).toBe('Solid threshold work — you held the back half better than last week.')
  })

  it('includes the ride execution and reported signals in the prompt', async () => {
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
    })
    const execution = 'Planned steps: Work 20min @ 95%\nActual intervals: Work 20:00 avg 248W HR 161'

    await assessSession(
      workout,
      'legs were heavy but pushed through',
      { rpe: 8, feel: 4, completion: 'as_planned', tags: ['poor_sleep'], mood: 3 },
      execution,
    )

    const prompt = lastPrompt()
    expect(prompt).toContain('2x20min at threshold')
    expect(prompt).toContain('Actual intervals: Work 20:00 avg 248W')
    expect(prompt).toContain('RPE 8/10')
    expect(prompt).toContain('legs 4/5')
    expect(prompt).toContain('poor sleep')
    expect(prompt).toContain('legs were heavy but pushed through')
  })

  it('handles a manual entry with no execution and no signals', async () => {
    mockFinalMessage.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Nice steady spin to keep the legs ticking over.' }],
    })

    const note = await assessSession(workout, 'easy recovery spin', {}, '')

    expect(note).toBe('Nice steady spin to keep the legs ticking over.')
    expect(mockStream).toHaveBeenCalledTimes(1)
  })

  it('uses the opus model', async () => {
    mockFinalMessage.mockResolvedValueOnce({ content: [{ type: 'text', text: 'x' }] })
    await assessSession(workout, 'fine', {}, '')
    const call = mockStream.mock.calls[0][0]
    expect(call.model).toBe('claude-opus-4-8')
  })
})
