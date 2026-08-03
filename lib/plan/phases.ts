import type { PlanPhase, Workout, ICUActivity } from '@/types'
import { buildWeekBuckets } from './progress'

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

/** Resolves which phase the current calendar week falls in, for a plan that may not have
 * a live UI displaying every week (unlike the /plan page, which already shows this via
 * buildWeekBuckets + resolvePhases inline). Reuses those same two functions so results are
 * guaranteed identical to the /plan page's own phase display — never reimplement this math
 * separately, that divergence is exactly what caused a previous hardcoded-phase bug. */
export function getCurrentPhase(
  workouts: Workout[],
  activities: ICUActivity[],
  weekPhases: PlanPhase[] | null | undefined,
  totalWeeks: number,
  planStart: string,
  today: string,
): PlanPhase {
  const start = new Date(planStart)
  const now = new Date(today)
  const current = Math.max(1, Math.min(totalWeeks, Math.floor((now.getTime() - start.getTime()) / (7 * 864e5)) + 1))
  const currentWeek = current - 1
  const buckets = buildWeekBuckets(workouts, activities, planStart, totalWeeks)
  const phases = resolvePhases(weekPhases, buckets.map(b => b.plannedTss), totalWeeks)
  return phases[currentWeek] ?? 'base'
}

interface PhaseAnchor { weeks: number; base: number; build: number; peak: number; taper: number }

// CLAUDE.md's phase-duration matrix, as data. Anchors the plan length -> phase-week-count
// mapping; computeWeekPhases interpolates for lengths that don't match a row exactly.
const PHASE_MATRIX: PhaseAnchor[] = [
  { weeks: 4, base: 1, build: 2, peak: 0, taper: 1 },
  { weeks: 6, base: 2, build: 2, peak: 1, taper: 1 },
  { weeks: 8, base: 2, build: 3, peak: 1, taper: 2 },
  { weeks: 10, base: 3, build: 4, peak: 1, taper: 2 },
  { weeks: 12, base: 4, build: 5, peak: 1, taper: 2 },
  { weeks: 16, base: 6, build: 6, peak: 2, taper: 2 },
  { weeks: 20, base: 8, build: 7, peak: 2, taper: 3 },
]

/**
 * Deterministic whole-plan phase schedule from CLAUDE.md's phase-duration matrix —
 * computed in code (not decided by Claude) so every generation batch sees the same
 * fixed periodization regardless of how many Claude calls the plan is split across.
 * Finds the nearest anchor row by week distance (ties go to the smaller anchor),
 * then adjusts the base-phase count by the difference (compressing base for shorter
 * plans, extending it for longer ones, per CLAUDE.md's "compress base first" rule),
 * clamping base to a minimum of 1 week and moving any remaining deficit onto build.
 */
export function computeWeekPhases(totalWeeks: number): PlanPhase[] {
  let nearest = PHASE_MATRIX[0]
  let nearestDist = Math.abs(totalWeeks - nearest.weeks)
  for (const row of PHASE_MATRIX.slice(1)) {
    const dist = Math.abs(totalWeeks - row.weeks)
    if (dist < nearestDist) { nearest = row; nearestDist = dist }
  }
  const delta = totalWeeks - nearest.weeks
  let base = nearest.base + delta
  let build = nearest.build
  if (base < 1) {
    build += base - 1
    base = 1
  }
  const phases: PlanPhase[] = [
    ...Array(base).fill('base'),
    ...Array(Math.max(0, build)).fill('build'),
    ...Array(nearest.peak).fill('peak'),
    ...Array(nearest.taper).fill('taper'),
  ]
  while (phases.length < totalWeeks) phases.unshift('base')
  return phases.slice(0, totalWeeks)
}

/**
 * Splits a plan into fixed-size week batches (default 4 weeks), 0-based like
 * WeekBucket.weekIndex elsewhere in this codebase. Each generation batch becomes its
 * own HTTP request, so no single request risks the serverless function's time limit
 * regardless of total plan length.
 */
export function buildPlanBatches(
  totalWeeks: number,
  batchSize = 4,
): Array<{ startWeek: number; weekCount: number }> {
  const batches: Array<{ startWeek: number; weekCount: number }> = []
  for (let start = 0; start < totalWeeks; start += batchSize) {
    batches.push({ startWeek: start, weekCount: Math.min(batchSize, totalWeeks - start) })
  }
  return batches
}
