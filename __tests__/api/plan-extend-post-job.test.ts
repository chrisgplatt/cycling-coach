/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/intervals/client', () => ({ IntervalsClient: jest.fn() }))
jest.mock('@/lib/hrv/server', () => ({ fetchHrvStatusBestSource: jest.fn(async () => null) }))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

const mockRunPlanJob = jest.fn(async (..._args: unknown[]) => {})
jest.mock('@/lib/plan/job-runner', () => ({ runPlanJob: (...args: unknown[]) => mockRunPlanJob(...args) }))

import { POST } from '@/app/api/plan/extend/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { waitUntil } from '@vercel/functions'

const goodProfile = {
  goals: 'g', events: [], weekly_availability: [{ day: 'monday', duration_minutes: 60 }],
  current_ftp: 200, weight_kg: 70, intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1', garmin_email: null,
}

const activePlan = {
  id: 'plan1', plan_weeks: 12, created_at: '2026-06-01T00:00:00Z',
  training_philosophy: null, week_phases: Array(12).fill('build'), phase: 'build',
  rationale: 'Original rationale', target_event_name: 'Dragon Ride', target_event_date: '2026-09-01',
}

function makeSupabase(overrides: { plan?: unknown; insertResult?: unknown } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'training_plans') {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: 'plan' in overrides ? overrides.plan : activePlan }) }) }) }) }) }) }
      }
      if (table === 'workouts') {
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }) }
      }
      if (table === 'user_profile') return { select: () => ({ maybeSingle: async () => ({ data: goodProfile }) }) }
      if (table === 'plan_generation_jobs') return { insert: () => ({ select: () => ({ single: async () => overrides.insertResult ?? { data: { id: 'job1' }, error: null } }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/plan/extend', { method: 'POST', body: JSON.stringify(body) }) as never
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/plan/extend', () => {
  it('creates a pending extend job, kicks it off via waitUntil, and returns 202 with job id + extra_weeks + new_total_weeks', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({ extra_weeks: 4 }))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.job_id).toBe('job1')
    expect(body.extra_weeks).toBe(4)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(mockRunPlanJob).toHaveBeenCalledWith(
      expect.anything(), 'job1',
      expect.objectContaining({ kind: 'extend', priorRationale: 'Original rationale', priorTargetEventName: 'Dragon Ride' }),
    )
  })

  it('returns 400 when extra_weeks is out of range', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({ extra_weeks: 30 }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when there is no active plan', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ plan: null }))
    const res = await POST(makeRequest({ extra_weeks: 4 }))
    expect(res.status).toBe(400)
  })

  it('returns 500 when the job row fails to insert', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ insertResult: { data: null, error: new Error('db down') } }))
    const res = await POST(makeRequest({ extra_weeks: 4 }))
    expect(res.status).toBe(500)
    expect(waitUntil).not.toHaveBeenCalled()
  })
})
