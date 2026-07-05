import { computeHrvIndex, computeWellnessIndex } from '@/lib/recovery-score'

export const STRAIN_TRAINING_LOAD_MAX = 150
export const STRAIN_NONPOWER_LOAD_MAX = 50 // ceiling for walks, runs, HR-only activities
export const STRAIN_WORKOUT_WEIGHT = 14
export const STRAIN_LIFE_WEIGHT = 7

export const STRAIN_SLEEP_WEIGHT = 2.0
export const STRAIN_BATTERY_WEIGHT = 1.5
export const STRAIN_SLEEP_DURATION_WEIGHT = 1.0
export const STRAIN_HRV_WEIGHT = 2.0
export const STRAIN_WELLNESS_WEIGHT = 1.0
export const STRAIN_DRAIN_WEIGHT = 1.0
export const STRAIN_SLEEP_DURATION_TARGET_SECS = 27000 // 7.5h = no penalty
export const STRAIN_SLEEP_DURATION_MIN_SECS = 18000 // 5h = max penalty

// 0–100 recovery score for sleep duration. 7.5h+ = 100, 5h = 0, linear between.
function sleepDurationScore(secs: number): number {
  return Math.max(0, Math.min(100,
    ((secs - STRAIN_SLEEP_DURATION_MIN_SECS) /
     (STRAIN_SLEEP_DURATION_TARGET_SECS - STRAIN_SLEEP_DURATION_MIN_SECS)) * 100,
  ))
}

// Non-power activities (runs, walks, HR-only rides) report training_load on a 0–50 scale.
// Scale them up to the 0–150 power-based range so they're comparable to cycling TSS.
export function computeDailyActivityLoad(
  activities: Array<{
    start_date_local: string
    training_load: number | null
    weighted_average_watts: number | null
    rolling_ftp: number | null
  }>,
  date: string,
  ftpWatts?: number | null,
): number {
  const nonPowerScale = STRAIN_TRAINING_LOAD_MAX / STRAIN_NONPOWER_LOAD_MAX
  return activities
    .filter(a => a.start_date_local.startsWith(date))
    .reduce((sum, a) => {
      const load = a.training_load ?? 0
      if (load === 0) return sum
      const ftp = ftpWatts ?? a.rolling_ftp
      if (a.weighted_average_watts && ftp && ftp > 0) {
        const intensityFactor = Math.min(1.5, a.weighted_average_watts / ftp)
        return sum + load * intensityFactor
      }
      return sum + load * nonPowerScale
    }, 0)
}

export interface LifeLoadInputs {
  sleepScore: number | null
  bodyBatteryHigh: number | null
  sleepSecs?: number | null
  hrv?: number | null
  hrvBaseline?: number | null
  energy?: number | null
  legFreshness?: number | null
  batteryDrained?: number | null
}

interface LifeLoadParts {
  sleepRawPts: number
  sleepDurationRawPts: number
  batteryRawPts: number
  hrvRawPts: number
  wellnessRawPts: number
  drainRawPts: number
  availableWeight: number
}

// Blends every present life-load signal into raw (un-normalised) points plus the
// total weight of signals actually available. Signals are combined using a
// weighted-average blend: each present signal contributes its raw points and its
// weight to the denominator; absent signals are excluded rather than counted as
// zero, so a missing value doesn't drag the score.
function computeLifeLoadParts(inputs: LifeLoadInputs): LifeLoadParts {
  const {
    sleepScore, bodyBatteryHigh, sleepSecs = null,
    hrv = null, hrvBaseline = null, energy = null, legFreshness = null, batteryDrained = null,
  } = inputs

  let sleepRawPts = 0
  let sleepDurationRawPts = 0
  let batteryRawPts = 0
  let hrvRawPts = 0
  let wellnessRawPts = 0
  let drainRawPts = 0
  let availableWeight = 0

  if (sleepScore != null) {
    sleepRawPts = ((100 - sleepScore) / 100) * STRAIN_SLEEP_WEIGHT
    availableWeight += STRAIN_SLEEP_WEIGHT
  }
  if (sleepSecs != null) {
    sleepDurationRawPts = ((100 - sleepDurationScore(sleepSecs)) / 100) * STRAIN_SLEEP_DURATION_WEIGHT
    availableWeight += STRAIN_SLEEP_DURATION_WEIGHT
  }
  if (bodyBatteryHigh != null) {
    batteryRawPts = ((100 - bodyBatteryHigh) / 100) * STRAIN_BATTERY_WEIGHT
    availableWeight += STRAIN_BATTERY_WEIGHT
  }
  const hrvGoodness = computeHrvIndex({ hrv, hrvBaseline })
  if (hrvGoodness != null) {
    hrvRawPts = ((100 - hrvGoodness) / 100) * STRAIN_HRV_WEIGHT
    availableWeight += STRAIN_HRV_WEIGHT
  }
  const wellnessGoodness = computeWellnessIndex({ energy, leg_freshness: legFreshness })
  if (wellnessGoodness != null) {
    wellnessRawPts = ((100 - wellnessGoodness) / 100) * STRAIN_WELLNESS_WEIGHT
    availableWeight += STRAIN_WELLNESS_WEIGHT
  }
  if (batteryDrained != null) {
    drainRawPts = (Math.max(0, Math.min(100, batteryDrained)) / 100) * STRAIN_DRAIN_WEIGHT
    availableWeight += STRAIN_DRAIN_WEIGHT
  }

  return { sleepRawPts, sleepDurationRawPts, batteryRawPts, hrvRawPts, wellnessRawPts, drainRawPts, availableWeight }
}

