export function normalizeY(
  value: number,
  min: number,
  max: number,
  svgTop: number,
  svgBottom: number,
): number {
  if (max === min) return (svgTop + svgBottom) / 2
  return svgBottom - ((value - min) / (max - min)) * (svgBottom - svgTop)
}

export function isoWeekStart(dateStr: string): string {
  const d = new Date(dateStr)
  const day = d.getUTCDay() // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}
