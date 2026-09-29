/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/intervals/client', () => ({ IntervalsClient: jest.fn() }))
jest.mock('@/lib/hrv/server', () => ({ fetchHrvStatusBestSource: jest.fn(async () => null) }))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

const mockRunPlanJob = jest.fn(async (..._args: unknown[]) => {})
jest.mock('@/lib/plan/job-runner', () => ({ runPlanJob: (...args: unknown[]) => mockRunPlanJob(...args) }))

const mockComputeLoadMultiplier = jest.fn((..._args: unknown[]) => 1)
jest.mock('@/lib/plan/load-calibration', () => ({ computeLoadMultiplier: (...args: unknown[]) => mockComputeLoadMultiplier(...args) }))

import { POST } from '@/app/api/plan/review/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { waitUntil } from '@vercel/functions'

const goodProfile = {
  goals: 'g', events: [], weekly_availability: [], current_ftp: 200, weight_kg: 70,
  intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1', garmin_email: null,
}

const activePlan = {
  id: 'plan1', created_at: '2026-06-01T00:00:00Z', plan_weeks: 12,
  week_phases: Array(12).fill('build'), rationale: 'Original rationale',
  target_event_name: 'Dragon Ride', target_event_date: '2026-09-01', workouts: [],
}

function makeSupabase(overrides: { plan?: unknown; insertResult?: unknown } = {}) {
  return {
    from: (table: string) => {
      if (table === 'user_profile') return { select: () => ({ maybeSingle: async () => ({ data: goodProfile }) }) }
      if (table === 'training_plans') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: 'plan' in overrides ? overrides.plan : activePlan }) }) }) }) }) }
      }
      if (table === 'plan_generation_jobs') {
        return { insert: () => ({ select: () => ({ single: async () => overrides.insertResult ?? { data: { id: 'job1' }, error: null } }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

function makeAuthedSupabase(overrides: Parameters<typeof makeSupabase>[0] = {}) {
  return { auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, ...makeSupabase(overrides) }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/plan/review', { method: 'POST', body: JSON.stringify(body) }) as never
}

beforeEach(() => {
  jest.clearAllMocks()
  mockComputeLoadMultiplier.mockReturnValue(1)
  ;(IntervalsClient as unknown as jest.Mock).mockImplementation(() => ({
    getActivities: jest.fn(async () => []), getWellness: jest.fn(async () => []),
  }))
})

describe('POST /api/plan/review', () => {
  it('creates a pending review job, kicks it off via waitUntil, and returns 202 with the job id', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeAuthedSupabase())
    const res = await POST(makeRequest({ note: 'Felt great this week' }))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ job_id: 'job1' })
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(mockRunPlanJob).toHaveBeenCalledWith(
      expect.anything(), 'job1',
      expect.objectContaining({ kind: 'review', priorRationale: 'Original rationale', priorTargetEventName: 'Dragon Ride' }),
    )
  })

  it('returns 400 when there is no active plan', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeAuthedSupabase({ plan: null }))
    const res = await POST(makeRequest({ note: '' }))
    expect(res.status).toBe(400)
  })

  it('falls back to a 12-week plan when the stored plan has no plan_weeks or week_phases', async () => {
    const planWithoutWeeks = { ...activePlan, plan_weeks: null, week_phases: null }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeAuthedSupabase({ plan: planWithoutWeeks }))
    const res = await POST(makeRequest({ note: '' }))
    expect(res.status).toBe(202)
    const call = mockRunPlanJob.mock.calls[0][2] as { phases: string[] }
    expect(call.phases).toHaveLength(12) // computeWeekPhases(12) fallback — NOT computeWeekPhases(1)
  })

  it('returns 500 when the job row fails to insert', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeAuthedSupabase({ insertResult: { data: null, error: new Error('db down') } }))
    const res = await POST(makeRequest({ note: '' }))
    expect(res.status).toBe(500)
    expect(waitUntil).not.toHaveBeenCalled()
  })
})
