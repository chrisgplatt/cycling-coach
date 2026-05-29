import type { UnavailabilityPeriod, UnavailabilityType } from '@/types'

export function icuCategory(type: UnavailabilityType): string {
  const map: Record<UnavailabilityType, string> = {
    sick: 'SICK',
    injury: 'INJURY',
    holiday: 'HOLIDAY',
    unavailable: 'NOTE',
  }
  return map[type]
}

export function periodDurationDays(period: UnavailabilityPeriod): number {
  const start = new Date(period.start_date).getTime()
  const end = new Date(period.end_date).getTime()
  return Math.round((end - start) / 864e5) + 1
}

export function periodOverlapsWeek(period: UnavailabilityPeriod, weekDates: string[]): boolean {
  const weekStart = weekDates[0]
  const weekEnd = weekDates[weekDates.length - 1]
  return period.start_date <= weekEnd && period.end_date >= weekStart
}

export function coveredDaysInWeek(period: UnavailabilityPeriod, weekDates: string[]): boolean[] {
  return weekDates.map(d => d >= period.start_date && d <= period.end_date)
}
