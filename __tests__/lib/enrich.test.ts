/** @jest-environment node */
import { backfillActivityMetrics } from '@/lib/intervals/enrich'

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
      altitude: null, cadence: null, velocity: null,
    })),
  }
}

// Minimal chainable Supabase stub: select/eq/in/gte/not/is/order/limit resolve to { data }.
function makeSupabase(rows: Array<{ id: string; icu_activity_id: string; steps: unknown }>, updateSpy: jest.Mock) {
  const query: Record<string, unknown> = {}
  const self = () => query
  Object.assign(query, {
    select: self, eq: self, in: self, gte: self, not: self, is: self, order: self,
    limit: () => Promise.resolve({ data: rows, error: null }),
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
    const count = await backfillActivityMetrics(supabase as any, client as any, 'u1')

    expect(count).toBe(2)
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
    const count = await backfillActivityMetrics(supabase as any, client as any, 'u1')

    expect(count).toBe(1)
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.mock.calls[0][0]).toBe('w2')
  })
})
