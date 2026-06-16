import type { ICUPowerCurvePoint } from '@/types'
import { findNearestPower } from '@/lib/stats-helpers'

export interface CriticalPowerResult {
  cp: number
  wPrimeJ: number
  pointsUsed: number
}

const CP_FIT_DURATIONS_SECS = [180, 300, 480, 720, 1200] // 3,5,8,12,20 min
const MIN_POINTS_FOR_FIT = 3

export function fitCriticalPower(curve: ICUPowerCurvePoint[]): CriticalPowerResult | null {
  const points = CP_FIT_DURATIONS_SECS
    .map(secs => ({ secs, watts: findNearestPower(curve, secs) }))
    .filter((p): p is { secs: number; watts: number } => p.watts !== null)

  if (points.length < MIN_POINTS_FOR_FIT) return null

  // Linear work-time model: work(t) = CP*t + W'  →  regress (t, watts*t)
  const n = points.length
  const xs = points.map(p => p.secs)
  const ys = points.map(p => p.watts * p.secs)
  const sumX = xs.reduce((a, b) => a + b, 0)
  const sumY = ys.reduce((a, b) => a + b, 0)
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0)
  const sumX2 = xs.reduce((s, x) => s + x * x, 0)

  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null

  const cp = (n * sumXY - sumX * sumY) / denom
  const wPrimeJ = (sumY - cp * sumX) / n

  if (!Number.isFinite(cp) || !Number.isFinite(wPrimeJ) || cp <= 0) return null

  return { cp: Math.round(cp), wPrimeJ: Math.round(wPrimeJ), pointsUsed: n }
}
