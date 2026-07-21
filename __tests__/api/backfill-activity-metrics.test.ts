/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/intervals/client', () => ({ IntervalsClient: jest.fn().mockImplementation(() => ({})) }))

const mockBackfill = jest.fn()
jest.mock('@/lib/intervals/enrich', () => ({ backfillActivityMetrics: (...args: unknown[]) => mockBackfill(...args) }))

import { POST } from '@/app/api/admin/backfill-activity-metrics/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase(profile: unknown, userId: string | null = 'u1') {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: () => ({ select: () => ({ maybeSingle: async () => ({ data: profile }) }) }),
  }
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/admin/backfill-activity-metrics', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(null, null))
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it('returns 400 when intervals.icu is not configured', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ intervals_icu_athlete_id: null, intervals_icu_api_key: null }),
    )
    const res = await POST()
    expect(res.status).toBe(400)
  })

  it('calls backfillActivityMetrics with allTime:true for the current user and returns its result', async () => {
    mockBackfill.mockResolvedValue({ candidates: 40, totalNeeding: 12, processed: 12, enriched: 12, failed: 0, firstError: null })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1' }),
    )
    const res = await POST()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ candidates: 40, totalNeeding: 12, processed: 12, enriched: 12, failed: 0, firstError: null })
    expect(mockBackfill).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'u1', { allTime: true })
  })

  it('returns a done result unchanged when nothing needs backfilling', async () => {
    mockBackfill.mockResolvedValue({ candidates: 40, totalNeeding: 0, processed: 0, enriched: 0, failed: 0, firstError: null })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1' }),
    )
    const res = await POST()
    const body = await res.json()
    expect(body.totalNeeding).toBe(0)
  })
})
