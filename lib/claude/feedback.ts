import { anthropic, MODEL } from './client'
import type { Workout, ProposedAdjustment, TrainingEvent, ReportedSignals } from '@/types'
import { formatReportedSignals } from './feedback-signals'

const SYSTEM_PROMPT = `You are an expert cycling coach analysing post-session feedback to adjust upcoming training.
Always respond with ONLY valid JSON. No markdown, no text outside the JSON.`

export async function analyseFeedback(
  plannedWorkout: Workout,
  feedbackText: string,
  actualTSS: number | null,
  actualAvgPower: number | null,
  actualAvgHR: number | null,
  upcomingWorkouts: Workout[],
  events: TrainingEvent[] = [],
  dossierSection = '',
  rideExecution = '',
  reported: ReportedSignals = {},
): Promise<ProposedAdjustment> {
  const upcoming = upcomingWorkouts
    .map(w => `- ID ${w.id}: ${w.date} ${w.type} ${w.duration_minutes}min — ${w.description}`)
    .join('\n')

  const today = plannedWorkout.date
  const upcomingEvents = events
    .filter(e => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
  const eventsSection = upcomingEvents.length
    ? upcomingEvents.map(e => `- ${e.date}: ${e.name} (${e.type}, priority ${e.priority})`).join('\n')
    : 'None'

  const signalsLine = formatReportedSignals(reported)

  const prompt = `Planned workout: ${plannedWorkout.date} ${plannedWorkout.type} ${plannedWorkout.duration_minutes}min
Description: ${plannedWorkout.description}
Target: ${plannedWorkout.target_zones}

Actual: TSS ${actualTSS ?? 'unknown'}, Avg power ${actualAvgPower ?? 'unknown'}W, Avg HR ${actualAvgHR ?? 'unknown'}bpm
${rideExecution ? `\n${rideExecution}\n` : ''}
${signalsLine ? `Athlete-reported: ${signalsLine}\n` : ''}Athlete feedback: "${feedbackText}"

${dossierSection ? dossierSection + '\n\n' : ''}Upcoming events (races, sportives, holidays — never propose workouts on these dates):
${eventsSection}

Upcoming workouts (next 7 days):
${upcoming || 'None'}

Propose adjustments to upcoming workouts if needed. Take event dates and their preparation requirements into account when suggesting changes.

For EVERY workout you propose a change to, you MUST also generate new workout steps in "workout_steps".
Steps must: always start with a warm-up and end with a cool-down, sum to the final duration_minutes,
match the workout type intensity zones, and be practical for a Garmin/Wahoo device.
power_pct_ftp: recovery=50-55%, endurance=60-75%, threshold=88-95%, intervals=105-120%.

Return ONLY valid JSON:
{
  "summary": "brief explanation",
  "changes": [
    {
      "workout_id": "uuid of workout to change",
      "field": "duration_minutes|description|type|status",
      "old_value": "current value",
      "new_value": "proposed value",
      "reason": "why"
    }
  ],
  "workout_steps": [
    {
      "workout_id": "uuid (must match a changed workout)",
      "steps": [
        { "label": "Warm Up", "duration_minutes": 10, "power_pct_ftp": 60 },
        { "label": "Main Set", "duration_minutes": 30, "power_pct_ftp": 68 },
        { "label": "Cool Down", "duration_minutes": 10, "power_pct_ftp": 55 }
      ]
    }
  ]
}
If no changes needed: {"summary": "No adjustments needed", "changes": [], "workout_steps": []}`

  const response = await anthropic.messages.stream({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  }).finalMessage()

  const block = response.content.find(b => b.type === 'text')
  const raw = block?.type === 'text' ? block.text : ''
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    return JSON.parse(text) as ProposedAdjustment
  } catch {
    throw new Error(`Failed to parse feedback analysis: ${text.slice(0, 200)}`)
  }
}
