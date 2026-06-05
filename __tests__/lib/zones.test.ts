import { zoneFor, deriveTargetZones } from '@/lib/claude/zones'
import type { WorkoutStep } from '@/types'

const step = (power_pct_ftp: number, duration_minutes = 10): WorkoutStep => ({
  label: 'x', duration_minutes, power_pct_ftp,
})

describe('zoneFor', () => {
  it('maps percentages to the canonical zone labels', () => {
    expect(zoneFor(50).label).toBe('Z1 Recovery')
    expect(zoneFor(70).label).toBe('Z2 Endurance')
    expect(zoneFor(85).label).toBe('Z3 Tempo')
    expect(zoneFor(100).label).toBe('Z4 Threshold')
    expect(zoneFor(115).label).toBe('Z5 VO2max')
    expect(zoneFor(130).label).toBe('Z6 Anaerobic')
  })
})

describe('deriveTargetZones', () => {
  it('returns null when steps are missing or empty', () => {
    expect(deriveTargetZones(null, 250)).toBeNull()
    expect(deriveTargetZones([], 250)).toBeNull()
    expect(deriveTargetZones(undefined, 250)).toBeNull()
  })

  it('returns null when FTP is missing', () => {
    expect(deriveTargetZones([step(100)], null)).toBeNull()
    expect(deriveTargetZones([step(100)], undefined)).toBeNull()
    expect(deriveTargetZones([step(100)], 0)).toBeNull()
  })

  it('summarises a threshold interval session at the headline zone, watts live from FTP', () => {
    // warm-up, work, recovery, work, cool-down — headline is the 100% work steps
    const steps = [step(60), step(100), step(55), step(100), step(50)]
    // ftp 250 → 100% = 250W; both work steps share the zone so it is a single value
    expect(deriveTargetZones(steps, 250)).toBe('Z4 Threshold · 250W')
  })

  it('shows a watt span when the headline zone covers a range of efforts (over/unders)', () => {
    const steps = [step(60), step(95), step(105), step(95), step(105), step(50)]
    // ftp 200 → 95% = 190W, 105% = 210W; all four work steps are Z4 (91–105%)
    expect(deriveTargetZones(steps, 200)).toBe('Z4 Threshold · 190–210W')
  })

  it('summarises an endurance ride from its Z2 steps, excluding the easier warm-up tail', () => {
    const steps = [step(60), step(70), step(55)]
    // headline zone is Z2 (max 70%); Z2 steps are 60% and 70% → 120–140W at ftp 200
    expect(deriveTargetZones(steps, 200)).toBe('Z2 Endurance · 120–140W')
  })

  it('recomputes watts when FTP changes (the staleness fix)', () => {
    const steps = [step(60), step(100), step(50)]
    expect(deriveTargetZones(steps, 250)).toBe('Z4 Threshold · 250W')
    expect(deriveTargetZones(steps, 270)).toBe('Z4 Threshold · 270W')
  })
})
