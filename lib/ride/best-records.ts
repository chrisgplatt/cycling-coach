import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAllTimeBests, type AllTimeBests, type BestsRide } from '@/lib/ride/all-time-bests'

export type BestCategory = 'biggest_climb' | 'longest_climb' | 'power' | 'speed' | 'max_speed'

export interface BestRecordRow {
  period: string
  category: BestCategory
  sub_key: string
  value: number
  detail: Record<string, unknown>
  is_indoor: boolean
  rank: number   // 1 (gold) through 3 (bronze) — this row's podium position within its (period, category, sub_key, is_indoor) slot
}

// Reconstructs each stored podium row as a minimal "synthetic ride" carrying
// only the one field relevant to its category — feeding these (plus one real
// candidate ride) back through computeAllTimeBests re-derives the correct new
// podium without needing any separate comparison logic. Every stored rank
// becomes its own synthetic ride, so all 3 podium slots (not just rank 1) feed
// back into the recomputation. Callers are responsible for only ever passing
// rows already filtered to one surface (outdoor vs. indoor) — this function has
// no is_indoor awareness itself.
export function reconstructSyntheticRides(rows: BestRecordRow[]): BestsRide[] {
  return rows.map((r): BestsRide => {
    const d = r.detail as { date: string; workoutId: string | null; icuActivityId: string; length_km?: number; elev_gain_m?: number; max_speed_ms?: number }
    const base = { id: d.workoutId, icu_activity_id: d.icuActivityId, date: d.date }
    switch (r.category) {
      case 'biggest_climb':
      case 'longest_climb':
        return { ...base, activity_metrics: { climbs: [{ elev_gain_m: r.category === 'biggest_climb' ? r.value : (d.elev_gain_m as number), length_km: r.category === 'longest_climb' ? r.value : (d.length_km ?? null) }], best_efforts: null, speed_bests: null, max_speed_ms: null } }
      case 'power':
        return { ...base, activity_metrics: { climbs: null, best_efforts: [{ secs: Number(r.sub_key), watts: r.value }], speed_bests: null, max_speed_ms: null } }
      case 'speed':
        return { ...base, activity_metrics: { climbs: null, best_efforts: null, speed_bests: [{ distance_km: Number(r.sub_key), avg_speed_kmh: r.value }], max_speed_ms: null } }
      case 'max_speed':
        return { ...base, activity_metrics: { climbs: null, best_efforts: null, speed_bests: null, max_speed_ms: d.max_speed_ms as number } }
    }
  })
}

// The inverse of reconstructSyntheticRides: turns a computed AllTimeBests into
// the rows to upsert for one period, tagged with the given isIndoor value. Each
// ranked entry in every category becomes its own row, carrying its rank. Omits
// rows entirely for an empty category rather than writing a null placeholder.
export function flattenAllTimeBestsToRows(period: string, bests: AllTimeBests, isIndoor: boolean): BestRecordRow[] {
  const rows: BestRecordRow[] = []
  for (const c of bests.biggestClimb) {
    rows.push({ period, category: 'biggest_climb', sub_key: '', value: c.elev_gain_m, detail: { date: c.date, workoutId: c.workoutId, icuActivityId: c.icuActivityId, length_km: c.length_km }, is_indoor: isIndoor, rank: c.rank })
  }
  for (const c of bests.longestClimb) {
    rows.push({ period, category: 'longest_climb', sub_key: '', value: c.length_km, detail: { date: c.date, workoutId: c.workoutId, icuActivityId: c.icuActivityId, elev_gain_m: c.elev_gain_m }, is_indoor: isIndoor, rank: c.rank })
  }
  for (const p of bests.powerBests) {
    rows.push({ period, category: 'power', sub_key: String(p.secs), value: p.watts, detail: { date: p.date, workoutId: p.workoutId, icuActivityId: p.icuActivityId }, is_indoor: isIndoor, rank: p.rank })
  }
  for (const s of bests.speedBests) {
    rows.push({ period, category: 'speed', sub_key: String(s.distance_km), value: s.avg_speed_kmh, detail: { date: s.date, workoutId: s.workoutId, icuActivityId: s.icuActivityId }, is_indoor: isIndoor, rank: s.rank })
  }
  for (const m of bests.maxSpeed) {
    rows.push({ period, category: 'max_speed', sub_key: '', value: m.speed_kmh, detail: { date: m.date, workoutId: m.workoutId, icuActivityId: m.icuActivityId, max_speed_ms: m.max_speed_ms }, is_indoor: isIndoor, rank: m.rank })
  }
  return rows
}

