import { anthropic, MODEL } from './client'
import type { Workout, WorkoutStep } from '@/types'

export async function generateWorkoutSteps(workout: Workout): Promise<WorkoutStep[]> {
  const prompt = `Generate structured workout steps for a cycling session.

Workout type: ${workout.type}
Duration: ${workout.duration_minutes} minutes total
Description: ${workout.description}
Target zones: ${workout.target_zones}

Rules:
- Always start with a warm-up and end with a cool-down
- Steps must sum to exactly ${workout.duration_minutes} minutes
- power_pct_ftp zones: recovery=50-55%, endurance=60-75%, threshold=88-95%, intervals=105-120%
- Keep it practical for a Garmin/Wahoo head unit (3-6 steps total)

Return ONLY a JSON array of steps, no markdown:
[
  { "label": "Warm Up", "duration_minutes": 10, "power_pct_ftp": 60 },
  { "label": "Main Set", "duration_minutes": 40, "power_pct_ftp": 88 },
  { "label": "Cool Down", "duration_minutes": 10, "power_pct_ftp": 55 }
]`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: 'You are a cycling coach. Always respond with ONLY valid JSON. No markdown, no text outside the JSON.',
    messages: [{ role: 'user', content: prompt }],
  })

  const block = response.content.find(b => b.type === 'text')
  const raw = block?.type === 'text' ? block.text : ''
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  const steps = JSON.parse(text) as WorkoutStep[]

  // Correct any rounding drift so steps sum exactly to duration_minutes
  const total = steps.reduce((s, st) => s + st.duration_minutes, 0)
  const diff = workout.duration_minutes - total
  if (diff !== 0 && steps.length > 0) {
    steps[steps.length - 1].duration_minutes += diff
  }

  return steps
}
