/** @jest-environment node */
import { runDeepHistoryBestsBatch } from '@/lib/intervals/deep-history-bests'
import type { ICUActivity } from '@/types'

function makeActivity(overrides: Partial<ICUActivity> = {}): ICUActivity {
  return {
    id: 'a1', start_date_local: '2020-06-15T08:00:00', type: 'Ride', moving_time: 3600,
    name: 'Old ride', average_watts: 200, max_watts: 400, weighted_average_watts: 210,
    average_heartrate: 140, training_load: 60, rolling_ftp: null, distance: 30000,
    total_elevation_gain: 300, left_right_balance: null,
    ...overrides,
  }
}

function makeClient(activities: ICUActivity[]) {
  return {
    getActivities: jest.fn().mockResolvedValue(activities),
    getPowerCurve: jest.fn().mockResolvedValue(null),
    getActivityStreams: jest.fn().mockResolvedValue(null),
  }
}

function makeSupabase({ existingRows = [] as unknown[], upsertSpy = jest.fn() } = {}) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ eq: async () => ({ data: existingRows, error: null }) }) }),
      upsert: (rows: unknown[], opts: unknown) => { upsertSpy(rows, opts); return Promise.resolve({ error: null }) },
    }),
  }
}

describe('runDeepHistoryBestsBatch', () => {
  it('returns reachedPossibleStart when no activities are found older than the cursor', async () => {
    const client = makeClient([])
    const result = await runDeepHistoryBestsBatch(makeSupabase() as never, client as never, 'u1', '2020-01-01')
    expect(result).toEqual({ fetched: 0, processed: 0, newCursor: null, reachedPossibleStart: true })
  })

  it('processes up to 25 rides, oldest-in-batch becomes the new cursor', async () => {
    const activities = Array.from({ length: 30 }, (_, i) =>
      // max_speed gives extractActivityMetrics something real to produce a candidate
      // from (curve/streams are still null) so the merge/upsert path actually fires.
      makeActivity({ id: `a${i}`, start_date_local: `2019-12-${String(31 - i).padStart(2, '0')}T08:00:00`, max_speed: 15 }),
    )
    const upsertSpy = jest.fn()
    const client = makeClient(activities)
    const result = await runDeepHistoryBestsBatch(makeSupabase({ upsertSpy }) as never, client as never, 'u1', '2020-01-01')
    expect(result.fetched).toBe(30)
    expect(result.processed).toBe(25)
    expect(result.newCursor).toBe('2019-12-07')  // 25th-oldest processed date in the batch
    expect(result.reachedPossibleStart).toBe(false)
    expect(upsertSpy).toHaveBeenCalled()
  })

  it('filters out non-ride activity types before batching', async () => {
    const activities = [
      makeActivity({ id: 'run1', type: 'Run', start_date_local: '2019-12-30T08:00:00' }),
      makeActivity({ id: 'ride1', type: 'Ride', start_date_local: '2019-12-29T08:00:00' }),
    ]
    const client = makeClient(activities)
    const result = await runDeepHistoryBestsBatch(makeSupabase() as never, client as never, 'u1', '2020-01-01')
    expect(result.fetched).toBe(1)
    expect(result.processed).toBe(1)
  })

  it('does not throw when a single ride\'s enrichment fails, and still advances the cursor past it', async () => {
    const activities = [makeActivity({ id: 'bad1', start_date_local: '2019-12-30T08:00:00' })]
    const client = {
      getActivities: jest.fn().mockResolvedValue(activities),
      getPowerCurve: jest.fn().mockRejectedValue(new Error('network error')),
      getActivityStreams: jest.fn().mockRejectedValue(new Error('network error')),
    }
    const result = await runDeepHistoryBestsBatch(makeSupabase() as never, client as never, 'u1', '2020-01-01')
    expect(result.processed).toBe(1)
    expect(result.newCursor).toBe('2019-12-30')
  })
})
