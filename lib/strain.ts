export const TRIMP_COEFF_A = 0.64   // Banister male coefficients — fixed default,
export const TRIMP_COEFF_B = 1.92   // no sex field on the profile to branch on
export const TRIMP_PER_TSS_FALLBACK = 1.0   // tunable — activities without HR data

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

export interface DailyActivityInput {
  name: string
  durationMin: number
  avgHr: number | null
  trainingLoad: number | null
}

/** Per-activity Banister HRR-exponential TRIMP; falls back to a scaled training_load estimate when HR data isn't available. */
function activityTrimp(a: DailyActivityInput, maxHr: number | null, restingHr: number | null): number {
  if (a.avgHr != null && maxHr != null && restingHr != null && maxHr > restingHr) {
    const hrr = clamp01((a.avgHr - restingHr) / (maxHr - restingHr))
    return a.durationMin * hrr * TRIMP_COEFF_A * Math.exp(TRIMP_COEFF_B * hrr)
  }
  if (a.trainingLoad != null) return a.trainingLoad * TRIMP_PER_TSS_FALLBACK
  return 0
}

export function computeDailyTrimp(
  activities: DailyActivityInput[],
  maxHr: number | null,
  restingHr: number | null,
): number {
  return activities.reduce((sum, a) => sum + activityTrimp(a, maxHr, restingHr), 0)
}

export function computeActivityTrimpBreakdown(
  activities: DailyActivityInput[],
  maxHr: number | null,
  restingHr: number | null,
): Array<{ name: string; trimp: number }> {
  return activities
    .map(a => ({ name: a.name, trimp: activityTrimp(a, maxHr, restingHr) }))
    .filter(a => a.trimp > 0)
}

export const TRIMP_REF_MIN_SAMPLES = 5
export const TRIMP_REF_COLD_START_DEFAULT = 150   // tunable — pending a first real hard-day sample
export const TRIMP_REF_PERCENTILE = 0.95
export const TRIMP_REF_WINDOW_DAYS = 21

export function computeTrimpRef(trailingDailyTrimp: number[]): number {
  const valid = trailingDailyTrimp.filter(v => v > 0)
  if (valid.length < TRIMP_REF_MIN_SAMPLES) return TRIMP_REF_COLD_START_DEFAULT
  const sorted = [...valid].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil(TRIMP_REF_PERCENTILE * sorted.length) - 1)
  return sorted[idx]
}

// Curve sharpness for the trimp→strain mapping below, independent of trimpRef itself.
// Using ln(1+dailyTrimp)/ln(1+trimpRef) directly (equivalent to the k=trimpRef case)
// made the curve far too steep near zero — with a typical trimpRef of 100-300, a day at
// just 15-25% of the reference (an easy walk or recovery spin) still landed at ~13-16/21
// ("high"), because a log curve's own scale sets how concave it is: a bigger implicit
// base (trimpRef, often 100+) front-loads the rise so hard that almost any nonzero
// effort already reads as a large fraction of the way to 21. Fixing k at a small
// constant decouples "how concave the curve is" from "what counts as a hard day" —
// light effort (~15-25% of trimpRef) now lands at 4-8/21 ("light"), while dailyTrimp ==
// trimpRef still reaches 21 and > trimpRef still caps there, matching prior behaviour
// at the endpoints.
const STRAIN_CURVE_SHARPNESS = 6

export function computeWorkoutStrain(dailyTrimp: number, trimpRef: number): number {
  if (dailyTrimp <= 0) return 0
  const ref = Math.max(trimpRef, 1)
  const k = STRAIN_CURVE_SHARPNESS
  return Math.min(21, Math.round(21 * Math.log(1 + k * (dailyTrimp / ref)) / Math.log(1 + k)))
}

export const STRAIN_TARGET_LOW_MAX = 14     // recovery=100 → low bound approaches 14
export const STRAIN_TARGET_RANGE_WIDTH = 7  // range width, tunable — matches Whoop's ~8pt example

export function computeStrainTarget(recoveryScore: number): { low: number; high: number } {
  const low = Math.round(clamp01(recoveryScore / 100) * STRAIN_TARGET_LOW_MAX)
  const high = Math.min(21, low + STRAIN_TARGET_RANGE_WIDTH)
  return { low, high }
}

export function strainLabel(score: number): 'light' | 'moderate' | 'high' | 'all_out' {
  if (score <= 9) return 'light'
  if (score <= 13) return 'moderate'
  if (score <= 17) return 'high'
  return 'all_out'
}

export interface StrainSeriesDayInput {
  date: string
  activities: DailyActivityInput[]
  restingHr: number | null
  frozenDailyTrimp: number | null
  frozenTrimpRef: number | null
  frozenWorkoutStrain: number | null
}

export interface StrainSeriesDayResult {
  date: string
  dailyTrimp: number
  trimpRef: number
  workoutStrain: number
  needsFreeze: boolean
}

/** `days` must be sorted chronologically ascending. Frozen past days pass through untouched;
 * unfrozen past days and today are computed live against a rolling window of the trailing
 * `TRIMP_REF_WINDOW_DAYS` daily_trimp values seen so far in this same series. */
export function computeWorkoutStrainSeries(
  days: StrainSeriesDayInput[],
  maxHr: number | null,
  today: string,
): StrainSeriesDayResult[] {
  const window: number[] = []
  const results: StrainSeriesDayResult[] = []

  for (const day of days) {
    const isPast = day.date < today
    const alreadyFrozen = isPast
      && day.frozenDailyTrimp != null && day.frozenTrimpRef != null && day.frozenWorkoutStrain != null

    let dailyTrimp: number
    let trimpRef: number
    let workoutStrain: number
    let needsFreeze: boolean

    if (alreadyFrozen) {
      dailyTrimp = day.frozenDailyTrimp!
      trimpRef = day.frozenTrimpRef!
      workoutStrain = day.frozenWorkoutStrain!
      needsFreeze = false
    } else {
      dailyTrimp = computeDailyTrimp(day.activities, maxHr, day.restingHr)
      trimpRef = computeTrimpRef(window)
      workoutStrain = computeWorkoutStrain(dailyTrimp, trimpRef)
      needsFreeze = isPast
    }

    results.push({ date: day.date, dailyTrimp, trimpRef, workoutStrain, needsFreeze })

    window.push(dailyTrimp)
    if (window.length > TRIMP_REF_WINDOW_DAYS) window.shift()
  }

  return results
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
  const recent = scores.slice(-3).filter((s): s is number => s != null)
  const earlier = scores.slice(0, 4).filter((s): s is number => s != null)
  // Compare last 3 days vs first 4 days to detect trend
  const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0
  const earlierAvg = earlier.length ? earlier.reduce((a, b) => a + b, 0) / earlier.length : 0
  const trend = recentAvg > earlierAvg + 2 ? 'rising' : recentAvg < earlierAvg - 2 ? 'falling' : 'stable'
  const vals = scores.map(s => (s == null ? '—' : String(s))).join(' ')
  return `Strain (last ${scores.length} days): ${vals} (avg: ${avg}, trend: ${trend})`
}
