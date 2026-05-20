import { findNearestPower, computeLeftRightBalance, groupCrossTraining } from '@/lib/stats-helpers'
import type { ICUActivity, ICUPowerCurvePoint } from '@/types'

describe('findNearestPower', () => {
  it('returns null for empty curve', () => {
    expect(findNearestPower([], 300)).toBeNull()
  })

  it('returns watts for exact match', () => {
    const curve: ICUPowerCurvePoint[] = [{ secs: 300, watts: 320 }]
    expect(findNearestPower(curve, 300)).toBe(320)
  })

  it('returns watts for nearest point within 30s', () => {
    const curve: ICUPowerCurvePoint[] = [{ secs: 295, watts: 315 }]
    expect(findNearestPower(curve, 300)).toBe(315)
  })

  it('returns null when nearest point is more than 30s away', () => {
    const curve: ICUPowerCurvePoint[] = [{ secs: 260, watts: 350 }]
    expect(findNearestPower(curve, 300)).toBeNull()
  })

  it('picks the closest of multiple candidates', () => {
    const curve: ICUPowerCurvePoint[] = [
      { secs: 290, watts: 310 },
      { secs: 302, watts: 318 },
    ]
    expect(findNearestPower(curve, 300)).toBe(318)
  })
})

describe('computeLeftRightBalance', () => {
  it('returns null for empty array', () => {
    expect(computeLeftRightBalance([])).toBeNull()
  })

  it('returns null when all values are null', () => {
    expect(computeLeftRightBalance([
      { left_right_balance: null },
      { left_right_balance: null },
    ])).toBeNull()
  })

  it('returns average of non-null values, ignoring nulls', () => {
    expect(computeLeftRightBalance([
      { left_right_balance: 52 },
      { left_right_balance: 50 },
      { left_right_balance: null },
    ])).toBe(51)
  })

  it('returns the single non-null value unchanged', () => {
    expect(computeLeftRightBalance([{ left_right_balance: 48.5 }])).toBe(48.5)
  })
})

// Helper — builds a minimal ICUActivity with sensible defaults
function makeActivity(overrides: Partial<ICUActivity>): ICUActivity {
  return {
    id: '1', name: 'Test', start_date_local: '2026-05-01T10:00:00',
    type: 'Walk', moving_time: 3600, average_watts: null, max_watts: null,
    weighted_average_watts: null, average_heartrate: null,
    training_load: 30, rolling_ftp: null, distance: null,
    total_elevation_gain: null, left_right_balance: null,
    ...overrides,
  }
}

describe('groupCrossTraining', () => {
  it('returns empty array for empty input', () => {
    expect(groupCrossTraining([])).toEqual([])
  })

  it('returns empty array when all activities are rides', () => {
    const acts = [
      makeActivity({ type: 'Ride' }),
      makeActivity({ type: 'VirtualRide' }),
      makeActivity({ type: 'EBikeRide' }),
    ]
    expect(groupCrossTraining(acts)).toEqual([])
  })

  it('filters out Ride activities, keeps non-rides', () => {
    const acts = [makeActivity({ type: 'Ride' }), makeActivity({ type: 'Walk' })]
    const result = groupCrossTraining(acts)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('Walk')
  })

  it('filters out VirtualRide activities', () => {
    const acts = [makeActivity({ type: 'VirtualRide' }), makeActivity({ type: 'Run' })]
    const result = groupCrossTraining(acts)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('Run')
  })

  it('groups multiple activities of the same type', () => {
    const acts = [
      makeActivity({ type: 'Walk', moving_time: 3600, training_load: 20 }),
      makeActivity({ type: 'Walk', moving_time: 1800, training_load: 10 }),
    ]
    const result = groupCrossTraining(acts)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      type: 'Walk',
      count: 2,
      total_duration_secs: 5400,
      total_tss: 30,
    })
  })

  it('treats null training_load as 0', () => {
    const acts = [makeActivity({ type: 'Yoga', training_load: null })]
    const result = groupCrossTraining(acts)
    expect(result[0].total_tss).toBe(0)
  })

  it('sorts groups by total_tss descending', () => {
    const acts = [
      makeActivity({ type: 'Walk', moving_time: 3600, training_load: 20 }),
      makeActivity({ type: 'Run', moving_time: 3600, training_load: 60 }),
    ]
    const result = groupCrossTraining(acts)
    expect(result[0].type).toBe('Run')
    expect(result[1].type).toBe('Walk')
  })
})
