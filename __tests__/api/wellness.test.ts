/** @jest-environment node */
import { GET, POST } from '@/app/api/wellness/route'

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

const user = { id: 'u1' }

const entry1 = { id: 'w1', user_id: 'u1', date: '2026-06-16', energy: 4, leg_freshness: 3, mood: 4, stress: 2, sleep_quality: 5, created_at: '2026-06-16T08:00:00Z', updated_at: '2026-06-16T08:00:00Z' }
const entry2 = { id: 'w2', user_id: 'u1', date: '2026-06-17', energy: 3, leg_freshness: 2, mood: 3, stress: 3, sleep_quality: 3, created_at: '2026-06-17T08:00:00Z', updated_at: '2026-06-17T08:00:00Z' }

function makeSupabase({ rows = [] as unknown[], upserted = entry1 } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => ({
              order: () => ({ data: rows, error: null }),
            }),
          }),
        }),
      }),
      upsert: () => ({
        select: () => ({
          single: async () => ({ data: upserted, error: null }),
        }),
      }),
    }),
  }
}

describe('GET /api/wellness', () => {
  it('returns wellness rows for the date range', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ rows: [entry1, entry2] }))
    const req = new Request('http://localhost/api/wellness?from=2026-06-16&to=2026-06-17')
    const res = await GET(req as never)
    const body = await res.json()
    expect(body.wellness).toHaveLength(2)
    expect(body.wellness[0].date).toBe('2026-06-16')
  })

  it('returns empty array when no rows exist', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ rows: [] }))
    const req = new Request('http://localhost/api/wellness?from=2026-06-01&to=2026-06-07')
    const res = await GET(req as never)
    const body = await res.json()
    expect(body.wellness).toEqual([])
  })

  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    })
    const req = new Request('http://localhost/api/wellness?from=2026-06-01&to=2026-06-07')
    const res = await GET(req as never)
    expect(res.status).toBe(401)
  })
})

describe('POST /api/wellness', () => {
  it('upserts and returns the wellness entry', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ upserted: entry1 }))
    const req = new Request('http://localhost/api/wellness', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-06-16', energy: 4, leg_freshness: 3, mood: 4, stress: 2, sleep_quality: 5 }),
    })
    const res = await POST(req as never)
    const body = await res.json()
    expect(body.wellness.date).toBe('2026-06-16')
    expect(body.wellness.energy).toBe(4)
  })

  it('returns 400 when date is missing', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const req = new Request('http://localhost/api/wellness', {
      method: 'POST',
      body: JSON.stringify({ energy: 4 }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(400)
  })
})
