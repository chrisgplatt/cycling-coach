/** @jest-environment node */
import { GET } from '@/app/api/bests/route'

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

function supabaseStub(rows: unknown[] | null, userId: string | null = 'u1') {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            not: async () => ({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  }
}

describe('GET /api/bests', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([], null))
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns computed all-time and per-year bests for the current user\'s rides', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([
      {
        id: 'w1', date: '2026-03-01',
        activity_metrics: {
          climbs: [{ start_km: 2, duration_secs: 300, elev_gain_m: 500, avg_watts: 220, vam: 600, length_km: 6, path: null }],
          best_efforts: null, speed_bests: null, max_speed_ms: null,
        },
      },
    ]))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.allTime.biggestClimb).toEqual({ workoutId: 'w1', date: '2026-03-01', elev_gain_m: 500, length_km: 6 })
    expect(body.byYear['2026'].biggestClimb).toEqual({ workoutId: 'w1', date: '2026-03-01', elev_gain_m: 500, length_km: 6 })
  })

  it('returns empty bests when the user has no completed rides with metrics', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([]))
    const res = await GET()
    const body = await res.json()
    expect(body.allTime).toEqual({ biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null })
    expect(body.byYear).toEqual({})
  })
})
