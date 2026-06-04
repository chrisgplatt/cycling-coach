import type { FeedbackCompletion, ReportedSignals } from '@/types'

const COMPLETION_LABEL: Record<FeedbackCompletion, string> = {
  as_planned: 'completed as planned',
  cut_short: 'cut short',
  went_harder: 'went harder than planned',
  modified: 'modified',
}

/**
 * One-line summary of the athlete's structured post-ride report, reused by the
 * adaptation analyser and the dossier synthesiser. Returns '' when nothing was
 * reported so callers can omit the line entirely.
 */
export function formatReportedSignals(s: ReportedSignals): string {
  const parts: string[] = []
  if (s.rpe != null) parts.push(`RPE ${s.rpe}/10`)
  if (s.feel != null) parts.push(`legs ${s.feel}/5`)
  if (s.completion) parts.push(COMPLETION_LABEL[s.completion])
  if (s.tags?.length) parts.push(`flags: ${s.tags.map(t => t.replace(/_/g, ' ')).join(', ')}`)
  return parts.join(' · ')
}
