/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

import { GET } from '@/app/api/bests/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { BestRecordRow } from '@/lib/ride/best-records'

// The route issues a single `.eq('user_id', ...)` query and groups the
// returned rows by period AND is_indoor client-side, so the stub returns all
// rows (flattened across periods/surfaces) from that one `.eq()` call rather
// than filtering server-side.
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

  it('assembles outdoor allTime and byYear from stored best_records rows, without scanning workouts', async () => {
    const rowsByPeriod: Record<string, BestRecordRow[]> = {
      all: [
        { period: 'all', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 }, is_indoor: false },
      ],
      '2026': [
        { period: '2026', category: 'biggest_climb', sub_key: '', value: 900, detail: { date: '2026-02-01', workoutId: 'w2', icuActivityId: 'icu-2', length_km: 3 }, is_indoor: false },
      ],
    }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(rowsByPeriod))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.outdoor.allTime.biggestClimb).toEqual({ workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 })
    expect(body.outdoor.byYear['2026'].biggestClimb).toEqual({ workoutId: 'w2', icuActivityId: 'icu-2', date: '2026-02-01', elev_gain_m: 900, length_km: 3 })
  })

  it('returns empty bests for both surfaces when best_records has no rows yet', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({}))
    const res = await GET()
    const body = await res.json()
    const empty = { biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null }
    expect(body.outdoor.allTime).toEqual(empty)
    expect(body.outdoor.byYear).toEqual({})
    expect(body.indoor.allTime).toEqual(empty)
    expect(body.indoor.byYear).toEqual({})
  })

  it('keeps indoor and outdoor records separate even when they share the same period/category/sub_key', async () => {
    const rowsByPeriod: Record<string, BestRecordRow[]> = {
      all: [
        { period: 'all', category: 'max_speed', sub_key: '', value: 54, detail: { date: '2026-01-01', workoutId: 'w1', icuActivityId: 'icu-1', max_speed_ms: 15 }, is_indoor: false },
        { period: 'all', category: 'max_speed', sub_key: '', value: 144, detail: { date: '2026-01-02', workoutId: 'w2', icuActivityId: 'icu-2', max_speed_ms: 40 }, is_indoor: true },
      ],
    }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(rowsByPeriod))
    const res = await GET()
    const body = await res.json()
    expect(body.outdoor.allTime.maxSpeed?.speed_kmh).toBe(54)
    expect(body.indoor.allTime.maxSpeed?.speed_kmh).toBe(144)
  })
})
