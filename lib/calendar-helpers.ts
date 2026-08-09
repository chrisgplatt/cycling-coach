import { getWeekBounds } from '@/lib/week-bounds'
import { estimateTss } from '@/lib/estimate-tss'
import type { Workout, ICUActivity } from '@/types'

export function calendarMonthDays(year: number, month: number): { date: string; inMonth: boolean }[] {
  const firstDayUTC = new Date(Date.UTC(year, month, 1)).getUTCDay() // 0=Sun
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const leadingCount = firstDayUTC === 0 ? 6 : firstDayUTC - 1

  const toDateStr = (d: Date) => d.toISOString().split('T')[0]

  // Date.UTC normalizes out-of-range day/month indices itself (day 0 = last day
  // of the previous month, month 12 = January of the next year), so no manual
  // month/year rollover handling is needed for either end.
  const leading = Array.from({ length: leadingCount }, (_, i) => ({
    date: toDateStr(new Date(Date.UTC(year, month, 1 - (leadingCount - i)))),
    inMonth: false,
  }))

  const current = Array.from({ length: daysInMonth }, (_, i) => ({
    date: toDateStr(new Date(Date.UTC(year, month, i + 1))),
    inMonth: true,
  }))

  const trailingCount = (7 - ((leadingCount + daysInMonth) % 7)) % 7
  const trailing = Array.from({ length: trailingCount }, (_, i) => ({
    date: toDateStr(new Date(Date.UTC(year, month + 1, i + 1))),
    inMonth: false,
  }))

  return [...leading, ...current, ...trailing]
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

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Deterministic, timezone-safe weekday name for a YYYY-MM-DD date. The date is
// read as a UTC calendar date so the result never drifts with the server's
// timezone — the canonical source of truth when a prompt must state the day.
export function weekdayName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

// "2026-06-08 (Monday)" — the canonical way to show a date to the coach so it
// never has to compute the day of week itself (a frequent off-by-one source).
export function labelDate(dateStr: string): string {
  return `${dateStr} (${weekdayName(dateStr)})`
}

// Monday (YYYY-MM-DD) of the week containing dateStr, plus `before` weeks of
// Mondays before it and `after` weeks after, ascending. Used to render a
// continuous, scrollable run of weeks around the selected one.
export function weekStartsAround(dateStr: string, before: number, after: number): string[] {
  const { start } = getWeekBounds(dateStr)
  const [y, m, d] = start.split('-').map(Number)
  const out: string[] = []
  for (let i = -before; i <= after; i++) {
    out.push(new Date(Date.UTC(y, m - 1, d + i * 7)).toISOString().split('T')[0])
  }
  return out
}

// The `count` Mondays immediately after `mondayStr` (ascending). For extending a
// week run as the user scrolls forward.
export function weekStartsAfter(mondayStr: string, count: number): string[] {
  const [y, m, d] = mondayStr.split('-').map(Number)
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(y, m - 1, d + (i + 1) * 7)).toISOString().split('T')[0])
}

// Formats a duration in minutes: "45m", "1h", "1h 30m"
export function formatDurationMins(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// Formats a moving time in seconds to the same string format.
// Rounds to nearest minute; imperceptible for activities measured in hours.
export function formatMovingTime(seconds: number): string {
  return formatDurationMins(Math.round(seconds / 60))
}

// Formats a Date object as YYYY-MM-DD using local time.
export function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const TYPE_PRIORITY: Record<string, number> = {
  intervals: 4, threshold: 3, test: 2, endurance: 2, recovery: 1,
}
const TYPE_COLOR: Record<string, string> = {
  intervals: 'bg-orange-500', threshold: 'bg-red-500',
  test:      'bg-violet-500', endurance: 'bg-blue-500', recovery: 'bg-emerald-500',
}

// Returns the Tailwind background class for the hardest workout type on dateStr,
// or null if no workouts fall on that date.
export function getDayWorkoutColor(dateStr: string, workouts: Workout[]): string | null {
  const dayWorkouts = workouts.filter(w => w.date === dateStr)
  if (!dayWorkouts.length) return null
  const hardest = dayWorkouts.reduce((best, curr) =>
    (TYPE_PRIORITY[curr.type] ?? 0) > (TYPE_PRIORITY[best.type] ?? 0) ? curr : best
  )
  return TYPE_COLOR[hardest.type] ?? null
}

// Picks which workout to feature as "today's session" out of every workout row on
// a single date. Defaults to the first entry (matching plan.workouts ordering ahead
// of unassociated rides), but if the scheduled session was marked missed and the
// athlete rode something else (unassociated) that day, surfaces that completed ride
// instead — a missed session shouldn't keep hiding a ride the athlete actually did.
export function pickTodayWorkout(dateWorkouts: Workout[]): Workout | null {
  const scheduled = dateWorkouts.find(w => w.plan_id != null) ?? null
  const unassociatedCompletedRide =
    dateWorkouts.find(w => w.plan_id == null && w.status === 'completed') ?? null
  if (scheduled?.status === 'skipped' && unassociatedCompletedRide) return unassociatedCompletedRide
  return dateWorkouts[0] ?? null
}

export interface WeeklySummary {
  actualTss: number
  actualMins: number
  plannedTss: number
  plannedMins: number
}

// Splits workouts in `dates` into actual (completed/needs_review) and planned
// buckets and returns their TSS and duration sums. Unlinked activities (rides
// not tied to a planned workout) are folded into the actual bucket.
export function getWeeklySummary(dates: string[], workouts: Workout[], activities: ICUActivity[] = []): WeeklySummary {
  const week = workouts.filter(w => dates.includes(w.date))
  const actual = week.filter(w => w.status === 'completed' || w.status === 'needs_review')
  const unlinked = activities.filter(a => dates.some(d => a.start_date_local.startsWith(d)))
  return {
    actualTss:  actual.reduce((sum, w) => sum + (w.tss ?? 0), 0)
              + unlinked.reduce((sum, a) => sum + (a.training_load ?? 0), 0),
    actualMins: actual.reduce((sum, w) => sum + (w.actual_duration_minutes ?? w.duration_minutes), 0)
              + unlinked.reduce((sum, a) => sum + Math.round(a.moving_time / 60), 0),
    // Planned reflects the week's original schedule regardless of what happened to
    // it — every workout counts, including ones later marked skipped/missed, not
    // just ones still in status 'planned'. Workout.tss only ever holds the achieved
    // value once completed, never a target, so estimateTss (the same heuristic
    // WorkoutCard uses for its own planned figure) is used unconditionally here instead.
    plannedTss:  week.reduce((sum, w) => sum + estimateTss(w.type, w.duration_minutes), 0),
    plannedMins: week.reduce((sum, w) => sum + w.duration_minutes, 0),
  }
}
