/** @jest-environment node */
import { GET } from '@/app/api/stats/year/route'

const mockGetActivities = jest.fn()

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getActivities: mockGetActivities,
  })),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase(user: { id: string } | null, profile: unknown) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({ maybeSingle: async () => ({ data: profile }) }),
    }),
  }
}

function makeActivity(overrides: Partial<{
  start_date_local: string; type: string; distance: number | null;
  total_elevation_gain: number | null; moving_time: number;
}> = {}) {
  return {
    id: 'a1', name: 'Ride', type: 'Ride', moving_time: 3600,
    average_watts: null, max_watts: null, weighted_average_watts: null,
    average_heartrate: null, training_load: null, rolling_ftp: null,
    left_right_balance: null,
    start_date_local: '2026-01-15T08:00:00',
    distance: 50000,
    total_elevation_gain: 500,
    ...overrides,
  }
}

function makeRequest(year?: string) {
  return new Request(`http://localhost/api/stats/year${year ? `?year=${year}` : ''}`)
}

const PROFILE = { intervals_icu_athlete_id: 'ath1', intervals_icu_api_key: 'key1' }

describe('GET /api/stats/year', () => {
  const currentYear = new Date().getFullYear()

  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(null, null))
    const res = await GET(makeRequest(String(currentYear)))
    expect(res.status).toBe(401)
  })

  it('returns 400 when intervals.icu not configured', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ id: 'u1' }, { intervals_icu_athlete_id: null, intervals_icu_api_key: null })
    )
    const res = await GET(makeRequest(String(currentYear)))
    expect(res.status).toBe(400)
  })

  it('returns 400 for a future year', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ id: 'u1' }, PROFILE))
    const res = await GET(makeRequest(String(currentYear + 1)))
    expect(res.status).toBe(400)
  })

  it('returns 400 for a year older than 4 years ago', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ id: 'u1' }, PROFILE))
    const res = await GET(makeRequest(String(currentYear - 5)))
    expect(res.status).toBe(400)
  })

  it('computes totals and monthly breakdown from activities', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ id: 'u1' }, PROFILE))
    mockGetActivities.mockResolvedValue([
      makeActivity({ start_date_local: `${currentYear}-01-10T08:00:00`, distance: 50000, total_elevation_gain: 500, moving_time: 5400 }),
      makeActivity({ start_date_local: `${currentYear}-01-25T08:00:00`, distance: 40000, total_elevation_gain: 300, moving_time: 3600 }),
      makeActivity({ start_date_local: `${currentYear}-03-05T08:00:00`, distance: 60000, total_elevation_gain: 600, moving_time: 7200 }),
    ])
    const res = await GET(makeRequest(String(currentYear)))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.year).toBe(currentYear)
    expect(body.totalRides).toBe(3)
    expect(body.totalKm).toBeCloseTo(150, 0)
    expect(body.totalElevationM).toBe(1400)
    expect(body.totalMovingTimeSecs).toBe(16200)
    expect(body.monthly).toHaveLength(12)
    const jan = body.monthly.find((m: { month: number }) => m.month === 1)
    expect(jan.km).toBeCloseTo(90, 0)
    const mar = body.monthly.find((m: { month: number }) => m.month === 3)
    expect(mar.km).toBeCloseTo(60, 0)
    const feb = body.monthly.find((m: { month: number }) => m.month === 2)
    expect(feb.km).toBe(0)
  })

  it('returns 502 when intervals.icu throws', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ id: 'u1' }, PROFILE))
    mockGetActivities.mockRejectedValue(new Error('ICU down'))
    const res = await GET(makeRequest(String(currentYear)))
    expect(res.status).toBe(502)
  })

  it('defaults to current year when no year param is provided', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ id: 'u1' }, PROFILE))
    mockGetActivities.mockResolvedValue([])
    const res = await GET(new Request('http://localhost/api/stats/year'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.year).toBe(new Date().getFullYear())
    expect(body.totalRides).toBe(0)
    expect(body.monthly).toHaveLength(12)
  })
})
