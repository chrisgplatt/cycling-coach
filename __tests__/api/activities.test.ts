/** @jest-environment node */
import { GET } from '@/app/api/activities/route'

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

function makeActivity(id: string, date = '2026-01-01T08:00:00') {
  return {
    id, name: `Ride ${id}`, type: 'Ride', moving_time: 3600,
    start_date_local: date, distance: 40000, total_elevation_gain: 400,
    average_watts: null, max_watts: null, weighted_average_watts: null,
    average_heartrate: null, training_load: null, rolling_ftp: null,
    left_right_balance: null,
  }
}

function makeRequest(page?: number) {
  return new Request(`http://localhost/api/activities${page ? `?page=${page}` : ''}`)
}

const PROFILE = { intervals_icu_athlete_id: 'ath1', intervals_icu_api_key: 'key1' }

// Build 35 activities with descending dates (a1 most recent)
const THIRTY_FIVE = Array.from({ length: 35 }, (_, i) => {
  const d = new Date('2026-06-01')
  d.setDate(d.getDate() - i)
  return makeActivity(`a${i + 1}`, d.toISOString())
})

describe('GET /api/activities', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(null, null))
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 400 when intervals.icu not configured', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ id: 'u1' }, { intervals_icu_athlete_id: null, intervals_icu_api_key: null })
    )
    const res = await GET(makeRequest())
    expect(res.status).toBe(400)
  })

  it('returns first 30 activities sorted descending, hasMore true', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ id: 'u1' }, PROFILE))
    mockGetActivities.mockResolvedValue(THIRTY_FIVE)
    const res = await GET(makeRequest(1))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.activities).toHaveLength(30)
    expect(body.activities[0].id).toBe('a1')
    expect(body.hasMore).toBe(true)
    expect(body.total).toBe(35)
  })

  it('returns remaining 5 on page 2, hasMore false', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ id: 'u1' }, PROFILE))
    mockGetActivities.mockResolvedValue(THIRTY_FIVE)
    const res = await GET(makeRequest(2))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.activities).toHaveLength(5)
    expect(body.hasMore).toBe(false)
  })

  it('returns 502 when intervals.icu throws', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ id: 'u1' }, PROFILE))
    mockGetActivities.mockRejectedValue(new Error('ICU down'))
    const res = await GET(makeRequest())
    expect(res.status).toBe(502)
  })
})
