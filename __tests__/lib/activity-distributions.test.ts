import { extractDistributions } from '@/lib/claude/activity-metrics'
import type { RideStreams } from '@/types'

// 11 samples, 10 gaps of 60s = 600s total (the final sample contributes no dt).
const time = [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600]
const base: RideStreams = {
  time, distance: time.map(() => 0), latlng: null,
  power: null, hr: null, altitude: null, cadence: null, velocity: null,
}

describe('extractDistributions — power', () => {
  it('buckets power by %FTP and computes VI + steadiness', () => {
    const power = time.map(() => 200) // 200W at FTP 200 = 100% FTP
    const d = extractDistributions({ ...base, power }, 200, null, 210, 200)
    expect(d.power).toEqual([{ edge: 100, secs: 600 }])
    expect(d.power_vi).toBeCloseTo(1.05, 2)      // NP 210 / avg 200
    expect(d.power_steady_pct).toBe(100)          // every sample within ±5% of NP 210
  })

  it('returns null power when FTP is missing', () => {
    const power = time.map(() => 200)
    const d = extractDistributions({ ...base, power }, null, null, 210, 200)
    expect(d.power).toBeNull()
    expect(d.power_steady_pct).toBeNull()
  })

  it('caps power bins at a 150%+ catch-all', () => {
    const power = time.map(() => 400) // 200% FTP
    const d = extractDistributions({ ...base, power }, 200, null, 400, 400)
    expect(d.power).toEqual([{ edge: 150, secs: 600 }])
  })

  it('excludes negative-power samples from the histogram', () => {
    // 5 gaps at 200W (100% FTP), 5 gaps at -10W (braking, excluded)
    const power = [200, 200, 200, 200, 200, -10, -10, -10, -10, -10, -10]
    const d = extractDistributions({ ...base, power }, 200, null, 200, 200)
    expect(d.power).toEqual([{ edge: 100, secs: 300 }])
  })
})

describe('extractDistributions — cadence', () => {
  it('buckets pedalling cadence and sums coasting separately', () => {
    // first 5 gaps at 90rpm, next 5 at 20rpm (coasting, <30)
    const cadence = [90, 90, 90, 90, 90, 20, 20, 20, 20, 20, 20]
    const d = extractDistributions({ ...base, cadence }, 200, null, null, null)
    expect(d.cadence).toEqual([{ edge: 90, secs: 300 }])
    expect(d.coasting_secs).toBe(300)
  })

  it('returns null cadence (but keeps coasting) when all samples are coasting', () => {
    const cadence = time.map(() => 0)
    const d = extractDistributions({ ...base, cadence }, 200, null, null, null)
    expect(d.cadence).toBeNull()
    expect(d.coasting_secs).toBe(600)
  })
})

describe('extractDistributions — hr', () => {
  it('buckets HR into 5bpm bins and records the LTHR overlay when supplied', () => {
    const hr = [150, 150, 150, 150, 150, 165, 165, 165, 165, 165, 165]
    const d = extractDistributions({ ...base, hr }, 200, 160, null, null)
    expect(d.hr).toEqual([{ edge: 150, secs: 300 }, { edge: 165, secs: 300 }])
    expect(d.hr_lthr).toBe(160)
  })

  it('keeps hr_lthr null (raw bpm) when no LTHR is known', () => {
    const hr = time.map(() => 150)
    const d = extractDistributions({ ...base, hr }, 200, null, null, null)
    expect(d.hr).toEqual([{ edge: 150, secs: 600 }])
    expect(d.hr_lthr).toBeNull()
  })
})

describe('extractDistributions — empty', () => {
  it('nulls every distribution when no streams are present', () => {
    const d = extractDistributions(base, 200, 160, 210, 200)
    expect(d).toEqual({
      power: null, power_vi: 1.05, power_steady_pct: null,
      cadence: null, coasting_secs: null, hr: null, hr_lthr: null,
    })
  })
})