export function computeDailyLifeLoad(inputs: LifeLoadInputs): number | null {
  const { sleepScore, bodyBatteryHigh, sleepSecs = null, hrv = null, energy = null, legFreshness = null, batteryDrained = null } = inputs
  if (sleepScore == null && bodyBatteryHigh == null && sleepSecs == null
    && hrv == null && energy == null && legFreshness == null && batteryDrained == null) return null
  const parts = computeLifeLoadParts(inputs)
  const rawLife = parts.sleepRawPts + parts.sleepDurationRawPts + parts.batteryRawPts
    + parts.hrvRawPts + parts.wellnessRawPts + parts.drainRawPts
  return parts.availableWeight > 0 ? (rawLife / parts.availableWeight) * STRAIN_LIFE_WEIGHT : null
}

export interface StrainComponents {
  total: number             // final strain score 0–21
  workoutPts: number
  workoutLoad: number
  lifePts: number
  sleepRawPts: number       // un-normalised sleep quality pts (for donut)
  sleepDurationRawPts: number
  batteryRawPts: number
  hrvRawPts: number
  wellnessRawPts: number
  drainRawPts: number
  sleepScore: number | null
  sleepSecs: number | null
  bodyBatteryHigh: number | null  // daily peak battery (post-sleep), not the midnight trough
  hrv: number | null
  hrvBaseline: number | null
  energy: number | null
  legFreshness: number | null
  batteryDrained: number | null
}

export function computeStrainComponents(
  activityLoad: number | null,
  inputs: LifeLoadInputs,
): StrainComponents | null {
  const {
    sleepScore, bodyBatteryHigh, sleepSecs = null,
    hrv = null, hrvBaseline = null, energy = null, legFreshness = null, batteryDrained = null,
  } = inputs
  if (activityLoad == null && sleepScore == null && bodyBatteryHigh == null && sleepSecs == null
    && hrv == null && energy == null && legFreshness == null && batteryDrained == null) return null

  const load = activityLoad ?? 0
  const workoutPts = Math.min(STRAIN_WORKOUT_WEIGHT, (load / STRAIN_TRAINING_LOAD_MAX) * STRAIN_WORKOUT_WEIGHT)

  const parts = computeLifeLoadParts(inputs)
  const rawLife = parts.sleepRawPts + parts.sleepDurationRawPts + parts.batteryRawPts
    + parts.hrvRawPts + parts.wellnessRawPts + parts.drainRawPts
  const lifePts = parts.availableWeight > 0 ? (rawLife / parts.availableWeight) * STRAIN_LIFE_WEIGHT : 0
  const total = Math.min(21, Math.round(workoutPts + lifePts))

  return {
    total, workoutPts, workoutLoad: load, lifePts,
    sleepRawPts: parts.sleepRawPts,
    sleepDurationRawPts: parts.sleepDurationRawPts,
    batteryRawPts: parts.batteryRawPts,
    hrvRawPts: parts.hrvRawPts,
    wellnessRawPts: parts.wellnessRawPts,
    drainRawPts: parts.drainRawPts,
    sleepScore, sleepSecs, bodyBatteryHigh,
    hrv, hrvBaseline, energy, legFreshness, batteryDrained,
  }
}

export function computeDailyStrain(
  activityLoad: number | null,
  lifeLoad: number | null,
): number | null {
  if (activityLoad == null && lifeLoad == null) return null
  // No activity load and life signals not yet synced — nothing meaningful to show
  if ((activityLoad == null || activityLoad === 0) && lifeLoad == null) return null
  const workout = ((activityLoad ?? 0) / STRAIN_TRAINING_LOAD_MAX) * STRAIN_WORKOUT_WEIGHT
  const life = lifeLoad ?? 0
  return Math.min(21, Math.round(workout + life))
}

export function strainLabel(score: number): 'low' | 'moderate' | 'high' {
  if (score < 9) return 'low'
  if (score <= 14) return 'moderate'
  return 'high'
}

export function formatStrainForPrompt(
  strain: number | null,
  sleepScore?: number | null,
  bodyBatteryHigh?: number | null,
  sleepSecs?: number | null,
): string {
  if (strain == null) return ''
  const parts: string[] = []
  if (sleepScore != null && sleepScore < 70) parts.push(`sleep ${sleepScore}/100`)
  if (sleepSecs != null && sleepSecs < 21600) parts.push(`slept ${(sleepSecs / 3600).toFixed(1)}h`)
  if (bodyBatteryHigh != null && bodyBatteryHigh < 50) parts.push(`body battery peak ${bodyBatteryHigh}%`)
  const context = parts.length ? ` — ${parts.join(', ')}` : ''
  return `Daily Strain: ${strain}/21 (${strainLabel(strain)})${context}`
}

export function formatStrainHistoryForPrompt(
  history: Array<{ date: string; strain: number | null }>,
): string {
  if (history.length < 2) return ''
  const scores = history.map(h => h.strain)
  const valid = scores.filter((s): s is number => s != null)
  if (!valid.length) return ''
  const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
  const recent = scores.slice(-3).filter((s): s is number => s != null)
  const earlier = scores.slice(0, 4).filter((s): s is number => s != null)
  // Compare last 3 days vs first 4 days to detect trend
  const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0
  const earlierAvg = earlier.length ? earlier.reduce((a, b) => a + b, 0) / earlier.length : 0
  const trend = recentAvg > earlierAvg + 2 ? 'rising' : recentAvg < earlierAvg - 2 ? 'falling' : 'stable'
  const vals = scores.map(s => (s == null ? '—' : String(s))).join(' ')
  return `Strain (last ${scores.length} days): ${vals} (avg: ${avg}, trend: ${trend})`
}
