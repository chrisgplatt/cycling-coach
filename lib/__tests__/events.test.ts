import { estimateEventTss } from '@/lib/events'

describe('estimateEventTss', () => {
  it('returns null when duration_minutes is missing', () => {
    expect(estimateEventTss({ duration_minutes: undefined, rpe: 'high' })).toBeNull()
  })

  it('returns null when duration_minutes is 0', () => {
    expect(estimateEventTss({ duration_minutes: 0, rpe: 'high' })).toBeNull()
  })

  it('uses race_pace IF (0.92): 60min → 85 TSS', () => {
    expect(estimateEventTss({ duration_minutes: 60, rpe: 'race_pace' })).toBe(85)
  })

  it('uses high IF (0.82): 60min → 67 TSS', () => {
    expect(estimateEventTss({ duration_minutes: 60, rpe: 'high' })).toBe(67)
  })

  it('uses medium IF (0.72): 60min → 52 TSS', () => {
    expect(estimateEventTss({ duration_minutes: 60, rpe: 'medium' })).toBe(52)
  })

  it('uses low IF (0.62): 60min → 38 TSS', () => {
    expect(estimateEventTss({ duration_minutes: 60, rpe: 'low' })).toBe(38)
  })

  it('defaults to medium IF when rpe is missing', () => {
    expect(estimateEventTss({ duration_minutes: 60, rpe: undefined })).toBe(52)
  })

  it('scales correctly for longer duration: 300min high → 336 TSS', () => {
    expect(estimateEventTss({ duration_minutes: 300, rpe: 'high' })).toBe(336)
  })
})
