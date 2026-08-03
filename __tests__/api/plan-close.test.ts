/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({})),
}))
const mockArchivePlan = jest.fn()
jest.mock('@/lib/plan/archive', () => ({ archivePlan: (...args: unknown[]) => mockArchivePlan(...args) }))

import { POST } from '@/app/api/plan/close/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase({
  activePlan = { id: 'plan1' } as unknown,
  profile = { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1' } as unknown,
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'training_plans') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: activePlan }) }) }) }) }
      }
      if (table === 'user_profile') {
        return { select: () => ({ maybeSingle: async () => ({ data: profile }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

beforeEach(() => { jest.clearAllMocks() })

describe('POST /api/plan/close', () => {
  it('archives the active plan and returns the deleted/failed counts', async () => {
    mockArchivePlan.mockResolvedValue({ archived: true, deleted: 3, failed: 1 })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())

    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ deleted: 3, failed: 1 })
    expect(mockArchivePlan).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'plan1', expect.any(String))
  })

  it('returns 400 when there is no active plan', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ activePlan: null }))

    const res = await POST()
    expect(res.status).toBe(400)
  })

  it('returns 400 when archivePlan reports the plan was already closed', async () => {
    mockArchivePlan.mockResolvedValue({ archived: false, deleted: 0, failed: 0 })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())

    const res = await POST()
    expect(res.status).toBe(400)
  })

  it('archives with a null intervals.icu client when the athlete has not configured it', async () => {
    mockArchivePlan.mockResolvedValue({ archived: true, deleted: 0, failed: 0 })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ profile: { intervals_icu_athlete_id: '', intervals_icu_api_key: '' } })
    )

    const res = await POST()
    expect(res.status).toBe(200)
    expect(mockArchivePlan).toHaveBeenCalledWith(expect.anything(), null, 'plan1', expect.any(String))
  })
})
