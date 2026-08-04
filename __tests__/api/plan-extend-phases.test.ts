/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/intervals/client', () => ({ IntervalsClient: jest.fn() }))
jest.mock('@/lib/hrv/server', () => ({ fetchHrvStatusBestSource: jest.fn(async () => null) }))
jest.mock('@/lib/claude/dossier', () => ({ fetchDossier: jest.fn(async () => null), formatDossier: jest.fn(() => '') }))
jest.mock('@/lib/claude/athlete-model', () => ({ fetchActiveBeliefs: jest.fn(async () => null), formatAthleteModel: jest.fn(() => '') }))

const mockCreateExtendStream = jest.fn()
const mockParsePlanText = jest.fn()
const mockCountPlannedWorkouts: jest.Mock = jest.fn(() => 5)
jest.mock('@/lib/claude/plan', () => ({
  createExtendStream: (...args: unknown[]) => mockCreateExtendStream(...args),
  parsePlanText: (...args: unknown[]) => mockParsePlanText(...args),
  countPlannedWorkouts: (...args: unknown[]) => mockCountPlannedWorkouts(...args),
}))

import { POST } from '@/app/api/plan/extend/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const goodProfile = {
  goals: 'g', events: [], weekly_availability: [], current_ftp: 200, weight_kg: 70,
  intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1',
}

function makeSupabase(activePlan: unknown) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'training_plans') {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: activePlan }) }) }) }) }) }) }
      }
      if (table === 'user_profile') {
        return { select: () => ({ maybeSingle: async () => ({ data: goodProfile }) }) }
      }
      if (table === 'workouts') {
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/plan/extend', { method: 'POST', body: JSON.stringify(body) }) as never
}

async function readNdjson(res: Response): Promise<Array<Record<string, unknown>>> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
  }
  return buf.split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCountPlannedWorkouts.mockReturnValue(5)
  mockCreateExtendStream.mockReturnValue({
    on: (_event: string, cb: (text: string) => void) => cb(JSON.stringify({
      rationale: 'r', target_event_name: 'E', target_event_date: '2026-09-01',
      workouts: [{ date: '2026-07-01', type: 'endurance', duration_minutes: 60, description: 'd', target_zones: 'z', steps: [] }],
    })),
    finalMessage: async () => ({}),
  })
  mockParsePlanText.mockImplementation((text: string) => JSON.parse(text))
})

describe('POST /api/plan/extend — phase computation', () => {
  it('attaches phase/week_phases computed in code, matching remainingWeeks + extraWeeks', async () => {
    // Plan created 8 weeks ago (createdAt far enough back), plan_weeks=12 -> weeksCompleted derived
    // from dates; simplest deterministic setup: use a very recent created_at so weeksCompleted=0,
    // plan_weeks=6, extra_weeks=6 -> remainingWeeks=6, extraWeeks=6 -> weeksToGenerate=12.
    const today = new Date().toISOString().split('T')[0]
    const activePlan = { id: 'p1', plan_weeks: 6, created_at: `${today}T00:00:00Z`, training_philosophy: null, week_phases: null, phase: null }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(activePlan))

    const res = await POST(makeRequest({ extra_weeks: 6 }))
    const events = await readNdjson(res)
    const planEvent = events.find(e => e.type === 'plan') as { plan: { phase: string; week_phases: string[] } } | undefined

    expect(planEvent).toBeDefined()
    // computeWeekPhases(12) = 4x base, 5x build, 1x peak, 2x taper (verified in lib/plan/phases.ts tests)
    expect(planEvent!.plan.week_phases).toHaveLength(12)
    expect(planEvent!.plan.phase).toBe(planEvent!.plan.week_phases[0])
    expect(planEvent!.plan.phase).toBe('base')
  })
})
