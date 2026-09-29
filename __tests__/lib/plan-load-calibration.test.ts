/** @jest-environment node */
import { computeLoadMultiplier } from '@/lib/plan/load-calibration'

describe('computeLoadMultiplier', () => {
  it('maintains load when the athlete completed everything as planned', () => {
    expect(computeLoadMultiplier({ plannedTss: 300, actualTss: 300, unplannedTss: 0, allPlannedCompleted: true, positiveFeedback: false }))
      .toBe(1)
  })
  it('increases load up to 10% when the athlete completed everything with positive feedback', () => {
    const m = computeLoadMultiplier({ plannedTss: 300, actualTss: 300, unplannedTss: 0, allPlannedCompleted: true, positiveFeedback: true })
    expect(m).toBeGreaterThan(1)
    expect(m).toBeLessThanOrEqual(1.1)
  })
  it('reduces load proportionally when sessions were missed', () => {
    const m = computeLoadMultiplier({ plannedTss: 300, actualTss: 150, unplannedTss: 0, allPlannedCompleted: false, positiveFeedback: false })
    expect(m).toBeLessThan(1)
  })
  it('reduces next load when unplanned rides added TSS on top of the plan', () => {
    const withExtra = computeLoadMultiplier({ plannedTss: 300, actualTss: 300, unplannedTss: 150, allPlannedCompleted: true, positiveFeedback: false })
    const withoutExtra = computeLoadMultiplier({ plannedTss: 300, actualTss: 300, unplannedTss: 0, allPlannedCompleted: true, positiveFeedback: false })
    expect(withExtra).toBeLessThan(withoutExtra)
  })
  it('never returns a multiplier below 0.5 or above 1.1', () => {
    const low = computeLoadMultiplier({ plannedTss: 300, actualTss: 0, unplannedTss: 0, allPlannedCompleted: false, positiveFeedback: false })
    const high = computeLoadMultiplier({ plannedTss: 100, actualTss: 100, unplannedTss: 0, allPlannedCompleted: true, positiveFeedback: true })
    expect(low).toBeGreaterThanOrEqual(0.5)
    expect(high).toBeLessThanOrEqual(1.1)
  })
})
