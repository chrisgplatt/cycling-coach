import type { DailyWellness } from '@/types'

export function formatWellnessForPrompt(wellness: DailyWellness[]): string {
  const lines: string[] = []

  for (const w of wellness) {
    const parts: string[] = []
    if (w.energy != null)       parts.push(`Energy ${w.energy}`)
    if (w.leg_freshness != null) parts.push(`Legs ${w.leg_freshness}`)
    if (w.mood != null)          parts.push(`Mood ${w.mood}`)
    if (w.stress != null)        parts.push(`Stress ${w.stress}`)
    if (w.sleep_quality != null) parts.push(`Sleep ${w.sleep_quality}`)
    if (parts.length) lines.push(`  ${w.date}: ${parts.join(', ')}`)
  }

  if (!lines.length) return ''

  const hasStress = wellness.some(w => w.stress != null)
  const footer = hasStress
    ? '(1 = lowest, 5 = highest; Stress is inverted — 1 = very stressed, 5 = relaxed)'
    : '(1 = lowest, 5 = highest)'

  return `Athlete wellness (last ${lines.length} day${lines.length === 1 ? '' : 's'}):\n${lines.join('\n')}\n${footer}`
}
