import { assessSession } from '@/lib/claude/session-note'
import { makeWorkout } from '../support/factories'

jest.mock('@/lib/claude/client', () => ({
  MODEL: 'claude-opus-4-8',
  anthropic: {
    messages: {
      create: jest.fn(),
    },
  },
}))

import { anthropic } from '@/lib/claude/client'

const mockCreate = anthropic.messages.create as jest.Mock

const workout = makeWorkout({
  id: 'wk1',
  date: '2026-05-10',
  type: 'threshold',
  duration_minutes: 60,
  description: '2x20min at threshold',
  target_zones: 'Zone 4 (91-105% FTP)',
  status: 'completed',
})

function makeToolResponse(note: string, recommend: boolean) {
  return {
    content: [{
      type: 'tool_use',
      id: 'tu1',
      name: 'session_note',
      input: { note, recommend_adaptations: recommend },
    }],
  }
}

beforeEach(() => jest.clearAllMocks())

describe('assessSession', () => {
  it('returns note and recommendAdaptations from tool_use input', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse('Solid effort.', false))
    const result = await assessSession(workout, 'felt strong', { rpe: 7, feel: 2 }, '')
    expect(result.note).toBe('Solid effort.')
    expect(result.recommendAdaptations).toBe(false)
  })

  it('returns recommendAdaptations: true when coach flags it', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse('Good session but you\'re accumulating fatigue.', true))
    const result = await assessSession(workout, 'tired', { rpe: 9 }, '')
    expect(result.recommendAdaptations).toBe(true)
  })

  it('trims whitespace from the note', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse('  Nice work.  ', false))
    const result = await assessSession(workout, 'felt good', {}, '')
    expect(result.note).toBe('Nice work.')
  })

  it('includes session details, ride execution, and reported signals in prompt', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse('ok', false))
    const execution = 'Planned steps: Work 20min @ 95%\nActual intervals: Work 20:00 avg 248W HR 161'
    await assessSession(
      workout,
      'legs were heavy but pushed through',
      { rpe: 8, feel: 4, completion: 'as_planned', tags: ['poor_sleep'], mood: 3 },
      execution,
    )
    const call = (anthropic.messages.create as jest.Mock).mock.calls[0][0]
    const prompt = call.messages[0].content
    expect(prompt).toContain('2x20min at threshold')
    expect(prompt).toContain('Actual intervals: Work 20:00 avg 248W')
    expect(prompt).toContain('RPE 8/10')
    expect(prompt).toContain('legs tired (4/5)')
    expect(prompt).toContain('mood neutral (3/4)')
    expect(prompt).toContain('poor sleep')
    expect(prompt).toContain('legs were heavy but pushed through')
  })

  it('uses tool_choice to force session_note tool', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse('ok', false))
    await assessSession(workout, 'fine', {}, '')
    const call = (anthropic.messages.create as jest.Mock).mock.calls[0][0]
    expect(call.tool_choice).toEqual({ type: 'tool', name: 'session_note' })
    expect(call.tools[0].name).toBe('session_note')
  })

  it('uses the opus model', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse('ok', false))
    await assessSession(workout, 'fine', {}, '')
    const call = (anthropic.messages.create as jest.Mock).mock.calls[0][0]
    expect(call.model).toBe('claude-opus-4-8')
  })
})
