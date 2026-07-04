import { resolveMaxHr, resolveMaxHrFromProfile, batchMaxHeartRate, type MaxHrInputs } from '@/lib/max-hr'

describe('resolveMaxHr', () => {
  it('manual override wins even when lower than both formula and observed', () => {
    const inputs: MaxHrInputs = { manual: 170, dateOfBirth: '1990-01-01', observed: 195 }
    const result = resolveMaxHr(inputs)
    expect(result).toEqual({ value: 170, source: 'manual' })
  })

  it('manual override wins even when higher than both formula and observed', () => {
    const inputs: MaxHrInputs = { manual: 200, dateOfBirth: '1990-01-01', observed: 150 }
    const result = resolveMaxHr(inputs)
    expect(result).toEqual({ value: 200, source: 'manual' })
  })

  it('picks the estimated (age-based) value when it is higher than observed', () => {
    // Tanaka: 208 - 0.7*36 = 182.8 -> rounds to 183
    const inputs: MaxHrInputs = { manual: null, dateOfBirth: '1990-07-03', observed: 170 }
    const result = resolveMaxHr(inputs)
    expect(result).toEqual({ value: 183, source: 'estimated' })
  })

  it('picks the observed value when it is higher than the estimate', () => {
    const inputs: MaxHrInputs = { manual: null, dateOfBirth: '1990-07-03', observed: 190 }
    const result = resolveMaxHr(inputs)
    expect(result).toEqual({ value: 190, source: 'observed' })
  })

  it('uses observed alone when date of birth is unset', () => {
    const inputs: MaxHrInputs = { manual: null, dateOfBirth: null, observed: 188 }
    const result = resolveMaxHr(inputs)
    expect(result).toEqual({ value: 188, source: 'observed' })
  })

  it('uses the estimate alone when there is no observed value', () => {
    const inputs: MaxHrInputs = { manual: null, dateOfBirth: '1990-07-03', observed: null }
    const result = resolveMaxHr(inputs)
    expect(result).toEqual({ value: 183, source: 'estimated' })
  })

  it('returns null when manual, date of birth, and observed are all unset', () => {
    const inputs: MaxHrInputs = { manual: null, dateOfBirth: null, observed: null }
    expect(resolveMaxHr(inputs)).toBeNull()
  })
})

describe('resolveMaxHrFromProfile', () => {
  it('reads manual, date_of_birth, and observed_max_hr off a profile-shaped object', () => {
    const result = resolveMaxHrFromProfile({ max_hr_manual: 175, date_of_birth: '1990-07-03', observed_max_hr: 190 })
    expect(result).toEqual({ value: 175, source: 'manual' })
  })

  it('falls back correctly when fields are missing', () => {
    const result = resolveMaxHrFromProfile({ date_of_birth: '1990-07-03' })
    expect(result).toEqual({ value: 183, source: 'estimated' })
  })

  it('returns null for a null or undefined profile', () => {
    expect(resolveMaxHrFromProfile(null)).toBeNull()
    expect(resolveMaxHrFromProfile(undefined)).toBeNull()
  })
})

describe('batchMaxHeartRate', () => {
  it('returns the highest max_heartrate in the batch', () => {
    expect(batchMaxHeartRate([{ max_heartrate: 170 }, { max_heartrate: 188 }, { max_heartrate: 150 }])).toBe(188)
  })

  it('ignores nulls', () => {
    expect(batchMaxHeartRate([{ max_heartrate: null }, { max_heartrate: 175 }, { max_heartrate: null }])).toBe(175)
  })

  it('returns 0 for an empty batch', () => {
    expect(batchMaxHeartRate([])).toBe(0)
  })

  it('returns 0 when every entry is null', () => {
    expect(batchMaxHeartRate([{ max_heartrate: null }, { max_heartrate: null }])).toBe(0)
  })
})
