/** @jest-environment node */
import { backfillActivityMetrics } from '@/lib/intervals/enrich'
import { METRICS_VERSION } from '@/lib/claude/activity-metrics'

function makeClient(opts: { throwOn?: string } = {}) {
  return {
    getActivity: jest.fn(async (id: string) => {
      if (opts.throwOn === id) throw new Error('ICU 500')
      return {
        id, start_date_local: '2026-05-20T07:00:00', type: 'Ride', moving_time: 3600,
        name: 'Ride', average_watts: 200, max_watts: 500, weighted_average_watts: 210,
        average_heartrate: 140, training_load: 80, rolling_ftp: 250, distance: 30000,
        total_elevation_gain: 300, left_right_balance: 50,
      }
    }),
    getPowerCurve: jest.fn(async () => [
      { secs: 300, watts: 312 }, { secs: 1200, watts: 264 },
    ]),
    getActivityIntervals: jest.fn(async () => []),
    getActivityStreams: jest.fn(async () => ({
      time: [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600],
      distance: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      latlng: null,
      power: Array.from({ length: 11 }, () => 200),
      hr: [150, 150, 150, 150, 150, 165, 165, 165, 165, 165, 165],
      altitude: null,
      cadence: [90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90],
      velocity: null,
    })),
    getRideLthr: jest.fn(async () => 160),
  }
}

// Minimal chainable Supabase stub. The workouts read terminates on .order() (it
// resolves the candidate rows); the user_profile read terminates on .maybeSingle().
function makeSupabase(rows: Array<{ id: string; icu_activity_id: string; steps: unknown; activity_metrics?: unknown; date?: string }>, updateSpy: jest.Mock, gteSpy?: jest.Mock, bestRecordsUpsertSpy?: jest.Mock) {
  const query: Record<string, unknown> = {}
  const self = () => query
  Object.assign(query, {
    select: self, eq: self, in: self, not: self,
    gte: (col: string, val: unknown) => { gteSpy?.(col, val); return query },
    order: () => Promise.resolve({ data: rows, error: null }),
    maybeSingle: () => Promise.resolve({ data: { current_ftp: 200 }, error: null }),
  })
  return {
    from: (table: string) => {
      if (table === 'workouts') {
        return {
          ...query,
          update: (patch: unknown) => ({ eq: (_c: string, id: string) => { updateSpy(id, patch); return Promise.resolve({ error: null }) } }),
        }
      }
      if (table === 'best_records') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }) }),
          upsert: (upsertRows: unknown[], opts: unknown) => { bestRecordsUpsertSpy?.(upsertRows, opts); return Promise.resolve({ error: null }) },
        }
      }
      return query // user_profile → maybeSingle resolves { current_ftp: 200 }
    },
  }
}

beforeEach(() => jest.clearAllMocks())

