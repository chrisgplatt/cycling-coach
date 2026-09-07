/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

import { POST } from '@/app/api/admin/repair-best-records/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase({
  userId = 'u1',
  bestRecordRows = [] as unknown[],
  workoutRows = [] as unknown[],
  upsertSpy = jest.fn(),
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: (table: string) => {
      if (table === 'best_records') {
        return {
          select: () => ({ eq: () => Promise.resolve({ data: bestRecordRows, error: null }) }),
          upsert: (rows: unknown[], opts: unknown) => { upsertSpy(rows, opts); return Promise.resolve({ error: null }) },
        }
      }
      if (table === 'workouts') {
        return { select: () => ({ eq: () => ({ not: () => Promise.resolve({ data: workoutRows, error: null }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('POST /api/admin/repair-best-records', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ userId: '' }))
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it('repoints a stale best_records row to the workout currently holding that ride, without deleting anything', async () => {
    const upsertSpy = jest.fn()
    const bestRecordRows = [
      { period: 'all', category: 'power', sub_key: '300', value: 310, is_indoor: false, rank: 1, detail: { date: '2026-06-01', workoutId: 'w-old', icuActivityId: 'a1' } },
    ]
    const workoutRows = [{ id: 'w-new', icu_activity_id: 'a1' }]
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ bestRecordRows, workoutRows, upsertSpy }))

    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ checked: 1, repaired: 1 })
    const [rows] = upsertSpy.mock.calls[0]
    expect(rows).toEqual([expect.objectContaining({ detail: expect.objectContaining({ workoutId: 'w-new' }) })])
  })

  it('is a no-op when nothing is stale (no upsert call)', async () => {
    const upsertSpy = jest.fn()
    const bestRecordRows = [
      { period: 'all', category: 'power', sub_key: '300', value: 310, is_indoor: false, rank: 1, detail: { workoutId: 'w1', icuActivityId: 'a1' } },
    ]
    const workoutRows = [{ id: 'w1', icu_activity_id: 'a1' }]
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ bestRecordRows, workoutRows, upsertSpy }))

    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ checked: 1, repaired: 0 })
    expect(upsertSpy).not.toHaveBeenCalled()
  })
})
