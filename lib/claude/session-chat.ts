import type { Workout, TrainingPlan, ICUWellness, TrainingEvent } from '@/types'

export function buildSessionSystemPrompt(
  workout: Workout,
  plan: TrainingPlan | null,
  upcomingWorkouts: Workout[],
  wellness: ICUWellness | null,
  currentFTP: number,
  events: TrainingEvent[] = [],
): string {
  const tsb = wellness?.form ?? (
    wellness?.ctl != null && wellness?.atl != null ? wellness.ctl - wellness.atl : null
  )

  const fitnessSection = wellness
    ? `CTL: ${wellness.ctl ?? '?'}, ATL: ${wellness.atl ?? '?'}, Form: ${tsb != null ? Math.round(tsb) : '?'}, HRV: ${wellness.hrv ?? '?'}`
    : 'No fitness data available.'

  const planSection = plan
    ? `Plan: ${plan.target_event_name} on ${plan.target_event_date} (${plan.phase} phase)`
    : 'No active training plan.'

  const weekSection = upcomingWorkouts.length
    ? upcomingWorkouts.map(w => `- ${w.id} | ${w.date}: ${w.type} ${w.duration_minutes}min — ${w.description}`).join('\n')
    : 'No other upcoming workouts this week.'

  const today = workout.date
  const upcomingEvents = events
    .filter(e => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
  const eventsSection = upcomingEvents.length
    ? upcomingEvents.map(e => {
        const extras: string[] = []
        if (e.start_time) extras.push(`starts ${e.start_time}`)
        if (e.rpe) extras.push(`effort: ${e.rpe.replace('_', ' ')}`)
        if (e.duration_minutes) extras.push(`~${e.duration_minutes}min`)
        if (e.distance_km) extras.push(`~${e.distance_km}km`)
        return `- ${e.date}: ${e.name} (${e.type}, priority ${e.priority}${extras.length ? ', ' + extras.join(', ') : ''})`
      }).join('\n')
    : 'None'

  return `You are an expert road cycling coach. Be direct and practical.

TODAY'S SESSION:
ID: ${workout.id}
Type: ${workout.type} | Duration: ${workout.duration_minutes} min
Description: ${workout.description}
Target zones: ${workout.target_zones}

ATHLETE STATE:
${fitnessSection}
FTP: ${currentFTP}W

${planSection}

UPCOMING EVENTS (races, sportives, holidays — do not propose workouts on these dates):
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

Keep proposals minimal — only change what's necessary. Never propose a workout on an event date.`
}
