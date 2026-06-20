import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { isoWeekStart } from '@/lib/chart-helpers'
import type { ChartsData, WeeklyTss, RidePoint, DailyStrainPoint } from '@/types'
import {
  computeDailyActivityLoad,
  computeStrainComponents,
} from '@/lib/strain'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp')
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

  const client = new IntervalsClient(
    profile.intervals_icu_athlete_id,
    profile.intervals_icu_api_key,
  )

  try {
    const [wellness, activities, { data: garminHistory }] = await Promise.all([
      client.getWellness(oldest, newest),
      client.getActivities(oldest, newest),
      supabase
        .from('garmin_wellness')
        .select('date, garmin_training_readiness, garmin_recovery_time_mins, garmin_body_battery_charged, garmin_body_battery_drained, garmin_stress_max')
        .gte('date', oldest)
        .lte('date', newest),
    ])
    const garminByDate = new Map((garminHistory ?? []).map(g => [g.date as string, g]))

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

    // Daily strain — combine per-day activity load with wellness life signals
    const ftp: number | null = (profile as { current_ftp?: number | null }).current_ftp ?? null
    const dailyStrain: DailyStrainPoint[] = wellness
      .map((w): DailyStrainPoint | null => {
        const activityLoad = computeDailyActivityLoad(activities, w.id, ftp)
        const components = computeStrainComponents(
          activityLoad > 0 ? activityLoad : null,
          w.sleep_score,
          w.body_battery_high,
          w.sleep_secs,
        )
        if (!components) return null
        const g = garminByDate.get(w.id)
        return {
          date: w.id,
          workout: components.workoutPts,
          life: components.lifePts,
          total: components.total,
          workoutLoad: components.workoutLoad,
          sleepScore: components.sleepScore,
          sleepSecs: components.sleepSecs,
          bodyBatteryHigh: components.bodyBatteryHigh,
          garminReadiness: g?.garmin_training_readiness ?? null,
          garminRecoveryTimeMins: g?.garmin_recovery_time_mins ?? null,
          garminBatteryCharged: g?.garmin_body_battery_charged ?? null,
          garminBatteryDrained: g?.garmin_body_battery_drained ?? null,
          garminStressMax: g?.garmin_stress_max ?? null,
        }
      })
      .filter((p): p is DailyStrainPoint => p !== null && (p.total > 0 || p.life > 0 || p.workout > 0))

    const charts: ChartsData = { wellness, weeklyTss, rides, dailyStrain }
    return NextResponse.json({ charts })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
