import type { PlanPhase } from '@/types'

const PHASES: PlanPhase[] = ['base', 'build', 'peak', 'taper']

/**
 * Deterministic per-week phase labels from a plan's weekly planned-TSS profile.
 * Yields base → build → peak → taper. Used as a fallback when the plan has no
 * Claude-supplied phases (current/legacy plans).
 */
export function derivePhases(weeklyPlannedTss: number[], totalWeeks: number): PlanPhase[] {
  const n = totalWeeks
  const tss = Array.from({ length: n }, (_, i) => weeklyPlannedTss[i] ?? 0)
  const phases: PlanPhase[] = Array.from({ length: n }, () => 'base')
  const peak = Math.max(0, ...tss)
  if (peak === 0) return phases

  // Taper: trailing weeks under 80% of peak, capped at 2. Force the last week on
  // a long plan if nothing qualified (a plan always eases into its end/event).
  const isTaper = Array.from({ length: n }, () => false)
  let taperCount = 0
  for (let i = n - 1; i >= 0 && taperCount < 2; i--) {
    if (tss[i] < 0.8 * peak) { isTaper[i] = true; taperCount++ } else break
  }
  if (taperCount === 0 && n >= 4) isTaper[n - 1] = true

  // Peak: highest non-taper week, plus one adjacent non-taper week >= 90% of peak.
  let peakIdx = -1
  let peakVal = -1
  for (let i = 0; i < n; i++) {
    if (!isTaper[i] && tss[i] > peakVal) { peakVal = tss[i]; peakIdx = i }
  }
  const isPeak = Array.from({ length: n }, () => false)
  if (peakIdx >= 0) {
    isPeak[peakIdx] = true
    for (const j of [peakIdx - 1, peakIdx + 1]) {
      if (isPeak.filter(Boolean).length >= 2) break
      if (j >= 0 && j < n && !isTaper[j] && tss[j] >= 0.9 * peak) isPeak[j] = true
    }
  }

  const firstPeak = isPeak.indexOf(true)
  for (let i = 0; i < n; i++) {
    if (isTaper[i]) { phases[i] = 'taper'; continue }
    if (isPeak[i]) { phases[i] = 'peak'; continue }
    if (firstPeak === -1) { phases[i] = 'base'; continue }
    if (i > firstPeak) { phases[i] = 'build'; continue }
    // Pre-peak weeks: split first-half base, second-half build (<=2 weeks → all base).
    phases[i] = firstPeak <= 2 ? 'base' : (i < Math.ceil(firstPeak / 2) ? 'base' : 'build')
  }
  return phases
}

/** Use Claude-supplied phases when present and length-correct, else derive. */
export function resolvePhases(
  stored: PlanPhase[] | null | undefined,
  weeklyPlannedTss: number[],
  totalWeeks: number,
): PlanPhase[] {
  if (Array.isArray(stored) && stored.length === totalWeeks && stored.every(p => PHASES.includes(p))) {
    return stored
  }
  return derivePhases(weeklyPlannedTss, totalWeeks)
}
