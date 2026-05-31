// Pure weekly-schedule formatter. Dependency-free (no Claude client import) so
// prompt builders can describe availability without pulling in the Anthropic SDK.
export function formatSchedule(availability: Array<{ day: string; duration_minutes: number }> | undefined): string {
  if (!availability?.length) {
    return 'Weekly training schedule: Not specified — use coaching judgement for session distribution.'
  }
  const orderedDays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
  const trainingDays = orderedDays
    .map(d => availability.find(a => a.day === d))
    .filter((a): a is { day: string; duration_minutes: number } => !!a && a.duration_minutes > 0)
  const restDays = orderedDays.filter(d => !trainingDays.find(a => a.day === d))

  const lines = trainingDays.map(a => {
    const h = Math.floor(a.duration_minutes / 60)
    const m = a.duration_minutes % 60
    const dur = h > 0 && m > 0 ? `${h}h ${m}min` : h > 0 ? `${h}h` : `${m}min`
    return `  ${a.day.charAt(0).toUpperCase() + a.day.slice(1)}: up to ${dur} available (max ${a.duration_minutes} min — must not exceed this)`
  })
  if (restDays.length) {
    lines.push(`  ${restDays.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')}: REST — do not schedule any workout on these days`)
  }
  return `Weekly training schedule:\n${lines.join('\n')}`
}
