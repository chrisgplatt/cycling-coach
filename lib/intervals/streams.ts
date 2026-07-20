import type { RideStreams } from '@/types'

// intervals.icu returns activity streams as an array of channel objects:
// [{ type: 'watts', data: [...] }, { type: 'latlng', data: [[lat,lng],...] }, ...].
// Absent channels simply aren't in the array → null here.
export function normaliseStreams(raw: Array<{ type: string; data: unknown[] }>): RideStreams {
  const byType = new Map(raw.map(c => [c.type, c.data]))
  const num = (t: string): number[] | null => {
    const d = byType.get(t)
    return Array.isArray(d) ? d.map(v => (typeof v === 'number' ? v : NaN)) : null
  }
  const time = num('time') ?? []
  // The streams `latlng` channel is unreliable — for many activities intervals.icu
  // returns it latitude-only (flat numbers). Only accept genuine [lat,lng] pairs;
  // the API route sources the real route from /activity/{id}/map instead.
  const latRaw = byType.get('latlng')
  const latlng = Array.isArray(latRaw) && latRaw.length && Array.isArray(latRaw[0])
    ? (latRaw as [number, number][])
    : null
  return {
    time,
    distance: num('distance') ?? time.map(() => 0),
    latlng,
    power: num('watts'),
    hr: num('heartrate'),
    altitude: num('altitude'),
    cadence: num('cadence'),
    velocity: num('velocity_smooth'),
  }
}

// Even-stride downsample for the browser payload. Keeps every channel index-aligned.
export function downsampleStreams(s: RideStreams, maxPoints: number): RideStreams {
  const n = s.time.length
  if (n <= maxPoints) return s
  const stride = Math.ceil(n / maxPoints)
  const pick = <T>(arr: T[] | null): T[] | null => (arr ? arr.filter((_, i) => i % stride === 0) : null)
  return {
    time: pick(s.time)!,
    distance: pick(s.distance)!,
    latlng: pick(s.latlng),
    power: pick(s.power),
    hr: pick(s.hr),
    altitude: pick(s.altitude),
    cadence: pick(s.cadence),
    velocity: pick(s.velocity),
  }
}

// Even-stride downsample for a single array (e.g. a climb's lat/lng path).
// Same technique as downsampleStreams' internal `pick`, generalized to one
// array instead of a whole multi-channel RideStreams object.
export function downsamplePoints<T>(points: T[], maxPoints: number): T[] {
  const n = points.length
  if (n <= maxPoints) return points
  const stride = Math.ceil(n / maxPoints)
  return points.filter((_, i) => i % stride === 0)
}
