/** @jest-environment node */
import { extractActivityMetrics, formatActivityMetrics, formatRideExecution, detectPersonalBests, METRICS_VERSION } from '@/lib/claude/activity-metrics'
import type { ICUActivity, ICUPowerCurvePoint, ActivityInterval, WorkoutStep, ActivityMetrics } from '@/types'
import { makeActivityMetrics } from '../support/factories'

const act: ICUActivity = {
  id: 'a1', start_date_local: '2026-05-28T08:00:00', type: 'Ride',
  moving_time: 3600, name: 'Threshold', average_watts: 231, max_watts: 612,
  weighted_average_watts: 248, average_heartrate: 152, training_load: 78,
  rolling_ftp: 250, distance: 32500, total_elevation_gain: 84, left_right_balance: 51,
}

const curve: ICUPowerCurvePoint[] = [
  { secs: 5, watts: 600 }, { secs: 15, watts: 520 }, { secs: 60, watts: 400 },
  { secs: 300, watts: 312 }, { secs: 1200, watts: 264 },
]

const intervals: ActivityInterval[] = [
  { label: 'Work', duration_secs: 480, avg_watts: 248, avg_hr: 161 },
]

describe('extractActivityMetrics', () => {
  it('maps tier-1 scalars from the activity', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.np).toBe(248)
    expect(m.avg_power).toBe(231)
    expect(m.max_power).toBe(612)
    expect(m.avg_hr).toBe(152)
    expect(m.distance_m).toBe(32500)
    expect(m.elevation_m).toBe(84)
    expect(m.lr_balance).toBe(51)
    expect(typeof m.synced_at).toBe('string')
  })

  it('samples best efforts at canonical durations present in the curve', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.best_efforts).toEqual([
      { secs: 5, watts: 600 }, { secs: 15, watts: 520 }, { secs: 60, watts: 400 },
      { secs: 300, watts: 312 }, { secs: 1200, watts: 264 },
    ])
  })

  it('omits canonical durations with no nearby curve point (no fabricated 60min best)', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.best_efforts?.some(e => e.secs === 3600)).toBe(false)
  })

  it('samples a 10-minute (600s) best when the curve has a nearby point', () => {
    const m = extractActivityMetrics(act, [...curve, { secs: 600, watts: 290 }], intervals)
    expect(m.best_efforts?.find(e => e.secs === 600)?.watts).toBe(290)
  })

  it('stamps the current metrics version', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.metrics_version).toBe(METRICS_VERSION)
  })

  it('sets best_efforts and intervals to null when not provided', () => {
    const m = extractActivityMetrics(act, null, null)
    expect(m.best_efforts).toBeNull()
    expect(m.intervals).toBeNull()
  })

  it('passes intervals through', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.intervals).toEqual(intervals)
  })

  it('maps elapsed time, max speed, and temperature from the activity', () => {
    const m = extractActivityMetrics(
      { ...act, elapsed_time: 3720, max_speed: 15.5, average_temp: 18, min_temp: 14, max_temp: 22 },
      curve, intervals,
    )
    expect(m.elapsed_secs).toBe(3720)
    expect(m.max_speed_ms).toBe(15.5)
    expect(m.avg_temp_c).toBe(18)
    expect(m.min_temp_c).toBe(14)
    expect(m.max_temp_c).toBe(22)
  })

  it('defaults elapsed time, max speed, and temperature to null when absent from the activity', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.elapsed_secs).toBeNull()
    expect(m.max_speed_ms).toBeNull()
    expect(m.avg_temp_c).toBeNull()
    expect(m.min_temp_c).toBeNull()
    expect(m.max_temp_c).toBeNull()
  })

  it('bumps METRICS_VERSION to 10', () => {
    expect(METRICS_VERSION).toBe(10)
  })

  it('samples a 30s best when the curve has a nearby point', () => {
    const m = extractActivityMetrics(act, [...curve, { secs: 30, watts: 500 }], intervals)
    expect(m.best_efforts?.find(e => e.secs === 30)?.watts).toBe(500)
  })

  it('rejects an implausible top speed as a GPS/sensor glitch', () => {
    // 205.9 km/h top speed, converted to m/s — no road bike reaches this.
    const m = extractActivityMetrics({ ...act, max_speed: 205.9 / 3.6 }, curve, intervals)
    expect(m.max_speed_ms).toBeNull()
  })

  it('rejects a top speed that survived smoothing but still exceeds the ceiling', () => {
    // 109.9 km/h — a real sustained-anomaly case seen in production, above the 95km/h ceiling.
    const m = extractActivityMetrics({ ...act, max_speed: 109.9 / 3.6 }, curve, intervals)
    expect(m.max_speed_ms).toBeNull()
  })

  it('keeps a fast but physically plausible top speed', () => {
    // 85 km/h converted to m/s — a genuine steep-descent peak, below the 95km/h ceiling.
    const m = extractActivityMetrics({ ...act, max_speed: 85 / 3.6 }, curve, intervals)
    expect(m.max_speed_ms).toBeCloseTo(85 / 3.6)
  })

  it('detects an indoor/virtual ride from the activity type', () => {
    const m = extractActivityMetrics({ ...act, type: 'VirtualRide' }, curve, intervals)
    expect(m.is_indoor).toBe(true)
  })

  it('treats a real-world ride type as outdoor', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.is_indoor).toBe(false)
  })

  it('sets speed_bests to null in the base extraction (filled later by extractStreamInsights)', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.speed_bests).toBeNull()
  })

  it('extracts 5s and 15s sprint entries from best_efforts', () => {
    const m = extractActivityMetrics(act, curve, intervals)
    expect(m.sprints).toEqual([
      { duration_secs: 5, watts: 600 },
      { duration_secs: 15, watts: 520 },
    ])
  })

  it('returns null sprints when the curve has no 5s/15s points', () => {
    const shortCurve = curve.filter(c => c.secs !== 5 && c.secs !== 15)
    const m = extractActivityMetrics(act, shortCurve, intervals)
    expect(m.sprints).toBeNull()
  })

  it('returns null sprints when there is no curve at all', () => {
    const m = extractActivityMetrics(act, null, intervals)
    expect(m.sprints).toBeNull()
  })
})

