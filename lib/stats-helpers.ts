import type { ICUPowerCurvePoint, ICUActivity, CrossTrainingGroup } from '@/types'

export function findNearestPower(curve: ICUPowerCurvePoint[], targetSecs: number): number | null {
  if (curve.length === 0) return null
  const nearest = curve.reduce((best, p) =>
    Math.abs(p.secs - targetSecs) < Math.abs(best.secs - targetSecs) ? p : best
  )
  return Math.abs(nearest.secs - targetSecs) <= 30 ? nearest.watts : null
}

export function computeLeftRightBalance(
  activities: Array<{ left_right_balance: number | null }>
): number | null {
  const values = activities
    .map(a => a.left_right_balance)
    .filter((v): v is number => v !== null)
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function groupCrossTraining(activities: ICUActivity[]): CrossTrainingGroup[] {
  const nonRides = activities.filter(a => !/ride/i.test(a.type))
  const map = new Map<string, CrossTrainingGroup>()
  for (const a of nonRides) {
    const existing = map.get(a.type)
    if (existing) {
      existing.count++
      existing.total_duration_secs += a.moving_time
      existing.total_tss += a.training_load ?? 0
    } else {
      map.set(a.type, {
        type: a.type,
        count: 1,
        total_duration_secs: a.moving_time,
        total_tss: a.training_load ?? 0,
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total_tss - a.total_tss)
}
