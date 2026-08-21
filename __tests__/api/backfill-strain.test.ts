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

import { POST } from '@/app/api/admin/backfill-strain/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeRequest(body?: Record<string, unknown>) {
  return { json: async () => body ?? {} } as unknown as Parameters<typeof POST>[0]
}

const goodProfile = {
  intervals_icu_athlete_id: 'i1',
  intervals_icu_api_key: 'k',
  max_hr_manual: 190,
  observed_max_hr: null,
  date_of_birth: null,
}

function makeSupabase({
  profile = goodProfile as unknown,
  dailyWellnessRows = [] as Array<{ date: string; daily_trimp: number | null; trimp_ref: number | null; workout_strain: number | null }>,
  upsertSpy = jest.fn(),
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'user_profile') {
        return { select: () => ({ maybeSingle: async () => ({ data: profile }) }) }
      }
      if (table === 'garmin_wellness') {
        return { select: () => ({ gte: () => ({ lte: async () => ({ data: [] }) }) }) }
      }
      if (table === 'daily_wellness') {
        return {
          select: () => ({ eq: () => ({ gte: () => ({ lte: async () => ({ data: dailyWellnessRows }) }) }) }),
          upsert: (rows: unknown, opts: unknown) => { upsertSpy(rows, opts); return { error: null } },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/admin/backfill-strain', () => {
  it('returns 401 when unauthenticated', async () => {
    (createSupabaseServerClient as jest.Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    })
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 400 when intervals.icu is not configured', async () => {
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ profile: { ...goodProfile, intervals_icu_athlete_id: null } })
    )
    const res = await POST(makeRequest())
    expect(res.status).toBe(400)
  })

  it('skips a day that already has frozen values when force is not passed', async () => {
    mockGetWellness.mockResolvedValue([
      { id: '2026-06-10', ctl: null, atl: null, form: null, hrv: null, resting_hr: 50, sleep_secs: null },
    ])
    mockGetActivities.mockResolvedValue([])
    const upsertSpy = jest.fn()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({
      upsertSpy,
      dailyWellnessRows: [{ date: '2026-06-10', daily_trimp: 999, trimp_ref: 999, workout_strain: 16 }],
    }))

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(body.backfilled).toBe(0)
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('recomputes and overwrites every day when force is true, even ones already frozen', async () => {
    mockGetWellness.mockResolvedValue([
      { id: '2026-06-10', ctl: null, atl: null, form: null, hrv: null, resting_hr: 50, sleep_secs: null },
    ])
    // An easy 45-min walk: hrr = (100-50)/(190-50) ≈ 0.357 — well below max effort
    mockGetActivities.mockResolvedValue([
      { id: 'a1', start_date_local: '2026-06-10T08:00:00', type: 'Walk', moving_time: 2700, name: 'Walk', average_heartrate: 100, training_load: 20 },
    ])
    const upsertSpy = jest.fn()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({
      upsertSpy,
      // Stale frozen values computed under the old, too-steep strain curve
      dailyWellnessRows: [{ date: '2026-06-10', daily_trimp: 999, trimp_ref: 999, workout_strain: 16 }],
    }))

    const res = await POST(makeRequest({ force: true }))
    const body = await res.json()

    expect(body.backfilled).toBe(1)
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    const [rows, opts] = upsertSpy.mock.calls[0]
    expect(opts).toEqual({ onConflict: 'user_id,date' })
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe('2026-06-10')
    // Recomputed from the real activity data, not the stale frozen 999/999/16 —
    // a light 45-min walk should land well under the old formula's inflated score.
    expect(rows[0].daily_trimp).not.toBe(999)
    expect(rows[0].workout_strain).toBeLessThan(10)
  })
})
