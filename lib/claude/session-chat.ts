import type { Workout, TrainingPlan, ICUWellness, TrainingEvent } from '@/types'
import { formatHrvForPrompt } from '@/lib/hrv/format'
import type { HrvStatus } from '@/lib/hrv/baseline'
import { weekdayName, labelDate } from '@/lib/calendar-helpers'
import { formatDistributions } from '@/lib/claude/activity-metrics'

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

export function buildSessionSystemPrompt(
  workout: Workout,
  plan: TrainingPlan | null,
  upcomingWorkouts: Workout[],
  wellness: ICUWellness | null,
  currentFTP: number,
  events: TrainingEvent[] = [],
  dossierSection = '',
  hrvStatus?: HrvStatus | null,
): string {
  const tsb = wellness?.form ?? (
    wellness?.ctl != null && wellness?.atl != null ? wellness.ctl - wellness.atl : null
  )

  const fitnessSection = (wellness
    ? `CTL: ${wellness.ctl ?? '?'}, ATL: ${wellness.atl ?? '?'}, Form: ${tsb != null ? Math.round(tsb) : '?'}, HRV: ${wellness.hrv ?? '?'}`
    : 'No fitness data available.')
    + (hrvStatus ? '\n' + formatHrvForPrompt(hrvStatus) : '')

  const weekSection = upcomingWorkouts.length
    ? upcomingWorkouts.map(w => `- ${w.id} | ${labelDate(w.date)}: ${w.type} ${w.duration_minutes}min — ${w.description}`).join('\n')
    : 'No other upcoming workouts this week.'

  const today = workout.date
  const weekday = weekdayName(today)
  const upcomingEvents = events
    .filter(e => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))

  const planTargetDate = plan?.target_event_date
  const planTargetStillActive = !planTargetDate || upcomingEvents.some(e => e.date === planTargetDate)
  const removedTargetNote = !planTargetStillActive && plan
    ? ` — NOTE: this event has been cancelled or removed from the athlete's schedule. Do NOT refer to it. Workout descriptions may still mention it; treat those references as outdated and ignore them.`
    : ''

  const planSection = plan
    ? `Plan: ${plan.target_event_name} on ${plan.target_event_date} (${plan.phase} phase)${removedTargetNote}`
    : 'No active training plan.'

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
    : 'None'

  const distributionSection = formatDistributions(workout.activity_metrics?.distributions ?? null)

  return `You are an expert road cycling coach messaging your athlete directly. Be direct, brief, and conversational — like a coach texting between sessions. No markdown, no bullet points, no headers, no bold text. Plain prose only. 2–4 sentences per response unless the athlete asks for detail.

TODAY: ${today} (${weekday})

TODAY'S SESSION:
ID: ${workout.id}
Type: ${workout.type} | Duration: ${workout.duration_minutes} min
Description: ${workout.description}
Target zones: ${workout.target_zones}
${distributionSection ? '\n' + distributionSection + '\n' : ''}
ATHLETE STATE:
${fitnessSection}
FTP: ${currentFTP}W

${planSection}

${dossierSection ? dossierSection + '\n\n' : ''}UPCOMING EVENTS (races, sportives, holidays — do not propose workouts on these dates):
${eventsSection}

NEXT 7 DAYS (ID | date: type duration — description):
${weekSection}

Answer questions about today's session. If the athlete asks to modify or rework the session, propose specific changes. When proposing changes, end your response with:

__PROPOSAL__
{"today_update": {"duration_minutes": <number>, "type": "<type>", "description": "<text>", "target_zones": "<text>"}, "rationale": "<short explanation>", "week_follow_up": "<optional: single question asking if they want to adjust the week — omit field if change doesn't affect weekly load>"}

Only include fields in today_update that actually change. Only include week_follow_up if the modification meaningfully shifts weekly training load.

If the athlete agrees to adjust the rest of the week, propose specific changes and end your response with:

__WEEK_PROPOSAL__
{"changes": [{"workout_id": "<id from the list above>", "field": "duration_minutes|description|type", "old_value": <current value>, "new_value": <proposed value>, "reason": "<why>"}], "rationale": "<overall reason>"}

Keep proposals minimal — only change what's necessary. Never propose a workout on an event date.

When the athlete explicitly asks you to remember something personal — a physical constraint, injury, scheduling limitation, or important observation about themselves — append a marker after your visible response:

__REMEMBER__
{"note": "concise note in third person, e.g. 'Left knee flares up on long climbs'"}

When they ask you to forget a note, append:

__FORGET__
{"note": "the note text to remove, as close to the original wording as possible"}

Use these only for personal constraints, physical observations, and scheduling facts. Not for events (those belong in the calendar) or workout preferences (those belong in the goals field). Only append a marker when the athlete explicitly asks to remember or forget something.`
}
