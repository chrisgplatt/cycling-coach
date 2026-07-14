import type { ICUActivity, ICUWellness, ProgressMetrics, WeightEntry, WorkoutStatus } from '@/types'
import { isSessionCountable, isSessionCompleted } from './session-counting'

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
  optional?: boolean
}

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const dow = d.getDay() // 0=Sun, 1=Mon…6=Sat
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  return d.toISOString().split('T')[0]
}

export function computeProgressMetrics(
  wellness: ICUWellness[],
  currentFTP: number,
  currentWeightKg: number,
  plan: PlanInfo | null,
  weightLog: WeightEntry[],
  planWorkouts: PlanWorkout[],
  activities: ICUActivity[] = [],
  minSessionsPerWeek: number = 3,
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

  // Adherence
  let adherence: ProgressMetrics['adherence'] = null
  if (plan && planWorkouts.length > 0) {
    // includes today — a planned session today counts until it's marked completed
    const pastAndToday = planWorkouts.filter(w => w.date <= today)
    const countable = pastAndToday.filter(isSessionCountable)
    const completed = countable.filter(isSessionCompleted).length
    const total = countable.length
    if (total > 0) adherence = { completed, total }
  }

  // Streak — consecutive weeks (Mon-Sun) ending before current week where completed >= minSessionsPerWeek
  let streak: number | null = null
  if (plan && planWorkouts.length > 0) {
    const currentWeekStart = getWeekStart(today)
    const weekMap = new Map<string, number>()
    for (const w of planWorkouts) {
      const ws = getWeekStart(w.date)
      if (ws >= currentWeekStart) continue // exclude current (in-progress) week
      if (!weekMap.has(ws)) weekMap.set(ws, 0)
      if (w.status === 'completed') weekMap.set(ws, weekMap.get(ws)! + 1)
    }
    if (weekMap.size > 0) {
      const weeks = [...weekMap.keys()].sort((a, b) => b.localeCompare(a)) // newest first
      let count = 0
      for (const ws of weeks) {
        if (weekMap.get(ws)! >= minSessionsPerWeek) count++
        else break
      }
      streak = count
    }
  }

  // Total rides since plan start (fallback: last 6 weeks)
  let totalRides: number | null = null
  if (activities.length > 0) {
    let baseline: string
    if (planStartDate) {
      baseline = planStartDate
    } else {
      const d = new Date()
      d.setDate(d.getDate() - 42)
      baseline = d.toISOString().split('T')[0]
    }
    const count = activities.filter(a => /ride/i.test(a.type) && a.start_date_local.substring(0, 10) >= baseline).length
    if (count > 0) totalRides = count
  }

  return {
    ftp,
    ctl,
    weight,
    adherence,
    streak,
    totalRides,
    planPhase: plan?.phase ?? null,
    targetEvent: plan?.target_event_name ?? null,
    targetDate: plan?.target_event_date ?? null,
    planStartDate,
  }
}
