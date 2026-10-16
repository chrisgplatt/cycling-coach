/** @jest-environment node */
import { PATCH } from '@/app/api/workouts/[id]/route'

jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/claude/coaching-notes', () => ({ generateCoachingNotes: jest.fn().mockResolvedValue({}) }))
jest.mock('@/lib/claude/steps', () => ({ generateWorkoutSteps: jest.fn() }))
jest.mock('@/lib/claude/usage-log', () => ({ setUsageContext: jest.fn() }))

import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase(row: Record<string, unknown>, updateSpy: jest.Mock) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'workouts') {
        return {
          update: (fields: unknown) => { updateSpy(fields); return { eq: () => ({ error: null }) } },
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }),
        }
      }
      // user_profile — no intervals.icu credentials, so the sync branch is skipped
      return { select: () => ({ maybeSingle: async () => ({ data: null }) }) }
    },
  }
}

const ctx = { params: Promise.resolve({ id: 'w1' }) } as never
const req = (body: unknown) => new Request('http://localhost/api/workouts/w1', { method: 'PATCH', body: JSON.stringify(body) }) as never

beforeEach(() => jest.clearAllMocks())

describe('PATCH /api/workouts/[id] — stored planned TSS', () => {
  it('re-derives a stale stored tss when type/duration change without new steps', async () => {
    const updateSpy = jest.fn()
    const row = {
      id: 'w1', status: 'planned', type: 'threshold', duration_minutes: 60, tss: 27, date: '2026-10-16',
      steps: [{ label: 'Main', duration_minutes: 60, power_pct_ftp: 100 }],
    }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(row, updateSpy))
    await PATCH(req({ duration_minutes: 60 }), ctx)
    expect(updateSpy).toHaveBeenCalledWith({ tss: 100 })
  })

  it('leaves a completed workout\'s achieved tss alone', async () => {
    const updateSpy = jest.fn()
    const row = { id: 'w1', status: 'completed', type: 'threshold', duration_minutes: 60, tss: 55, steps: null, date: '2026-10-16' }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(row, updateSpy))
    await PATCH(req({ description: 'edited' }), ctx)
    expect(updateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ tss: expect.anything() }))
  })
})
