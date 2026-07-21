import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAllTimeBests, type AllTimeBests, type BestsRide } from '@/lib/ride/all-time-bests'

export type BestCategory = 'biggest_climb' | 'longest_climb' | 'power' | 'speed' | 'max_speed'

export interface BestRecordRow {
  period: string
  category: BestCategory
  sub_key: string
  value: number
  detail: Record<string, unknown>
}

// Reconstructs each stored champion row as a minimal "synthetic ride" carrying
// only the one field relevant to its category — feeding these (plus one real
// candidate ride) back through computeAllTimeBests re-derives the correct new
// champions without needing any separate comparison logic.
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
// the rows to upsert for one period. Omits a row entirely for any absent
// category rather than writing a null placeholder.
export function flattenAllTimeBestsToRows(period: string, bests: AllTimeBests): BestRecordRow[] {
  const rows: BestRecordRow[] = []
  if (bests.biggestClimb) {
    const c = bests.biggestClimb
    rows.push({ period, category: 'biggest_climb', sub_key: '', value: c.elev_gain_m, detail: { date: c.date, workoutId: c.workoutId, icuActivityId: c.icuActivityId, length_km: c.length_km } })
  }
  if (bests.longestClimb) {
    const c = bests.longestClimb
    rows.push({ period, category: 'longest_climb', sub_key: '', value: c.length_km, detail: { date: c.date, workoutId: c.workoutId, icuActivityId: c.icuActivityId, elev_gain_m: c.elev_gain_m } })
  }
  for (const p of bests.powerBests) {
    rows.push({ period, category: 'power', sub_key: String(p.secs), value: p.watts, detail: { date: p.date, workoutId: p.workoutId, icuActivityId: p.icuActivityId } })
  }
  for (const s of bests.speedBests) {
    rows.push({ period, category: 'speed', sub_key: String(s.distance_km), value: s.avg_speed_kmh, detail: { date: s.date, workoutId: s.workoutId, icuActivityId: s.icuActivityId } })
  }
  if (bests.maxSpeed) {
    const m = bests.maxSpeed
    rows.push({ period, category: 'max_speed', sub_key: '', value: m.speed_kmh, detail: { date: m.date, workoutId: m.workoutId, icuActivityId: m.icuActivityId, max_speed_ms: m.max_speed_ms } })
  }
  return rows
}

// Turns a flat list of stored rows for one period back into an AllTimeBests —
// the read-side counterpart to flattenAllTimeBestsToRows. Categories with no
// row simply stay at their default null/empty value.
export function assembleAllTimeBests(rows: BestRecordRow[]): AllTimeBests {
  const bests: AllTimeBests = { biggestClimb: null, longestClimb: null, powerBests: [], speedBests: [], maxSpeed: null }
  for (const r of rows) {
    const d = r.detail as { date: string; workoutId: string | null; icuActivityId: string; length_km?: number; elev_gain_m?: number; max_speed_ms?: number }
    // best_records.value is a Postgres `numeric` column, which some drivers
    // return as a string over the wire. Coerce defensively so the API always
    // serializes real numbers to the UI regardless of driver behavior.
    const value = Number(r.value)
    if (r.category === 'biggest_climb') bests.biggestClimb = { workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date, elev_gain_m: value, length_km: d.length_km ?? null }
    if (r.category === 'longest_climb') bests.longestClimb = { workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date, length_km: value, elev_gain_m: d.elev_gain_m as number }
    if (r.category === 'power') bests.powerBests.push({ secs: Number(r.sub_key), watts: value, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date })
    if (r.category === 'speed') bests.speedBests.push({ distance_km: Number(r.sub_key), avg_speed_kmh: value, workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date })
    if (r.category === 'max_speed') bests.maxSpeed = { workoutId: d.workoutId, icuActivityId: d.icuActivityId, date: d.date, speed_kmh: value, max_speed_ms: d.max_speed_ms as number }
  }
  bests.powerBests.sort((a, b) => a.secs - b.secs)
  bests.speedBests.sort((a, b) => a.distance_km - b.distance_km)
  return bests
}

// Merges one new candidate ride into the currently-stored champions for both
// "all-time" and the candidate's own year, reusing computeAllTimeBests as the
// sole comparison authority. Pure — callers persist the results themselves.
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

export async function fetchBestRecordRows(supabase: SupabaseClient, userId: string, period: string): Promise<BestRecordRow[]> {
  const { data, error } = await supabase
    .from('best_records')
    .select('period, category, sub_key, value, detail')
    .eq('user_id', userId)
    .eq('period', period)
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
      { onConflict: 'user_id,period,category,sub_key' },
    )
  if (error) throw new Error(error.message)
}
