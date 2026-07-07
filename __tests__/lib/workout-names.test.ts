import { workoutFingerprint, nameForWorkout, hashString, SESSION_NAMES } from '@/lib/workout-names'
import type { WorkoutStep } from '@/types'

const steps: WorkoutStep[] = [
  { label: 'Warm Up', duration_minutes: 15, power_pct_ftp: 60 },
  { label: 'Main Set', duration_minutes: 40, power_pct_ftp: 90 },
  { label: 'Cool Down', duration_minutes: 20, power_pct_ftp: 55 },
]

// Same shape as `steps`, but with trivial jitter in every value — should round to
// the exact same fingerprint.
const jitteredSteps: WorkoutStep[] = [
  { label: 'Warm Up', duration_minutes: 14, power_pct_ftp: 61 },
  { label: 'Main Set', duration_minutes: 41, power_pct_ftp: 91 },
  { label: 'Cool Down', duration_minutes: 19, power_pct_ftp: 54 },
]

describe('workoutFingerprint', () => {
  it('rounds duration_minutes and power_pct_ftp to the nearest 5, absorbing jitter', () => {
    expect(workoutFingerprint('endurance', 76, jitteredSteps)).toBe(workoutFingerprint('endurance', 75, steps))
  })

  it('produces a different fingerprint for a different type', () => {
    expect(workoutFingerprint('threshold', 75, steps)).not.toBe(workoutFingerprint('endurance', 75, steps))
  })

  it('produces a different fingerprint for different steps', () => {
    const otherSteps: WorkoutStep[] = [{ label: 'Steady', duration_minutes: 75, power_pct_ftp: 65 }]
    expect(workoutFingerprint('endurance', 75, otherSteps)).not.toBe(workoutFingerprint('endurance', 75, steps))
  })

  it('ignores label text and cadence', () => {
    const relabelled: WorkoutStep[] = [
      { label: 'Different Label', duration_minutes: 15, power_pct_ftp: 60, cadence: 95 },
      { label: 'Also Different', duration_minutes: 40, power_pct_ftp: 90 },
      { label: 'Whatever', duration_minutes: 20, power_pct_ftp: 55 },
    ]
    expect(workoutFingerprint('endurance', 75, relabelled)).toBe(workoutFingerprint('endurance', 75, steps))
  })
})

describe('hashString', () => {
  it('is deterministic', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
  })

  it('returns a non-negative integer', () => {
    expect(hashString('abc')).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(hashString('abc'))).toBe(true)
  })

  it('produces different hashes for different strings', () => {
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })
})

describe('nameForWorkout', () => {
  it('returns "{ListEntry} - {duration}" using an entry from SESSION_NAMES', () => {
    const result = nameForWorkout('endurance', 75, steps)
    expect(result).toMatch(/^.+ - 75$/)
    const entry = result.slice(0, result.length - ' - 75'.length)
    expect(SESSION_NAMES as readonly string[]).toContain(entry)
  })

  it('is deterministic for the same inputs', () => {
    expect(nameForWorkout('endurance', 75, steps)).toBe(nameForWorkout('endurance', 75, steps))
  })

  it('is stable across trivial jitter in the steps', () => {
    expect(nameForWorkout('endurance', 76, jitteredSteps)).toBe(nameForWorkout('endurance', 75, steps))
  })

  it('rounds the displayed duration', () => {
    expect(nameForWorkout('endurance', 74.6, steps)).toMatch(/ - 75$/)
  })
})
