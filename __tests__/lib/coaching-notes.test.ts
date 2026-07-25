jest.mock('@/lib/claude/client', () => ({
  anthropic: { messages: { stream: jest.fn() } },
  MODEL: 'claude-opus-5',
}))

import { anthropic } from '@/lib/claude/client'
import { generateCoachingNotes, coachingNotesGuidance } from '@/lib/claude/coaching-notes'
import type { UserProfile } from '@/types'

const streamMock = (anthropic.messages.stream as jest.Mock)

function mockReply(text: string) {
  streamMock.mockReturnValue({ finalMessage: async () => ({ content: [{ type: 'text', text }] }) })
}

const profile = { current_ftp: 250, weight_kg: 72, goals: 'Sportive in August' } as UserProfile
const workouts = [
  { id: 'w1', date: '2026-06-03', type: 'endurance' as const, description: 'Z2 ride', target_zones: 'Zone 2', steps: null },
  { id: 'w2', date: '2026-06-05', type: 'intervals' as const, description: '5x3 VO2', target_zones: 'Zone 5', steps: null },
]

beforeEach(() => streamMock.mockReset())

describe('coachingNotesGuidance', () => {
  it('returns non-empty guidance text', () => {
    expect(coachingNotesGuidance().length).toBeGreaterThan(0)
  })
})

describe('generateCoachingNotes', () => {
  it('maps notes by workout id', async () => {
    mockReply(JSON.stringify({ notes: [
      { id: 'w1', summary: 'Easy aerobic.', focus: [{ label: 'Cadence', detail: '90 rpm' }] },
      { id: 'w2', summary: 'Hit VO2 targets.', focus: [] },
    ] }))
    const out = await generateCoachingNotes(profile, workouts)
    expect(out.w1.summary).toBe('Easy aerobic.')
    expect(out.w1.focus[0]).toEqual({ label: 'Cadence', detail: '90 rpm' })
    expect(out.w2.summary).toBe('Hit VO2 targets.')
  })

  it('skips malformed entries instead of throwing', async () => {
    mockReply(JSON.stringify({ notes: [
      { id: 'w1', summary: 'Good.', focus: [] },
      { summary: 'no id' },
      { id: 'w2' },
    ] }))
    const out = await generateCoachingNotes(profile, workouts)
    expect(out.w1.summary).toBe('Good.')
    expect(out.w2).toBeUndefined()
    expect(Object.keys(out)).toEqual(['w1'])
  })

  it('returns {} for an empty workout list without calling the model', async () => {
    const out = await generateCoachingNotes(profile, [])
    expect(out).toEqual({})
    expect(streamMock).not.toHaveBeenCalled()
  })
})

describe('generateCoachingNotes Max HR', () => {
  it('includes Max HR in the prompt when resolvable', async () => {
    mockReply(JSON.stringify({ notes: [] }))
    const profileWithDob = { ...profile, date_of_birth: '1990-07-03' }
    await generateCoachingNotes(profileWithDob, workouts)
    const sentPrompt = streamMock.mock.calls.at(-1)[0].messages[0].content as string
    expect(sentPrompt).toContain('Max HR: 183bpm')
  })

  it('omits Max HR when it cannot be resolved', async () => {
    mockReply(JSON.stringify({ notes: [] }))
    await generateCoachingNotes(profile, workouts)
    const sentPrompt = streamMock.mock.calls.at(-1)[0].messages[0].content as string
    expect(sentPrompt).not.toContain('Max HR')
  })
})
