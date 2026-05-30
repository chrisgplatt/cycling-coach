/** @jest-environment node */
import { synthesizeDossier } from '@/lib/claude/synthesize-dossier'
import { generateDossier } from '@/lib/claude/dossier'

jest.mock('@/lib/claude/dossier', () => ({ generateDossier: jest.fn() }))

type Result = { data: unknown }

function chain(result: Result, upsertSpy?: jest.Mock) {
  const b: Record<string, unknown> = {}
  const self = () => b
  Object.assign(b, {
    select: self, eq: self, in: self, gte: self, order: self, limit: self,
    maybeSingle: () => Promise.resolve(result),
    upsert: upsertSpy ?? (() => Promise.resolve({ error: null })),
    then: (resolve: (v: Result) => void) => resolve(result),
  })
  return b
}

function makeSupabase(opts: {
  workouts?: unknown[]
  feedbacks?: unknown[]
  chat?: unknown[]
  existing?: unknown
  upsertSpy?: jest.Mock
}) {
  return {
    from: (table: string) => {
      switch (table) {
        case 'workouts': return chain({ data: opts.workouts ?? [] })
        case 'session_feedback': return chain({ data: opts.feedbacks ?? [] })
        case 'chat_messages': return chain({ data: opts.chat ?? [] })
        case 'athlete_dossier': return chain({ data: opts.existing ?? null }, opts.upsertSpy)
        default: return chain({ data: null })
      }
    },
  }
}

const profile = {
  user_id: 'u1', goals: 'Win the Etape', current_ftp: 250, weight_kg: 72,
  events: [{ name: 'Etape', date: '2026-07-10', type: 'sportive', priority: 'A', icu_activity_id: 'a1' }],
}

const fakeContent = {
  as_rider: 'x', strengths: ['a'], weaknesses: ['b'],
  training_compliance: 'c', recovery_profile: 'd', event_performance: 'e', trajectory: 'f',
}

beforeEach(() => jest.clearAllMocks())

describe('synthesizeDossier', () => {
  it('calls generateDossier and upserts content, preserving explicit_notes', async () => {
    (generateDossier as jest.Mock).mockResolvedValue(fakeContent)
    const upsertSpy = jest.fn(() => Promise.resolve({ error: null }))
    const existingNotes = [{ note: 'keep me', added_at: '2026-05-01T00:00:00Z' }]
    const supabase = makeSupabase({ existing: { explicit_notes: existingNotes }, upsertSpy })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await synthesizeDossier(supabase as any, profile as any)

    expect(generateDossier).toHaveBeenCalledTimes(1)
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const [row, options] = upsertSpy.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>]
    expect(row.content).toEqual(fakeContent)
    expect(row.explicit_notes).toEqual(existingNotes)
    expect(row.user_id).toBe('u1')
    expect(typeof row.synthesized_at).toBe('string')
    expect(options).toEqual({ onConflict: 'user_id' })
  })

  it('defaults explicit_notes to [] when no dossier exists yet', async () => {
    (generateDossier as jest.Mock).mockResolvedValue(fakeContent)
    const upsertSpy = jest.fn(() => Promise.resolve({ error: null }))
    const supabase = makeSupabase({ existing: null, upsertSpy })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await synthesizeDossier(supabase as any, profile as any)

    expect(upsertSpy.mock.calls[0][0].explicit_notes).toEqual([])
  })

  it('throws and never upserts when generateDossier rejects', async () => {
    (generateDossier as jest.Mock).mockRejectedValue(new Error('claude down'))
    const upsertSpy = jest.fn(() => Promise.resolve({ error: null }))
    const supabase = makeSupabase({ upsertSpy })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(synthesizeDossier(supabase as any, profile as any)).rejects.toThrow('claude down')
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('throws when the upsert returns an error', async () => {
    (generateDossier as jest.Mock).mockResolvedValue(fakeContent)
    const upsertSpy = jest.fn(() => Promise.resolve({ error: { message: 'boom' } }))
    const supabase = makeSupabase({ upsertSpy })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(synthesizeDossier(supabase as any, profile as any)).rejects.toThrow('boom')
  })
})