describe('detectPersonalBests', () => {
  const rideBest = [{ secs: 300, watts: 312 }, { secs: 1200, watts: 264 }]

  it('flags a duration where this ride ties or beats the 90-day curve max', () => {
    const ninetyDayCurve: ICUPowerCurvePoint[] = [
      { secs: 300, watts: 312 },   // this ride currently holds the best
      { secs: 1200, watts: 290 },  // a different day was better — not a PB
    ]
    expect(detectPersonalBests(rideBest, ninetyDayCurve)).toEqual([
      { duration_secs: 300, watts: 312, window_days: 90 },
    ])
  })

  it('returns null when no duration qualifies', () => {
    const ninetyDayCurve: ICUPowerCurvePoint[] = [
      { secs: 300, watts: 340 }, { secs: 1200, watts: 290 },
    ]
    expect(detectPersonalBests(rideBest, ninetyDayCurve)).toBeNull()
  })

  it('returns null when best_efforts or the curve is null/empty', () => {
    expect(detectPersonalBests(null, [{ secs: 300, watts: 312 }])).toBeNull()
    expect(detectPersonalBests(rideBest, null)).toBeNull()
    expect(detectPersonalBests(rideBest, [])).toBeNull()
  })
})

describe('formatActivityMetrics', () => {
  const base = makeActivityMetrics({
    np: 248, avg_power: 231, max_power: 612, avg_hr: 152,
    distance_m: 32500, elevation_m: 84, lr_balance: 51,
    best_efforts: [{ secs: 300, watts: 312 }, { secs: 1200, watts: 264 }],
    synced_at: '2026-05-28T09:00:00Z',
  })

  it('formats a compact summary line with present fields', () => {
    const s = formatActivityMetrics(base)
    expect(s).toContain('NP 248W')
    expect(s).toContain('avg 231W')
    expect(s).toContain('max 612W')
    expect(s).toContain('32.5km')
    expect(s).toContain('84m climb')
    expect(s).toContain('HR 152')
    expect(s).toContain('5min best 312W')
    expect(s).toContain('20min best 264W')
    expect(s).toContain(' · ')
  })

  it('omits null fields', () => {
    const s = formatActivityMetrics({ ...base, max_power: null, avg_hr: null, best_efforts: null })
    expect(s).not.toContain('max')
    expect(s).not.toContain('HR')
    expect(s).not.toContain('best')
  })

  it('returns a fallback when nothing is present', () => {
    const s = formatActivityMetrics(makeActivityMetrics({
      np: null, avg_power: null, max_power: null, avg_hr: null, distance_m: null,
      elevation_m: null, lr_balance: null, best_efforts: null, intervals: null,
    }))
    expect(s).toBe('no power data')
  })
})

