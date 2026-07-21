/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

import { POST } from '@/app/api/admin/resync-bests/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase({
  userId = 'u1',
  workoutRows = [] as unknown[],
  upsertSpy = jest.fn(),
  deleteSpy = jest.fn(),
  updateSpy = jest.fn(),
} = {}) {
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
        return {
          upsert: (rows: unknown[], opts: unknown) => { upsertSpy(rows, opts); return Promise.resolve({ error: null }) },
          delete: () => ({
            eq: (...args: unknown[]) => { deleteSpy(...args); return Promise.resolve({ error: null }) },
          }),
        }
      }
      if (table === 'user_profile') {
        return {
          update: (values: unknown) => ({
            eq: (...args: unknown[]) => { updateSpy(values, ...args); return Promise.resolve({ error: null }) },
          }),
        }
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

  it('clears existing best_records rows before writing the freshly computed set (so a category that no longer qualifies does not leave a stale row behind)', async () => {
    const callOrder: string[] = []
    const deleteSpy = jest.fn(() => { callOrder.push('delete') })
    const upsertSpy = jest.fn(() => { callOrder.push('upsert') })
    const workoutRows = [
      {
        id: 'w1', icu_activity_id: 'icu-1', date: '2026-03-01',
        activity_metrics: { climbs: [{ elev_gain_m: 500, length_km: 6 }], best_efforts: null, speed_bests: null, max_speed_ms: null },
      },
    ]
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ workoutRows, upsertSpy, deleteSpy }))
    const res = await POST()
    expect(res.status).toBe(200)
    expect(deleteSpy).toHaveBeenCalledWith('user_id', 'u1')
    expect(upsertSpy).toHaveBeenCalled()
    expect(callOrder).toEqual(['delete', 'upsert'])
  })

  it('resets deep_history_bests_cursor to null for the current user, so the next deep-history scan restarts from the oldest workout instead of resuming past the span this resync just wiped', async () => {
    const updateSpy = jest.fn()
    const workoutRows = [
      {
        id: 'w1', icu_activity_id: 'icu-1', date: '2026-03-01',
        activity_metrics: { climbs: [{ elev_gain_m: 500, length_km: 6 }], best_efforts: null, speed_bests: null, max_speed_ms: null },
      },
    ]
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ workoutRows, updateSpy }))
    const res = await POST()
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith({ deep_history_bests_cursor: null }, 'user_id', 'u1')
  })

  it('partitions workouts into outdoor and indoor sets, never letting an indoor ride compete with an outdoor record', async () => {
    const upsertSpy = jest.fn()
    const workoutRows = [
      {
        id: 'w1', icu_activity_id: 'icu-1', date: '2026-03-01',
        activity_metrics: { climbs: null, best_efforts: null, speed_bests: null, max_speed_ms: 15, is_indoor: false },
      },
      {
        id: 'w2', icu_activity_id: 'icu-2', date: '2026-03-02',
        activity_metrics: { climbs: null, best_efforts: null, speed_bests: null, max_speed_ms: 40, is_indoor: true },
      },
    ]
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ workoutRows, upsertSpy }))
    const res = await POST()
    expect(res.status).toBe(200)
    const [rows] = upsertSpy.mock.calls[0]
    const outdoorMaxSpeed = rows.find((r: { category: string; is_indoor: boolean }) => r.category === 'max_speed' && r.is_indoor === false)
    const indoorMaxSpeed = rows.find((r: { category: string; is_indoor: boolean }) => r.category === 'max_speed' && r.is_indoor === true)
    expect(outdoorMaxSpeed).toMatchObject({ period: 'all', value: 54 })
    expect(indoorMaxSpeed).toMatchObject({ period: 'all', value: 144 })
  })

  it('treats a ride with no is_indoor key at all (pre-feature data) as outdoor', async () => {
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
    const [rows] = upsertSpy.mock.calls[0]
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'biggest_climb', is_indoor: false }),
    ]))
    expect(rows.find((r: { is_indoor: boolean }) => r.is_indoor === true)).toBeUndefined()
  })
})
