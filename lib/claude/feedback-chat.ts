import type { Workout } from '@/types'
import { formatReportedSignals } from './feedback-signals'
import type { SessionSignals } from './session-note'
import { buildCoachContext } from './coach-memory'

// System prompt for the post-ride feedback conversation. Anchored to one logged
// session and the coach's note about it — the athlete can dig into how the session
// went and tell the coach whether the assessment was useful.
export function buildFeedbackChatSystemPrompt(
  workout: Workout,
  signals: SessionSignals,
  rideExecution: string,
  coachNote: string,
  memoryBlock = '',
): string {
  const reported = formatReportedSignals(signals)

  const lines: string[] = [
    buildCoachContext(memoryBlock, ''),
    ``,
    `You are discussing a session this athlete has just completed and logged feedback for.`,
    ``,
    `THE SESSION:`,
    `${workout.date} ${workout.type} ${workout.duration_minutes}min`,
    `Planned: ${workout.description}`,
    `Target: ${workout.target_zones}`,
  ]
  if (rideExecution) lines.push(``, rideExecution)
  if (reported) lines.push(``, `Athlete reported: ${reported}`)
  if (coachNote) lines.push(``, `Your note to the athlete after the session: "${coachNote}"`)

  lines.push(
    ``,
    `Discuss the session honestly. If the athlete disagrees with your read, listen and revise it rather than defending it. They may also tell you whether your feedback was useful — take that on board and adjust how you coach them. Keep replies to a few sentences. No markdown.`,
  )

  return lines.join('\n')
}
