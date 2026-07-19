import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { isoWeekStart } from '@/lib/chart-helpers'
import { mergeGarminIntoWellness } from '@/lib/garmin-wellness-merge'
import { resolveMaxHrFromProfile } from '@/lib/max-hr'
import type { ChartsData, WeeklyTss, RidePoint, DailyStrainPoint, ActivitySummary, RecoveryHistoryPoint } from '@/types'
import {
  computeWorkoutStrainSeries,
  type StrainSeriesDayInput,
  type DailyActivityInput,
} from '@/lib/strain'
import { fetchRecoveryInputsForRange } from '@/lib/recovery-inputs'
import { computeRecoveryScore } from '@/lib/recovery-score'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp, max_hr_manual, observed_max_hr, date_of_birth, timezone')
    .maybeSingle()

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 })

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const today = new Date()
  const newest = today.toISOString().split('T')[0]
  // Both wellness and activities fetched for 365 days so all time windows are covered
  const oldest = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0]

  const tz = (profile as { timezone?: string } | null)?.timezone ?? 'Europe/London'
  const recoveryToday = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())

  const client = new IntervalsClient(
    profile.intervals_icu_athlete_id,
    profile.intervals_icu_api_key,
  )

  try {
    const [rawWellness, activities, { data: garminHistory }, { data: dailyWellnessRows }] = await Promise.all([
      client.getWellness(oldest, newest),
      client.getActivities(oldest, newest),
      supabase
        .from('garmin_wellness')
        .select('date, garmin_training_readiness, garmin_recovery_time_mins, garmin_training_status, garmin_body_battery_current, garmin_body_battery_charged, garmin_body_battery_drained, garmin_stress_avg, garmin_stress_max, garmin_hrv_overnight, garmin_hrv_status, garmin_resting_hr, garmin_sleep_deep_secs, garmin_sleep_light_secs, garmin_sleep_rem_secs, garmin_sleep_awake_secs, garmin_sleep_respiration_avg')
        .gte('date', oldest)
        .lte('date', newest),
      supabase
        .from('daily_wellness')
        .select('date, daily_trimp, trimp_ref, workout_strain')
        .eq('user_id', user.id)
        .gte('date', oldest)
        .lte('date', newest),
    ])
    const dailyWellnessByDate = new Map((dailyWellnessRows ?? []).map(w => [w.date as string, w]))
    const garminByDate = new Map((garminHistory ?? []).map(g => [g.date as string, g]))
    // Garmin sleep stages, HRV overnight, and training readiness live only in garmin_wellness —
    // intervals.icu's wellness endpoint never returns them (lib/intervals/client.ts getWellness()).
    const wellness = mergeGarminIntoWellness(rawWellness, garminHistory ?? [])

    // Weekly TSS — cycling only
    const cyclingRides = activities.filter(a => /ride/i.test(a.type))
    const tssMap = new Map<string, number>()
    for (const ride of cyclingRides) {
      const week = isoWeekStart(ride.start_date_local)
      tssMap.set(week, (tssMap.get(week) ?? 0) + (ride.training_load ?? 0))
    }
    const weeklyTss: WeeklyTss[] = Array.from(tssMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, tss]) => ({ weekStart, tss: Math.round(tss) }))

    // Per-activity HR — all types, sorted ascending so latestHr badge is correct
    const rides: RidePoint[] = activities
      .map(a => ({
        date: a.start_date_local.slice(0, 10),
        avgHr: a.average_heartrate,
        tss: a.training_load ?? null,
        name: a.name,
        durationSecs: a.moving_time,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Activity summaries — all-type activities for last 365 days
    const activitySummaries: ActivitySummary[] = activities.map(a => ({
      date: a.start_date_local.slice(0, 10),
      type: a.type,
      distanceM: a.distance ?? null,
      elevationM: a.total_elevation_gain ?? null,
      movingTimeSecs: a.moving_time,
    }))

    // Daily strain — pure HR-Reserve TRIMP load, computed chronologically so each
    // day's personalized reference sees the correctly-ordered trailing window.
    const maxHr = resolveMaxHrFromProfile(profile as { max_hr_manual?: number | null; date_of_birth?: string | null; observed_max_hr?: number | null })?.value ?? null
    const activitiesByDate = new Map<string, DailyActivityInput[]>()
    for (const a of activities) {
      const date = a.start_date_local.slice(0, 10)
      const arr = activitiesByDate.get(date) ?? []
      arr.push({
        name: a.name,
        durationMin: a.moving_time / 60,
        avgHr: a.average_heartrate,
        trainingLoad: a.training_load,
      })
      activitiesByDate.set(date, arr)
    }

    const seriesInput: StrainSeriesDayInput[] = wellness
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((w): StrainSeriesDayInput => {
        const dw = dailyWellnessByDate.get(w.id) as { daily_trimp?: number | null; trimp_ref?: number | null; workout_strain?: number | null } | undefined
        return {
          date: w.id,
          activities: activitiesByDate.get(w.id) ?? [],
          restingHr: w.garmin_resting_hr ?? w.resting_hr,
          frozenDailyTrimp: dw?.daily_trimp ?? null,
          frozenTrimpRef: dw?.trimp_ref ?? null,
          frozenWorkoutStrain: dw?.workout_strain ?? null,
        }
      })

    const seriesResults = computeWorkoutStrainSeries(seriesInput, maxHr, newest)

    const toFreeze = seriesResults.filter(r => r.needsFreeze)
    if (toFreeze.length > 0) {
      const { error: freezeError } = await supabase
        .from('daily_wellness')
        .upsert(
          toFreeze.map(r => ({
            user_id: user.id,
            date: r.date,
            daily_trimp: r.dailyTrimp,
            trimp_ref: r.trimpRef,
            workout_strain: r.workoutStrain,
          })),
          { onConflict: 'user_id,date' },
        )
      // Freezing is a cache-write, not the source of truth for this response — log
      // and continue with the in-memory results rather than failing the whole request.
      if (freezeError) console.error('Failed to freeze historical strain values:', freezeError.message)
    }

    const seriesByDate = new Map(seriesResults.map(r => [r.date, r]))
    const dailyStrain: DailyStrainPoint[] = wellness
      .map((w): DailyStrainPoint | null => {
        const r = seriesByDate.get(w.id)
        if (!r || r.workoutStrain <= 0) return null
        const g = garminByDate.get(w.id)
        return {
          date: w.id,
          dailyTrimp: r.dailyTrimp,
          trimpRef: r.trimpRef,
          workoutStrain: r.workoutStrain,
          garminReadiness: g?.garmin_training_readiness ?? null,
          garminRecoveryTimeMins: g?.garmin_recovery_time_mins ?? null,
          garminBatteryCharged: g?.garmin_body_battery_charged ?? null,
          garminBatteryDrained: g?.garmin_body_battery_drained ?? null,
          garminStressMax: g?.garmin_stress_max ?? null,
        }
      })
      .filter((p): p is DailyStrainPoint => p !== null)

    // Recovery — computed once here, shared by the dashboard, fitness page, and (via the
    // same fetchRecoveryInputsForRange function) the briefing route. See
    // docs/superpowers/specs/2026-07-19-unified-recovery-inputs-design.md for why this
    // route owns the canonical computation.
    const recoveryInputsResult = await fetchRecoveryInputsForRange(supabase, user.id, client, { from: oldest, to: recoveryToday })
    const recoveryHistory: RecoveryHistoryPoint[] = recoveryInputsResult.map(r => {
      const score = computeRecoveryScore(r.inputs)
      return { date: r.date, ...score }
    })

    const charts: ChartsData = { wellness, weeklyTss, rides, dailyStrain, activities: activitySummaries, recoveryHistory }
    return NextResponse.json({ charts })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
