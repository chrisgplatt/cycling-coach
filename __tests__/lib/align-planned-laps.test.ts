import { alignPlannedToLaps } from '@/lib/ride/planned-actual'
import type { WorkoutStep } from '@/types'

// FTP 200 → 120% = 240W interval target, 50% = 100W recovery, 60% = 120W warm-up.
const ftp = 200
const steps: WorkoutStep[] = [
  { label: 'Warm Up', duration_minutes: 15, power_pct_ftp: 60 },   // 120W
  { label: 'Interval 1', duration_minutes: 3, power_pct_ftp: 120 }, // 240W
  { label: 'Recovery 1', duration_minutes: 3, power_pct_ftp: 50 },  // 100W
  { label: 'Interval 2', duration_minutes: 3, power_pct_ftp: 120 },
  { label: 'Recovery 2', duration_minutes: 3, power_pct_ftp: 50 },
  { label: 'Interval 3', duration_minutes: 3, power_pct_ftp: 120 },
  { label: 'Recovery 3', duration_minutes: 3, power_pct_ftp: 50 },
  { label: 'Interval 4', duration_minutes: 3, power_pct_ftp: 120 },
  { label: 'Recovery 4', duration_minutes: 3, power_pct_ftp: 50 },
  { label: 'Endurance', duration_minutes: 15, power_pct_ftp: 68 },  // 136W
  { label: 'Cool Down', duration_minutes: 5, power_pct_ftp: 55 },   // 110W
]

// The real ride: warm-up rode long and split into two laps, recoveries ran a bit
// over, endurance is two laps, cool-down one — 13 laps for 11 planned steps. Every
// effort was HIT (~230-240W). This is the drift case where the old stream-window
// method mislabels interval 2 onward as below target.
const laps = [
  { watts: 110, duration_secs: 480 }, // warm-up part 1
  { watts: 130, duration_secs: 480 }, // warm-up part 2  (≈16min total, overran)
  { watts: 240, duration_secs: 180 }, // interval 1 — hit
  { watts: 118, duration_secs: 180 }, // recovery 1
  { watts: 240, duration_secs: 180 }, // interval 2 — hit
  { watts: 115, duration_secs: 200 }, // recovery 2 (ran over)
  { watts: 238, duration_secs: 180 }, // interval 3 — hit
  { watts: 120, duration_secs: 190 }, // recovery 3
  { watts: 231, duration_secs: 180 }, // interval 4 — hit
  { watts: 120, duration_secs: 180 }, // recovery 4
  { watts: 131, duration_secs: 900 }, // endurance part 1
  { watts: 126, duration_secs: 600 }, // endurance part 2
  { watts: 135, duration_secs: 246 }, // cool-down
]

describe('alignPlannedToLaps', () => {
  it('reports every interval at its real lap power despite drift and a lap/step mismatch', () => {
    const out = alignPlannedToLaps(steps, laps, ftp)!
    expect(out).not.toBeNull()
    // The four efforts read at the watts actually held — not dragged down into the
    // recovery valley beside them.
    expect(out[1].actual_w).toBe(240) // Interval 1
    expect(out[3].actual_w).toBe(240) // Interval 2  ← the one the user saw flagged low
    expect(out[5].actual_w).toBe(238) // Interval 3
    expect(out[7].actual_w).toBe(231) // Interval 4
    // And none of them collapse toward recovery power.
    for (const i of [1, 3, 5, 7]) expect(out[i].actual_w).toBeGreaterThan(225)
  })

  it('groups a split warm-up into the warm-up step (duration-weighted)', () => {
    const out = alignPlannedToLaps(steps, laps, ftp)!
    // (480·110 + 480·130) / 960 = 120
    expect(out[0].actual_w).toBe(120)
    expect(out[0].lap_secs).toBe(960)
  })

  it('groups multiple endurance laps into the endurance step', () => {
    const out = alignPlannedToLaps(steps, laps, ftp)!
    // (900·131 + 600·126) / 1500 = 129
    expect(out[9].actual_w).toBe(129)
    expect(out[9].lap_secs).toBe(1500)
  })

  it('sets planned_w from the step target and FTP', () => {
    const out = alignPlannedToLaps(steps, laps, ftp)!
    expect(out[1].planned_w).toBe(240)
    expect(out[2].planned_w).toBe(100)
  })

  it('maps 1:1 when laps already match steps', () => {
    const s: WorkoutStep[] = [
      { label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 },
      { label: 'Effort', duration_minutes: 10, power_pct_ftp: 100 },
    ]
    const out = alignPlannedToLaps(s, [
      { watts: 148, duration_secs: 540 },
      { watts: 252, duration_secs: 660 },
    ], 250)!
    expect(out[0].actual_w).toBe(148)
    expect(out[1].actual_w).toBe(252)
  })

  it('leaves a step with no matching lap at zero actual', () => {
    const s: WorkoutStep[] = [
      { label: 'Effort', duration_minutes: 10, power_pct_ftp: 100 },
      { label: 'Extra', duration_minutes: 10, power_pct_ftp: 100 },
    ]
    const out = alignPlannedToLaps(s, [{ watts: 250, duration_secs: 600 }], 250)!
    // Single lap goes to whichever single step; the other reports nothing.
    expect(out.filter(o => o.lap_secs === 0)).toHaveLength(1)
  })

  it('returns null on empty input', () => {
    expect(alignPlannedToLaps([], laps, ftp)).toBeNull()
    expect(alignPlannedToLaps(steps, [], ftp)).toBeNull()
    expect(alignPlannedToLaps(steps, laps, 0)).toBeNull()
  })
})
