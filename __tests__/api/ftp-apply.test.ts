/** @jest-environment node */
import { PATCH } from '@/app/api/ftp/[id]/apply/route'

const mockSync = jest.fn()
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/profile/sync-ftp-to-icu', () => ({
  syncFtpToIntervalsIcu: (...args: unknown[]) => mockSync(...args),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

const predictionRow = {
  id: 'p1', predicted_ftp: 230, reasoning: 'r', confidence: 'medium',
  activity_ids: [], confirmed: true, created_at: '2026-07-09T00:00:00Z',
}

function makeSupabase({
  user = { id: 'u1' } as { id: string } | null,
  predictionUpdateResult = predictionRow as unknown,
  profileRow = { id: 'prof1' } as unknown,
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      if (table === 'ftp_predictions') {
        return {
          update: () => ({
            eq: () => ({
              select: () => ({ maybeSingle: async () => ({ data: predictionUpdateResult, error: null }) }),
            }),
          }),
        }
      }
      if (table === 'user_profile') {
        return {
          select: () => ({ maybeSingle: async () => ({ data: profileRow, error: null }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => jest.clearAllMocks())

describe('PATCH /api/ftp/[id]/apply', () => {
  it('marks the prediction confirmed, updates profile FTP, and syncs to intervals.icu', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await PATCH({} as Request as never, ctx('p1') as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual(predictionRow)
    expect(mockSync).toHaveBeenCalledWith(expect.anything(), 230)
  })

  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ user: null }))
    const res = await PATCH({} as Request as never, ctx('p1') as never)
    expect(res.status).toBe(401)
  })

  it('returns 404 when the prediction id does not exist or is not owned by the user', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ predictionUpdateResult: null }))
    const res = await PATCH({} as Request as never, ctx('missing') as never)
    expect(res.status).toBe(404)
    expect(mockSync).not.toHaveBeenCalled()
  })
})
