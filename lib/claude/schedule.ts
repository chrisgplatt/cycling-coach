import { weekdayName } from '@/lib/calendar-helpers'
import { eventCoversDate } from '@/lib/events'

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

// Explicit day-by-day calendar for a planning window, with each real weekday
// resolved in code. The coach must never derive a weekday from a date itself
// (the off-by-one that mislabels e.g. Sunday as Saturday) — it reads these lines
// verbatim. Each day is marked trainable (with its cap), REST, or BLOCKED (event).
export function formatPlanCalendar(
  startDate: string,
  endDate: string,
  availability: Array<{ day: string; duration_minutes: number }> | undefined,
  events: Array<{ date: string; end_date?: string; name: string; continueTraining?: boolean }> = [],
): string {
  const capByDay = new Map<string, number>()
  for (const a of availability ?? []) capByDay.set(a.day.toLowerCase(), a.duration_minutes)

  const [sy, sm, sd] = startDate.split('-').map(Number)
  const start = Date.UTC(sy, sm - 1, sd)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const end = Date.UTC(ey, em - 1, ed)

  const lines: string[] = []
  // UTC has no DST, so adding one day (86_400_000 ms) is always exactly one date.
  for (let t = start; t <= end; t += 864e5) {
    const dateStr = new Date(t).toISOString().split('T')[0]
    const dayName = weekdayName(dateStr)
    const covering = events.find(e => eventCoversDate(e, dateStr))
    let status: string
    if (covering?.continueTraining) {
      status = `HOLIDAY (continuing to train) — optional quality session only, no mandatory workout: ${covering.name}`
    } else if (covering) {
      status = `BLOCKED — event: ${covering.name} (no workout)`
    } else {
      const cap = capByDay.get(dayName.toLowerCase()) ?? 0
      status = cap > 0 ? `train — up to ${cap} min` : 'REST — no workout'
    }
    lines.push(`  ${dateStr} ${dayName}: ${status}`)
  }
  return `EXACT PLANNING CALENDAR (authoritative — every date's weekday is given here; use these labels verbatim and NEVER compute the day of week yourself):\n${lines.join('\n')}`
}
