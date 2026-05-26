import type { TrainingEvent, EventRPE } from '@/types'

const RPE_IF: Record<EventRPE, number> = {
  race_pace: 0.92,
  high: 0.82,
  medium: 0.72,
  low: 0.62,
}

export function estimateEventTss(event: Pick<TrainingEvent, 'duration_minutes' | 'rpe'>): number | null {
  if (!event.duration_minutes) return null
  const rpe: EventRPE = event.rpe ?? 'medium'
  return Math.round((event.duration_minutes / 60) * RPE_IF[rpe] * RPE_IF[rpe] * 100)
}
