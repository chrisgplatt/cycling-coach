import type { RecoveryInputsRangeResult } from '@/lib/recovery-inputs'

export interface RecoveryInputs {
  hrv: number | null
  hrvBaseline: number | null
  garmin_sleep_deep_secs: number | null
  garmin_sleep_light_secs: number | null
  garmin_sleep_rem_secs: number | null
  garmin_sleep_awake_secs: number | null
  body_battery_high: number | null
  energy: number | null
  leg_freshness: number | null
  tsb: number | null
}

export interface RecoveryScore {
  score: number
  band: 'high' | 'moderate' | 'low'
  explanation: string
  components: {
    sleep: number | null
    hrv: number | null
    wellness: number | null
    tsb: number | null
    bodyBattery: number | null
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a)
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function computeSleepIndex(inputs: RecoveryInputs): number | null {
  const { garmin_sleep_deep_secs: deep, garmin_sleep_light_secs: light,
    garmin_sleep_rem_secs: rem, garmin_sleep_awake_secs: awake } = inputs
  if (deep === null && light === null && rem === null && awake === null) return null
  const totalSecs = (deep ?? 0) + (light ?? 0) + (rem ?? 0) + (awake ?? 0)
  if (totalSecs === 0) return 0
  const sub: number[] = [clamp01(totalSecs / (8 * 3600)) * 100]
  if (deep !== null) sub.push(clamp01((deep / totalSecs) / 0.20) * 100)
  if (rem !== null) sub.push(clamp01((rem / totalSecs) / 0.25) * 100)
  return sub.reduce((a, b) => a + b, 0) / sub.length
}

export function computeHrvIndex(inputs: { hrv: number | null; hrvBaseline: number | null }): number | null {
  const { hrv, hrvBaseline } = inputs
  if (hrv === null || hrvBaseline === null || hrvBaseline === 0) return null
  const ratio = hrv / hrvBaseline
  if (ratio >= 1.10) return 90
  if (ratio >= 1.00) return lerp(70, 90, (ratio - 1.00) / 0.10)
  if (ratio >= 0.90) return lerp(40, 70, (ratio - 0.90) / 0.10)
  return lerp(0, 40, clamp01((ratio - 0.70) / 0.20))
}

export function computeWellnessIndex(inputs: { energy: number | null; leg_freshness: number | null }): number | null {
  const { energy, leg_freshness } = inputs
  const vals = [energy, leg_freshness].filter((v): v is number => v !== null)
  if (!vals.length) return null
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  return (avg - 1) / 4 * 100
}

function computeTsbIndex(inputs: RecoveryInputs): number | null {
  const { tsb } = inputs
  if (tsb === null) return null
  if (tsb >= 25) return 100
  if (tsb >= 5) return lerp(80, 100, (tsb - 5) / 20)
  if (tsb >= -10) return lerp(45, 80, (tsb + 10) / 15)
  if (tsb >= -25) return lerp(10, 45, (tsb + 25) / 15)
  return 10
}

export const COMPONENT_WEIGHTS = { sleep: 0.30, hrv: 0.30, wellness: 0.20, tsb: 0.10, bodyBattery: 0.10 } as const
export type ComponentKey = keyof typeof COMPONENT_WEIGHTS

const EXPLANATION_LABELS: { key: ComponentKey; label: string }[] = [
  { key: 'sleep', label: 'short/poor deep sleep' },
  { key: 'hrv', label: 'HRV suppressed' },
  { key: 'wellness', label: 'low subjective energy' },
  { key: 'tsb', label: 'high training load' },
  { key: 'bodyBattery', label: 'low body battery' },
]

export function computeRecoveryScore(inputs: RecoveryInputs): RecoveryScore {
  const components = {
    sleep: computeSleepIndex(inputs),
    hrv: computeHrvIndex(inputs),
    wellness: computeWellnessIndex(inputs),
    tsb: computeTsbIndex(inputs),
    bodyBattery: inputs.body_battery_high == null ? null : Math.min(100, Math.max(0, inputs.body_battery_high)),
  }

  const available = (Object.keys(components) as ComponentKey[]).filter(k => components[k] !== null)

  let score: number
  if (!available.length) {
    score = 50
  } else {
    const totalWeight = available.reduce((s, k) => s + COMPONENT_WEIGHTS[k], 0)
    score = Math.round(available.reduce((s, k) => s + (components[k] as number) * COMPONENT_WEIGHTS[k] / totalWeight, 0))
  }

  const band: RecoveryScore['band'] = score >= 75 ? 'high' : score >= 50 ? 'moderate' : 'low'

  const explanation = score >= 75 ? '' : EXPLANATION_LABELS
    .filter(l => components[l.key] !== null && (components[l.key] as number) < 50)
    .sort((a, b) => (components[a.key] as number) - (components[b.key] as number))
    .slice(0, 2)
    .map(l => l.label)
    .join(', ')

  return { score, band, explanation, components }
}

/** Returns 2 when the most recent two entries both score band 'low' (Red), else 0.
 * A fully-unavailable day defaults to band 'moderate' (see computeRecoveryScore above),
 * so a data gap between two Red days correctly breaks the streak rather than being
 * skipped over. */
export function getConsecutiveRedDays(results: RecoveryInputsRangeResult[]): number {
  const last = results.at(-1)
  const prev = results.at(-2)
  if (!last || !prev) return 0
  const lastScore = computeRecoveryScore(last.inputs)
  const prevScore = computeRecoveryScore(prev.inputs)
  return lastScore.band === 'low' && prevScore.band === 'low' ? 2 : 0
}