// Turns a flat list of stored rows for one period AND one surface back into an
// AllTimeBests — the read-side counterpart to flattenAllTimeBestsToRows. Each
// category collects every row it has, then sorts by rank (power/speed sort by
// duration/distance first, then rank within each). The caller is responsible
// for pre-filtering rows to one is_indoor value, same as it already
// pre-filters by period.
export function assembleAllTimeBests(rows: BestRecordRow[]): AllTimeBests {
  const bests: AllTimeBests = { biggestClimb: [], longestClimb: [], powerBests: [], speedBests: [], maxSpeed: [] }
  for (const r of rows) {
    const d = r.detail as { date: string; workoutId: string | null; icuActivityId: string; length_km?: number; elev_gain_m?: number; max_speed_ms?: number }
    // best_records.value is a Postgres `numeric` column, which some drivers
    // return as a string over the wire. Coerce defensively so the API always
    // serializes real numbers to the UI regardless of driver behavior.
    const value = Number(r.value)
    const rank = r.rank as 1 | 2 | 3
    if (r.category === 'biggest_climb') bests.biggestClimb.push({ rank, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date, elev_gain_m: value, length_km: d.length_km ?? null })
    if (r.category === 'longest_climb') bests.longestClimb.push({ rank, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date, length_km: value, elev_gain_m: d.elev_gain_m as number })
    if (r.category === 'power') bests.powerBests.push({ rank, secs: Number(r.sub_key), watts: value, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date })
    if (r.category === 'speed') bests.speedBests.push({ rank, distance_km: Number(r.sub_key), avg_speed_kmh: value, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date })
    if (r.category === 'max_speed') bests.maxSpeed.push({ rank, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date, speed_kmh: value, max_speed_ms: d.max_speed_ms as number })
  }
  bests.biggestClimb.sort((a, b) => a.rank - b.rank)
  bests.longestClimb.sort((a, b) => a.rank - b.rank)
  bests.powerBests.sort((a, b) => a.secs - b.secs || a.rank - b.rank)
  bests.speedBests.sort((a, b) => a.distance_km - b.distance_km || a.rank - b.rank)
  bests.maxSpeed.sort((a, b) => a.rank - b.rank)
  return bests
}

// Merges one new candidate ride into the currently-stored podiums for both
// "all-time" and the candidate's own year, reusing computeAllTimeBests as the
// sole comparison authority. Pure — callers persist the results themselves.
// existingAllTimeRows/existingYearRows must already be filtered to the same
// surface (outdoor/indoor) as the candidate — see fetchBestRecordRows.
export function mergeCandidateIntoBests(
  existingAllTimeRows: BestRecordRow[],
  existingYearRows: BestRecordRow[],
  candidate: BestsRide,
): { allTime: AllTimeBests; year: string; yearBests: AllTimeBests } {
  const year = candidate.date.slice(0, 4)
  const allTime = computeAllTimeBests([...reconstructSyntheticRides(existingAllTimeRows), candidate])
  const yearBests = computeAllTimeBests([...reconstructSyntheticRides(existingYearRows), candidate])
  return { allTime, year, yearBests }
}

export async function fetchBestRecordRows(supabase: SupabaseClient, userId: string, period: string, isIndoor: boolean): Promise<BestRecordRow[]> {
  const { data, error } = await supabase
    .from('best_records')
    .select('period, category, sub_key, value, detail, is_indoor, rank')
    .eq('user_id', userId)
    .eq('period', period)
    .eq('is_indoor', isIndoor)
  if (error) throw new Error(error.message)
  // best_records.value is a Postgres `numeric` column, which some drivers
  // return as a string over the wire — coerce defensively so every downstream
  // reconstruction/comparison always sees a real number (matches the same
  // defensive coercion assembleAllTimeBests already applies for its own reads).
  return ((data ?? []) as BestRecordRow[]).map(row => ({ ...row, value: Number(row.value) }))
}

export async function upsertBestRecordRows(supabase: SupabaseClient, userId: string, rows: BestRecordRow[]): Promise<void> {
  if (!rows.length) return
  const { error } = await supabase
    .from('best_records')
    .upsert(
      rows.map(r => ({ user_id: userId, ...r })),
      { onConflict: 'user_id,period,category,sub_key,is_indoor,rank' },
    )
  if (error) throw new Error(error.message)
}
