/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

const mockGetActivities = jest.fn()
const mockGetWellness = jest.fn()
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getActivities: mockGetActivities,
    getWellness: mockGetWellness,
  })),
}))

import { POST } from '@/app/api/admin/backfill-plan-history/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const goodProfile = {
  is_admin: true,
  intervals_icu_athlete_id: 'i1',
  intervals_icu_api_key: 'k',
}

function makeSupabase({
  profile = goodProfile as unknown,
  plans = [] as Array<{ id: string; created_at: string; plan_weeks: number | null }>,
  workoutsByPlan = {} as Record<string, unknown[]>,
  updateSpy = jest.fn(async (_fields: unknown) => ({ error: null as { message: string } | null })),
}: {
  profile?: unknown
  plans?: Array<{ id: string; created_at: string; plan_weeks: number | null }>
  workoutsByPlan?: Record<string, unknown[]>
  updateSpy?: (fields: unknown) => Promise<{ error: { message: string } | null }>
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'user_profile') {
        return { select: () => ({ maybeSingle: async () => ({ data: profile }) }) }
      }
      if (table === 'training_plans') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({ data: plans }),
              }),
            }),
          }),
          update: (fields: unknown) => ({ eq: () => updateSpy(fields) }),
        }
      }
      if (table === 'workouts') {
        return {
          select: () => ({
            eq: (_col: string, planId: string) => ({ data: workoutsByPlan[planId] ?? [] }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/admin/backfill-plan-history', () => {
  it('returns 403 for a non-admin', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ profile: { ...goodProfile, is_admin: false } }))
    const res = await POST()
    expect(res.status).toBe(403)
  })

  it('returns zero counts when there are no archived plans missing a summary', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ plans: [] }))
    const res = await POST()
    const body = await res.json()
    expect(body).toEqual({ total: 0, backfilled: 0, failed: 0 })
  })

  it('computes and writes archive_summary + closed_at, assuming the plan ran its full planned course', async () => {
    const updateSpy = jest.fn(async (_fields: unknown) => ({ error: null }))
    mockGetActivities.mockResolvedValue([])
    mockGetWellness.mockResolvedValue([])
    const supabase = makeSupabase({
      updateSpy,
      plans: [{ id: 'plan1', created_at: '2026-05-01T00:00:00Z', plan_weeks: 2 }],
      workoutsByPlan: {
        plan1: [
          { id: 'w1', status: 'completed', date: '2026-05-02', plan_id: 'plan1', icu_activity_id: null, intervals_icu_event_id: null, duration_minutes: 60, type: 'endurance', steps: null, optional: false },
        ],
      },
    })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabase)

    const res = await POST()
    const body = await res.json()

    expect(body).toEqual({ total: 1, backfilled: 1, failed: 0 })
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      closed_at: '2026-05-15', // created_at + 2 weeks — assumed full course, since actual closure date is unknown
      archive_summary: expect.objectContaining({ closedEarly: false, totalCompletedSessions: 1 }),
    }))
  })

  it('degrades gracefully when intervals.icu is not configured', async () => {
    const updateSpy = jest.fn(async (_fields: unknown) => ({ error: null }))
    const supabase = makeSupabase({
      updateSpy,
      profile: { is_admin: true, intervals_icu_athlete_id: '', intervals_icu_api_key: '' },
      plans: [{ id: 'plan1', created_at: '2026-05-01T00:00:00Z', plan_weeks: 1 }],
      workoutsByPlan: {},
    })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabase)

    const res = await POST()
    const body = await res.json()

    expect(body).toEqual({ total: 1, backfilled: 1, failed: 0 })
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      archive_summary: expect.objectContaining({ ctlStart: null, ctlEnd: null, fitnessChange: null }),
    }))
  })

  it('counts a failed update without stopping the batch', async () => {
    const updateSpy = jest.fn(async (_fields: unknown) => ({ error: { message: 'db error' } }))
    mockGetActivities.mockResolvedValue([])
    mockGetWellness.mockResolvedValue([])
    const supabase = makeSupabase({
      updateSpy,
      plans: [{ id: 'plan1', created_at: '2026-05-01T00:00:00Z', plan_weeks: 1 }],
      workoutsByPlan: {},
    })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabase)

    const res = await POST()
    const body = await res.json()
    expect(body).toEqual({ total: 1, backfilled: 0, failed: 1 })
  })
})
