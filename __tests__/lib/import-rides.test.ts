import { importUnplannedRides } from '@/lib/intervals/import-rides'
import type { ICUActivity } from '@/types'

function makeActivity(overrides: Partial<ICUActivity> = {}): ICUActivity {
  return {
    id: 'act1', start_date_local: '2026-07-06T08:00:00', type: 'Ride', moving_time: 3600,
    name: 'Evening Spin', average_watts: 150, max_watts: 300, weighted_average_watts: 160,
    average_heartrate: 140, training_load: 60, rolling_ftp: null, ftp: 245,
    distance: null, total_elevation_gain: null, left_right_balance: null,
    ...overrides,
  } as ICUActivity
}

function makeSupabase({
  existingActivityIds = [] as string[],
  predictions = [] as { created_at: string; predicted_ftp: number }[],
  insertSpy = jest.fn(),
} = {}) {
  return {
    from: (table: string) => {
      if (table === 'workouts') {
        return {
          select: () => ({ in: () => ({ data: existingActivityIds.map(id => ({ icu_activity_id: id })) }) }),
          insert: (rows: unknown[]) => { insertSpy(rows); return { data: null, error: null } },
        }
      }
      if (table === 'ftp_predictions') {
        return { select: () => ({ eq: () => ({ data: predictions }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('importUnplannedRides', () => {
  it('stamps ftp_at_completion directly from the activity ftp field', async () => {
    const insertSpy = jest.fn()
    const supabase = makeSupabase({ insertSpy })
    await importUnplannedRides(supabase as never, 'u1', [makeActivity({ ftp: 245 })])
    expect(insertSpy).toHaveBeenCalledWith([expect.objectContaining({ ftp_at_completion: 245 })])
  })

  it('falls back to the confirmed ftp_predictions timeline when the activity has no ftp', async () => {
    const insertSpy = jest.fn()
    const supabase = makeSupabase({
      insertSpy,
      predictions: [{ created_at: '2026-07-01T00:00:00Z', predicted_ftp: 230 }],
    })
    await importUnplannedRides(supabase as never, 'u1', [makeActivity({ ftp: null, start_date_local: '2026-07-06T08:00:00' })])
    expect(insertSpy).toHaveBeenCalledWith([expect.objectContaining({ ftp_at_completion: 230 })])
  })

  it('leaves ftp_at_completion null when neither the activity nor any confirmed prediction has a value', async () => {
    const insertSpy = jest.fn()
    const supabase = makeSupabase({ insertSpy })
    await importUnplannedRides(supabase as never, 'u1', [makeActivity({ ftp: null })])
    expect(insertSpy).toHaveBeenCalledWith([expect.objectContaining({ ftp_at_completion: null })])
  })

  it('skips rides that already have a workout row', async () => {
    const insertSpy = jest.fn()
    const supabase = makeSupabase({ insertSpy, existingActivityIds: ['act1'] })
    const count = await importUnplannedRides(supabase as never, 'u1', [makeActivity({ id: 'act1' })])
    expect(count).toBe(0)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('ignores non-ride activities', async () => {
    const insertSpy = jest.fn()
    const supabase = makeSupabase({ insertSpy })
    const count = await importUnplannedRides(supabase as never, 'u1', [makeActivity({ type: 'Run' })])
    expect(count).toBe(0)
    expect(insertSpy).not.toHaveBeenCalled()
  })
})
