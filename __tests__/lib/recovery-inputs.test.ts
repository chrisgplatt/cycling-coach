/** @jest-environment node */
import { fetchRecoveryInputsForRange } from '@/lib/recovery-inputs'
import type { IntervalsClient } from '@/lib/intervals/client'
import type { ICUWellness } from '@/types'

function wellnessRow(id: string, overrides: Partial<ICUWellness> = {}): ICUWellness {
  return {
    id, ctl: 60, atl: 55, form: 5, hrv: 45, resting_hr: 50, sleep_secs: null,
    body_battery_low: null, body_battery_high: 70, stress_avg: null, stress_high: null,
    garmin_training_load: null, sleep_score: null,
    ...overrides,
  }
}

function makeSupabase(garminRows: Array<{ date: string; garmin_hrv_overnight: number | null; garmin_sleep_deep_secs?: number | null }>, dailyWellnessRows: Array<{ date: string; energy: number | null; leg_freshness: number | null }>) {
  const from = jest.fn((table: string) => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
    }
    if (table === 'garmin_wellness') {
      return { ...chain, lte: jest.fn().mockResolvedValue({ data: garminRows }) }
    }
    return { ...chain, lte: jest.fn().mockResolvedValue({ data: dailyWellnessRows }) }
  })
  return { from }
}

describe('fetchRecoveryInputsForRange', () => {
  test('builds RecoveryInputs for every ICU wellness date in the visible range', async () => {
    const icuClient = {
      getWellness: jest.fn().mockResolvedValue([
        wellnessRow('2026-07-17'),
        wellnessRow('2026-07-18'),
        wellnessRow('2026-07-19'),
      ]),
    } as unknown as IntervalsClient
    const sb = makeSupabase([], [])
    const result = await fetchRecoveryInputsForRange(sb as any, 'u1', icuClient, { from: '2026-07-18', to: '2026-07-19' })
    expect(result.map(r => r.date)).toEqual(['2026-07-18', '2026-07-19'])
    // 2026-07-17 is outside [from, to] and must not appear, even though ICU returned it
    // (it exists only as trailing lookback context for the HRV baseline).
  })

  test('uses body_battery_high and form directly from the ICU wellness row', async () => {
    const icuClient = {
      getWellness: jest.fn().mockResolvedValue([wellnessRow('2026-07-19', { body_battery_high: 82, form: -3 })]),
    } as unknown as IntervalsClient
    const sb = makeSupabase([], [])
    const result = await fetchRecoveryInputsForRange(sb as any, 'u1', icuClient, { from: '2026-07-19', to: '2026-07-19' })
    expect(result[0].inputs.body_battery_high).toBe(82)
    expect(result[0].inputs.tsb).toBe(-3)
  })

  test('falls back to ctl-atl for tsb when form is null', async () => {
    const icuClient = {
      getWellness: jest.fn().mockResolvedValue([wellnessRow('2026-07-19', { form: null, ctl: 60, atl: 55 })]),
    } as unknown as IntervalsClient
    const sb = makeSupabase([], [])
    const result = await fetchRecoveryInputsForRange(sb as any, 'u1', icuClient, { from: '2026-07-19', to: '2026-07-19' })
    expect(result[0].inputs.tsb).toBe(5)
  })

  test('pulls energy/leg_freshness from daily_wellness for the matching date', async () => {
    const icuClient = {
      getWellness: jest.fn().mockResolvedValue([wellnessRow('2026-07-19')]),
    } as unknown as IntervalsClient
    const sb = makeSupabase([], [{ date: '2026-07-19', energy: 4, leg_freshness: 3 }])
    const result = await fetchRecoveryInputsForRange(sb as any, 'u1', icuClient, { from: '2026-07-19', to: '2026-07-19' })
    expect(result[0].inputs.energy).toBe(4)
    expect(result[0].inputs.leg_freshness).toBe(3)
  })

  test('date with no daily_wellness row gets null energy/leg_freshness, not a crash', async () => {
    const icuClient = {
      getWellness: jest.fn().mockResolvedValue([wellnessRow('2026-07-19')]),
    } as unknown as IntervalsClient
    const sb = makeSupabase([], [])
    const result = await fetchRecoveryInputsForRange(sb as any, 'u1', icuClient, { from: '2026-07-19', to: '2026-07-19' })
    expect(result[0].inputs.energy).toBeNull()
    expect(result[0].inputs.leg_freshness).toBeNull()
  })
})
