/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

import { GET } from '@/app/api/plan/history/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase(plans: unknown[], orderSpy?: jest.Mock) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: (...args: unknown[]) => {
              orderSpy?.(...args)
              return { data: plans, error: null }
            },
          }),
        }),
      }),
    }),
  }
}

describe('GET /api/plan/history', () => {
  it('returns archived plans', async () => {
    const plans = [{ id: 'p1', name: 'Base Build', closed_at: '2026-06-01', archive_summary: null }]
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(plans))

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.plans).toEqual(plans)
  })

  it('orders by closed_at descending with nulls last, so legacy plans without a snapshot sort to the bottom', async () => {
    const orderSpy = jest.fn()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase([], orderSpy))
    await GET()
    expect(orderSpy).toHaveBeenCalledWith('closed_at', { ascending: false, nullsFirst: false })
  })

  it('returns an empty list when there are no archived plans', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase([]))
    const res = await GET()
    const body = await res.json()
    expect(body.plans).toEqual([])
  })

  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    })
    const res = await GET()
    expect(res.status).toBe(401)
  })
})
