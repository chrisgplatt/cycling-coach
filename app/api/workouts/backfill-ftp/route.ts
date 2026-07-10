import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { resolveFallbackFtp, type FtpAnchor } from '@/lib/ftp/resolve-ftp'
import type { ICUActivity } from '@/types'

// Admin-only one-off: backfill ftp_at_completion for completed workouts that predate
// this feature. Primary source is intervals.icu's own per-activity `ftp` (its FTP
// history); falls back to our confirmed ftp_predictions timeline, then to the
// workout's plan baseline_ftp, then leaves it null.
export async function POST() {
  const supabase = await createSupabaseServerClient()

  const { data: profile } = await supabase
    .from('user_profile')
    .select('is_admin, intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: rows } = await supabase
    .from('workouts')
    .select('id, date, plan_id, icu_activity_id')
    .eq('status', 'completed')
    .is('ftp_at_completion', null)

  const workouts = (rows ?? []) as Array<{ id: string; date: string; plan_id: string | null; icu_activity_id: string | null }>
  if (!workouts.length) {
    return NextResponse.json({ total: 0, updated: 0, skipped: 0, failed: 0 })
  }

  // Bulk-fetch intervals.icu activities for every linked workout, once, spanning the
  // full date range in this batch — a single wide fetch is fine for a one-off admin action.
  const activityById = new Map<string, ICUActivity>()
  const linkedIds = workouts.map(w => w.icu_activity_id).filter((id): id is string => id !== null)
  if (linkedIds.length && profile.intervals_icu_athlete_id && profile.intervals_icu_api_key) {
    const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    const dates = workouts.map(w => w.date).sort()
    const activities = await client.getActivities(dates[0], dates[dates.length - 1])
    for (const a of activities) activityById.set(a.id, a)
  }

  // Fallback sources, fetched once and reused across the whole batch.
  const { data: predictions } = await supabase
    .from('ftp_predictions')
    .select('created_at, predicted_ftp')
    .eq('confirmed', true)
  const anchors: FtpAnchor[] = (predictions ?? []).map((p: { created_at: string; predicted_ftp: number }) => ({
    createdAt: p.created_at,
    predictedFtp: p.predicted_ftp,
  }))

  const planIds = [...new Set(workouts.map(w => w.plan_id).filter((id): id is string => id !== null))]
  const planBaselineById = new Map<string, number | null>()
  if (planIds.length) {
    const { data: plans } = await supabase.from('training_plans').select('id, baseline_ftp').in('id', planIds)
    for (const p of plans ?? []) planBaselineById.set(p.id, p.baseline_ftp)
  }

  let updated = 0, skipped = 0, failed = 0
  for (const w of workouts) {
    const linkedActivity = w.icu_activity_id ? activityById.get(w.icu_activity_id) : undefined
    const ftpFromActivity = linkedActivity?.ftp ?? null
    const ftp = ftpFromActivity ?? resolveFallbackFtp(w.date, anchors, w.plan_id ? planBaselineById.get(w.plan_id) ?? null : null)

    if (ftp === null) { skipped++; continue }

    const { error } = await supabase.from('workouts').update({ ftp_at_completion: ftp }).eq('id', w.id)
    if (error) failed++; else updated++
  }

  return NextResponse.json({ total: workouts.length, updated, skipped, failed })
}
