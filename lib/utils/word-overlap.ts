export function wordOverlap(a: string, b: string): number {
  const aW = new Set(a.split(/\s+/).filter(Boolean))
  const bW = new Set(b.split(/\s+/).filter(Boolean))
  if (aW.size === 0 || bW.size === 0) return 0
  let overlap = 0
  for (const w of bW) if (aW.has(w)) overlap++
  return overlap / Math.max(aW.size, bW.size)
}