describe('formatRideExecution', () => {
  const steps: WorkoutStep[] = [
    { label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 },
    { label: 'Work', duration_minutes: 8, power_pct_ftp: 95 },
    { label: 'Recovery', duration_minutes: 4, power_pct_ftp: 55 },
  ]
  const metricsWithIntervals = makeActivityMetrics({
    np: 248, avg_power: 231, max_power: 612, avg_hr: 152, distance_m: 32500,
    elevation_m: 84, lr_balance: 51, best_efforts: null,
    intervals: [
      { label: 'Warm Up', duration_secs: 602, avg_watts: 142, avg_hr: 120 },
      { label: 'Work', duration_secs: 480, avg_watts: 244, avg_hr: 161 },
    ],
    synced_at: '2026-05-28T09:00:00Z',
  })

  it('lays planned steps and actual intervals side by side', () => {
    const s = formatRideExecution(steps, metricsWithIntervals)
    expect(s).toContain('Planned steps:')
    expect(s).toContain('Warm Up 10min @ 60%')
    expect(s).toContain('Work 8min @ 95%')
    expect(s).toContain('Actual intervals:')
    expect(s).toContain('Work 8:00 avg 244W HR 161')
  })

  it('returns empty string when there are no planned steps', () => {
    expect(formatRideExecution(null, metricsWithIntervals)).toBe('')
    expect(formatRideExecution([], metricsWithIntervals)).toBe('')
  })

  it('returns empty string when there are no detected intervals', () => {
    expect(formatRideExecution(steps, { ...metricsWithIntervals, intervals: null })).toBe('')
  })
})

import { formatRideShape, extractStreamInsights } from '@/lib/claude/activity-metrics'
import type { ActivityMetrics as AM } from '@/types'

describe('insight formatting', () => {
  const m: AM = {
    np: 240, avg_power: 230, max_power: 600, avg_hr: 150, distance_m: 40000,
    elevation_m: 500, lr_balance: 50, best_efforts: null, intervals: null,
    decoupling_pct: 6.2,
    time_in_zone: { z1: 0, z2: 6800, z3: 2200, z4: 800, z5: 0, z6: 0 },
    climbs: [{ start_km: 5, duration_secs: 480, elev_gain_m: 90, avg_watts: 268, vam: 675, length_km: 3.2, path: null }],
    shape: [{ label: 'Work', planned_w: 250, actual_w: 238 }],
    distributions: null,
    effort_periods: null,
    sprints: null,
    speed_bests: null,
    personal_bests: null,
    synced_at: '2026-05-31T00:00:00Z',
  }

  it('formatActivityMetrics appends decoupling, zones and climbs', () => {
    const s = formatActivityMetrics(m)
    expect(s).toContain('decoupling 6.2%')
    expect(s).toContain('Z2 69%')
    expect(s).toContain('1 climb: 8min@268W')
  })

  it('formatRideShape renders planned vs actual per step', () => {
    expect(formatRideShape(m.shape)).toContain('Work: planned 250W, actual 238W')
    expect(formatRideShape(null)).toBe('')
  })
})

