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

// Matches WorkoutFeedbackTab's MOOD_FACES emoji scale: 1 = best (loved it), 4 = worst.
// Same ambiguity risk as feel above — a bare "mood N/4" reads as a good score to a
// reader with no context, when here a HIGH number is the worst mood.
const MOOD_LABEL: Record<number, string> = {
  1: 'loved it', 2: 'good', 3: 'neutral', 4: 'low',
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
  if (s.mood != null) parts.push(`mood ${MOOD_LABEL[s.mood] ?? s.mood} (${s.mood}/4)`)
  return parts.join(' · ')
}
