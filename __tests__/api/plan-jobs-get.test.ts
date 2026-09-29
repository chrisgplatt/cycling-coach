/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

import { GET } from '@/app/api/plan/jobs/[id]/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase(job: unknown) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: job }) }) }) }),
  }
}

function makeRequest() {
  return new Request('http://localhost/api/plan/jobs/job1') as never
}

describe('GET /api/plan/jobs/[id]', () => {
  it('returns the job status, progress, and result', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({
      status: 'running', progress: { total: 10, completed: 4, failed_days: [] }, result: null, error: null,
    }))
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'job1' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'running', progress: { total: 10, completed: 4, failed_days: [] }, result: null, error: null })
  })

  it('returns 404 when the job does not exist or belongs to another user (RLS-filtered)', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(null))
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })

  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } })
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'job1' }) })
    expect(res.status).toBe(401)
  })
})
