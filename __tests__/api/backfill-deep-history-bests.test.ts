/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/intervals/client', () => ({ IntervalsClient: jest.fn().mockImplementation(() => ({})) }))

const mockRunBatch = jest.fn()
jest.mock('@/lib/intervals/deep-history-bests', () => ({ runDeepHistoryBestsBatch: (...args: unknown[]) => mockRunBatch(...args) }))

import { POST } from '@/app/api/admin/backfill-deep-history-bests/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase({ profile = { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1', deep_history_bests_cursor: null } as unknown, userId = 'u1', oldestWorkoutDate = '2023-01-01' as string | null, updateSpy = jest.fn() } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: (table: string) => {
      if (table === 'user_profile') {
        return {
          select: () => ({ maybeSingle: async () => ({ data: profile }) }),
          update: (fields: unknown) => { updateSpy(fields); return { eq: async () => ({ error: null }) } },
        }
      }
      if (table === 'workouts') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: oldestWorkoutDate ? { date: oldestWorkoutDate } : null }) }) }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/admin/backfill-deep-history-bests', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ userId: '' }))
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it('returns 400 when intervals.icu is not configured', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ profile: { intervals_icu_athlete_id: null, intervals_icu_api_key: null } }))
    const res = await POST()
    expect(res.status).toBe(400)
  })

  it('defaults the cursor to the oldest workout date when no cursor is stored yet', async () => {
    mockRunBatch.mockResolvedValue({ fetched: 5, processed: 5, newCursor: '2022-06-01', reachedPossibleStart: false })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ oldestWorkoutDate: '2023-01-01' }))
    await POST()
    expect(mockRunBatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'u1', '2023-01-01')
  })

  it('uses the stored cursor when one already exists', async () => {
    mockRunBatch.mockResolvedValue({ fetched: 5, processed: 5, newCursor: '2022-06-01', reachedPossibleStart: false })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ profile: { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1', deep_history_bests_cursor: '2022-09-01' } }))
    await POST()
    expect(mockRunBatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'u1', '2022-09-01')
  })

  it('persists the new cursor after a successful batch', async () => {
    mockRunBatch.mockResolvedValue({ fetched: 5, processed: 5, newCursor: '2022-06-01', reachedPossibleStart: false })
    const updateSpy = jest.fn()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ updateSpy }))
    const res = await POST()
    const body = await res.json()
    expect(body.newCursor).toBe('2022-06-01')
    expect(updateSpy).toHaveBeenCalledWith({ deep_history_bests_cursor: '2022-06-01' })
  })
})
