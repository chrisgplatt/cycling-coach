/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/workout-names', () => ({ nameForWorkout: () => 'Test Ride' }))
const mockArchivePlan = jest.fn()
jest.mock('@/lib/plan/archive', () => ({ archivePlan: (...args: unknown[]) => mockArchivePlan(...args) }))
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    createEvent: jest.fn(async () => 'evt-1'),
  })),
}))

import { PATCH } from '@/app/api/plan/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const validPlan = {
  target_event_name: 'A Race', target_event_date: '2026-08-01', phase: 'build', rationale: 'r',
  workouts: [{ date: '2026-05-02', type: 'endurance', duration_minutes: 60, description: 'd', target_zones: 'z2', steps: null }],
}

function makeSupabase({ activePlan = null as unknown } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'user_profile') {
        return {
          select: () => ({
            maybeSingle: async () => ({
              data: { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1', events: [], current_ftp: 200 },
            }),
          }),
        }
      }
      if (table === 'training_plans') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: activePlan }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'plan2' }, error: null }) }) }),
        }
      }
      if (table === 'workouts') {
        return { insert: async () => ({ error: null }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/plan', { method: 'PATCH', body: JSON.stringify(body) }) as never
}

beforeEach(() => jest.clearAllMocks())

describe('PATCH /api/plan — archive-on-replace', () => {
  it('archives the existing active plan via archivePlan before saving the new one', async () => {
    mockArchivePlan.mockResolvedValue({ archived: true, deleted: 0, failed: 0 })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ activePlan: { id: 'plan1' } }))

    const res = await PATCH(makeRequest({ plan: validPlan, name: 'New Plan' }))

    expect(res.status).toBe(200)
    expect(mockArchivePlan).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'plan1', expect.any(String))
  })

  it('does not call archivePlan when there is no existing active plan', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ activePlan: null }))

    const res = await PATCH(makeRequest({ plan: validPlan, name: 'New Plan' }))

    expect(res.status).toBe(200)
    expect(mockArchivePlan).not.toHaveBeenCalled()
  })
})
