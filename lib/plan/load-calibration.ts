export interface LoadCalibrationInput {
  plannedTss: number
  actualTss: number       // completed TSS from the plan's own sessions only
  unplannedTss: number    // TSS from rides not on the plan (e.g. an unplanned event ride)
  allPlannedCompleted: boolean
  positiveFeedback: boolean
}

// CLAUDE.md's "Load calibration summary" table, as code: missed sessions reduce
// proportionally, unplanned rides add fatigue that reduces the next week, completing
// everything with positive feedback allows up to +10%, otherwise load is maintained.
// Clamped to [0.5, 1.1] so a single bad week can't collapse or blow out the plan.
export function computeLoadMultiplier(input: LoadCalibrationInput): number {
  const { plannedTss, actualTss, unplannedTss, allPlannedCompleted, positiveFeedback } = input

  if (plannedTss <= 0) return 1

  const completionRatio = Math.min(1, actualTss / plannedTss)
  let multiplier = allPlannedCompleted ? 1 : 0.7 + 0.3 * completionRatio

  if (allPlannedCompleted && positiveFeedback) multiplier = 1.1
  if (unplannedTss > 0) multiplier -= Math.min(0.3, unplannedTss / plannedTss * 0.3)

  return Math.max(0.5, Math.min(1.1, multiplier))
}
