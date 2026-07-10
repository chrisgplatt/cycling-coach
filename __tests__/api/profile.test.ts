/** @jest-environment node */
import { PATCH } from '@/app/api/profile/route'

const mockUpdateRideFTP = jest.fn()
const mockUpdateAthleteWeight = jest.fn()
const mockUpdateRideMaxHr = jest.fn()

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    updateRideFTP: mockUpdateRideFTP,
    updateAthleteWeight: mockUpdateAthleteWeight,
    updateRideMaxHr: mockUpdateRideMaxHr,
  })),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

const icuProfile = { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k' }

// All test bodies below always include `id`, so the route always takes the
// `if (id)` branch for the update — the only `.select()` call that ever
// fires is the later intervals.icu-credentials lookup.
function makeSupabase({
  profileRow = icuProfile as unknown,
  updateSpy = jest.fn(async (_fields: unknown) => ({ error: null })),
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      update: (fields: unknown) => ({ eq: () => updateSpy(fields) }),
      select: () => ({ maybeSingle: async () => ({ data: profileRow }) }),
    }),
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/profile', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUpdateRideFTP.mockResolvedValue(undefined)
  mockUpdateAthleteWeight.mockResolvedValue(undefined)
  mockUpdateRideMaxHr.mockResolvedValue(undefined)
})

describe('PATCH /api/profile — intervals.icu sync', () => {
  it('pushes max_hr_manual to intervals.icu via updateRideMaxHr when it changes', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ profileRow: icuProfile }))
    const res = await PATCH(makeRequest({ id: 'p1', max_hr_manual: 188 }))
    expect(res.status).toBe(200)
    expect(mockUpdateRideMaxHr).toHaveBeenCalledWith(188)
  })

  it('does not push to intervals.icu when max_hr_manual is cleared to null', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ profileRow: icuProfile }))
    await PATCH(makeRequest({ id: 'p1', max_hr_manual: null }))
    expect(mockUpdateRideMaxHr).not.toHaveBeenCalled()
  })

  it('still pushes current_ftp and weight_kg alongside max_hr_manual', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ profileRow: icuProfile }))
    await PATCH(makeRequest({ id: 'p1', current_ftp: 250, weight_kg: 72, max_hr_manual: 188 }))
    expect(mockUpdateRideFTP).toHaveBeenCalledWith(250)
    expect(mockUpdateAthleteWeight).toHaveBeenCalledWith(72)
    expect(mockUpdateRideMaxHr).toHaveBeenCalledWith(188)
  })

  it('does not call intervals.icu at all when intervals.icu credentials are missing', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ profileRow: { intervals_icu_athlete_id: null, intervals_icu_api_key: null } })
    )
    await PATCH(makeRequest({ id: 'p1', max_hr_manual: 188 }))
    expect(mockUpdateRideMaxHr).not.toHaveBeenCalled()
  })

  it('does not touch intervals.icu when none of ftp/weight/max_hr are in the update', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ profileRow: icuProfile }))
    await PATCH(makeRequest({ id: 'p1', full_name: 'Chris' }))
    expect(mockUpdateRideFTP).not.toHaveBeenCalled()
    expect(mockUpdateAthleteWeight).not.toHaveBeenCalled()
    expect(mockUpdateRideMaxHr).not.toHaveBeenCalled()
  })
})
