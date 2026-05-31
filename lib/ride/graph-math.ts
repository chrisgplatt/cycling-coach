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

// Builds an SVG polyline `points` string scaling values into [0,width]×[0,height].
// Y is inverted (SVG origin top-left). Nulls/NaNs are skipped. When `xs` (per-sample
// 0..1 fractions) is given, X follows the axis; otherwise points are evenly spaced.
export function seriesToPolyline(
  values: (number | null)[], width: number, height: number, pad = 2, xs?: number[],
): string {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (!nums.length) return ''
  const min = Math.min(...nums)
  const max = Math.max(...nums)
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

export function formatDuration(secs: number): string {
  const s = Math.max(0, Math.round(secs))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`
}
