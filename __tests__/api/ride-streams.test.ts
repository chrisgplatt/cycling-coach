/** @jest-environment node */
import { GET } from '@/app/api/rides/[workoutId]/streams/route'

const streams = {
  time: Array.from({ length: 1000 }, (_, i) => i),
  distance: Array.from({ length: 1000 }, (_, i) => i),
  latlng: null, power: Array.from({ length: 1000 }, () => 200),
  hr: null, altitude: null, cadence: null, velocity: null,
}

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getActivityStreams: jest.fn(async () => streams),
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

beforeEach(() => jest.clearAllMocks())

describe('GET /api/rides/[workoutId]/streams', () => {
  it('returns downsampled streams (<=600 points)', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseStub({ icu_activity_id: 'a1' }, { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k' }),
    )
    const res = await GET({} as Request as never, ctx('w1') as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.streams.time.length).toBeLessThanOrEqual(600)
    expect(body.streams.power.length).toBe(body.streams.time.length)
  })

  it('404s when the workout has no activity', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseStub({ icu_activity_id: null }, { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k' }),
    )
    const res = await GET({} as Request as never, ctx('w1') as never)
    expect(res.status).toBe(404)
  })
})
