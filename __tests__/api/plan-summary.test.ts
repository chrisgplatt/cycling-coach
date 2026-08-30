/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

const mockGetWellness = jest.fn()
const mockGetActivities = jest.fn()
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getWellness: mockGetWellness,
    getActivities: mockGetActivities,
  })),
}))

import { GET } from '@/app/api/plan/summary/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { ICUWellness } from '@/types'

function wellness(over: Partial<ICUWellness>): ICUWellness {
  return {
    id: '2026-01-01', ctl: null, atl: null, form: null, hrv: null, resting_hr: null,
    sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null,
    stress_high: null, garmin_training_load: null, sleep_score: null, ...over,
  }
}

function makeSupabase({
  archivedPlans = [] as unknown[],
  archivedPlansError = null as unknown,
  activePlanRow = null as unknown,
  activePlanError = null as unknown,
  profile = null as unknown,
  predictions = [] as unknown[],
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'training_plans') {
        return {
          select: () => ({
            eq: (col1: string) => {
              if (col1 === 'user_id') {
                return { eq: async () => ({ data: archivedPlans, error: archivedPlansError }) }
              }
              return { order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: activePlanRow, error: activePlanError }) }) }) }
            },
          }),
        }
      }
      if (table === 'user_profile') {
        return { select: () => ({ maybeSingle: async () => ({ data: profile }) }) }
      }
      if (table === 'ftp_predictions') {
        return { select: () => ({ eq: async () => ({ data: predictions }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

function makeRequest(months?: string) {
  return new Request(`http://localhost/api/plan/summary${months ? `?months=${months}` : ''}`) as never
}

describe('GET /api/plan/summary', () => {
  // Pinned so every test's hardcoded fixture dates clip against the same, known
  // "today" — without this, window-clipping assertions would silently depend on
  // whatever real date the test happens to run on.
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers().setSystemTime(new Date('2026-08-30T12:00:00Z'))
  })
  afterEach(() => jest.useRealTimers())

  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    })
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('defaults to a 12-month window when months is missing or invalid', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res1 = await GET(makeRequest())
    expect((await res1.json()).windowMonths).toBe(12)

    const res2 = await GET(makeRequest('99'))
    expect((await res2.json()).windowMonths).toBe(12)
  })

  it('uses a 6-month window when months=6', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await GET(makeRequest('6'))
    expect((await res.json()).windowMonths).toBe(6)
  })

  it("combines archived-plan weeks, the active plan's live progress, and confirmed FTP predictions into one summary", async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({
      archivedPlans: [{
        archive_summary: {
          closedAt: '2026-07-31',
          weeks: [{ weekIndex: 0, weekStart: '2026-01-01', plannedSessions: 2, completedSessions: 2, plannedTss: 100, actualTss: 100, hours: 3 }],
        },
      }],
      activePlanRow: { id: 'p2', created_at: '2026-07-01T00:00:00Z', plan_weeks: 4, workouts: [] },
      profile: { current_ftp: 250, intervals_icu_athlete_id: 'ath1', intervals_icu_api_key: 'key1' },
      predictions: [{ predicted_ftp: 230, created_at: '2025-01-01T00:00:00Z' }],
    }))
    mockGetWellness.mockResolvedValue([wellness({ id: '2025-09-01', ctl: 40 }), wellness({ id: '2026-08-25', ctl: 52 })])
    mockGetActivities.mockResolvedValue([])

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ridesCompleted).toBe(2)
    expect(body.hoursTrained).toBe(3)
    expect(body.weeksWithPlan).toBe(1)
    expect(body.ctlStart).toBe(40)
    expect(body.ctlEnd).toBe(52)
    expect(body.fitnessChange).toBe(12)
    expect(body.ftpStart).toBe(230)
    expect(body.ftpEnd).toBe(250)
    expect(body.ftpChange).toBe(20)
    expect(mockGetWellness).toHaveBeenCalledWith('2025-09-04', '2026-08-30')
    expect(mockGetActivities).toHaveBeenCalledWith('2026-07-01', '2026-08-30')
  })

  it('returns nulled CTL fields and skips intervals.icu calls when it is not configured', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({
      archivedPlans: [{ archive_summary: { closedAt: '2026-06-15', weeks: [{ weekIndex: 0, weekStart: '2026-06-01', plannedSessions: 1, completedSessions: 1, plannedTss: 50, actualTss: 50, hours: 1 }] } }],
      profile: { current_ftp: 250, intervals_icu_athlete_id: '', intervals_icu_api_key: '' },
    }))

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ridesCompleted).toBe(1)
    expect(body.ctlStart).toBeNull()
    expect(body.ctlEnd).toBeNull()
    expect(mockGetWellness).not.toHaveBeenCalled()
  })

  it('returns 500 when the archived-plans query fails, instead of silently rendering zeros', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({
      archivedPlansError: { message: 'db down' },
    }))
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  it('returns 500 when the active-plan query fails, instead of silently rendering zeros', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({
      activePlanError: { message: 'db down' },
    }))
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  it('degrades to nulled CTL fields (still 200) when intervals.icu throws', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({
      archivedPlans: [{ archive_summary: { closedAt: '2026-06-15', weeks: [{ weekIndex: 0, weekStart: '2026-06-01', plannedSessions: 1, completedSessions: 1, plannedTss: 50, actualTss: 50, hours: 1 }] } }],
      profile: { current_ftp: 250, intervals_icu_athlete_id: 'ath1', intervals_icu_api_key: 'key1' },
    }))
    mockGetWellness.mockRejectedValue(new Error('ICU down'))
    mockGetActivities.mockResolvedValue([])

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ridesCompleted).toBe(1)
    expect(body.ctlStart).toBeNull()
  })
})
