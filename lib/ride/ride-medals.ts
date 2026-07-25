import type { BestRecordRow, BestCategory } from './best-records'

export interface MedalEntry {
  category: BestCategory
  subKey: string   // '' for climbs/max_speed; duration (secs) or distance (km) for power/speed
}

export interface RideMedals {
  allTime: MedalEntry[]
  year: MedalEntry[]
}

// Builds a workoutId -> RideMedals lookup from a flat list of best_records rows
// (any mix of periods/surfaces, typically all of one user's rows). Rows whose
// detail.workoutId is null (deep-history champions with no local `workouts` row)
// are skipped — there's no card to attach a badge to. A category already present
// in a ride's `allTime` list is never also added to that ride's `year` list, even
// though best_records may carry a row for both periods — an all-time record is
// trivially also that year's best, so listing both would be redundant.
export function buildMedalsByWorkoutId(rows: BestRecordRow[]): Record<string, RideMedals> {
  const result: Record<string, RideMedals> = {}
  const allTimeCategories: Record<string, Set<BestCategory>> = {}

  for (const r of rows) {
    if (r.period !== 'all') continue
    const workoutId = (r.detail as { workoutId: string | null }).workoutId
    if (!workoutId) continue
    if (!result[workoutId]) result[workoutId] = { allTime: [], year: [] }
    if (!allTimeCategories[workoutId]) allTimeCategories[workoutId] = new Set()
    if (allTimeCategories[workoutId].has(r.category)) continue
    allTimeCategories[workoutId].add(r.category)
    result[workoutId].allTime.push({ category: r.category, subKey: r.sub_key })
  }

  const yearCategories: Record<string, Set<BestCategory>> = {}
  for (const r of rows) {
    if (r.period === 'all') continue
    const workoutId = (r.detail as { workoutId: string | null }).workoutId
    if (!workoutId) continue
    if (allTimeCategories[workoutId]?.has(r.category)) continue
    if (!result[workoutId]) result[workoutId] = { allTime: [], year: [] }
    if (!yearCategories[workoutId]) yearCategories[workoutId] = new Set()
    if (yearCategories[workoutId].has(r.category)) continue
    yearCategories[workoutId].add(r.category)
    result[workoutId].year.push({ category: r.category, subKey: r.sub_key })
  }

  return result
}
