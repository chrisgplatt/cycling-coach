/** @jest-environment node */
import { POST } from '@/app/api/workouts/[id]/disassociate/route'

const mockGetActivity = jest.fn()

jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getActivity: mockGetActivity,
  })),
}))

jest.mock('@/lib/ftp/resolve-ftp', () => ({
  resolveFallbackFtpForWorkout: jest.fn(async () => 210),
}))

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

const icuProfile = { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k' }

function makeSupabase({
  workoutRow = { plan_id: 'p1', date: '2026-07-10', icu_activity_id: 'a1', status: 'completed' },
  profileRow = icuProfile as unknown,
  insertSpy = jest.fn(async () => ({ error: null })),
  updateSpy = jest.fn(async (_fields: unknown) => ({ error: null })),
}: {
  workoutRow?: unknown
  profileRow?: unknown
  insertSpy?: jest.Mock
  updateSpy?: jest.Mock
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'workouts') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: workoutRow }) }) }),
          insert: insertSpy,
          update: (fields: unknown) => ({ eq: () => updateSpy(fields) }),
        }
      }
      if (table === 'user_profile') {
        return { select: () => ({ maybeSingle: async () => ({ data: profileRow }) }) }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
}

function makeRequest() {
  return new Request('http://localhost/api/workouts/w1/disassociate', { method: 'POST' }) as never
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetActivity.mockResolvedValue({
    id: 'a1', start_date_local: '2026-07-10T09:00:00', type: 'Ride', moving_time: 3600,
    name: 'Evening Ride', training_load: 65, ftp: 245,
    average_watts: null, max_watts: null, weighted_average_watts: null,
    average_heartrate: null, max_heartrate: null, rolling_ftp: null,
    distance: null, total_elevation_gain: null, left_right_balance: null,
  })
})

describe('POST /api/workouts/[id]/disassociate', () => {
  it('creates a new unplanned ride row shaped like an imported ride', async () => {
    const insertSpy = jest.fn(async () => ({ error: null }))
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ insertSpy }))

    const res = await POST(makeRequest(), makeParams('w1'))
    expect(res.status).toBe(200)
    expect(insertSpy).toHaveBeenCalledWith({
      user_id: 'u1', plan_id: null, date: '2026-07-10', type: 'endurance',
      duration_minutes: 60, description: 'Evening Ride', target_zones: '',
      status: 'completed', icu_activity_id: 'a1', tss: 65, steps: null,
      ftp_at_completion: 245,
    })
  })

  it('reverts the original workout to planned with match fields cleared', async () => {
    const updateSpy = jest.fn(async (_fields: unknown) => ({ error: null }))
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ updateSpy }))

    await POST(makeRequest(), makeParams('w1'))
    expect(updateSpy).toHaveBeenCalledWith({
      status: 'planned', icu_activity_id: null, tss: null, actual_duration_minutes: null, ftp_at_completion: null, activity_metrics: null,
    })
  })

  it('uses the fallback FTP resolver when the activity has no ftp', async () => {
    mockGetActivity.mockResolvedValue({
      id: 'a1', start_date_local: '2026-07-10T09:00:00', type: 'Ride', moving_time: 3600,
      name: 'Evening Ride', training_load: 65, ftp: null,
      average_watts: null, max_watts: null, weighted_average_watts: null,
      average_heartrate: null, max_heartrate: null, rolling_ftp: null,
      distance: null, total_elevation_gain: null, left_right_balance: null,
    })
    const insertSpy = jest.fn(async () => ({ error: null }))
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ insertSpy }))

    await POST(makeRequest(), makeParams('w1'))
    const inserted = ((insertSpy.mock.calls as unknown[])[0] as unknown[])[0] as { ftp_at_completion: number }
    expect(inserted.ftp_at_completion).toBe(210)
  })

  it('returns 400 when the workout is not matched to a ride', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ workoutRow: { plan_id: 'p1', date: '2026-07-10', icu_activity_id: null, status: 'planned' } })
    )
    const res = await POST(makeRequest(), makeParams('w1'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the workout has no plan_id (already unplanned)', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ workoutRow: { plan_id: null, date: '2026-07-10', icu_activity_id: 'a1', status: 'completed' } })
    )
    const res = await POST(makeRequest(), makeParams('w1'))
    expect(res.status).toBe(400)
  })

  it('returns 404 when the workout does not exist', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ workoutRow: null }))
    const res = await POST(makeRequest(), makeParams('w1'))
    expect(res.status).toBe(404)
  })
})