describe('effort period detection (via extractStreamInsights)', () => {
  // 10 samples, 30s apart (dt=30s). At this spacing the 30s centred rolling
  // average only ever includes the sample itself (its neighbours are exactly
  // 30s away, outside the ±15s half-window), so smoothed power === raw power
  // here — keeping the fixture's expected output simple to reason about.
  const time = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270]
  const distance = [0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800]
  const ftp = 250

  it('detects a sustained Z4+ block lasting at least 180s', () => {
    // indices 2..8 (7 points) = 230W (92% FTP, Z4); rest = 150W (60% FTP, Z2).
    // time[8]-time[2] = 240-60 = 180s, exactly meeting the minimum.
    const power = [150, 150, 230, 230, 230, 230, 230, 230, 230, 150]
    const s = { time, distance, latlng: null, power, hr: null, altitude: null, cadence: null, velocity: null }
    const insights = extractStreamInsights(s, ftp, null, null)
    expect(insights.effort_periods).toEqual([
      { start_km: 0.4, duration_secs: 180, avg_watts: 230, zone: 'z4' },
    ])
  })

  it('does not emit a block shorter than 180s', () => {
    // indices 2..6 (5 points) = 230W; duration = time[6]-time[2] = 150-60 = 90s.
    const power = [150, 150, 230, 230, 230, 230, 230, 150, 150, 150]
    const s = { time, distance, latlng: null, power, hr: null, altitude: null, cadence: null, velocity: null }
    const insights = extractStreamInsights(s, ftp, null, null)
    expect(insights.effort_periods).toBeNull()
  })

  it('returns null when power or ftp is unavailable', () => {
    const s = { time, distance, latlng: null, power: null, hr: null, altitude: null, cadence: null, velocity: null }
    expect(extractStreamInsights(s, ftp, null, null).effort_periods).toBeNull()
    const s2 = { time, distance, latlng: null, power: [200, 200, 200, 200, 200, 200, 200, 200, 200, 200], hr: null, altitude: null, cadence: null, velocity: null }
    expect(extractStreamInsights(s2, null, null, null).effort_periods).toBeNull()
  })
})

