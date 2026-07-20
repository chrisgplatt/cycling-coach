/** @jest-environment node */
import { extractStreamInsights } from '@/lib/claude/activity-metrics'
import type { RideStreams, WorkoutStep } from '@/types'

function base(): RideStreams {
  return { time: [], distance: [], latlng: null, power: null, hr: null, altitude: null, cadence: null, velocity: null }
}

describe('extractStreamInsights', () => {
  it('computes positive decoupling when HR drifts up at constant power', () => {
    const time = [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600]
    const power = time.map(() => 200)
    const hr = time.map(t => (t < 300 ? 150 : 165))
    const m = extractStreamInsights({ ...base(), time, power, hr }, 200, null)
    expect(m.decoupling_pct).toBeCloseTo(9.1, 1)
  })

  it('returns null decoupling when HR or power missing', () => {
    const time = [0, 60, 120]
    const m = extractStreamInsights({ ...base(), time, power: [200, 200, 200] }, 200, null)
    expect(m.decoupling_pct).toBeNull()
  })

  it('buckets time into power zones by FTP', () => {
    const time = [0, 60, 120, 180]
    const power = [100, 160, 200, 260] // dt-weighted: 50%→z1, 80%→z3, 100%→z4; final sample (130%) has no dt, so z6 stays 0
    const m = extractStreamInsights({ ...base(), time, power }, 200, null)
    expect(m.time_in_zone).toEqual({ z1: 60, z2: 0, z3: 60, z4: 60, z5: 0, z6: 0 })
  })

  it('detects a sustained climb with VAM and avg power', () => {
    const n = 8
    const time = Array.from({ length: n }, (_, i) => 60 * i)
    const distance = Array.from({ length: n }, (_, i) => 100 * i)
    const altitude = Array.from({ length: n }, (_, i) => 10 * i) // 10m per 100m = 10%
    const power = Array.from({ length: n }, () => 250)
    const m = extractStreamInsights({ ...base(), time, distance, altitude, power }, 200, null)
    expect(m.climbs).toEqual([
      { start_km: 0, duration_secs: 360, elev_gain_m: 60, avg_watts: 250, vam: 600, length_km: 0.6, path: null },
    ])
  })

  it('aligns planned steps onto the actual power trace (shape)', () => {
    const time = [0, 30, 60, 90]
    const power = [100, 100, 200, 200]
    const steps: WorkoutStep[] = [
      { label: 'WU', duration_minutes: 1, power_pct_ftp: 50 },
      { label: 'Work', duration_minutes: 1, power_pct_ftp: 100 },
    ]
    const m = extractStreamInsights({ ...base(), time, power }, 200, steps)
    expect(m.shape).toEqual([
      { label: 'WU', planned_w: 100, actual_w: 100 },
      { label: 'Work', planned_w: 200, actual_w: 200 },
    ])
  })

  it('shapes from detected laps when present, immune to warm-up/recovery drift', () => {
    // Warm-up overran (stream-window slicing would shove every later window late and
    // drag the efforts into the recovery beside them). The laps carry true power, so
    // the effort must still read at its real ~240W, not collapse toward recovery.
    const time = Array.from({ length: 61 }, (_, i) => i * 60) // 60 min, 1/min
    const power = time.map(() => 150)                          // stream irrelevant when laps win
    const steps: WorkoutStep[] = [
      { label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 }, // 120W
      { label: 'Effort', duration_minutes: 3, power_pct_ftp: 120 },  // 240W
      { label: 'Recovery', duration_minutes: 3, power_pct_ftp: 50 }, // 100W
    ]
    const laps = [
      { label: 'wu1', duration_secs: 360, avg_watts: 110, avg_hr: null },
      { label: 'wu2', duration_secs: 240, avg_watts: 128, avg_hr: null }, // warm-up overran into 2 laps
      { label: 'eff', duration_secs: 180, avg_watts: 240, avg_hr: null },
      { label: 'rec', duration_secs: 180, avg_watts: 118, avg_hr: null },
    ]
    const m = extractStreamInsights({ ...base(), time, power }, 200, steps, laps)
    expect(m.shape).toEqual([
      { label: 'Warm Up', planned_w: 120, actual_w: 117 }, // (360·110+240·128)/600
      { label: 'Effort', planned_w: 240, actual_w: 240 },  // the effort, read true
      { label: 'Recovery', planned_w: 100, actual_w: 118 },
    ])
  })

  it('returns null zones/shape when ftp is null', () => {
    const m = extractStreamInsights({ ...base(), time: [0, 60], power: [200, 200] }, null, null)
    expect(m.time_in_zone).toBeNull()
    expect(m.shape).toBeNull()
  })

  it('returns negative decoupling when efficiency improves over the ride', () => {
    const time = [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600]
    const power = time.map(() => 200)
    const hr = time.map(t => (t < 300 ? 165 : 150)) // HR drops in second half
    const m = extractStreamInsights({ ...base(), time, power, hr }, 200, null)
    expect(m.decoupling_pct).toBeLessThan(0)
  })
})
