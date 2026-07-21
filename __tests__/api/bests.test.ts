/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

import { GET } from '@/app/api/bests/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { BestRecordRow } from '@/lib/ride/best-records'

// The route issues a single `.eq('user_id', ...)` query and groups the
// returned rows by period client-side, so the stub returns all rows
// (flattened across periods) from that one `.eq()` call rather than
// filtering server-side per period.
function makeSupabase(rowsByPeriod: Record<string, BestRecordRow[]>, userId: string | null = 'u1') {
  const allRows = Object.values(rowsByPeriod).flat()
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: allRows, error: null }),
      }),
    }),
  }
}

describe('GET /api/bests', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({}, null))
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('assembles allTime and byYear from stored best_records rows, without scanning workouts', async () => {
    const rowsByPeriod: Record<string, BestRecordRow[]> = {
      all: [
        { period: 'all', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 } },
      ],
      '2026': [
        { period: '2026', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 } },
      ],
    }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(rowsByPeriod))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.allTime.biggestClimb).toEqual({ workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 })
    expect(body.byYear['2026'].biggestClimb).toEqual({ workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 })
  })

  it('returns empty bests when best_records has no rows yet', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({}))
    const res = await GET()
    const body = await res.json()
    expect(body.allTime).toEqual({ biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null })
    expect(body.byYear).toEqual({})
  })
})
