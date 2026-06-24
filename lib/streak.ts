import { isoWeekStart } from '@/lib/chart-helpers'
import type { ActivitySummary } from '@/types'

export type ActivityTab = 'Ride' | 'Run' | 'Walk' | 'Other'

export function classifyTab(type: string): ActivityTab {
  if (/ride/i.test(type)) return 'Ride'
  if (/run/i.test(type))  return 'Run'
  if (/walk/i.test(type)) return 'Walk'
  return 'Other'
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function weekHasActivity(dates: Set<string>, monday: string, today: string): boolean {
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i)
    if (day > today) break
    if (dates.has(day)) return true
  }
  return false
}

function isWeekComplete(monday: string, today: string): boolean {
  // The week is complete when its Sunday has passed
  return addDays(monday, 6) < today
}

export function computeWeeklyStreak(activities: ActivitySummary[], today: string): number {
  if (!activities.length) return 0
  const dates = new Set(activities.map(a => a.date))
  let streak = 0

  // Start at Monday of the current week
  const currentMonday = isoWeekStart(today)

  // Include current week if it has activity
  if (weekHasActivity(dates, currentMonday, today)) streak++

  // Walk back through complete past weeks
  let monday = addDays(currentMonday, -7)
  while (isWeekComplete(monday, today)) {
    if (!weekHasActivity(dates, monday, today)) break
    streak++
    monday = addDays(monday, -7)
  }

  return streak
}

export function computeStreakActivityCount(activities: ActivitySummary[], today: string): number {
  const streak = computeWeeklyStreak(activities, today)
  if (streak === 0) return 0
  const currentMonday = isoWeekStart(today)
  const streakStart = addDays(currentMonday, -(streak - 1) * 7)
  return activities.filter(a => a.date >= streakStart && a.date <= today).length
}
