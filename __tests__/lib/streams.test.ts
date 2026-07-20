/** @jest-environment node */
import { normaliseStreams, downsampleStreams, downsamplePoints } from '@/lib/intervals/streams'

describe('normaliseStreams', () => {
  it('maps channels by type and reads latlng pairs', () => {
    const raw = [
      { type: 'time', data: [0, 1, 2] },
      { type: 'watts', data: [100, 200, 300] },
      { type: 'heartrate', data: [120, 130, 140] },
      { type: 'altitude', data: [10, 11, 12] },
      { type: 'distance', data: [0, 5, 10] },
      { type: 'velocity_smooth', data: [5, 6, 7] },
      { type: 'latlng', data: [[53.5, -2.4], [53.6, -2.5], [53.7, -2.6]] },
    ]
    const s = normaliseStreams(raw)
    expect(s.time).toEqual([0, 1, 2])
    expect(s.power).toEqual([100, 200, 300])
    expect(s.hr).toEqual([120, 130, 140])
    expect(s.velocity).toEqual([5, 6, 7])
    expect(s.latlng).toEqual([[53.5, -2.4], [53.6, -2.5], [53.7, -2.6]])
    expect(s.cadence).toBeNull()
  })

  it('returns null latlng for indoor rides (no latlng channel)', () => {
    const s = normaliseStreams([{ type: 'time', data: [0, 1] }, { type: 'watts', data: [150, 160] }])
    expect(s.latlng).toBeNull()
    expect(s.distance).toEqual([0, 0]) // falls back to zeros, length of time
  })

  it('rejects a latitude-only latlng channel (intervals.icu flat-number quirk)', () => {
    const s = normaliseStreams([
      { type: 'time', data: [0, 1, 2] },
      { type: 'latlng', data: [53.59, 53.59, 53.6] }, // flat numbers, not [lat,lng] pairs
    ])
    expect(s.latlng).toBeNull()
  })
})

describe('downsampleStreams', () => {
  it('returns the input unchanged when under the cap', () => {
    const s = normaliseStreams([{ type: 'time', data: [0, 1, 2] }, { type: 'watts', data: [1, 2, 3] }])
    expect(downsampleStreams(s, 600)).toBe(s)
  })

  it('strides arrays in lockstep when over the cap', () => {
    const time = Array.from({ length: 10 }, (_, i) => i)
    const power = Array.from({ length: 10 }, (_, i) => i * 10)
    const s = normaliseStreams([{ type: 'time', data: time }, { type: 'watts', data: power }])
    const d = downsampleStreams(s, 5) // stride = ceil(10/5) = 2
    expect(d.time).toEqual([0, 2, 4, 6, 8])
    expect(d.power).toEqual([0, 20, 40, 60, 80])
  })
})

describe('downsamplePoints', () => {
  it('returns the input unchanged when under the cap', () => {
    const points = [1, 2, 3, 4, 5]
    expect(downsamplePoints(points, 12)).toEqual(points)
  })

  it('returns the input unchanged when exactly at the cap', () => {
    const points = Array.from({ length: 12 }, (_, i) => i)
    expect(downsamplePoints(points, 12)).toEqual(points)
  })

  it('downsamples an 18-point array to 9 points via even stride', () => {
    const points = Array.from({ length: 18 }, (_, i) => i)
    // stride = ceil(18/12) = 2 → keeps indices 0,2,4,...,16 (9 points)
    expect(downsamplePoints(points, 12)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16])
  })

  it('works with tuple arrays (lat/lng points)', () => {
    const points: [number, number][] = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]
    // stride = ceil(5/3) = 2 → keeps indices 0,2,4
    expect(downsamplePoints(points, 3)).toEqual([[1, 1], [3, 3], [5, 5]])
  })
})
