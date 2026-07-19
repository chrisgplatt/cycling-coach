/** @jest-environment node */
import { GET } from '@/app/api/rides/activity/[activityId]/highlights/route'

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

function supabaseStub(rows: unknown[], userId: string | null = 'u1') {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: async () => ({ data: rows }),
          }),
        }),
      }),
    }),
  }
}

const ctx = (id: string) => ({ params: Promise.resolve({ activityId: id }) })

describe('GET /api/rides/activity/[activityId]/highlights', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([], null))
    const res = await GET({} as Request as never, ctx('a1') as never)
    expect(res.status).toBe(401)
  })

  it('returns the four highlight fields from the linked workout row', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([{
      activity_metrics: {
        climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675 }],
        effort_periods: [{ start_km: 2, duration_secs: 200, avg_watts: 240, zone: 'z4' }],
        sprints: [{ duration_secs: 5, watts: 890 }],
        personal_bests: [{ duration_secs: 300, watts: 312, window_days: 90 }],
      },
    }]))
    const res = await GET({} as Request as never, ctx('a1') as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.climbs).toHaveLength(1)
    expect(body.effort_periods).toHaveLength(1)
    expect(body.sprints).toHaveLength(1)
    expect(body.personal_bests).toHaveLength(1)
  })

  it('returns all-null fields when there is no linked workout row', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub([]))
    const res = await GET({} as Request as never, ctx('a1') as never)
    const body = await res.json()
    expect(body).toEqual({ climbs: null, effort_periods: null, sprints: null, personal_bests: null })
  })
})
