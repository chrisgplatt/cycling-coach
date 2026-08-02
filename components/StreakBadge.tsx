'use client'
import type { ActivitySummary } from '@/types'
import { computeWeeklyStreak } from '@/lib/streak'

interface Props {
  activities: ActivitySummary[] | undefined
  today: string
}

export default function StreakBadge({ activities, today }: Props) {
  const streak = computeWeeklyStreak(activities ?? [], today)
  if (streak === 0) return null

  return (
    <div
      data-testid="streak-badge"
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold bg-orange-50 border-orange-200 text-orange-700"
    >
      <span aria-hidden="true">🔥</span>
      <span>{streak}-week streak</span>
    </div>
  )
}
