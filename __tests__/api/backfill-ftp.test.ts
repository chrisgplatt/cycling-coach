/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

const mockGetActivities = jest.fn()
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getActivities: mockGetActivities,
  })),
}))

import { POST } from '@/app/api/workouts/backfill-ftp/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const goodProfile = {
  is_admin: true,
  intervals_icu_athlete_id: 'i1',
  intervals_icu_api_key: 'k',
}

function makeSupabase({
  profile = goodProfile as unknown,
  workouts = [] as Array<{ id: string; date: string; plan_id: string | null; icu_activity_id: string | null }>,
  predictions = [] as { created_at: string; predicted_ftp: number }[],
  planRows = {} as Record<string, { baseline_ftp: number | null }>,
  updateSpy = jest.fn(),
} = {}) {
  return {
    from: (table: string) => {
      if (table === 'user_profile') {
        return { select: () => ({ maybeSingle: async () => ({ data: profile }) }) }
      }
      if (table === 'workouts') {
        return {
          select: () => ({ eq: () => ({ is: () => ({ data: workouts }) }) }),
          update: (fields: unknown) => { updateSpy(fields); return { eq: async () => ({ error: null }) } },
        }
      }
      if (table === 'ftp_predictions') {
        return { select: () => ({ eq: () => ({ data: predictions }) }) }
      }
      if (table === 'training_plans') {
        return { select: () => ({ in: () => ({ data: Object.entries(planRows).map(([id, row]) => ({ id, ...row })) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/workouts/backfill-ftp', () => {
  it('returns 403 for a non-admin', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ profile: { ...goodProfile, is_admin: false } }))
    const res = await POST()
    expect(res.status).toBe(403)
  })

  it('backfills from the linked activity\'s ftp when present', async () => {
    const updateSpy = jest.fn()
    mockGetActivities.mockResolvedValue([
      { id: 'act1', start_date_local: '2026-06-10T08:00:00', type: 'Ride', moving_time: 3600, name: 'r', ftp: 240 },
    ])
    const supabase = makeSupabase({
      updateSpy,
      workouts: [{ id: 'w1', date: '2026-06-10', plan_id: null, icu_activity_id: 'act1' }],
    })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabase)
    const res = await POST()
    const body = await res.json()
    expect(body.updated).toBe(1)
    expect(updateSpy).toHaveBeenCalledWith({ ftp_at_completion: 240 })
  })

  it('falls back to a confirmed prediction when the linked activity has no ftp', async () => {
    const updateSpy = jest.fn()
    mockGetActivities.mockResolvedValue([
      { id: 'act1', start_date_local: '2026-06-10T08:00:00', type: 'Ride', moving_time: 3600, name: 'r', ftp: null },
    ])
    const supabase = makeSupabase({
      updateSpy,
      workouts: [{ id: 'w1', date: '2026-06-10', plan_id: null, icu_activity_id: 'act1' }],
      predictions: [{ created_at: '2026-06-01T00:00:00Z', predicted_ftp: 225 }],
    })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabase)
    const res = await POST()
    const body = await res.json()
    expect(body.updated).toBe(1)
    expect(updateSpy).toHaveBeenCalledWith({ ftp_at_completion: 225 })
  })

  it('falls back to the plan baseline_ftp when there is no activity value and no earlier prediction', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase({
      updateSpy,
      workouts: [{ id: 'w1', date: '2026-06-10', plan_id: 'plan1', icu_activity_id: null }],
      planRows: { plan1: { baseline_ftp: 210 } },
    })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabase)
    const res = await POST()
    const body = await res.json()
    expect(body.updated).toBe(1)
    expect(updateSpy).toHaveBeenCalledWith({ ftp_at_completion: 210 })
  })

  it('skips a workout when none of the three sources have a value', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase({
      updateSpy,
      workouts: [{ id: 'w1', date: '2026-06-10', plan_id: null, icu_activity_id: null }],
    })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabase)
    const res = await POST()
    const body = await res.json()
    expect(body.updated).toBe(0)
    expect(body.skipped).toBe(1)
    expect(updateSpy).not.toHaveBeenCalled()
  })
})
