import { calculateAge } from '@/lib/age'

export interface MaxHrInputs {
  manual: number | null
  dateOfBirth: string | null
  observed: number | null
}

export interface MaxHrResult {
  value: number
  source: 'manual' | 'estimated' | 'observed'
}

export function resolveMaxHr(inputs: MaxHrInputs): MaxHrResult | null {
  const { manual, dateOfBirth, observed } = inputs
  if (manual != null) return { value: manual, source: 'manual' }

  const estimated = dateOfBirth != null
    ? Math.round(208 - 0.7 * calculateAge(dateOfBirth))
    : null

  if (estimated == null && observed == null) return null
  if (estimated == null) return { value: observed as number, source: 'observed' }
  if (observed == null) return { value: estimated, source: 'estimated' }

  return estimated >= observed
    ? { value: estimated, source: 'estimated' }
    : { value: observed, source: 'observed' }
}

export function batchMaxHeartRate(activities: { max_heartrate: number | null }[]): number {
  return activities.reduce((max, a) => Math.max(max, a.max_heartrate ?? 0), 0)
}