describe('backfillActivityMetrics', () => {
  it('enriches each missing ride and writes activity_metrics', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase(
      [{ id: 'w1', icu_activity_id: 'a1', steps: null }, { id: 'w2', icu_activity_id: 'a2', steps: null }],
      updateSpy,
    )
    const client = makeClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillActivityMetrics(supabase as any, client as any, 'u1')

    expect(result.enriched).toBe(2)
    expect(client.getActivity).toHaveBeenCalledTimes(2)
    expect(updateSpy).toHaveBeenCalledTimes(2)
    const [, patch] = updateSpy.mock.calls[0]
    expect(patch.activity_metrics.np).toBe(210)
    expect(patch.activity_metrics.elevation_m).toBe(300)
    // best_efforts comes from the day-scoped power curve
    expect(patch.activity_metrics.best_efforts).toEqual([
      { secs: 300, watts: 312 }, { secs: 1200, watts: 264 },
    ])
    expect(client.getPowerCurve).toHaveBeenCalledWith('2026-05-20', '2026-05-20')
    expect(patch.activity_metrics.decoupling_pct).toBeCloseTo(9.1, 1)
    expect(patch.activity_metrics.time_in_zone).not.toBeNull()
  })

  it('skips a ride whose enrichment throws, without aborting the rest', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase(
      [{ id: 'w1', icu_activity_id: 'a1', steps: null }, { id: 'w2', icu_activity_id: 'a2', steps: null }],
      updateSpy,
    )
    const client = makeClient({ throwOn: 'a1' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillActivityMetrics(supabase as any, client as any, 'u1')

    expect(result.enriched).toBe(1)
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.mock.calls[0][0]).toBe('w2')
  })

  it('computes distributions and threads the fetched LTHR', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase([{ id: 'w1', icu_activity_id: 'a1', steps: null }], updateSpy)
    const client = makeClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await backfillActivityMetrics(supabase as any, client as any, 'u1')

    const [, patch] = updateSpy.mock.calls[0]
    const dist = patch.activity_metrics.distributions
    expect(dist.power).toEqual([{ edge: 100, secs: 600 }]) // 200W @ FTP 200
    expect(dist.cadence).toEqual([{ edge: 90, secs: 600 }])
    expect(dist.hr_lthr).toBe(160)
    expect(client.getRideLthr).toHaveBeenCalledTimes(1)
  })

  it('enriches rows lacking distributions or below the current metrics version', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase(
      [
        { id: 'done', icu_activity_id: 'a1', steps: null, activity_metrics: { distributions: { power: [{ edge: 100, secs: 600 }] }, metrics_version: METRICS_VERSION } },
        { id: 'needs', icu_activity_id: 'a2', steps: null, activity_metrics: null },
        { id: 'old', icu_activity_id: 'a3', steps: null, activity_metrics: { np: 200 } }, // pre-feature: no distributions key
        { id: 'stale', icu_activity_id: 'a4', steps: null, activity_metrics: { distributions: { power: null }, metrics_version: 1 } }, // older version → refresh
      ],
      updateSpy,
    )
    const client = makeClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await backfillActivityMetrics(supabase as any, client as any, 'u1')

    // 'done' is current → skipped; 'needs'/'old' lack distributions; 'stale' is an
    // older metrics version → all three (re)enriched.
    expect(result.enriched).toBe(3)
    expect(updateSpy.mock.calls.map(c => c[0])).toEqual(['needs', 'old', 'stale'])
  })

  it('scopes to the last 90 days on a routine run', async () => {
    const gteSpy = jest.fn()
    const supabase = makeSupabase([], jest.fn(), gteSpy)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await backfillActivityMetrics(supabase as any, makeClient() as any, 'u1')
    expect(gteSpy).toHaveBeenCalledWith('date', expect.any(String))
  })

  it('drops the date filter on a deep (allTime) run', async () => {
    const gteSpy = jest.fn()
    const supabase = makeSupabase([], jest.fn(), gteSpy)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await backfillActivityMetrics(supabase as any, makeClient() as any, 'u1', { allTime: true })
    expect(gteSpy).not.toHaveBeenCalled()
  })

  it('fetches a 90-day power curve anchored on the ride\'s own date, not today', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase([{ id: 'w1', icu_activity_id: 'a1', steps: null }], updateSpy)
    const client = makeClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await backfillActivityMetrics(supabase as any, client as any, 'u1')

    // a1's start_date_local (from makeClient's getActivity mock) is 2026-05-20;
    // 90 days before that is 2026-02-19, independent of the current wall-clock date.
    expect(client.getPowerCurve).toHaveBeenCalledWith('2026-02-19', '2026-05-20')
  })

  it('writes an empty distributions object (not null) when the ride has no streams', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase([{ id: 'w1', icu_activity_id: 'a1', steps: null }], updateSpy)
    const client = makeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.getActivityStreams = jest.fn(async () => null) as any // ride with no stream data

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await backfillActivityMetrics(supabase as any, client as any, 'u1')

    const [, patch] = updateSpy.mock.calls[0]
    expect(patch.activity_metrics.distributions).not.toBeNull()
    expect(patch.activity_metrics.distributions).toMatchObject({
      power: null, cadence: null, coasting_secs: null, hr: null, hr_lthr: null,
    })
  })

  it('merges each successfully-enriched ride into best_records (all-time and its year)', async () => {
    const updateSpy = jest.fn()
    const bestRecordsUpsertSpy = jest.fn()
    const supabase = makeSupabase(
      [{ id: 'w1', icu_activity_id: 'a1', steps: null, date: '2026-05-20' }],
      updateSpy, undefined, bestRecordsUpsertSpy,
    )
    const client = makeClient()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await backfillActivityMetrics(supabase as any, client as any, 'u1')

    expect(bestRecordsUpsertSpy).toHaveBeenCalled()
    const rows = bestRecordsUpsertSpy.mock.calls.flatMap(([r]) => r as Array<{ period: string; is_indoor: boolean }>)
    expect(rows.map(r => r.period)).toEqual(expect.arrayContaining(['all', '2026']))
    expect(rows.every(r => r.is_indoor === false)).toBe(true)
  })

  it('threads is_indoor through to the best_records rows for an indoor/virtual ride', async () => {
    const updateSpy = jest.fn()
    const bestRecordsUpsertSpy = jest.fn()
    const supabase = makeSupabase(
      [{ id: 'w1', icu_activity_id: 'a1', steps: null, date: '2026-05-20' }],
      updateSpy, undefined, bestRecordsUpsertSpy,
    )
    const client = makeClient()
    client.getActivity = jest.fn(async (id: string) => ({
      id, start_date_local: '2026-05-20T07:00:00', type: 'VirtualRide', moving_time: 3600,
      name: 'Zwift Ride', average_watts: 200, max_watts: 500, weighted_average_watts: 210,
      average_heartrate: 140, training_load: 80, rolling_ftp: 250, distance: 30000,
      total_elevation_gain: 300, left_right_balance: 50,
    }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await backfillActivityMetrics(supabase as any, client as any, 'u1')

    const rows = bestRecordsUpsertSpy.mock.calls.flatMap(([r]) => r as Array<{ is_indoor: boolean }>)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.is_indoor === true)).toBe(true)
  })
})
