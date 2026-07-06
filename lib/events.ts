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

export function eventEndDate(e: Pick<TrainingEvent, 'date' | 'end_date'>): string {
  return e.end_date ?? e.date
}

export function eventCoversDate(e: Pick<TrainingEvent, 'date' | 'end_date'>, dateStr: string): boolean {
  return dateStr >= e.date && dateStr <= eventEndDate(e)
}

export function eventDurationDays(e: Pick<TrainingEvent, 'date' | 'end_date'>): number {
  return Math.round((new Date(eventEndDate(e)).getTime() - new Date(e.date).getTime()) / 86400000) + 1
}

export function eventDateRangeLabel(e: Pick<TrainingEvent, 'date' | 'end_date'>): string {
  return e.end_date && e.end_date !== e.date ? `${e.date} to ${e.end_date}` : e.date
}

export function eventBlockStatusLabel(e: Pick<TrainingEvent, 'type' | 'continue_training'>): string {
  return e.type === 'holiday' && e.continue_training
    ? 'NOT BLOCKED — self-directed riding, optional quality sessions only (no mandatory workout)'
    : 'BLOCKED'
}
