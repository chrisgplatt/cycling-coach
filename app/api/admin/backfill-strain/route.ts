import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { mergeGarminIntoWellness } from '@/lib/garmin-wellness-merge'
import { resolveMaxHrFromProfile } from '@/lib/max-hr'
import { computeWorkoutStrainSeries, type StrainSeriesDayInput, type DailyActivityInput } from '@/lib/strain'

export const dynamic = 'force-dynamic'

/** One-time backfill: freezes daily_trimp/trimp_ref/workout_strain for every past date
 * that doesn't already have them. Safe to re-run — already-frozen dates are skipped. */
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, max_hr_manual, observed_max_hr, date_of_birth')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]
  const oldest = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  const [rawWellness, activities, { data: garminHistory }, { data: dailyWellnessRows }] = await Promise.all([
    client.getWellness(oldest, today),
    client.getActivities(oldest, today),
    supabase
      .from('garmin_wellness')
      .select('date, garmin_training_readiness, garmin_recovery_time_mins, garmin_training_status, garmin_body_battery_current, garmin_body_battery_charged, garmin_body_battery_drained, garmin_stress_avg, garmin_stress_max, garmin_hrv_overnight, garmin_hrv_status, garmin_resting_hr, garmin_sleep_deep_secs, garmin_sleep_light_secs, garmin_sleep_rem_secs, garmin_sleep_awake_secs, garmin_sleep_respiration_avg')
      .gte('date', oldest)
      .lte('date', today),
    supabase
      .from('daily_wellness')
      .select('date, daily_trimp, trimp_ref, workout_strain')
      .eq('user_id', user.id)
      .gte('date', oldest)
      .lte('date', today),
  ])
  // Garmin sleep stages, HRV overnight, and training readiness live only in garmin_wellness —
  // intervals.icu's wellness endpoint never returns them (lib/intervals/client.ts getWellness()).
  const wellness = mergeGarminIntoWellness(rawWellness, garminHistory ?? [])

  const dailyWellnessByDate = new Map((dailyWellnessRows ?? []).map(w => [w.date as string, w]))
  const activitiesByDate = new Map<string, DailyActivityInput[]>()
  for (const a of activities) {
    const date = a.start_date_local.slice(0, 10)
    const arr = activitiesByDate.get(date) ?? []
    arr.push({ name: a.name, durationMin: a.moving_time / 60, avgHr: a.average_heartrate, trainingLoad: a.training_load })
    activitiesByDate.set(date, arr)
  }

  const maxHr = resolveMaxHrFromProfile(profile)?.value ?? null
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

  const results = computeWorkoutStrainSeries(seriesInput, maxHr, today)
  const toFreeze = results.filter(r => r.needsFreeze)

  if (toFreeze.length > 0) {
    const { error } = await supabase
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
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ backfilled: toFreeze.length, totalDays: results.length })
}
