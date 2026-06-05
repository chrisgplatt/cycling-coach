import { zoneFor, deriveTargetZones, deriveTargetZonesPct, stripBakedWatts } from '@/lib/claude/zones'
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

describe('deriveTargetZonesPct (FTP-independent, for storage)', () => {
  it('returns null when there are no steps', () => {
    expect(deriveTargetZonesPct(null)).toBeNull()
    expect(deriveTargetZonesPct([])).toBeNull()
  })

  it('renders the headline zone as a single %FTP figure for a steady effort', () => {
    expect(deriveTargetZonesPct([step(60), step(100), step(50)])).toBe('Z4 Threshold (100% FTP)')
  })

  it('renders a %FTP span for over/unders', () => {
    expect(deriveTargetZonesPct([step(60), step(95), step(105), step(50)])).toBe('Z4 Threshold (95–105% FTP)')
  })

  it('summarises an endurance ride from its Z2 steps', () => {
    expect(deriveTargetZonesPct([step(60), step(70), step(55)])).toBe('Z2 Endurance (60–70% FTP)')
  })
})

describe('stripBakedWatts', () => {
  it('returns empty string for nullish input', () => {
    expect(stripBakedWatts(null)).toBe('')
    expect(stripBakedWatts(undefined)).toBe('')
  })

  it('removes a parenthetical watt range', () => {
    expect(stripBakedWatts('Zone 2 endurance ride (140-190W)')).toBe('Zone 2 endurance ride')
  })

  it('removes an "at <watts>" phrase mid-sentence', () => {
    expect(stripBakedWatts('2x20min at 240-265W with 5min recovery')).toBe('2x20min with 5min recovery')
  })

  it('removes an "@ <watts>" phrase but keeps cadence parentheticals', () => {
    expect(stripBakedWatts('4×8min @ 250–265w (90rpm)')).toBe('4×8min (90rpm)')
  })

  it('removes a "<n> watts" token', () => {
    expect(stripBakedWatts('Easy spin around 130 watts')).toBe('Easy spin around')
  })

  it('leaves %FTP, durations and prose without watts untouched', () => {
    expect(stripBakedWatts('Over/unders at 95-105% FTP, hold 90rpm')).toBe('Over/unders at 95-105% FTP, hold 90rpm')
    expect(stripBakedWatts('Ride to feel, no power target')).toBe('Ride to feel, no power target')
  })
})
