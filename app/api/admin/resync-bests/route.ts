import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { computeAllTimeBestsByPeriod, type BestsRide } from '@/lib/ride/all-time-bests'
import { flattenAllTimeBestsToRows, upsertBestRecordRows } from '@/lib/ride/best-records'

export const dynamic = 'force-dynamic'

/** Recomputes best_records from scratch from the current workouts rows. Safe to
 * re-run at any time — this is the correction path for the "champion records
 * only ever go up" limitation (e.g. after disassociating a workout, or after
 * an algorithm fix that would otherwise leave a stale, too-high value behind). */
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rows, error } = await supabase
    .from('workouts')
    .select('id, icu_activity_id, date, activity_metrics')
    .eq('user_id', user.id)
    .in('status', ['completed', 'needs_review'])
    .not('activity_metrics', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rides = (rows ?? []) as BestsRide[]
  const { allTime, byYear } = computeAllTimeBestsByPeriod(rides)

  const allRows = [
    ...flattenAllTimeBestsToRows('all', allTime),
    ...Object.entries(byYear).flatMap(([year, bests]) => flattenAllTimeBestsToRows(year, bests)),
  ]

  // A full wipe-and-rewrite, not a partial upsert: this route already recomputes
  // from the ENTIRE workouts table every time, so any category that no longer
  // qualifies (e.g. its record-holding ride was disassociated) must not leave a
  // stale row behind — clearing first is what makes this a genuine recovery
  // mechanism for the "champion records only ever go up" limitation.
  const { error: deleteError } = await supabase.from('best_records').delete().eq('user_id', user.id)
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

  // Deep-history-sourced champions have no workouts row and can't be restored by
  // this recompute (it only reads workouts) — resetting the cursor to null makes
  // the next deep-history scan restart from the oldest workout (its own fallback
  // logic) instead of resuming from wherever it last left off, so it re-covers
  // exactly the span this wipe just discarded.
  const { error: cursorError } = await supabase.from('user_profile').update({ deep_history_bests_cursor: null }).eq('user_id', user.id)
  if (cursorError) return NextResponse.json({ error: cursorError.message }, { status: 500 })

  await upsertBestRecordRows(supabase, user.id, allRows)

  return NextResponse.json({ ridesScanned: rides.length, rowsWritten: allRows.length })
}
