import { anthropic, MODEL } from './client'
import type { Workout, ReportedSignals } from '@/types'
import { formatReportedSignals } from './feedback-signals'

const SYSTEM_PROMPT = `You are the athlete's cycling coach reflecting on a session they have just completed and logged feedback for.
Write a short, warm, specific assessment of how the session went — 2 to 3 sentences, plain coach's voice.
Speak directly to the athlete ("you"). Ground it in the actual execution and what they reported; don't invent data.
Acknowledge how it went and, where it helps, point to what it sets up next. No markdown, no headings, no lists — just the prose.`

export interface SessionSignals extends ReportedSignals {
  mood?: number | null
}

export async function assessSession(
  workout: Workout,
  feedbackText: string,
  signals: SessionSignals,
  rideExecution: string,
): Promise<string> {
  const signalsLine = formatReportedSignals(signals)
  const moodLine = signals.mood != null ? `Mood ${signals.mood}/4` : ''
  const reported = [signalsLine, moodLine].filter(Boolean).join(' · ')

  const prompt = `Session: ${workout.date} ${workout.type} ${workout.duration_minutes}min
Planned: ${workout.description}
Target: ${workout.target_zones}
${rideExecution ? `\n${rideExecution}\n` : ''}
${reported ? `Athlete reported: ${reported}\n` : ''}Athlete feedback: "${feedbackText}"

Write your 2–3 sentence assessment of this session for the athlete.`

  const response = await anthropic.messages.stream({
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  }).finalMessage()

  const block = response.content.find(b => b.type === 'text')
  return block?.type === 'text' ? block.text.trim() : ''
}
