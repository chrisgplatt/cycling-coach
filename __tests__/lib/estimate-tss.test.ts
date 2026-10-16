import { estimateTss, stepsTss, plannedWorkoutTss } from '@/lib/estimate-tss'

describe('estimateTss', () => {
  it('estimates threshold TSS: 60min at IF 0.85', () => {
    // round(60 * 60 * 0.85^2 / 36) = round(72.25) = 72
    expect(estimateTss('threshold', 60)).toBe(72)
  })

  it('estimates recovery TSS: 30min at IF 0.50', () => {
    // round(30 * 60 * 0.5^2 / 36) = round(12.5) = 13
    expect(estimateTss('recovery', 30)).toBe(13)
  })

  it('estimates endurance TSS: 90min at IF 0.68', () => {
    // round(90 * 60 * 0.68^2 / 36) = round(69.36) = 69
    expect(estimateTss('endurance', 90)).toBe(69)
  })

  it('estimates intervals TSS: 60min at IF 0.90', () => {
    // round(60 * 60 * 0.9^2 / 36) = round(81) = 81
    expect(estimateTss('intervals', 60)).toBe(81)
  })

  it('estimates test TSS at the same intensity as intervals (0.90), not endurance', () => {
    expect(estimateTss('test', 60)).toBe(estimateTss('intervals', 60))
  })
})

describe('stepsTss / plannedWorkoutTss', () => {
  const steps = [
    { label: 'Warm Up', duration_minutes: 60, power_pct_ftp: 100 },
  ]

  it('sums duration × (power/FTP)² across steps', () => {
    expect(stepsTss(steps)).toBe(100)
  })

  it('derives planned TSS from steps, ignoring a stale stored tss', () => {
    // Regression: a 60-min threshold session whose steps were rewritten but whose
    // stored tss (27, from an earlier easy session) was never refreshed.
    const w = { type: 'threshold' as const, duration_minutes: 60, tss: 27, steps }
    expect(plannedWorkoutTss(w)).toBe(100)
  })

  it('falls back to the per-type heuristic when there are no steps', () => {
    expect(plannedWorkoutTss({ type: 'threshold', duration_minutes: 60, steps: null })).toBe(72)
    expect(plannedWorkoutTss({ type: 'threshold', duration_minutes: 60, steps: [] })).toBe(72)
  })
})
