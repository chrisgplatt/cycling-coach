import type { ICUPowerCurvePoint } from '@/types'

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