describe('climb length/path detection (via extractStreamInsights)', () => {
  it('computes length_km and a downsampled path for a detected climb', () => {
    // 15 samples, 30s apart, 125m apart. Flat 0-250m (idx 0-1), climbing at a
    // steady 5% grade from 250m (idx 2) to 1750m (idx 14), altitude plateauing
    // at idx 11+. The climb-detection algorithm's forward-looking 200m window
    // means the detected climb boundary lands at idx 2..8 (not the full
    // idx 2..10 physical climb) — verified empirically against the real
    // algorithm, not hand-derived, since the forward-window lookahead
    // truncates the tail before the grade drops below threshold.
    const time =     [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 390, 420]
    const distance = [0, 125, 250, 375, 500, 625, 750, 875, 1000, 1125, 1250, 1375, 1500, 1625, 1750]
    const altitude: number[] = []
    for (let i = 0; i < distance.length; i++) {
      if (i <= 1) altitude.push(100)
      else if (i <= 10) altitude.push(100 + (distance[i] - 250) * 0.05)
      else altitude.push(altitude[10])
    }
    const latlng: [number, number][] = distance.map((_, i) => [51.5 + i * 0.001, -0.1 + i * 0.001])
    const power = distance.map(() => 220)
    const s = { time, distance, latlng, power, hr: null, altitude, cadence: null, velocity: null }
    const insights = extractStreamInsights(s, 250, null, null)
    expect(insights.climbs).toEqual([
      {
        start_km: 0.3,
        duration_secs: 180,
        elev_gain_m: 38,
        avg_watts: 220,
        vam: 750,
        length_km: 0.8,
        path: [
          [51.502, -0.098],
          [51.503, -0.097],
          [51.504, -0.096],
          [51.505, -0.095],
          [51.506, -0.094],
          [51.507, -0.093],
          [51.508, -0.092],
        ],
      },
    ])
  })

  it('downsamples a longer climb path to at most 12 points', () => {
    // 24 samples, same spacing/grade shape as above but scaled up: flat
    // idx 0-1, climbing idx 2-20 (altitude plateaus at idx 20+). Detected
    // climb boundary (verified empirically): idx 1..18, an 18-point raw path,
    // downsampled via stride 2 to 9 points.
    const n = 24
    const time: number[] = []
    const distance: number[] = []
    for (let i = 0; i < n; i++) { time.push(i * 30); distance.push(i * 125) }
    const altitude: number[] = []
    for (let i = 0; i < n; i++) {
      if (i <= 1) altitude.push(100)
      else if (i <= 20) altitude.push(100 + (distance[i] - distance[1]) * 0.05)
      else altitude.push(altitude[20])
    }
    const latlng: [number, number][] = distance.map((_, i) => [51.5 + i * 0.001, -0.1 + i * 0.001])
    const power = distance.map(() => 220)
    const s = { time, distance, latlng, power, hr: null, altitude, cadence: null, velocity: null }
    const insights = extractStreamInsights(s, 250, null, null)
    expect(insights.climbs).toHaveLength(1)
    expect(insights.climbs![0].length_km).toBe(2.1)
    // Note: indices 11 and 13's longitude is `-0.1 + i * 0.001`, which is not exactly
    // representable in IEEE-754 double precision (a JS float artifact of the fixture's
    // own generation formula, unrelated to climb-boundary detection) — hence the
    // non-round literals below for those two points only.
    expect(insights.climbs![0].path).toEqual([
      [51.501, -0.099],
      [51.503, -0.097],
      [51.505, -0.095],
      [51.507, -0.093],
      [51.509, -0.091],
      [51.511, -0.08900000000000001],
      [51.513, -0.08700000000000001],
      [51.515, -0.085],
      [51.517, -0.083],
    ])
  })

  it('still computes length_km but leaves path null when there is no GPS (indoor ride)', () => {
    const time =     [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 390, 420]
    const distance = [0, 125, 250, 375, 500, 625, 750, 875, 1000, 1125, 1250, 1375, 1500, 1625, 1750]
    const altitude: number[] = []
    for (let i = 0; i < distance.length; i++) {
      if (i <= 1) altitude.push(100)
      else if (i <= 10) altitude.push(100 + (distance[i] - 250) * 0.05)
      else altitude.push(altitude[10])
    }
    const power = distance.map(() => 220)
    const s = { time, distance, latlng: null, power, hr: null, altitude, cadence: null, velocity: null }
    const insights = extractStreamInsights(s, 250, null, null)
    expect(insights.climbs).toHaveLength(1)
    expect(insights.climbs![0].length_km).toBe(0.8)
    expect(insights.climbs![0].path).toBeNull()
  })
})

