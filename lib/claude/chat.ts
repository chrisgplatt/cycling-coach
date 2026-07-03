import type { TrainingPlan, Workout, ICUWellness, TrainingEvent, ActivityMetrics, WorkoutStep, DailyWellness } from '@/types'
import { formatZones } from './zones'
import { formatActivityMetrics, formatRideExecution } from './activity-metrics'
import { formatHrvForPrompt } from '@/lib/hrv/format'
import type { HrvStatus } from '@/lib/hrv/baseline'
import { weekdayName, labelDate } from '@/lib/calendar-helpers'
import { buildCoachContext } from './coach-memory'
import { formatWellnessForPrompt } from '@/lib/claude/wellness-prompt'

function relativeDay(eventDate: string, today: string): string {
  const diffDays = Math.round(
    (new Date(eventDate).getTime() - new Date(today).getTime()) / 864e5
  )
  if (diffDays === 0) return 'TODAY'
  if (diffDays === 1) return 'TOMORROW'
  if (diffDays === 2) return 'in 2 days'
  if (diffDays > 2) return `in ${diffDays} days`
  return 'past'
}

export interface RecentRide {
  date: string
  type: string
  duration_minutes: number
  steps: WorkoutStep[] | null
  activity_metrics: ActivityMetrics | null
}

export function buildChatSystemPrompt(
  plan: TrainingPlan | null,
  upcomingWorkouts: Workout[],
  latestWellness: ICUWellness | null,
  currentFTP: number,
  events: TrainingEvent[],
  dossierSection = '',
  recentRides: RecentRide[] = [],
  hrvStatus?: HrvStatus | null,
  memoryBlock = '',
  recentWellness: DailyWellness[] = [],
  maxHr: number | null = null,
): string {
  const today = new Date().toISOString().split('T')[0]
  const weekday = weekdayName(today)

  const planSection = plan
    ? `Active plan: ${plan.target_event_name} on ${plan.target_event_date} (${plan.phase} phase)\nRationale: ${plan.rationale}`
    : 'No active training plan.'

  const workoutSection = upcomingWorkouts.length
    ? upcomingWorkouts.map(w => `- ${labelDate(w.date)}: ${w.type} ${w.duration_minutes}min — ${w.description}`).join('\n')
    : 'No upcoming workouts.'

  const recentRidesSection = recentRides.length
    ? recentRides.map(r => {
        const summary = r.activity_metrics ? formatActivityMetrics(r.activity_metrics) : 'no power data'
        const execution = formatRideExecution(r.steps, r.activity_metrics)
        return `- ${r.date} ${r.type} ${r.duration_minutes}min: ${summary}${execution ? `\n  ${execution.replace('\n', '\n  ')}` : ''}`
      }).join('\n')
    : 'No recent rides with detail.'

  const maxHrSegment = maxHr != null ? `, Max HR: ${maxHr}` : ''
  const fitnessSection = (latestWellness
    ? `CTL: ${latestWellness.ctl ?? '?'}, ATL: ${latestWellness.atl ?? '?'}, Form: ${latestWellness.form ?? '?'}, HRV: ${latestWellness.hrv ?? '?'}, Resting HR: ${latestWellness.resting_hr ?? '?'}${maxHrSegment}`
    : (maxHr != null ? `No wellness data.\nMax HR: ${maxHr}` : 'No wellness data.'))
    + (hrvStatus ? '\n' + formatHrvForPrompt(hrvStatus) : '')

  const wellnessSection = recentWellness.length
    ? formatWellnessForPrompt(recentWellness.slice(-7))
    : null

  const upcomingEvents = events.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const eventsSection = upcomingEvents.length
    ? upcomingEvents.map(e => {
        const rel = relativeDay(e.date, today)
        const extras: string[] = []
        if (e.start_time) extras.push(`starts ${e.start_time}`)
        if (e.rpe) extras.push(`effort: ${e.rpe.replace('_', ' ')}`)
        if (e.duration_minutes) extras.push(`~${e.duration_minutes}min`)
        if (e.distance_km) extras.push(`~${e.distance_km}km`)
        return `- ${e.date} (${rel}): ${e.name} (${e.type}, priority ${e.priority}${extras.length ? ', ' + extras.join(', ') : ''})`
      }).join('\n')
    : 'No upcoming events.'

  return `${buildCoachContext(memoryBlock, dossierSection)}

TODAY: ${today} (${weekday})

${planSection}

Upcoming events (races, sportives, holidays):
${eventsSection}

Upcoming workouts (next 7 days):
${workoutSection}

Current fitness:
${fitnessSection}
${wellnessSection ? '\n' + wellnessSection : ''}

Recent rides (last ${recentRides.length} completed, most recent first):
${recentRidesSection}

Athlete FTP: ${currentFTP}W

Power zones (watts, derived from FTP):
${formatZones(currentFTP)}

Answer questions about training, recovery, pacing, nutrition, and race strategy. Reference specific workouts, power zones, and upcoming events where relevant — use the watt ranges above when giving pacing or zone advice.

You also keep private notes about this athlete. When the conversation surfaces something durable and personal worth remembering — a persistent feeling or mood (burnout, low motivation, stress), a physical constraint or niggle, a sleep or recovery pattern, or a scheduling limitation — save it yourself by appending a marker after your visible response, even if the athlete did not explicitly ask:

__REMEMBER__
{"note": "concise note in third person, e.g. 'Feeling burnt out in late May 2026' or 'Left knee flares up on long climbs'"}

When the athlete asks you to forget a note, append:

__FORGET__
{"note": "the note text to remove, as close to the original wording as possible"}

Capture rules: only save durable, personal observations and significant changes in how the athlete is doing. Do not save trivia, passing small talk, or one-off remarks. Never save a note that duplicates something already in your notes above. Events belong in the calendar and workout preferences belong in the goals field — do not save those as notes. Append at most one __REMEMBER__ or __FORGET__ marker per reply, always after your visible message.`
}
