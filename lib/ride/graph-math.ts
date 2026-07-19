// Pure helpers for the ride graph. No React, no DOM — unit-testable.

export function pointerToIndex(clientX: number, left: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width))
  return Math.round(ratio * (count - 1))
}

// Normalised 0..1 position of each sample along a monotonic axis (distance or
// time). Falls back to even spacing when the axis has zero span (e.g. an indoor
// ride whose distance stream is all zeros).
export function axisFractions(axis: number[]): number[] {
  const n = axis.length
  if (n === 0) return []
  if (n === 1) return [0]
  const lo = axis[0]
  const span = axis[n - 1] - lo
  if (span <= 0) return axis.map((_, i) => i / (n - 1))
  return axis.map(v => Math.min(1, Math.max(0, (v - lo) / span)))
}

// Index of the sample whose fraction is nearest to f (0..1). Used to map a
// pointer position back to a sample when the X axis is non-uniform.
export function nearestIndexForFraction(fractions: number[], f: number): number {
  if (fractions.length === 0) return 0
  let best = 0, bestD = Infinity
  for (let i = 0; i < fractions.length; i++) {
    const d = Math.abs(fractions[i] - f)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

// Min/max of the finite values, or null when there are none.
export function extent(values: (number | null)[]): [number, number] | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (!nums.length) return null
  return [Math.min(...nums), Math.max(...nums)]
}

// Expands a [min,max] domain outward to the nearest `step` (default 10) so axes
// land on clean round bounds (e.g. [96,171] → [90,180]). Guarantees a non-zero span.
export function niceDomain([min, max]: [number, number], step = 10): [number, number] {
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  return [lo, hi === lo ? lo + step : hi]
}

// Light moving-average smoothing that ignores null/NaN and preserves length and
// gaps. `window` is the total span of samples averaged per point. Pure.
export function smoothSeries(values: (number | null)[], window: number): (number | null)[] {
  if (window <= 1) return values
  const half = Math.floor(window / 2)
  const out: (number | null)[] = new Array(values.length)
  for (let i = 0; i < values.length; i++) {
    const cur = values[i]
    if (cur == null || !Number.isFinite(cur)) { out[i] = cur; continue }
    let sum = 0, count = 0
    for (let j = i - half; j <= i + half; j++) {
      const v = values[j]
      if (j >= 0 && j < values.length && v != null && Number.isFinite(v)) { sum += v; count++ }
    }
    out[i] = count ? sum / count : cur
  }
  return out
}

// Builds an SVG polyline `points` string scaling values into [0,width]×[0,height].
// Y is inverted (SVG origin top-left). Nulls/NaNs are skipped. When `xs` (per-sample
// 0..1 fractions) is given, X follows the axis; otherwise points are evenly spaced.
// `domain` fixes the value range (e.g. raw min/max) so a smoothed line still scales
// against the true extent and lines up with an axis built from the same range.
export function seriesToPolyline(
  values: (number | null)[], width: number, height: number, pad = 2, xs?: number[], domain?: [number, number],
): string {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (!nums.length) return ''
  const min = domain ? domain[0] : Math.min(...nums)
  const max = domain ? domain[1] : Math.max(...nums)
  const span = max - min || 1
  const n = values.length
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const v = values[i]
    if (v == null || !Number.isFinite(v)) continue
    const x = xs ? xs[i] * width : (n === 1 ? 0 : (i / (n - 1)) * width)
    const y = height - pad - ((v - min) / span) * (height - pad * 2)
    out.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return out.join(' ')
}

// Formats a duration in seconds as a clock string, e.g. "1:15" or "1:01:15"
// (not to be confused with components/RideStats.tsx's formatHrsMins).
export function formatClockDuration(secs: number): string {
  const s = Math.max(0, Math.round(secs))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`
}

// Shared between RouteMap (Leaflet) and RideGraph (SVG) so the two marker
// surfaces never visually drift out of sync with each other.
export interface HighlightMarker {
  arrayIndex: number    // this highlight's position in the RideHighlight[] array
  streamIndex: number   // resolved index into the ride's stream arrays
  kind: 'climb' | 'effort'
}

export const HIGHLIGHT_MARKER_COLOR: Record<'climb' | 'effort', string> = {
  climb: '#c2410c',
  effort: '#f59e0b',
}

export const HIGHLIGHT_MARKER_ICON: Record<'climb' | 'effort', string> = {
  climb: '🏔️',
  effort: '⚡',
}

// Maps a highlight's start_km to the nearest stream sample index, reusing the
// same fraction-based nearest-match already used for pointer scrubbing —
// keeps this in lock-step with how the rest of the chart positions samples.
export function nearestIndexForKm(distance: number[], km: number): number {
  const targetM = km * 1000
  const fractions = axisFractions(distance)
  if (fractions.length === 0) return 0
  const lo = distance[0]
  const span = distance[distance.length - 1] - lo
  const f = span <= 0 ? 0 : Math.min(1, Math.max(0, (targetM - lo) / span))
  return nearestIndexForFraction(fractions, f)
}
