/** @jest-environment node */
import { fetchHrvStatusBestSource } from '@/lib/hrv/server'
import { IntervalsClient } from '@/lib/intervals/client'

// Minimal Supabase mock
function makeSupabase(rows: { date: string; garmin_hrv_overnight: number | null }[]) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: rows }),
  }
  return { from: jest.fn().mockReturnValue(chain) }
}

// 60 rows with HRV value v
function garminRows(n: number, today: string, v: number) {
  const endMs = new Date(today + 'T00:00:00Z').getTime()
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(endMs - (n - 1 - i) * 864e5).toISOString().split('T')[0],
    garmin_hrv_overnight: v,
  }))
}

describe('fetchHrvStatusBestSource', () => {
  it('returns Garmin result when sufficient (≥14 readings)', async () => {
    const sb = makeSupabase(garminRows(60, '2026-06-20', 55))
    const result = await fetchHrvStatusBestSource(
      '2026-06-20',
      { supabase: sb as any, userId: 'u1' },
      null,
    )
    expect(result.sufficient).toBe(true)
    expect(result.label).toBe('balanced')
  })

  it('falls back to ICU when Garmin has < 14 readings', async () => {
    const sb = makeSupabase(garminRows(5, '2026-06-20', 55))
    const icuClient = { getWellness: jest.fn().mockResolvedValue(garminRows(60, '2026-06-20', 55).map(r => ({
      id: r.date, ctl: null, atl: null, form: null, hrv: 55, resting_hr: null,
      sleep_secs: null, body_battery_low: null, body_battery_high: null,
      stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null,
    }))) } as unknown as IntervalsClient
    const result = await fetchHrvStatusBestSource(
      '2026-06-20',
      { supabase: sb as any, userId: 'u1' },
      icuClient,
    )
    expect(result.sufficient).toBe(true)
    expect(result.label).toBe('balanced')
  })

  it('uses ICU only when garminParams is null', async () => {
    const icuClient = { getWellness: jest.fn().mockResolvedValue(garminRows(60, '2026-06-20', 55).map(r => ({
      id: r.date, ctl: null, atl: null, form: null, hrv: 50, resting_hr: null,
      sleep_secs: null, body_battery_low: null, body_battery_high: null,
      stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null,
    }))) } as unknown as IntervalsClient
    const result = await fetchHrvStatusBestSource('2026-06-20', null, icuClient)
    expect(result.sufficient).toBe(true)
  })

  it('returns no_data when both sources absent', async () => {
    const result = await fetchHrvStatusBestSource('2026-06-20', null, null)
    expect(result.label).toBe('no_data')
    expect(result.sufficient).toBe(false)
  })
})
