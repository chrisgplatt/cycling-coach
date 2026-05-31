// Pure helpers for the ride graph. No React, no DOM — unit-testable.

export function pointerToIndex(clientX: number, left: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width))
  return Math.round(ratio * (count - 1))
}

// Builds an SVG polyline `points` string scaling values into [0,width]×[0,height].
// Y is inverted (SVG origin top-left). Nulls/NaNs are skipped.
export function seriesToPolyline(
  values: (number | null)[], width: number, height: number, pad = 2,
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
    const x = n === 1 ? 0 : (i / (n - 1)) * width
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
