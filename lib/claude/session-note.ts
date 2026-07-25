import { anthropic, MODEL } from './client'
import type { Workout, ReportedSignals } from '@/types'
import { formatReportedSignals } from './feedback-signals'

export type SessionSignals = ReportedSignals

export interface SessionNoteResult {
  note: string
  recommendAdaptations: boolean
}

const SYSTEM_PROMPT = `You are the athlete's cycling coach reflecting on a session they have just completed and logged feedback for.
Write a short, warm, specific assessment of how the session went — 2 to 3 sentences, plain coach's voice.
Speak directly to the athlete ("you"). Ground it in the actual execution and what they reported; don't invent data.
Acknowledge how it went and, where it helps, point to what it sets up next. No markdown, no headings, no lists — just the prose.
Also assess whether the athlete should consider exploring adaptations to their upcoming planned sessions based on this session or recent patterns.`

export async function assessSession(
  workout: Workout,
  feedbackText: string,
  signals: SessionSignals,
  rideExecution: string,
): Promise<SessionNoteResult> {
  const reported = formatReportedSignals(signals)

  const prompt = `Session: ${workout.date} ${workout.type} ${workout.duration_minutes}min
Planned: ${workout.description}
Target: ${workout.target_zones}
${rideExecution ? `\n${rideExecution}\n` : ''}
${reported ? `Athlete reported: ${reported}\n` : ''}Athlete feedback: "${feedbackText}"

Assess this session and indicate whether the athlete should explore adaptations to upcoming sessions.`

  const response = await anthropic.messages.create({
    model: MODEL,
    // Headroom for adaptive thinking (default on Opus 5), which draws from
    // this same budget as the tool call output.
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [{
      name: 'session_note',
      description: 'Submit the session assessment and adaptation recommendation',
      input_schema: {
        type: 'object' as const,
        properties: {
          note: {
            type: 'string' as const,
            description: '2–3 sentence coach assessment of the session',
          },
          recommend_adaptations: {
            type: 'boolean' as const,
            description: 'True if the athlete should consider exploring adaptations to upcoming planned sessions',
          },
        },
        required: ['note', 'recommend_adaptations'],
      },
    }],
    tool_choice: { type: 'tool', name: 'session_note' },
    messages: [{ role: 'user', content: prompt }],
  })

  const toolUse = response.content.find(b => b.type === 'tool_use')
  if (toolUse?.type !== 'tool_use') throw new Error('No tool_use block in response')
  const input = toolUse.input as { note: string; recommend_adaptations: boolean }
  // Strip any XML parameter tags the model occasionally leaks into the note value.
  const note = input.note.replace(/<\/parameter>[\s\S]*$/, '').replace(/<\/?parameter[^>]*>/g, '').trim()
  return { note, recommendAdaptations: input.recommend_adaptations }
}
