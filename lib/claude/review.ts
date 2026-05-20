import { anthropic } from './client'
import { formatZones, formatSchedule } from './plan'
import type { UserProfile, ICUWellness, Workout, TrainingEvent } from '@/types'

export { parsePlanText } from './plan'

function formatLastWeekWorkouts(workouts: Workout[]): string {
  if (!workouts.length) return 'No workouts were scheduled last week.'
  return workouts
    .map(w => {
      const statusStr = w.status === 'skipped' && w.missed_reason
        ? `skipped (${w.missed_reason})`
        : w.status
      return `- ${w.date} | ${w.type} | ${w.duration_minutes}min | status: ${statusStr}`
    })
    .join('\n')
}

function formatWellness(wellness: ICUWellness[]): string {
  if (!wellness.length) return 'No wellness data available.'
  return wellness
    .map(w => `- ${w.id}: CTL ${w.ctl ?? '?'}, ATL ${w.atl ?? '?'}, Form ${w.form ?? '?'}, HRV ${w.hrv ?? '?'}, RHR ${w.resting_hr ?? '?'}`)
    .join('\n')
}

function formatRemainingWorkouts(workouts: Workout[]): string {
  if (!workouts.length) return 'No remaining planned workouts.'
  return workouts
    .map(w => `- ${w.date} | ${w.type} | ${w.duration_minutes}min`)
    .join('\n')
}

const SYSTEM_PROMPT = `You are an expert road cycling coach adapting a training plan based on last week's execution. Always respond with ONLY valid JSON matching the exact schema requested. No markdown, no explanation outside the JSON.`

export function buildReviewPrompt(
  profile: UserProfile,
  lastWeekWorkouts: Workout[],
  wellness: ICUWellness[],
  remainingWorkouts: Workout[],
  note: string,
): string {
  const wPerKg = (profile.current_ftp / profile.weight_kg).toFixed(2)
  const allEvents = [...(profile.events ?? [])].sort((a: TrainingEvent, b: TrainingEvent) =>
    a.date.localeCompare(b.date)
  )
  const today = new Date().toISOString().split('T')[0]
  const sortedRemaining = [...remainingWorkouts].sort((a, b) => a.date.localeCompare(b.date))
  const lastDate = sortedRemaining.length ? sortedRemaining[sortedRemaining.length - 1].date : today

  return `You are adapting the remaining training plan based on last week's execution.

ATHLETE PROFILE:
- Goals: ${profile.goals}
- FTP: ${profile.current_ftp}W | Weight: ${profile.weight_kg}kg | Power-to-weight: ${wPerKg} W/kg

TRAINING ZONES (use these exact watt ranges):
${formatZones(profile.current_ftp)}

${formatSchedule(profile.weekly_availability)}

UPCOMING EVENTS — these dates are BLOCKED, no workout may be scheduled on them:
${allEvents.length
    ? allEvents.map((e: TrainingEvent) => `- ${e.date} BLOCKED: ${e.name} | ${e.type} | Priority ${e.priority}`).join('\n')
    : 'None'}

LAST WEEK'S TRAINING:
${formatLastWeekWorkouts(lastWeekWorkouts)}

WELLNESS — LAST 14 DAYS:
${formatWellness(wellness)}

REMAINING PLANNED WORKOUTS (to be replaced):
${formatRemainingWorkouts(remainingWorkouts)}
${note ? `\nATHLETE NOTE: ${note}\n` : ''}
Review last week's execution and adapt the remaining plan. Replace the remaining planned workouts with an adjusted schedule covering the same date range (${today} to ${lastDate}).

Apply the same constraints as initial plan generation: respect the weekly schedule, never schedule on rest days or event dates, use exact duration_minutes for each day of the week.

If the athlete completed all workouts: maintain or slightly increase load.
If the athlete missed sessions: reduce upcoming intensity or volume proportionally.
If the athlete left a note: incorporate their feedback.

STEP RULES:
- power_pct_ftp: recovery=50-55, endurance=60-75, tempo=76-90, threshold=91-105, VO2max=106-120, sprint=121+
- Sessions >45min must include a warm-up (10-15min at Z1-Z2) and cool-down (10min at Z1)
- For interval sessions, list each rep and each recovery period as a separate step (do not group)

Return ONLY this JSON:
{
  "rationale": "2-3 paragraph explanation of adaptations made. Separate paragraphs with \\n\\n.",
  "target_event_name": "event name",
  "target_event_date": "YYYY-MM-DD",
  "phase": "base|build|peak|taper",
  "workouts": [
    {
      "date": "YYYY-MM-DD",
      "type": "endurance|threshold|intervals|recovery",
      "duration_minutes": 90,
      "description": "what to do",
      "target_zones": "Zone 2 (55-75% FTP)",
      "steps": [
        {"label": "Warm Up", "duration_minutes": 15, "power_pct_ftp": 60},
        {"label": "Zone 2", "duration_minutes": 65, "power_pct_ftp": 70},
        {"label": "Cool Down", "duration_minutes": 10, "power_pct_ftp": 55}
      ]
    }
  ]
}`
}

export function createReviewStream(
  profile: UserProfile,
  lastWeekWorkouts: Workout[],
  wellness: ICUWellness[],
  remainingWorkouts: Workout[],
  note: string,
) {
  const prompt = buildReviewPrompt(profile, lastWeekWorkouts, wellness, remainingWorkouts, note)
  return anthropic.messages.stream({
    model: 'claude-opus-4-7',
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })
}
