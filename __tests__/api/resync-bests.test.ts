/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

import { POST } from '@/app/api/admin/resync-bests/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase({ userId = 'u1', workoutRows = [] as unknown[], upsertSpy = jest.fn() } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: (table: string) => {
      if (table === 'workouts') {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                not: async () => ({ data: workoutRows, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'best_records') {
        return { upsert: (rows: unknown[], opts: unknown) => { upsertSpy(rows, opts); return Promise.resolve({ error: null }) } }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('POST /api/admin/resync-bests', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ userId: '' }))
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it('computes bests from current workouts rows and upserts them into best_records', async () => {
    const upsertSpy = jest.fn()
    const workoutRows = [
      {
        id: 'w1', icu_activity_id: 'icu-1', date: '2026-03-01',
        activity_metrics: { climbs: [{ elev_gain_m: 500, length_km: 6 }], best_efforts: null, speed_bests: null, max_speed_ms: null },
      },
    ]
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ workoutRows, upsertSpy }))
    const res = await POST()
    expect(res.status).toBe(200)
    expect(upsertSpy).toHaveBeenCalled()
    const [rows] = upsertSpy.mock.calls[0]
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: 'u1', period: 'all', category: 'biggest_climb', value: 500 }),
        expect.objectContaining({ user_id: 'u1', period: '2026', category: 'biggest_climb', value: 500 }),
      ]),
    )
  })

  it('is safe to call with zero rides (writes nothing, still returns 200)', async () => {
    const upsertSpy = jest.fn()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ workoutRows: [], upsertSpy }))
    const res = await POST()
    expect(res.status).toBe(200)
    expect(upsertSpy).not.toHaveBeenCalled()
  })
})
