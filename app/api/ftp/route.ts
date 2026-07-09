import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { predictFTP } from '@/lib/claude/ftp'
import { fitCriticalPower } from '@/lib/critical-power'
import { findNearestPower } from '@/lib/stats-helpers'
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import type { ICUPowerCurvePoint, PredictionDraft } from '@/types'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('ftp_predictions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { currentFTP } = await req.json()

  const { data: profileData } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp')
    .maybeSingle()

  if (!profileData?.intervals_icu_athlete_id || !profileData?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const client = new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)

  const newest = new Date().toISOString().split('T')[0]
  const oldest = new Date(Date.now() - 91 * 86400000).toISOString().split('T')[0]

  try {
    const [activities, powerCurve] = await Promise.all([
      client.getActivities(oldest, newest),
      client.getPowerCurve(oldest, newest).catch((): ICUPowerCurvePoint[] => []),
    ])

    const rides = activities.filter(a => a.type === 'Ride')

    // Real best-effort-within-a-ride power, sampled from the aggregate power curve —
    // replaces the old whole-ride-NP-bucketed-by-duration approximation, which could
    // mistake e.g. a hard 30-min time trial for a 20-min effort.
    const mins5 = findNearestPower(powerCurve, 300)
    const mins20 = findNearestPower(powerCurve, 1200)
    const mins60 = findNearestPower(powerCurve, 3600)
    const cpModel = fitCriticalPower(powerCurve)

    // intervals.icu's own rolling FTP is the best algorithmic estimate available.
    // Fall back to curve-derived estimates if not present.
    const latestRollingFTP = rides
      .filter(a => a.rolling_ftp != null)
      .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))[0]?.rolling_ftp ?? null
    const algorithmicEstimate =
      latestRollingFTP !== null ? latestRollingFTP :
      mins20 !== null ? Math.round(mins20 * 0.95) :
      mins60 !== null ? Math.round(mins60 * 0.97) :
      cpModel !== null ? cpModel.cp : null

    const buckets = new Map<string, { rideCount: number; peakNP: number; totalTSS: number }>()
    for (const act of activities.filter(a => a.type === 'Ride')) {
      const month = act.start_date_local.slice(0, 7)
      const existing = buckets.get(month) ?? { rideCount: 0, peakNP: 0, totalTSS: 0 }
      buckets.set(month, {
        rideCount: existing.rideCount + 1,
        peakNP: Math.max(existing.peakNP, act.weighted_average_watts ?? 0),
        totalTSS: existing.totalTSS + (act.training_load ?? 0),
      })
    }
    const monthlyTrend = Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }))

    // Qualitative context: the existing coach dossier, plus recent feedback specifically
    // on threshold/intervals sessions — so a confident-but-wrong power number can be
    // checked against how the athlete actually says hard efforts feel.
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString()
    const [dossier, { data: recentWorkouts }, { data: recentFeedback }] = await Promise.all([
      fetchDossier(supabase, user.id),
      supabase.from('workouts')
        .select('id, type')
        .eq('user_id', user.id)
        .gte('date', sixtyDaysAgo.slice(0, 10)),
      supabase.from('session_feedback')
        .select('created_at, workout_id, feedback_text, rpe, feel')
        .eq('user_id', user.id)
        .gte('created_at', sixtyDaysAgo)
        .order('created_at', { ascending: false }),
    ])
    const thresholdWorkoutIds = new Set(
      (recentWorkouts ?? []).filter(w => w.type === 'threshold' || w.type === 'intervals').map(w => w.id)
    )
    const recentThresholdFeedback = (recentFeedback ?? [])
      .filter(f => f.workout_id && thresholdWorkoutIds.has(f.workout_id))
      .slice(0, 8)
      .map(f => ({
        date: (f.created_at as string).slice(0, 10),
        rpe: f.rpe as number | null,
        feel: f.feel as number | null,
        feedbackText: f.feedback_text as string,
      }))

    const resolvedFTP = currentFTP ?? profileData.current_ftp ?? 200

    const result = await predictFTP({
      powerCurve: { mins5, mins20, mins60 },
      cpModel,
      algorithmicEstimate,
      monthlyTrend,
      dossierText: formatDossier(dossier),
      recentThresholdFeedback,
      currentFTP: resolvedFTP,
    })

    const draft: PredictionDraft = {
      predicted_ftp: result.predicted_ftp,
      reasoning: result.reasoning,
      confidence: result.confidence,
      activity_ids: activities.map(a => a.id),
    }

    return NextResponse.json(draft)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FTP prediction failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
