/** @jest-environment node */
import { GET } from '@/app/api/rides/[workoutId]/streams/route'

function makeStreams() {
  return {
    time: Array.from({ length: 1000 }, (_, i) => i),
    distance: Array.from({ length: 1000 }, (_, i) => i),
    latlng: null as [number, number][] | null,
    power: Array.from({ length: 1000 }, () => 200),
    hr: null, altitude: null, cadence: null, velocity: null,
  }
}

const mockGetActivityStreams = jest.fn()
const mockGetActivityMap = jest.fn()
const mockGetActivityIntervals = jest.fn()

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getActivityStreams: mockGetActivityStreams,
    getActivityMap: mockGetActivityMap,
    getActivityIntervals: mockGetActivityIntervals,
  })),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

function supabaseStub(workoutRow: unknown, profileRow: unknown) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: table === 'workouts' ? workoutRow : profileRow }) }),
        maybeSingle: async () => ({ data: profileRow }),
      }),
    }),
  }
}

const ctx = (id: string) => ({ params: Promise.resolve({ workoutId: id }) })
const goodProfile = { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k' }

beforeEach(() => {
  jest.clearAllMocks()
  mockGetActivityStreams.mockResolvedValue(makeStreams())
  mockGetActivityMap.mockResolvedValue({ latlngs: null })
  mockGetActivityIntervals.mockResolvedValue([
    { label: 'Lap 1', duration_secs: 600, avg_watts: 200, avg_hr: 140 },
  ])
})

describe('GET /api/rides/[workoutId]/streams', () => {
  it('returns downsampled streams (<=600 points)', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseStub({ icu_activity_id: 'a1' }, goodProfile),
    )
    const res = await GET({} as Request as never, ctx('w1') as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.streams.time.length).toBeLessThanOrEqual(600)
    expect(body.streams.power.length).toBe(body.streams.time.length)
  })

  it('injects the aligned route from /map into latlng', async () => {
    const latlngs = Array.from({ length: 1000 }, (_, i) => [53.5 + i / 1e5, -2.4] as [number, number])
    mockGetActivityMap.mockResolvedValue({ latlngs })
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseStub({ icu_activity_id: 'a1' }, goodProfile),
    )
    const res = await GET({} as Request as never, ctx('w1') as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.streams.latlng).not.toBeNull()
    expect(body.streams.latlng.length).toBe(body.streams.time.length)
    expect(body.streams.latlng[0]).toEqual([53.5, -2.4])
  })

  it('leaves latlng null when /map route length does not match the streams', async () => {
    mockGetActivityMap.mockResolvedValue({ latlngs: [[53.5, -2.4]] }) // length 1, streams length 1000
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseStub({ icu_activity_id: 'a1' }, goodProfile),
    )
    const res = await GET({} as Request as never, ctx('w1') as never)
    const body = await res.json()
    expect(body.streams.latlng).toBeNull()
  })

  it('404s when the workout has no activity', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseStub({ icu_activity_id: null }, goodProfile),
    )
    const res = await GET({} as Request as never, ctx('w1') as never)
    expect(res.status).toBe(404)
  })

  it('returns detected laps as intervals', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseStub({ icu_activity_id: 'a1' }, goodProfile),
    )
    const res = await GET({} as Request as never, ctx('w1') as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.intervals).toHaveLength(1)
    expect(body.intervals[0].avg_watts).toBe(200)
  })
})
