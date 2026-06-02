import { buildPlannedActual } from '@/lib/ride/planned-actual'
import type { WorkoutStep, ActivityInterval, RideStreams } from '@/types'

const steps: WorkoutStep[] = [
  { label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 },
  { label: 'Effort', duration_minutes: 10, power_pct_ftp: 100 },
]
// 20 min ride sampled each minute; first half ~150W, second half ~250W.
const time = Array.from({ length: 21 }, (_, i) => i * 60)
const power = time.map(t => (t < 600 ? 150 : 250))
const streams: Pick<RideStreams, 'time' | 'power'> = { time, power }

describe('buildPlannedActual', () => {
  it('returns null without ftp, power, or steps', () => {
    expect(buildPlannedActual(steps, streams, null, null)).toBeNull()
    expect(buildPlannedActual(steps, { time, power: null }, null, 250)).toBeNull()
    expect(buildPlannedActual([], streams, null, 250)).toBeNull()
  })

  it('lap-anchors when lap count equals step count, using lap avg_watts', () => {
    const laps: ActivityInterval[] = [
      { label: 'wu', duration_secs: 540, avg_watts: 148, avg_hr: null },   // 9 min
      { label: 'eff', duration_secs: 660, avg_watts: 252, avg_hr: null },  // 11 min
    ]
    const out = buildPlannedActual(steps, streams, laps, 250)!
    expect(out.aligned).toBe('laps')
    expect(out.segments[0].width_frac).toBeCloseTo(540 / 1200, 5)
    expect(out.segments[0].actual_w).toBe(148)
    expect(out.segments[1].actual_w).toBe(252)
    expect(out.segments[0].planned_w).toBe(150) // 60% of 250
    expect(out.segments[1].planned_w).toBe(250) // 100% of 250
    expect(out.segments[0].start_frac).toBe(0)
    expect(out.segments[1].start_frac).toBeCloseTo(540 / 1200, 5)
  })

  it('averages the stream when a clean lap has no avg_watts', () => {
    const laps: ActivityInterval[] = [
      { label: 'wu', duration_secs: 600, avg_watts: null, avg_hr: null },
      { label: 'eff', duration_secs: 600, avg_watts: null, avg_hr: null },
    ]
    const out = buildPlannedActual(steps, streams, laps, 250)!
    expect(out.aligned).toBe('laps')
    expect(out.segments[0].actual_w).toBe(150)
    expect(out.segments[1].actual_w).toBe(250)
  })

  it('falls back to scaled when lap count differs from step count', () => {
    const laps: ActivityInterval[] = [
      { label: 'only one', duration_secs: 1200, avg_watts: 200, avg_hr: null },
    ]
    const out = buildPlannedActual(steps, streams, laps, 250)!
    expect(out.aligned).toBe('scaled')
    expect(out.segments[0].width_frac).toBeCloseTo(0.5, 5) // planned proportions
    expect(out.segments[0].actual_w).toBe(150)             // stream avg over first half
    expect(out.segments[1].actual_w).toBe(250)
  })

  it('scales when there are no laps at all', () => {
    expect(buildPlannedActual(steps, streams, null, 250)!.aligned).toBe('scaled')
  })

  it('builds a %FTP trace over 0..1 and a headroom yMaxPct', () => {
    const out = buildPlannedActual(steps, streams, null, 250)!
    expect(out.trace[0]).toEqual({ x: 0, pct: 60 })        // 150 / 250
    expect(out.trace[out.trace.length - 1].x).toBe(1)
    expect(out.trace[out.trace.length - 1].pct).toBe(100)  // 250 / 250
    // max planned/actual pct = 100 -> 100*1.08=108 -> ceil to 110, floored at 110
    expect(out.yMaxPct).toBe(110)
  })

  it('lifts yMaxPct above an over-target sprint', () => {
    const sprintPower = time.map(() => 375) // 150% FTP
    const out = buildPlannedActual(steps, { time, power: sprintPower }, null, 250)!
    expect(out.yMaxPct).toBe(170) // 150*1.08=162 -> ceil/10 -> 170
  })
})
