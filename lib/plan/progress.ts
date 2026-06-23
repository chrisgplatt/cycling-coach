import type { Workout, ICUActivity, WorkoutType } from '@/types'

export interface WeekBucket {
  weekIndex: number
  plannedTss: number
  actualTss: number
  plannedSessions: number
  completedSessions: number
}

export type WeekState = 'done' | 'partial' | 'missed' | 'current' | 'upcoming'

// Fallback intensity factor per workout type, used only when a workout has no steps.
const IF_BY_TYPE: Record<WorkoutType, number> = {
  recovery: 0.55,
  endurance: 0.68,
  threshold: 0.95,
  intervals: 1.0,
  test: 1.0,
}

function isDone(status: Workout['status']): boolean {
  return status === 'completed' || status === 'needs_review'
}

function weekIndexOf(dateStr: string, planStart: string): number {
  const d = Date.parse(dateStr.split('T')[0] + 'T00:00:00Z')
  const s = Date.parse(planStart.split('T')[0] + 'T00:00:00Z')
  return Math.floor((d - s) / (7 * 86_400_000))
}

/** Target training stress for a session: from steps if present, else a type estimate. */
export function plannedTss(workout: Workout): number {
  if (workout.steps && workout.steps.length) {
    const tss = workout.steps.reduce(
      (sum, st) => sum + (st.duration_minutes / 60) * Math.pow(st.power_pct_ftp / 100, 2) * 100,
      0,
    )
    return Math.round(tss)
  }
  const intf = IF_BY_TYPE[workout.type] ?? 0.7
  return Math.round((workout.duration_minutes / 60) * intf * intf * 100)
}

/** Per-week planned/actual load and session counts across the plan window. */
export function buildWeekBuckets(
  workouts: Workout[],
  activities: ICUActivity[],
  planStart: string,
  totalWeeks: number,
): WeekBucket[] {
  const buckets: WeekBucket[] = Array.from({ length: totalWeeks }, (_, i) => ({
    weekIndex: i, plannedTss: 0, actualTss: 0, plannedSessions: 0, completedSessions: 0,
  }))
  for (const w of workouts) {
    if (!w.plan_id) continue
    const i = weekIndexOf(w.date, planStart)
    if (i < 0 || i >= totalWeeks) continue
    buckets[i].plannedTss += plannedTss(w)
    buckets[i].plannedSessions += 1
    if (isDone(w.status)) buckets[i].completedSessions += 1
  }
  for (const a of activities) {
    const i = weekIndexOf(a.start_date_local, planStart)
    if (i < 0 || i >= totalWeeks) continue
    buckets[i].actualTss += a.training_load ?? 0
  }
  for (const b of buckets) {
    b.plannedTss = Math.round(b.plannedTss)
    b.actualTss = Math.round(b.actualTss)
  }
  return buckets
}

export function weekState(bucket: WeekBucket, currentWeek: number): WeekState {
  if (bucket.weekIndex === currentWeek) return 'current'
  if (bucket.weekIndex > currentWeek) return 'upcoming'
  if (bucket.plannedSessions === 0) return 'upcoming'
  if (bucket.completedSessions >= bucket.plannedSessions) return 'done'
  if (bucket.completedSessions > 0) return 'partial'
  return 'missed'
}

export function consistency(
  buckets: WeekBucket[],
  currentWeek: number,
): { hitPct: number; streak: number } {
  let planned = 0
  let completed = 0
  for (const b of buckets) {
    if (b.weekIndex <= currentWeek && b.plannedSessions > 0) {
      planned += b.plannedSessions
      completed += b.completedSessions
    }
  }
  const hitPct = planned === 0 ? 0 : Math.round((completed / planned) * 100)

  let streak = 0
  for (let i = currentWeek - 1; i >= 0; i--) {
    const b = buckets[i]
    if (!b || b.plannedSessions === 0) break
    if (b.completedSessions / b.plannedSessions >= 0.8) streak++
    else break
  }
  return { hitPct, streak }
}

/** Hours trained across the plan: linked activity moving time, else planned duration. */
export function planHours(workouts: Workout[], activities: ICUActivity[]): number {
  const byId = new Map(activities.map(a => [a.id, a]))
  let secs = 0
  for (const w of workouts) {
    if (!w.plan_id || !isDone(w.status)) continue
    const act = w.icu_activity_id ? byId.get(w.icu_activity_id) : undefined
    secs += act?.moving_time ?? w.duration_minutes * 60
  }
  return Math.round(secs / 360) / 10
}
