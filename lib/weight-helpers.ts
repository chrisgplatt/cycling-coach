import type { WeightEntry } from '@/types'

export function weightAtDate(
  log: WeightEntry[],
  rideDate: string,
  fallback: number | null,
): number | null {
  const sorted = [...log].sort((a, b) => b.date.localeCompare(a.date))
  const entry = sorted.find(e => e.date <= rideDate)
  return entry ? entry.weight_kg : fallback
}
