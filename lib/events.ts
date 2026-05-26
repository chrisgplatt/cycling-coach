import type { TrainingEvent } from '@/types'

const RPE_IF: Record<string, number> = {
  race_pace: 0.92,
  high: 0.82,
  medium: 0.72,
  low: 0.62,
}

export function estimateEventTss(event: Pick<TrainingEvent, 'duration_minutes' | 'rpe'>): number | null {
  if (!event.duration_minutes) return null
  const IF = RPE_IF[event.rpe ?? 'medium'] ?? RPE_IF.medium
  return Math.round((event.duration_minutes / 60) * IF * IF * 100)
}
