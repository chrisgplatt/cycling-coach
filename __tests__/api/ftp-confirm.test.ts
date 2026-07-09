/** @jest-environment node */
import { POST } from '@/app/api/ftp/confirm/route'

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

const draft = {
  predicted_ftp: 225,
  reasoning: 'Steady progress.',
  confidence: 'medium',
  activity_ids: ['a1', 'a2'],
}

function makeSupabase({
  user = { id: 'u1' } as { id: string } | null,
  insertedRow = { id: 'p1', ...draft, confirmed: false, created_at: '2026-07-09T00:00:00Z' } as unknown,
  insertError = null as { message: string } | null,
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: insertError ? null : insertedRow, error: insertError }),
        }),
      }),
    }),
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/ftp/confirm', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/ftp/confirm', () => {
  it('saves the draft and returns the inserted row', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest(draft))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ id: 'p1', predicted_ftp: 225, confirmed: false })
  })

  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ user: null }))
    const res = await POST(makeRequest(draft))
    expect(res.status).toBe(401)
  })

  it('returns 400 when predicted_ftp is missing', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({ ...draft, predicted_ftp: undefined }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when confidence is not a recognised value', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({ ...draft, confidence: 'extreme' }))
    expect(res.status).toBe(400)
  })

  it('returns 500 with the db error message on insert failure', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ insertError: { message: 'db down' } })
    )
    const res = await POST(makeRequest(draft))
    expect(res.status).toBe(500)
  })
})
