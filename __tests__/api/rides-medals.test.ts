/** @jest-environment node */
import { GET } from '@/app/api/rides/medals/route'

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

function supabaseStub(rows: unknown[] | null, userId: string | null = 'u1') {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: () => ({
      select: () => ({
        eq: async () => ({ data: rows, error: null }),
      }),
    }),
  }
}

describe('GET /api/rides/medals', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([], null))
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it("returns a workoutId-keyed medals lookup for the current user's best_records rows", async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([
      {
        period: 'all', category: 'max_speed', sub_key: '', value: 68.2, is_indoor: false, rank: 1,
        detail: { workoutId: 'w1', date: '2026-03-01', icuActivityId: 'a1' },
      },
    ]))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({
      w1: { allTime: [{ category: 'max_speed', subKey: '', rank: 1 }], year: [] },
    })
  })

  it('returns an empty object when the user has no best_records rows', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([]))
    const res = await GET()
    const body = await res.json()
    expect(body).toEqual({})
  })
})
