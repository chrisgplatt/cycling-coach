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
    getActivityPowerCurve: jest.fn(async () => []),
    getActivityIntervals: jest.fn(async () => []),
  }
}

// Minimal chainable Supabase stub: select/eq/in/gte/not/order/limit resolve to { data }.
function makeSupabase(rows: Array<{ id: string; icu_activity_id: string }>, updateSpy: jest.Mock) {
  const query: Record<string, unknown> = {}
  const self = () => query
  Object.assign(query, {
    select: self, eq: self, in: self, gte: self, not: self, order: self,
    limit: () => Promise.resolve({ data: rows, error: null }),
  })
  return {
    from: (table: string) => {
      if (table === 'workouts') {
        return {
          ...query,
          update: (patch: unknown) => ({ eq: (_c: string, id: string) => { updateSpy(id, patch); return Promise.resolve({ error: null }) } }),
        }
      }
      return query
    },
  }
}

beforeEach(() => jest.clearAllMocks())

describe('backfillActivityMetrics', () => {
  it('enriches each missing ride and writes activity_metrics', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase(
      [{ id: 'w1', icu_activity_id: 'a1' }, { id: 'w2', icu_activity_id: 'a2' }],
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
  })

  it('skips a ride whose enrichment throws, without aborting the rest', async () => {
    const updateSpy = jest.fn()
    const supabase = makeSupabase(
      [{ id: 'w1', icu_activity_id: 'a1' }, { id: 'w2', icu_activity_id: 'a2' }],
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
