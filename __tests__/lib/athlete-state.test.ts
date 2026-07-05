import { buildAthleteStateLine } from '@/lib/claude/athlete-state'
import type { ICUWellness } from '@/types'

function makeWellness(overrides: Partial<ICUWellness> = {}): ICUWellness {
  return {
    id: '2026-07-04',
    ctl: 65, atl: 70, form: -5, hrv: 55, resting_hr: 48,
    sleep_secs: null, body_battery_low: null, body_battery_high: null,
    stress_avg: null, stress_high: null,
    ...overrides,
  } as ICUWellness
}

describe('buildAthleteStateLine', () => {
  it('includes CTL, ATL, Form (TSB), HRV, and Resting HR with units', () => {
    const line = buildAthleteStateLine(makeWellness(), null)
    expect(line).toBe('CTL: 65 TSS/day (fitness), ATL: 70 TSS/day (fatigue), Form (TSB): -5, HRV: 55 ms, Resting HR: 48 bpm')
  })

  it('falls back to ctl-atl when form is null', () => {
    const line = buildAthleteStateLine(makeWellness({ form: null, ctl: 65, atl: 70 }), null)
    expect(line).toContain('Form (TSB): -5')
  })

  it('prefers the form field over the ctl-atl fallback when both are present', () => {
    const line = buildAthleteStateLine(makeWellness({ form: -12, ctl: 65, atl: 70 }), null)
    expect(line).toContain('Form (TSB): -12')
  })

  it('shows "?" for missing fields', () => {
    const line = buildAthleteStateLine(makeWellness({ ctl: null, atl: null, form: null, hrv: null, resting_hr: null }), null)
    expect(line).toBe('CTL: ? TSS/day (fitness), ATL: ? TSS/day (fatigue), Form (TSB): ?, HRV: ? ms, Resting HR: ? bpm')
  })

  it('appends a Max HR segment with bpm when provided', () => {
    const line = buildAthleteStateLine(makeWellness(), 183)
    expect(line).toBe('CTL: 65 TSS/day (fitness), ATL: 70 TSS/day (fatigue), Form (TSB): -5, HRV: 55 ms, Resting HR: 48 bpm, Max HR: 183bpm')
  })

  it('returns a no-data message with Max HR when there is no wellness', () => {
    expect(buildAthleteStateLine(null, 183)).toBe('No wellness data.\nMax HR: 183bpm')
  })

  it('returns a plain no-data message when there is no wellness and no Max HR', () => {
    expect(buildAthleteStateLine(null, null)).toBe('No wellness data.')
  })
})
