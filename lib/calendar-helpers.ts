import { getWeekBounds } from '@/lib/week-bounds'

/**
 * Returns a Monday-start grid of YYYY-MM-DD strings for a calendar month.
 * Cells before the 1st of the month are null.
 * @param year - Full year (e.g. 2026)
 * @param month - 0-based month index (0 = January, 11 = December)
 */
export function calendarMonthDays(year: number, month: number): (string | null)[] {
  const firstDayUTC = new Date(Date.UTC(year, month, 1)).getUTCDay() // 0=Sun
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const leadingNulls = Array<null>(firstDayUTC === 0 ? 6 : firstDayUTC - 1).fill(null)
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  })
  return [...leadingNulls, ...days]
}

// Returns 7 YYYY-MM-DD strings for Mon–Sun of the week containing dateStr.
export function weekDates(dateStr: string): string[] {
  if (!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return []
  const { start } = getWeekBounds(dateStr)
  const [y, m, d] = start.split('-').map(Number)
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 1, d + i))
    return date.toISOString().split('T')[0]
  })
}

// Formats a duration in minutes: "45m", "1h", "1h 30m"
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// Formats a moving time in seconds to the same string format.
// Rounds to nearest minute; imperceptible for activities measured in hours.
export function formatMovingTime(seconds: number): string {
  return formatDuration(Math.round(seconds / 60))
}

// Formats a Date object as YYYY-MM-DD using local time.
export function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
