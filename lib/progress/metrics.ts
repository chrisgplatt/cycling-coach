import type { ICUWellness, ProgressMetrics, WeightEntry, WorkoutStatus } from '@/types'

interface PlanInfo {
  created_at: string
  baseline_ftp: number | null
  phase: string
  target_event_name: string
  target_event_date: string
}

interface PlanWorkout {
  status: WorkoutStatus
  date: string
}

export function computeProgressMetrics(
  wellness: ICUWellness[],
  currentFTP: number,
  currentWeightKg: number,
  plan: PlanInfo | null,
  weightLog: WeightEntry[],
  planWorkouts: PlanWorkout[],
): ProgressMetrics {
  const today = new Date().toISOString().split('T')[0]
  const planStartDate = plan ? plan.created_at.split('T')[0] : null

  // FTP delta
  let ftp: ProgressMetrics['ftp'] = null
  if (plan?.baseline_ftp && plan.baseline_ftp > 0) {
    ftp = {
      current: currentFTP,
      baseline: plan.baseline_ftp,
      delta: currentFTP - plan.baseline_ftp,
    }
  }

  // CTL delta
  let ctl: ProgressMetrics['ctl'] = null
  if (wellness.length > 0) {
    const sorted = [...wellness].sort((a, b) => a.id.localeCompare(b.id))
    const latest = sorted[sorted.length - 1]
    if (latest.ctl !== null) {
      let baselineEntry = sorted[0]
      if (planStartDate) {
        const onOrAfter = sorted.find(w => w.id >= planStartDate)
        if (onOrAfter) baselineEntry = onOrAfter
      }
      if (baselineEntry.ctl !== null) {
        ctl = {
          current: Math.round(latest.ctl),
          baseline: Math.round(baselineEntry.ctl),
          delta: Math.round(latest.ctl - baselineEntry.ctl),
        }
      }
    }
  }

  // Weight delta
  let weight: ProgressMetrics['weight'] = null
  if (weightLog.length > 0) {
    const sorted = [...weightLog].sort((a, b) => a.date.localeCompare(b.date))
    const latest = sorted[sorted.length - 1]
    let baselineWeight: number | null = null
    if (planStartDate) {
      const before = sorted.filter(w => w.date <= planStartDate)
      const after = sorted.filter(w => w.date > planStartDate)
      if (before.length) baselineWeight = before[before.length - 1].weight_kg
      // fallback: use earliest post-plan entry if no pre-plan weight exists
      else if (after.length) baselineWeight = after[0].weight_kg
    } else {
      baselineWeight = sorted[0].weight_kg
    }
    if (baselineWeight !== null) {
      weight = {
        current: latest.weight_kg,
        baseline: baselineWeight,
        delta: Math.round((latest.weight_kg - baselineWeight) * 10) / 10,
      }
    }
  }

  // w/kg delta
  let wkg: ProgressMetrics['wkg'] = null
  if (ftp && weight) {
    const currentWkg = currentFTP / currentWeightKg
    const baselineWkg = ftp.baseline / weight.baseline
    wkg = {
      current: Math.round(currentWkg * 100) / 100,
      baseline: Math.round(baselineWkg * 100) / 100,
      delta: Math.round((currentWkg - baselineWkg) * 100) / 100,
    }
  }

  // Adherence
  let adherence: ProgressMetrics['adherence'] = null
  if (plan && planWorkouts.length > 0) {
    // includes today — a planned session today counts until it's marked completed
    const pastAndToday = planWorkouts.filter(w => w.date <= today)
    const completed = pastAndToday.filter(w => w.status === 'completed').length
    const total = pastAndToday.length
    if (total > 0) adherence = { completed, total }
  }

  return {
    ftp,
    ctl,
    wkg,
    weight,
    adherence,
    planPhase: plan?.phase ?? null,
    targetEvent: plan?.target_event_name ?? null,
    targetDate: plan?.target_event_date ?? null,
    planStartDate,
  }
}
