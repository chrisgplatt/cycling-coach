import { anthropic, MODEL } from './client'
import type { Workout, ProposedAdjustment } from '@/types'

const SYSTEM_PROMPT = `You are an expert cycling coach analysing post-session feedback to adjust upcoming training.
Always respond with ONLY valid JSON. No markdown, no text outside the JSON.`

export async function analyseFeedback(
  plannedWorkout: Workout,
  feedbackText: string,
  actualTSS: number | null,
  actualAvgPower: number | null,
  actualAvgHR: number | null,
  upcomingWorkouts: Workout[]
): Promise<ProposedAdjustment> {
  const upcoming = upcomingWorkouts
    .map(w => `- ID ${w.id}: ${w.date} ${w.type} ${w.duration_minutes}min — ${w.description}`)
    .join('\n')

  const prompt = `Planned workout: ${plannedWorkout.date} ${plannedWorkout.type} ${plannedWorkout.duration_minutes}min
Description: ${plannedWorkout.description}
Target: ${plannedWorkout.target_zones}

Actual: TSS ${actualTSS ?? 'unknown'}, Avg power ${actualAvgPower ?? 'unknown'}W, Avg HR ${actualAvgHR ?? 'unknown'}bpm

Athlete feedback: "${feedbackText}"

Upcoming workouts (next 7 days):
${upcoming || 'None'}

Propose adjustments to upcoming workouts if needed. Return ONLY:
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
  ]
}
If no changes needed: {"summary": "No adjustments needed", "changes": []}`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })

  const block = response.content.find(b => b.type === 'text')
  const raw = block?.type === 'text' ? block.text : ''
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    return JSON.parse(text) as ProposedAdjustment
  } catch {
    throw new Error(`Failed to parse feedback analysis: ${text.slice(0, 200)}`)
  }
}
