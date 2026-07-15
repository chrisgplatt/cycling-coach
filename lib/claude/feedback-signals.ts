import type { FeedbackCompletion, ReportedSignals } from '@/types'

const COMPLETION_LABEL: Record<FeedbackCompletion, string> = {
  as_planned: 'completed as planned',
  cut_short: 'cut short',
  went_harder: 'went harder than planned',
  modified: 'modified',
}

// Matches WorkoutFeedbackTab's FEEL_FACES emoji scale: 1 = best/freshest, 5 = worst.
// A bare "legs N/5" is ambiguous to a reader with no other context for which
// direction is good — label it so the sentiment is unambiguous regardless of the number.
const FEEL_LABEL: Record<number, string> = {
  1: 'great', 2: 'good', 3: 'okay', 4: 'tired', 5: 'exhausted',
}

/**
 * One-line summary of the athlete's structured post-ride report, reused by the
 * adaptation analyser and the dossier synthesiser. Returns '' when nothing was
 * reported so callers can omit the line entirely.
 */
export function formatReportedSignals(s: ReportedSignals): string {
  const parts: string[] = []
  if (s.rpe != null) parts.push(`RPE ${s.rpe}/10`)
  if (s.feel != null) parts.push(`legs ${FEEL_LABEL[s.feel] ?? s.feel} (${s.feel}/5)`)
  if (s.completion) parts.push(COMPLETION_LABEL[s.completion])
  if (s.tags?.length) parts.push(`flags: ${s.tags.map(t => t.replace(/_/g, ' ')).join(', ')}`)
  return parts.join(' · ')
}
