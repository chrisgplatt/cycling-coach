/** @jest-environment node */
import { PATCH } from '@/app/api/workouts/[id]/route'

jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/ftp/resolve-ftp', () => ({ resolveFallbackFtpForWorkout: jest.fn() }))

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { resolveFallbackFtpForWorkout } from '@/lib/ftp/resolve-ftp'

function makeSupabase({
  updateSpy = jest.fn(),
  workoutRow = { date: '2026-07-06', plan_id: 'plan1' } as unknown,
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'workouts') {
        return {
          update: (fields: unknown) => { updateSpy(fields); return { eq: () => ({ error: null }) } },
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: workoutRow }) }) }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/workouts/w1', { method: 'PATCH', body: JSON.stringify(body) }) as never
}

beforeEach(() => jest.clearAllMocks())

describe('PATCH /api/workouts/[id] — ftp_at_completion', () => {
  it('writes the client-supplied ftp_at_completion directly when status is completed', async () => {
    const updateSpy = jest.fn()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ updateSpy }))
    await PATCH(makeRequest({ status: 'completed', ftp_at_completion: 245 }), ctx('w1') as never)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', ftp_at_completion: 245 }))
    expect(resolveFallbackFtpForWorkout).not.toHaveBeenCalled()
  })

  it('resolves a fallback when status is completed but no ftp_at_completion is supplied', async () => {
    const updateSpy = jest.fn()
    ;(resolveFallbackFtpForWorkout as jest.Mock).mockResolvedValue(230)
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ updateSpy }))
    await PATCH(makeRequest({ status: 'completed' }), ctx('w1') as never)
    expect(resolveFallbackFtpForWorkout).toHaveBeenCalledWith(expect.anything(), '2026-07-06', 'plan1')
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ ftp_at_completion: 230 }))
  })

  it('treats an explicit null ftp_at_completion the same as omitted — resolves a fallback', async () => {
    const updateSpy = jest.fn()
    ;(resolveFallbackFtpForWorkout as jest.Mock).mockResolvedValue(null)
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ updateSpy }))
    await PATCH(makeRequest({ status: 'completed', ftp_at_completion: null }), ctx('w1') as never)
    expect(resolveFallbackFtpForWorkout).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ ftp_at_completion: null }))
  })

  it('does not touch ftp_at_completion or fetch the workout when status is not being set to completed', async () => {
    const updateSpy = jest.fn()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ updateSpy }))
    await PATCH(makeRequest({ missed_reason: 'Illness' }), ctx('w1') as never)
    const written = updateSpy.mock.calls[0][0]
    expect(written).not.toHaveProperty('ftp_at_completion')
    expect(resolveFallbackFtpForWorkout).not.toHaveBeenCalled()
  })
})
