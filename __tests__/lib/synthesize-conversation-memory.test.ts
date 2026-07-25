/** @jest-environment node */
import { synthesizeConversationMemory } from '@/lib/claude/synthesize-conversation-memory'
import { anthropic } from '@/lib/claude/client'

jest.mock('@/lib/claude/client', () => ({
  anthropic: { messages: { create: jest.fn() } },
  MODEL: 'claude-opus-5',
}))

function makeSupabase(opts: { messages?: unknown[]; upsertSpy?: jest.Mock }) {
  const b: Record<string, unknown> = {}
  const self = () => b
  Object.assign(b, {
    select: self, eq: self, gte: self, order: self, limit: self,
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: opts.messages ?? [], error: null }),
    upsert: opts.upsertSpy ?? (() => Promise.resolve({ error: null })),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  })
  return { from: () => b }
}

const NOW = '2026-06-09T03:00:00Z'

const fakeDigestJson = JSON.stringify({
  digest: 'Athlete discussed knee pain and fatigue.',
  open_threads: [{ topic: 'knee pain', last_mentioned: '2026-06-08' }],
  recurring_concerns: ['fatigue after long rides'],
  commitments: ['Try easier gear on climbs'],
})

describe('synthesizeConversationMemory', () => {
  beforeEach(() => jest.clearAllMocks())

  it('calls anthropic and upserts the digest', async () => {
    const upsertSpy = jest.fn(() => Promise.resolve({ error: null }))
    const supabase = makeSupabase({
      messages: [{ role: 'user', content: 'my knee hurts', surface: 'workout', created_at: '2026-06-08T10:00:00Z' }],
      upsertSpy,
    })
    ;(anthropic.messages.create as jest.Mock).mockResolvedValue({
      content: [{ type: 'text', text: fakeDigestJson }],
    })
    await synthesizeConversationMemory(supabase as never, 'u1', NOW)
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1)
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const arg = (upsertSpy.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0]
    expect(arg.user_id).toBe('u1')
    expect(arg.digest).toBe('Athlete discussed knee pain and fatigue.')
    expect(arg.open_threads).toEqual([{ topic: 'knee pain', last_mentioned: '2026-06-08' }])
    expect(arg.commitments).toEqual(['Try easier gear on climbs'])
  })

  it('skips synthesis and upsert when there are no messages', async () => {
    const upsertSpy = jest.fn(() => Promise.resolve({ error: null }))
    const supabase = makeSupabase({ messages: [], upsertSpy })
    await synthesizeConversationMemory(supabase as never, 'u1', NOW)
    expect(anthropic.messages.create).not.toHaveBeenCalled()
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('throws on upsert error', async () => {
    const upsertSpy = jest.fn(() => Promise.resolve({ error: { message: 'db fail' } }))
    const supabase = makeSupabase({
      messages: [{ role: 'user', content: 'hello', surface: 'coach', created_at: NOW }],
      upsertSpy,
    })
    ;(anthropic.messages.create as jest.Mock).mockResolvedValue({
      content: [{ type: 'text', text: fakeDigestJson }],
    })
    await expect(synthesizeConversationMemory(supabase as never, 'u1', NOW)).rejects.toThrow('db fail')
  })
})
