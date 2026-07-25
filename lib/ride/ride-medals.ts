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
// are skipped — there's no card to attach a badge to. A ride can hold several
// distinct sub_keys within one category (e.g. both a 5-min and a 20-min power
// record) — each gets its own entry, so the detail list shows every one. Only an
// exact (category, sub_key) repeat is deduplicated, and a (category, sub_key)
// already present in a ride's `allTime` list is never also added to its `year`
// list, even though best_records may carry a row for both periods — an all-time
// record is trivially also that year's best, so listing both would be redundant.
export function buildMedalsByWorkoutId(rows: BestRecordRow[]): Record<string, RideMedals> {
  const result: Record<string, RideMedals> = {}
  const keyOf = (r: BestRecordRow) => `${r.category}:${r.sub_key}`
  const allTimeKeys: Record<string, Set<string>> = {}

  for (const r of rows) {
    if (r.period !== 'all') continue
    const workoutId = (r.detail as { workoutId: string | null }).workoutId
    if (!workoutId) continue
    if (!result[workoutId]) result[workoutId] = { allTime: [], year: [] }
    if (!allTimeKeys[workoutId]) allTimeKeys[workoutId] = new Set()
    const key = keyOf(r)
    if (allTimeKeys[workoutId].has(key)) continue
    allTimeKeys[workoutId].add(key)
    result[workoutId].allTime.push({ category: r.category, subKey: r.sub_key })
  }

  const yearKeys: Record<string, Set<string>> = {}
  for (const r of rows) {
    if (r.period === 'all') continue
    const workoutId = (r.detail as { workoutId: string | null }).workoutId
    if (!workoutId) continue
    const key = keyOf(r)
    if (allTimeKeys[workoutId]?.has(key)) continue
    if (!result[workoutId]) result[workoutId] = { allTime: [], year: [] }
    if (!yearKeys[workoutId]) yearKeys[workoutId] = new Set()
    if (yearKeys[workoutId].has(key)) continue
    yearKeys[workoutId].add(key)
    result[workoutId].year.push({ category: r.category, subKey: r.sub_key })
  }

  return result
}
