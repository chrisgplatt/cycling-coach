/** @jest-environment node */
import { GET, POST, DELETE } from '@/app/api/weight-log/route'

const mockUpdateAthleteWeight = jest.fn()

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    updateAthleteWeight: mockUpdateAthleteWeight,
  })),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

const user = { id: 'u1' }
const profile = { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k' }

function makeSupabase({
  entries = [] as unknown[],
  insertedEntry = { id: 'we-1', date: '2026-06-12', weight_kg: 75 },
  latestEntry = { date: '2026-06-12', weight_kg: 75 },
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => ({
      select: (cols?: string) => ({
        eq: () => ({
          order: () => ({ data: entries, error: null }),
          maybeSingle: async () => ({ data: table === 'user_profile' ? profile : null }),
          limit: () => ({ maybeSingle: async () => ({ data: latestEntry }) }),
        }),
        order: () => ({
          limit: () => ({ maybeSingle: async () => ({ data: latestEntry }) }),
        }),
        maybeSingle: async () => ({ data: profile }),
      }),
      upsert: () => ({ select: () => ({ single: async () => ({ data: insertedEntry, error: null }) }) }),
      update: () => ({ eq: () => ({ error: null }) }),
      delete: () => ({ eq: () => ({ eq: () => ({ error: null }) }) }),
    }),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUpdateAthleteWeight.mockResolvedValue(undefined)
})

describe('GET /api/weight-log', () => {
  it('returns entries ordered by date desc', async () => {
    const entries = [
      { id: '2', date: '2026-06-12', weight_kg: 75 },
      { id: '1', date: '2026-05-01', weight_kg: 76 },
    ]
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ entries }))
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.entries).toHaveLength(2)
    expect(body.entries[0].date).toBe('2026-06-12')
  })
})

describe('POST /api/weight-log', () => {
  it('returns the upserted entry', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const req = new Request('http://localhost/api/weight-log', {
      method: 'POST',
      body: JSON.stringify({ weight_kg: 75, date: '2026-06-12' }),
    })
    const res = await POST(req)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.entry.weight_kg).toBe(75)
  })

  it('calls updateAthleteWeight with the new weight', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const req = new Request('http://localhost/api/weight-log', {
      method: 'POST',
      body: JSON.stringify({ weight_kg: 75, date: '2026-06-12' }),
    })
    await POST(req)
    expect(mockUpdateAthleteWeight).toHaveBeenCalledWith(75)
  })

  it('returns 400 when weight_kg is missing', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const req = new Request('http://localhost/api/weight-log', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/weight-log', () => {
  it('returns ok: true', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const req = new Request('http://localhost/api/weight-log?id=we-1', { method: 'DELETE' })
    const res = await DELETE(req)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it('returns 400 when id is missing', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const req = new Request('http://localhost/api/weight-log', { method: 'DELETE' })
    const res = await DELETE(req)
    expect(res.status).toBe(400)
  })
})
