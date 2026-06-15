import { computeMethodology } from '@/lib/claude/methodology'

const base = {
  weeklyHours: 9,
  weeksToEvent: 14,
  eventType: 'sportive',
  eventPriority: 'A',
  currentCTL: 55,
  goals: 'Complete the Dragon Ride',
}

describe('computeMethodology', () => {
  it('returns polarised-base for weeklyHours >= 8', () => {
    const result = computeMethodology({ ...base, weeklyHours: 9 })
    expect(result.intensity_profile).toBe('polarised-base')
    expect(result.name).toBe('friel-polarised-base')
  })

  it('returns threshold-heavy for weeklyHours < 8', () => {
    const result = computeMethodology({ ...base, weeklyHours: 6 })
    expect(result.intensity_profile).toBe('threshold-heavy')
    expect(result.name).toBe('friel-threshold-heavy')
  })

  it('returns correct phase weeks for 14 week plan', () => {
    const result = computeMethodology({ ...base, weeksToEvent: 14 })
    // 14 weeks → equidistant between 12 and 16; prefer longer → 16-week plan
    expect(result.phase_weeks).toEqual({ base: 6, build: 6, peak: 2, taper: 2 })
  })

  it('returns correct phase weeks for 6 week plan', () => {
    const result = computeMethodology({ ...base, weeksToEvent: 6 })
    expect(result.phase_weeks).toEqual({ base: 2, build: 2, peak: 1, taper: 1 })
  })

  it('returns correct phase weeks for 4 week plan', () => {
    const result = computeMethodology({ ...base, weeksToEvent: 4 })
    expect(result.phase_weeks).toEqual({ base: 1, build: 2, peak: 0, taper: 1 })
  })

  it('rationale includes hours, event type, and weeks', () => {
    const result = computeMethodology({ ...base, weeklyHours: 9, weeksToEvent: 14, eventType: 'sportive' })
    expect(result.rationale).toMatch(/9/)
    expect(result.rationale).toMatch(/sportive/)
    expect(result.rationale).toMatch(/14/)
  })

  it('label contains Friel and intensity approach', () => {
    const result = computeMethodology({ ...base, weeklyHours: 9 })
    expect(result.label).toMatch(/Friel/)
    expect(result.label).toMatch(/polarised/)
  })

  it('weekly_hours_at_creation stores the input hours', () => {
    const result = computeMethodology({ ...base, weeklyHours: 7.5 })
    expect(result.weekly_hours_at_creation).toBe(7.5)
  })

  it('prefers longer plan when equidistant (11 weeks → 12-week plan)', () => {
    const result = computeMethodology({ ...base, weeksToEvent: 11 })
    expect(result.phase_weeks).toEqual({ base: 4, build: 5, peak: 1, taper: 2 })
  })

  it('clamps weeksToEvent to minimum 4 weeks', () => {
    const result = computeMethodology({ ...base, weeksToEvent: 1 })
    expect(result.phase_weeks).toEqual({ base: 1, build: 2, peak: 0, taper: 1 })
    expect(result.rationale).not.toMatch(/1 weeks/)  // rationale shows clamped value
  })

  it('returns polarised-base for exactly 8h/week', () => {
    const result = computeMethodology({ ...base, weeklyHours: 8 })
    expect(result.intensity_profile).toBe('polarised-base')
  })
})
