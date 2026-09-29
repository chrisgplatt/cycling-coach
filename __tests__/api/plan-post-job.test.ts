/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/intervals/client', () => ({ IntervalsClient: jest.fn() }))
jest.mock('@/lib/hrv/server', () => ({ fetchHrvStatusBestSource: jest.fn(async () => null) }))
jest.mock('@/lib/claude/dossier', () => ({ fetchDossier: jest.fn(async () => null), formatDossier: jest.fn(() => '') }))
jest.mock('@/lib/claude/athlete-model', () => ({ fetchActiveBeliefs: jest.fn(async () => null), formatAthleteModel: jest.fn(() => '') }))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))

const mockRunGeneratePlanJob = jest.fn(async (..._args: unknown[]) => {})
jest.mock('@/lib/plan/job-runner', () => ({ runGeneratePlanJob: (...args: unknown[]) => mockRunGeneratePlanJob(...args) }))

import { POST } from '@/app/api/plan/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { waitUntil } from '@vercel/functions'

const goodProfile = {
  goals: 'g', events: [{ name: 'E', date: '2026-09-01', type: 'sportive', priority: 'A' }],
  weekly_availability: [], current_ftp: 200, weight_kg: 70,
  intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1',
}

function makeSupabase(overrides: { insertResult?: unknown } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'user_profile') return { select: () => ({ maybeSingle: async () => ({ data: goodProfile }) }) }
      if (table === 'plan_generation_jobs') {
        return {
          insert: () => ({
            select: () => ({
              single: async () => overrides.insertResult ?? { data: { id: 'job1' }, error: null },
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/plan', { method: 'POST', body: JSON.stringify(body) }) as never
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('POST /api/plan', () => {
  it('creates a pending job, kicks it off via waitUntil, and returns 202 with the job id', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({ totalWeeks: 6, startDate: '2026-06-01' }))
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toEqual({ job_id: 'job1' })
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(mockRunGeneratePlanJob).toHaveBeenCalledWith(expect.anything(), 'job1', expect.objectContaining({ kind: 'generate', totalWeeks: 6 }))
  })

  it('returns 400 when the profile has no events', async () => {
    const supabase = makeSupabase()
    supabase.from = (table: string) => {
      if (table === 'user_profile') return { select: () => ({ maybeSingle: async () => ({ data: { ...goodProfile, events: [] } }) }) }
      throw new Error('unexpected')
    }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabase)
    const res = await POST(makeRequest({ totalWeeks: 6, startDate: '2026-06-01' }))
    expect(res.status).toBe(400)
  })

  it('returns 500 when the job row fails to insert', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ insertResult: { data: null, error: new Error('db down') } }))
    const res = await POST(makeRequest({ totalWeeks: 6, startDate: '2026-06-01' }))
    expect(res.status).toBe(500)
    expect(waitUntil).not.toHaveBeenCalled()
  })
})
