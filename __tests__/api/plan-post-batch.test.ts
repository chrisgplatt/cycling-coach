/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/intervals/client', () => ({ IntervalsClient: jest.fn() }))
jest.mock('@/lib/hrv/server', () => ({ fetchHrvStatusBestSource: jest.fn(async () => null) }))
jest.mock('@/lib/claude/dossier', () => ({ fetchDossier: jest.fn(async () => null), formatDossier: jest.fn(() => '') }))
jest.mock('@/lib/claude/athlete-model', () => ({ fetchActiveBeliefs: jest.fn(async () => null), formatAthleteModel: jest.fn(() => '') }))

const mockCreatePlanStream = jest.fn()
const mockParsePlanText = jest.fn()
const mockCountPlannedWorkouts = jest.fn((..._args: unknown[]) => 10)
jest.mock('@/lib/claude/plan', () => ({
  createPlanStream: (...args: unknown[]) => mockCreatePlanStream(...args),
  parsePlanText: (...args: unknown[]) => mockParsePlanText(...args),
  countPlannedWorkouts: (...args: unknown[]) => mockCountPlannedWorkouts(...args),
  estimateTss: (steps: Array<{ duration_minutes: number; power_pct_ftp: number }>) =>
    Math.round(steps.reduce((sum, s) => sum + (s.duration_minutes * 60 * (s.power_pct_ftp / 100) ** 2) / 36, 0)),
}))

import { POST } from '@/app/api/plan/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const goodProfile = {
  goals: 'g', events: [{ name: 'E', date: '2026-09-01', type: 'sportive', priority: 'A' }],
  weekly_availability: [], current_ftp: 200, weight_kg: 70,
  intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k1',
}

function makeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'user_profile') return { select: () => ({ maybeSingle: async () => ({ data: goodProfile }) }) }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/plan', { method: 'POST', body: JSON.stringify(body) }) as never
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
  mockCountPlannedWorkouts.mockReturnValue(10)
  mockCreatePlanStream.mockReturnValue({
    on: (_event: string, cb: (text: string) => void) => cb('{"workouts":[{"date":"2026-06-01"}]}'),
    finalMessage: async () => ({}),
  })
  mockParsePlanText.mockImplementation((text: string) => JSON.parse(text))
})

describe('POST /api/plan — batching', () => {
  it('defaults to a single full-plan batch when no batch fields are sent', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    await POST(makeRequest({ totalWeeks: 6, startDate: '2026-06-01' }))
    expect(mockCreatePlanStream).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 6, '2026-06-01', '', expect.anything(), null, null,
      { batchStartWeek: 0, batchWeekCount: 6, priorWorkouts: [] },
    )
  })

  it('forwards batch fields and prior workouts for a later batch', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const priorWorkouts = [{ date: '2026-06-01', type: 'endurance', duration_minutes: 60, description: 'd', target_zones: 'z', steps: [] }]
    await POST(makeRequest({
      totalWeeks: 12, startDate: '2026-06-01', batchStartWeek: 4, batchWeekCount: 4, priorWorkouts,
    }))
    expect(mockCreatePlanStream).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 12, '2026-06-01', '', expect.anything(), null, null,
      { batchStartWeek: 4, batchWeekCount: 4, priorWorkouts },
    )
  })

  it('clamps an out-of-range batch window to stay inside the plan length', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    await POST(makeRequest({
      totalWeeks: 6, startDate: '2026-06-01', batchStartWeek: 4, batchWeekCount: 8, priorWorkouts: [],
    }))
    expect(mockCreatePlanStream).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 6, '2026-06-01', '', expect.anything(), null, null,
      { batchStartWeek: 4, batchWeekCount: 2, priorWorkouts: [] },
    )
  })

  it('reports the whole plan total regardless of which batch is requested', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({
      totalWeeks: 12, startDate: '2026-06-01', batchStartWeek: 8, batchWeekCount: 4, priorWorkouts: [],
    }))
    const events = await readNdjson(res)
    expect(mockCountPlannedWorkouts).toHaveBeenCalledWith(expect.anything(), 12, '2026-06-01')
    expect(events[0]).toEqual({ type: 'total', count: 10 })
  })
})
