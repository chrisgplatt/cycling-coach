import type { ICUActivity } from '@/types'

export interface PendingWorkout {
  id: string
  date: string
  created_at: string
}

export interface WorkoutMatch {
  id: string
  icu_activity_id: string
  tss: number | null
  actual_duration_minutes: number
  status: 'completed' | 'needs_review'
}

// Matches unfinished workouts to same-day ride activities. A single ride must
// never be matched to more than one workout: when several workouts share a
// date, rides are paired one-to-one (earliest-created workout gets the
// highest-load ride, and so on) rather than each workout independently
// grabbing "the best" activity for that date. Any workout left without a
// paired ride (more workouts than rides that day) is omitted from the result
// and stays untouched by the caller.
export function matchWorkoutsToActivities(
  pending: PendingWorkout[],
  activitiesByDate: Map<string, ICUActivity[]>,
): WorkoutMatch[] {
  const pendingByDate = new Map<string, PendingWorkout[]>()
  for (const w of pending) {
    pendingByDate.set(w.date, [...(pendingByDate.get(w.date) ?? []), w])
  }

  const matches: WorkoutMatch[] = []

  for (const [date, workoutsForDate] of pendingByDate) {
    const acts = (activitiesByDate.get(date) ?? []).filter(a => /ride/i.test(a.type))
    if (acts.length === 0) continue

    if (workoutsForDate.length === 1) {
      const best = acts.reduce((a, b) => (b.training_load ?? 0) > (a.training_load ?? 0) ? b : a)
      matches.push({
        id: workoutsForDate[0].id,
        icu_activity_id: best.id,
        tss: best.training_load,
        actual_duration_minutes: Math.round(best.moving_time / 60),
        status: acts.length === 1 ? 'completed' : 'needs_review',
      })
      continue
    }

    const sortedWorkouts = [...workoutsForDate].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
    const sortedActs = [...acts].sort((a, b) => (b.training_load ?? 0) - (a.training_load ?? 0))
    sortedWorkouts.forEach((w, i) => {
      const act = sortedActs[i]
      if (!act) return
      matches.push({
        id: w.id,
        icu_activity_id: act.id,
        tss: act.training_load,
        actual_duration_minutes: Math.round(act.moving_time / 60),
        status: 'completed',
      })
    })
  }

  return matches
}
