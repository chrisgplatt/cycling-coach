export const STRAIN_TRAINING_LOAD_MAX = 400
export const STRAIN_WORKOUT_WEIGHT = 14
export const STRAIN_LIFE_WEIGHT = 7

// Sum intensity-weighted training load across all activities on a given date.
// For power-metered rides, load is scaled by intensity factor (NP/FTP) so a
// threshold ride contributes more than an easy spin at the same TSS.
// Non-power activities (walks, runs, HR-only rides) use their raw training load
// since intervals.icu already incorporates HR-based intensity into that figure.
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
      return sum + load
    }, 0)
}

export function computeDailyStrain(
  activityLoad: number | null,
  stressAvg: number | null,
): number | null {
  if (activityLoad == null && stressAvg == null) return null
  // No activity load and stress not yet synced — nothing meaningful to show
  if ((activityLoad == null || activityLoad === 0) && stressAvg == null) return null
  const workout = ((activityLoad ?? 0) / STRAIN_TRAINING_LOAD_MAX) * STRAIN_WORKOUT_WEIGHT
  const life = ((stressAvg ?? 0) / 100) * STRAIN_LIFE_WEIGHT
  return Math.min(21, Math.round(workout + life))
}

export function strainLabel(score: number): 'low' | 'moderate' | 'high' {
  if (score < 9) return 'low'
  if (score <= 14) return 'moderate'
  return 'high'
}

export function formatStrainForPrompt(strain: number | null): string {
  if (strain == null) return ''
  return `Daily Strain: ${strain}/21 (${strainLabel(strain)})`
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
