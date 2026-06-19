export const STRAIN_TRAINING_LOAD_MAX = 150
export const STRAIN_NONPOWER_LOAD_MAX = 50
export const STRAIN_WORKOUT_WEIGHT = 14
export const STRAIN_LIFE_WEIGHT = 7

export const STRAIN_SLEEP_WEIGHT = 2.0
export const STRAIN_BATTERY_WEIGHT = 1.5
export const STRAIN_BATTERY_DRAIN_WEIGHT = 1.5
export const STRAIN_SLEEP_DURATION_WEIGHT = 1.0
export const STRAIN_SLEEP_DURATION_TARGET_SECS = 27000
export const STRAIN_SLEEP_DURATION_MIN_SECS = 18000

function sleepDurationScore(secs: number): number {
  return Math.max(0, Math.min(100,
    ((secs - STRAIN_SLEEP_DURATION_MIN_SECS) /
     (STRAIN_SLEEP_DURATION_TARGET_SECS - STRAIN_SLEEP_DURATION_MIN_SECS)) * 100,
  ))
}

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

// Compute the life component of daily strain (0–7) from Garmin wellness signals.
// batteryDrain (BodyBatteryMax - BodyBatteryMin) is an optional fourth signal
// representing in-day cardiovascular drain; only used when the reading is from a
// post-8am live poll (caller's responsibility to enforce).
export function computeDailyLifeLoad(
  sleepScore: number | null,
  bodyBatteryHigh: number | null,
  sleepSecs: number | null = null,
  batteryDrain: number | null = null,
): number | null {
  if (sleepScore == null && bodyBatteryHigh == null && sleepSecs == null && batteryDrain == null) return null
  let rawScore = 0
  let availableWeight = 0
  if (sleepScore != null) {
    rawScore += ((100 - sleepScore) / 100) * STRAIN_SLEEP_WEIGHT
    availableWeight += STRAIN_SLEEP_WEIGHT
  }
  if (sleepSecs != null) {
    rawScore += ((100 - sleepDurationScore(sleepSecs)) / 100) * STRAIN_SLEEP_DURATION_WEIGHT
    availableWeight += STRAIN_SLEEP_DURATION_WEIGHT
  }
  if (bodyBatteryHigh != null) {
    rawScore += ((100 - bodyBatteryHigh) / 100) * STRAIN_BATTERY_WEIGHT
    availableWeight += STRAIN_BATTERY_WEIGHT
  }
  if (batteryDrain != null) {
    rawScore += (batteryDrain / 100) * STRAIN_BATTERY_DRAIN_WEIGHT
    availableWeight += STRAIN_BATTERY_DRAIN_WEIGHT
  }
  return availableWeight > 0 ? (rawScore / availableWeight) * STRAIN_LIFE_WEIGHT : null
}

export interface StrainComponents {
  total: number
  workoutPts: number
  workoutLoad: number
  lifePts: number
  sleepRawPts: number
  sleepDurationRawPts: number
  batteryRawPts: number
  batteryDrainRawPts: number
  sleepScore: number | null
  sleepSecs: number | null
  bodyBatteryHigh: number | null
  batteryDrain: number | null
}

export function computeStrainComponents(
  activityLoad: number | null,
  sleepScore: number | null,
  bodyBatteryHigh: number | null,
  sleepSecs: number | null = null,
  batteryDrain: number | null = null,
): StrainComponents | null {
  if (activityLoad == null && sleepScore == null && bodyBatteryHigh == null && sleepSecs == null && batteryDrain == null) return null
  const load = activityLoad ?? 0
  const workoutPts = Math.min(STRAIN_WORKOUT_WEIGHT, (load / STRAIN_TRAINING_LOAD_MAX) * STRAIN_WORKOUT_WEIGHT)
  let sleepRawPts = 0
  let sleepDurationRawPts = 0
  let batteryRawPts = 0
  let batteryDrainRawPts = 0
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
  if (batteryDrain != null) {
    batteryDrainRawPts = (batteryDrain / 100) * STRAIN_BATTERY_DRAIN_WEIGHT
    availableWeight += STRAIN_BATTERY_DRAIN_WEIGHT
  }
  const rawLife = sleepRawPts + sleepDurationRawPts + batteryRawPts + batteryDrainRawPts
  const lifePts = availableWeight > 0 ? (rawLife / availableWeight) * STRAIN_LIFE_WEIGHT : 0
  const total = Math.min(21, Math.round(workoutPts + lifePts))
  return {
    total, workoutPts, workoutLoad: load, lifePts,
    sleepRawPts, sleepDurationRawPts, batteryRawPts, batteryDrainRawPts,
    sleepScore, sleepSecs, bodyBatteryHigh, batteryDrain,
  }
}

export function computeDailyStrain(
  activityLoad: number | null,
  lifeLoad: number | null,
): number | null {
  if (activityLoad == null && lifeLoad == null) return null
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
  const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0
  const earlierAvg = earlier.length ? earlier.reduce((a, b) => a + b, 0) / earlier.length : 0
  const trend = recentAvg > earlierAvg + 2 ? 'rising' : recentAvg < earlierAvg - 2 ? 'falling' : 'stable'
  const vals = scores.map(s => (s == null ? '—' : String(s))).join(' ')
  return `Strain (last ${scores.length} days): ${vals} (avg: ${avg}, trend: ${trend})`
}