describe('speed-over-distance detection (via extractStreamInsights)', () => {
  // Builds a 15km ride: 5km @ 20km/h, 5km @ 40km/h, 5km @ 20km/h again — so
  // the fastest window for each split is NOT simply "the first N km", proving
  // the detection genuinely finds the fastest contiguous stretch.
  function buildMixedSpeedStreams() {
    const time: number[] = [0]
    const distance: number[] = [0]
    const stepM = 100
    for (let d = stepM; d <= 5000; d += stepM) { distance.push(d); time.push(time[time.length - 1] + 18) }
    for (let d = 5000 + stepM; d <= 10000; d += stepM) { distance.push(d); time.push(time[time.length - 1] + 9) }
    for (let d = 10000 + stepM; d <= 15000; d += stepM) { distance.push(d); time.push(time[time.length - 1] + 18) }
    const power = distance.map(() => 200)
    return { time, distance, latlng: null, power, hr: null, altitude: null, cadence: null, velocity: null }
  }

  it('finds the fastest 1km, 5km, and 10km windows, correctly favouring the faster section over the first N km', () => {
    const s = buildMixedSpeedStreams()
    const insights = extractStreamInsights(s, 250, null, null)
    expect(insights.speed_bests).toEqual([
      { distance_km: 1, avg_speed_kmh: 40, start_km: 5, duration_secs: 90 },
      { distance_km: 5, avg_speed_kmh: 40, start_km: 5, duration_secs: 450 },
      { distance_km: 10, avg_speed_kmh: 26.7, start_km: 0, duration_secs: 1350 },
    ])
  })

  it('skips a split the ride is too short to cover (20km split on a 15km ride)', () => {
    const s = buildMixedSpeedStreams()
    const insights = extractStreamInsights(s, 250, null, null)
    expect(insights.speed_bests!.find(sb => sb.distance_km === 20)).toBeUndefined()
  })

  // Builds an 11km ride with a single corrupted GPS jump (1km covered in 18s,
  // i.e. 200km/h) followed by a normal 20km/h pace for the rest — mimics a
  // single bad position sample fabricating a burst of "instant distance".
  function buildGpsGlitchStreams() {
    const time: number[] = [0]
    const distance: number[] = [0, 1000]
    time.push(18)
    for (let d = 1100; d <= 11000; d += 100) { distance.push(d); time.push(time[time.length - 1] + 18) }
    const power = distance.map(() => 200)
    return { time, distance, latlng: null, power, hr: null, altitude: null, cadence: null, velocity: null }
  }

  it('drops a split made implausibly fast by a corrupted GPS/distance sample, leaving other splits intact', () => {
    const s = buildGpsGlitchStreams()
    const insights = extractStreamInsights(s, 250, null, null)
    // The 1km split's only candidate window is the 200km/h glitch — rejected entirely,
    // not replaced with a fallback window.
    expect(insights.speed_bests!.find(sb => sb.distance_km === 1)).toBeUndefined()
    // 5km and 10km splits dilute the glitch across enough real distance to stay
    // physically plausible, so they're kept as genuine bests.
    expect(insights.speed_bests!.find(sb => sb.distance_km === 5)).toEqual(
      { distance_km: 5, avg_speed_kmh: 24.4, start_km: 0, duration_secs: 738 },
    )
    expect(insights.speed_bests!.find(sb => sb.distance_km === 10)).toEqual(
      { distance_km: 10, avg_speed_kmh: 22, start_km: 0, duration_secs: 1638 },
    )
  })

  it('returns null when the ride is shorter than the smallest split (1km)', () => {
    const s = { time: [0, 30, 60], distance: [0, 250, 500], latlng: null, power: [200, 200, 200], hr: null, altitude: null, cadence: null, velocity: null }
    const insights = extractStreamInsights(s, 250, null, null)
    expect(insights.speed_bests).toBeNull()
  })
})

describe('max speed detection from the smoothed velocity stream (via extractStreamInsights)', () => {
  function streamsWithVelocity(velocity: number[] | null) {
    return { time: [0, 10, 20], distance: [0, 100, 200], latlng: null, power: null, hr: null, altitude: null, cadence: null, velocity }
  }

  it('takes the peak of the smoothed velocity stream as max speed', () => {
    const s = streamsWithVelocity([5, 12, 8])   // 12 m/s = 43.2km/h, well under the ceiling
    const insights = extractStreamInsights(s, null, null, null)
    expect(insights.max_speed_ms).toBe(12)
  })

  it('rejects an implausible peak in the velocity stream as a GPS/sensor glitch', () => {
    const s = streamsWithVelocity([5, 205.9 / 3.6, 8])
    const insights = extractStreamInsights(s, null, null, null)
    expect(insights.max_speed_ms).toBeNull()
  })

  it('returns null when there is no velocity stream to judge from', () => {
    const s = streamsWithVelocity(null)
    const insights = extractStreamInsights(s, null, null, null)
    expect(insights.max_speed_ms).toBeNull()
  })
})
