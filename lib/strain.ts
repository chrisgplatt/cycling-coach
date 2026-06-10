export const STRAIN_TRAINING_LOAD_MAX = 400
export const STRAIN_NONPOWER_LOAD_MAX = 50  // ceiling for walks, runs, HR-only activities
export const STRAIN_WORKOUT_WEIGHT = 14
export const STRAIN_LIFE_WEIGHT = 7

// Sub-weights within the 7-point life component
const STRAIN_STRESS_WEIGHT = 3.5
const STRAIN_SLEEP_WEIGHT = 2.0
const STRAIN_BATTERY_WEIGHT = 1.5

// Sum activity load across all activities on a given date, normalised to the
// power scale so computeDailyStrain can use a single ceiling (STRAIN_TRAINING_LOAD_MAX).
//
// Power-metered rides: load × IF (NP/FTP) — harder rides contribute more.
// Non-power activities (walks, runs, HR-only): load is scaled up by
// (STRAIN_TRAINING_LOAD_MAX / STRAIN_NONPOWER_LOAD_MAX) so that a "full"
// non-power day (≈50 TSS) saturates the same workout component as a
// "full" cycling day (≈400 TSS), meaning small walk loads register as 1–2/21
// rather than rounding to zero.
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
//
// Blends up to three signals: stress (3.5 pts), sleep quality (2 pts),
// body battery recovery floor (1.5 pts). Missing signals are excluded from
// the denominator so the remaining signals normalise back to 7 pts —
// stress-only input gives the same result as the previous stressAvg formula.
export function computeDailyLifeLoad(
  stressAvg: number | null,
  stressHigh: number | null,
  sleepScore: number | null,
  bodyBatteryLow: number | null,
): number | null {
  if (stressAvg == null && sleepScore == null && bodyBatteryLow == null) return null
  let rawScore = 0
  let availableWeight = 0
  if (stressAvg != null) {
    const effective = stressHigh != null
      ? stressAvg * 0.7 + stressHigh * 0.3
      : stressAvg
    rawScore += (effective / 100) * STRAIN_STRESS_WEIGHT
    availableWeight += STRAIN_STRESS_WEIGHT
  }
  if (sleepScore != null) {
    rawScore += ((100 - sleepScore) / 100) * STRAIN_SLEEP_WEIGHT
    availableWeight += STRAIN_SLEEP_WEIGHT
  }
  if (bodyBatteryLow != null) {
    rawScore += ((100 - bodyBatteryLow) / 100) * STRAIN_BATTERY_WEIGHT
    availableWeight += STRAIN_BATTERY_WEIGHT
  }
  return availableWeight > 0 ? (rawScore / availableWeight) * STRAIN_LIFE_WEIGHT : null
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
  bodyBatteryLow?: number | null,
): string {
  if (strain == null) return ''
  const parts: string[] = []
  if (sleepScore != null && sleepScore < 70) parts.push(`sleep ${sleepScore}/100`)
  if (bodyBatteryLow != null && bodyBatteryLow < 50) parts.push(`body battery woke at ${bodyBatteryLow}%`)
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
  // Compare last 3 days vs first 4 days to detect trend
  const recent = scores.slice(-3).filter((s): s is number => s != null)
  const earlier = scores.slice(0, 4).filter((s): s is number => s != null)
  const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0
  const earlierAvg = earlier.length ? earlier.reduce((a, b) => a + b, 0) / earlier.length : 0
  const trend = recentAvg > earlierAvg + 2 ? 'rising' : recentAvg < earlierAvg - 2 ? 'falling' : 'stable'
  const vals = scores.map(s => (s == null ? '—' : String(s))).join(' ')
  return `Strain (last ${scores.length} days): ${vals} (avg: ${avg}, trend: ${trend})`
}
