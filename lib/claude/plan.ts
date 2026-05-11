import { anthropic, MODEL } from './client'
import type { UserProfile, ICUSyncData, GeneratedPlan, ICUActivity, ICUWellness } from '@/types'

function summariseActivities(activities: ICUActivity[]): string {
  if (!activities.length) return 'No recent activities.'
  return activities
    .slice(-10)
    .map(a => `- ${a.start_date_local.split('T')[0]}: ${a.name}, ${Math.round(a.moving_time / 60)}min, NP ${a.weighted_average_watts ?? '?'}W, TSS ${a.training_load ?? '?'}`)
    .join('\n')
}

function summariseWellness(wellness: ICUWellness[]): string {
  const latest = wellness[wellness.length - 1]
  if (!latest) return 'No wellness data.'
  return `CTL: ${latest.ctl ?? '?'}, ATL: ${latest.atl ?? '?'}, Form: ${latest.form ?? '?'}, HRV: ${latest.hrv ?? '?'}`
}

const SYSTEM_PROMPT = `You are an expert road cycling coach. Generate periodized training plans based on athlete data.
Always respond with ONLY valid JSON matching the exact schema requested. No markdown, no explanation outside the JSON.`

export async function generatePlan(
  profile: UserProfile,
  syncData: ICUSyncData
): Promise<GeneratedPlan> {
  const today = new Date().toISOString().split('T')[0]
  const targetEvent = profile.events.find(e => e.priority === 'A') ?? profile.events[0]

  const prompt = `Generate a training plan for this athlete.

Profile:
- Goals: ${profile.goals}
- FTP: ${profile.current_ftp}W
- Weight: ${profile.weight_kg}kg
- Weekly hours available: ${profile.weekly_hours}
- Rest days: ${profile.rest_days.join(', ')}

Target event: ${targetEvent.name} on ${targetEvent.date} (${targetEvent.type}, Priority ${targetEvent.priority})

Current fitness:
${summariseWellness(syncData.wellness)}

Recent activities (last 6 weeks):
${summariseActivities(syncData.activities)}

Plan from today (${today}) to ${targetEvent.date}.
Use periodization: base → build → peak → taper appropriate to time available.
Respect weekly hour limits and rest days.

Return ONLY this JSON:
{
  "rationale": "explanation of plan approach",
  "target_event_name": "event name",
  "target_event_date": "YYYY-MM-DD",
  "phase": "base|build|peak|taper",
  "workouts": [
    {
      "date": "YYYY-MM-DD",
      "type": "endurance|threshold|intervals|recovery",
      "duration_minutes": 90,
      "description": "what to do",
      "target_zones": "Zone 2 (55-75% FTP)"
    }
  ]
}`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  try {
    return JSON.parse(text) as GeneratedPlan
  } catch {
    throw new Error(`Failed to parse plan from Claude response: ${text.slice(0, 200)}`)
  }
}
