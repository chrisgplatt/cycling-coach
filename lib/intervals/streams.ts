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
  const latRaw = byType.get('latlng')
  const latlng = Array.isArray(latRaw) && latRaw.length ? (latRaw as [number, number][]) : null
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
