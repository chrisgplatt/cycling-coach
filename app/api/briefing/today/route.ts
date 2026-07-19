import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { generateBriefing } from '@/lib/claude/briefing'
import { fetchDossier } from '@/lib/claude/dossier'
import { fetchActiveBeliefs, formatAthleteModel } from '@/lib/claude/athlete-model'
import { IntervalsClient } from '@/lib/intervals/client'
import { fetchHrvStatusBestSource } from '@/lib/hrv/server'
import { fetchDailyForecast } from '@/lib/weather/open-meteo'
import { computeDailyTrimp, computeTrimpRef, computeWorkoutStrain, computeStrainTarget, type DailyActivityInput } from '@/lib/strain'
import { computeRecoveryScore } from '@/lib/recovery-score'
import { fetchRecoveryInputsForRange } from '@/lib/recovery-inputs'
import { resolveMaxHrFromProfile } from '@/lib/max-hr'
import { eventCoversDate, eventEndDate } from '@/lib/events'
import type { Workout, TrainingEvent, BriefingContext, ICUActivity, ICUWellness, DailyWellness, GarminWellness } from '@/types'

export const dynamic = 'force-dynamic'

function readinessLabel(tsb: number | null): BriefingContext['readinessLabel'] {
  if (tsb === null) return 'Unknown'
  if (tsb > 0) return 'Ready'
  if (tsb >= -30) return 'Moderate'
  return 'Fatigued'
}

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const refresh = new URL(req.url).searchParams.get('refresh') === 'true'

  // Fetch profile first so we can compute the user's local date from their stored timezone
  const { data: profile } = await supabase.from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, events, timezone, latitude, longitude, garmin_email, date_of_birth, max_hr_manual, observed_max_hr')
    .maybeSingle()

  const tz = (profile as { timezone?: string } | null)?.timezone ?? 'Europe/London'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())

  // Return cached note unless refresh is requested
  if (!refresh) {
    const { data: cached } = await supabase
      .from('daily_briefings')
      .select('coach_note, verdict, headline, weather, generated_at')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle()
    if (cached) return NextResponse.json({
      coach_note: cached.coach_note, verdict: cached.verdict ?? null,
      headline: cached.headline ?? null, weather: cached.weather ?? null, cached: true,
    })
  }

  const fiveDaysLater = new Date(Date.now() + 5 * 864e5).toISOString().split('T')[0]

  const [{ data: workouts }, { data: upcomingWorkoutsData }, dossier, beliefs, { data: activePlan }] = await Promise.all([
    supabase.from('workouts')
      .select('*')
      .eq('date', today)
      .in('status', ['planned', 'completed', 'needs_review'])
      .order('created_at'),
    supabase.from('workouts')
      .select('date, type, duration_minutes, description')
      .eq('status', 'planned')
      .gt('date', today)
      .lte('date', fiveDaysLater)
      .order('date'),
    fetchDossier(supabase, user.id),
    fetchActiveBeliefs(supabase, user.id),
    supabase.from('training_plans')
      .select('phase, week_phases, created_at, plan_weeks')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const todayWorkouts = (workouts ?? []) as Workout[]
  const todayWorkout = todayWorkouts[0] ?? null

  const allEvents = (profile?.events ?? []) as TrainingEvent[]
  const todayEvent = allEvents.find((e: TrainingEvent) => eventCoversDate(e, today)) ?? null
  const fourWeeks = new Date(Date.now() + 28 * 864e5).toISOString().split('T')[0]
  const upcomingEvents = allEvents.filter(
    (e: TrainingEvent) => eventEndDate(e) >= today && e.date <= fourWeeks
  )

  let ctl: number | null = null
  let atl: number | null = null
  let tsb: number | null = null
  let hrv: number | null = null
  let hrvStatus: BriefingContext['hrvStatus'] = null
  let recentWorkouts: BriefingContext['recentWorkouts'] = []
  let dailyStrain: number | null = null
  let strainHistory: Array<{ date: string; strain: number | null }> = []
  let strainWellness: ICUWellness[] = []
  let strainActivities: ICUActivity[] = []

  if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
    const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0]
      const [wellness, activities] = await Promise.all([
        client.getWellness(sevenDaysAgo, today),
        client.getActivities(sevenDaysAgo, today),
      ])
      strainWellness = wellness
      strainActivities = activities
      const latest: ICUWellness | undefined = wellness.at(-1)
      ctl = latest?.ctl ?? null
      atl = latest?.atl ?? null
      tsb = latest?.form ?? (ctl !== null && atl !== null ? ctl - atl : null)
      hrv = latest?.hrv ?? null
      recentWorkouts = activities
        .filter((a: ICUActivity) => /ride/i.test(a.type))
        .sort((a: ICUActivity, b: ICUActivity) => b.start_date_local.localeCompare(a.start_date_local))
        .slice(0, 2)
        .map((a: ICUActivity) => ({
          date: a.start_date_local.split('T')[0],
          type: a.type,
          avg_power: a.average_watts ?? null,
          tss: a.training_load ?? null,
        }))
    } catch { /* ICU unavailable — briefing proceeds without metrics */ }
  }

  // HRV — Garmin-first, ICU fallback
  const garminParams = profile?.garmin_email ? { supabase, userId: user.id } : null
  const icuClient = profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key
    ? new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    : null
  try {
    hrvStatus = await fetchHrvStatusBestSource(today, garminParams, icuClient)
  } catch { /* HRV optional */ }

  const anyWorkoutCompleted = todayWorkouts.some(w => w.status === 'completed')
  const raceResultRecorded = todayEvent != null && todayEvent.result_tss != null
  const workoutCompleted = anyWorkoutCompleted || raceResultRecorded

  let completedRide: BriefingContext['completedRide'] = null
  let completedRides: BriefingContext['completedRides'] = null
  if (workoutCompleted && profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
    const client2 = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    try {
      const todayActivities = await client2.getActivities(today, today)
      const rides = todayActivities.filter((a: ICUActivity) => /ride/i.test(a.type))
      const { formatRideExecution, formatRideShape, formatDistributions } = await import('@/lib/claude/activity-metrics')
      completedRides = rides.map((ride: ICUActivity) => {
        const match = todayWorkouts.find(w => w.icu_activity_id === ride.id)
        const metrics = match?.activity_metrics ?? null
        const steps = match?.steps ?? null
        return {
          name: ride.name,
          avg_power: ride.average_watts,
          weighted_avg_power: ride.weighted_average_watts,
          tss: ride.training_load,
          moving_time: ride.moving_time,
          elevation_m: metrics?.elevation_m ?? ride.total_elevation_gain ?? null,
          execution: [
            formatRideExecution(steps, metrics),
            formatRideShape(metrics?.shape ?? null),
            formatDistributions(metrics?.distributions ?? null),
          ].filter(Boolean).join('\n\n') || null,
        }
      })
      completedRide = completedRides[0] ?? null
    } catch { /* if ICU unavailable, proceed without ride data */ }
  }

  // Fetch weather for the most recent completed ride — used in post-ride briefing
  let completedRideWeather: import('@/types').ActivityWeather | null = null
  if (completedRide && todayWorkouts.length > 0) {
    const matchedWorkout = todayWorkouts.find(w => w.status === 'completed' && w.icu_activity_id)
    if (matchedWorkout?.icu_activity_id) {
      try {
        const { data: cachedWeather } = await supabase
          .from('activity_weather')
          .select('activity_id,temp_min_c,temp_max_c,precip_mm,wind_avg_kph,wind_dir_deg,headwind_pct,tailwind_pct,crosswind_pct,air_speed_kph,weather_impact_pct')
          .eq('activity_id', matchedWorkout.icu_activity_id)
          .eq('user_id', user.id)
          .maybeSingle()
        completedRideWeather = cachedWeather ?? null
      } catch { /* non-fatal */ }
    }
  }

  const lat = (profile as { latitude?: number } | null)?.latitude
  const lon = (profile as { longitude?: number } | null)?.longitude
  let weather: BriefingContext['weather'] = null
  if (!workoutCompleted && typeof lat === 'number' && typeof lon === 'number') {
    weather = await fetchDailyForecast(lat, lon, today, tz)
  }

  let currentPhaseWeek: number | null = null
  let currentPhaseFromPlan: string | null = activePlan?.phase ?? null
  if (activePlan?.week_phases && Array.isArray(activePlan.week_phases) && activePlan.week_phases.length > 0 && activePlan.created_at) {
    const planStart = new Date(activePlan.created_at.split('T')[0] + 'T00:00:00Z')
    const todayDate = new Date(today + 'T00:00:00Z')
    const weekIndex = Math.floor((todayDate.getTime() - planStart.getTime()) / (7 * 24 * 60 * 60 * 1000))
    const weekPhases = activePlan.week_phases as string[]

    // If the plan has ended, don't report a stale phase
    if (weekIndex >= weekPhases.length) {
      currentPhaseFromPlan = null
    } else {
      const clampedIndex = Math.max(0, weekIndex)
      const currentPhaseFromWeekPhases = weekPhases[clampedIndex]
      currentPhaseFromPlan = currentPhaseFromWeekPhases

      let phaseStart = clampedIndex
      while (phaseStart > 0 && weekPhases[phaseStart - 1] === currentPhaseFromWeekPhases) {
        phaseStart--
      }
      currentPhaseWeek = clampedIndex - phaseStart + 1
    }
  }

  const twoDaysAgo = new Date(Date.now() - 2 * 864e5).toISOString().split('T')[0]
  const twentyOneDaysAgo = new Date(Date.now() - 21 * 864e5).toISOString().split('T')[0]
  const [{ data: wellnessRows }, { data: garminRow }, { data: strainDailyWellnessRows }] = await Promise.all([
    supabase
      .from('daily_wellness')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', twoDaysAgo)
      .lte('date', today)
      .order('date', { ascending: true }),
    supabase
      .from('garmin_wellness')
      .select('garmin_training_readiness, garmin_recovery_time_mins, garmin_training_status, garmin_body_battery_current, garmin_body_battery_charged, garmin_body_battery_drained, garmin_stress_avg, garmin_stress_max, garmin_resting_hr, garmin_sleep_deep_secs, garmin_sleep_light_secs, garmin_sleep_rem_secs, garmin_sleep_awake_secs, garmin_sleep_respiration_avg')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle(),
    supabase
      .from('daily_wellness')
      .select('date, daily_trimp, trimp_ref, workout_strain')
      .eq('user_id', user.id)
      .gte('date', twentyOneDaysAgo)
      .lt('date', today),
  ])
  const todayGarmin = garminRow as Pick<GarminWellness,
    | 'garmin_training_readiness' | 'garmin_recovery_time_mins' | 'garmin_training_status'
    | 'garmin_body_battery_current' | 'garmin_body_battery_charged' | 'garmin_body_battery_drained'
    | 'garmin_stress_avg' | 'garmin_stress_max'
    | 'garmin_resting_hr' | 'garmin_sleep_deep_secs' | 'garmin_sleep_light_secs'
    | 'garmin_sleep_rem_secs' | 'garmin_sleep_awake_secs' | 'garmin_sleep_respiration_avg'
  > | null

  const maxHrProfile = profile as { date_of_birth?: string | null; max_hr_manual?: number | null; observed_max_hr?: number | null } | null
  const maxHr = resolveMaxHrFromProfile(maxHrProfile)?.value ?? null

  // Daily Strain — pure TRIMP load. strainActivities/strainWellness were already
  // fetched in the ICU block above (7 days back); the trailing trimp window for
  // trimpRef comes from already-frozen daily_wellness rows, matching the charts route.
  if (strainWellness.length > 0 || strainActivities.length > 0) {
    const trailingTrimp = (strainDailyWellnessRows ?? [])
      .map(r => (r as { daily_trimp: number | null }).daily_trimp)
      .filter((v): v is number => v != null)
    const trimpRef = computeTrimpRef(trailingTrimp)

    const activitiesForDate = (date: string): DailyActivityInput[] =>
      strainActivities
        .filter(a => a.start_date_local.slice(0, 10) === date)
        .map(a => ({ name: a.name, durationMin: a.moving_time / 60, avgHr: a.average_heartrate, trainingLoad: a.training_load }))

    const todayRestingHr = todayGarmin?.garmin_resting_hr ?? strainWellness.at(-1)?.resting_hr ?? null
    const todayTrimp = computeDailyTrimp(activitiesForDate(today), maxHr, todayRestingHr)
    dailyStrain = computeWorkoutStrain(todayTrimp, trimpRef)

    // Past days: read the frozen workout_strain from daily_wellness so this history
    // matches what the dashboard chart shows (each day frozen against its own rolling
    // trimpRef at freeze time) rather than re-deriving every day against today's trimpRef.
    // Only today (never frozen) and any not-yet-backfilled date fall back to a live
    // recompute using the same trimpRef this route already derived above.
    const frozenByDate = new Map(
      (strainDailyWellnessRows ?? []).map(r => [
        r.date as string,
        r as { daily_trimp: number | null; trimp_ref: number | null; workout_strain: number | null },
      ])
    )

    strainHistory = strainWellness.map(w => {
      if (w.id === today) return { date: w.id, strain: dailyStrain }
      const frozen = frozenByDate.get(w.id)
      if (frozen && frozen.daily_trimp != null && frozen.trimp_ref != null && frozen.workout_strain != null) {
        return { date: w.id, strain: frozen.workout_strain }
      }
      return {
        date: w.id,
        strain: computeWorkoutStrain(
          computeDailyTrimp(activitiesForDate(w.id), maxHr, w.garmin_resting_hr ?? w.resting_hr),
          trimpRef,
        ),
      }
    })
  }

  // Widen the fetch range and take the last available entry (mirroring the
  // dashboard's chartsData.recoveryHistory.at(-1) semantics) rather than requiring
  // an exact match on `today` — intervals.icu doesn't always have today's wellness
  // row computed yet, and falling back to a neutral default in that case would show
  // a different Recovery picture than the dashboard on the same morning.
  const recoveryFrom = new Date(new Date(today + 'T00:00:00Z').getTime() - 3 * 864e5).toISOString().split('T')[0]
  const recoveryInputsResult = icuClient
    ? await fetchRecoveryInputsForRange(supabase, user.id, icuClient, { from: recoveryFrom, to: today })
    : []
  const recoveryResult = computeRecoveryScore(
    recoveryInputsResult.at(-1)?.inputs ?? {
      hrv: null, hrvBaseline: null, garmin_sleep_deep_secs: null, garmin_sleep_light_secs: null,
      garmin_sleep_rem_secs: null, garmin_sleep_awake_secs: null, body_battery_high: null,
      energy: null, leg_freshness: null, tsb: null,
    },
  )

  const strainTarget = computeStrainTarget(recoveryResult.score)

  const ctx: BriefingContext = {
    today,
    todayWorkout,
    todayWorkouts,
    todayEvent,
    workoutCompleted,
    completedRide,
    completedRides,
    completedRideWeather,
    ctl,
    atl,
    tsb,
    readinessLabel: readinessLabel(tsb),
    hrv,
    hrvStatus,
    recentWorkouts,
    upcomingEvents,
    upcomingWorkouts: (upcomingWorkoutsData ?? []) as BriefingContext['upcomingWorkouts'],
    dossier,
    athleteModel: formatAthleteModel(beliefs),
    weather,
    dailyStrain,
    strainTargetLow: strainTarget.low,
    strainTargetHigh: strainTarget.high,
    strainHistory,
    currentPhase: currentPhaseFromPlan,
    currentPhaseWeek,
    recentWellness: (wellnessRows ?? []) as DailyWellness[],
    garminTrainingReadiness: todayGarmin?.garmin_training_readiness ?? null,
    garminRecoveryTimeMins: todayGarmin?.garmin_recovery_time_mins ?? null,
    garminTrainingStatus: todayGarmin?.garmin_training_status ?? null,
    garminBodyBatteryCurrent: todayGarmin?.garmin_body_battery_current ?? null,
    garminBodyBatteryCharged: todayGarmin?.garmin_body_battery_charged ?? null,
    garminBodyBatteryDrained: todayGarmin?.garmin_body_battery_drained ?? null,
    garminStressAvg: todayGarmin?.garmin_stress_avg ?? null,
    garminStressMax: todayGarmin?.garmin_stress_max ?? null,
    garminRestingHr: todayGarmin?.garmin_resting_hr ?? null,
    garminSleepDeepSecs: todayGarmin?.garmin_sleep_deep_secs ?? null,
    garminSleepLightSecs: todayGarmin?.garmin_sleep_light_secs ?? null,
    garminSleepRemSecs: todayGarmin?.garmin_sleep_rem_secs ?? null,
    garminSleepAwakeSecs: todayGarmin?.garmin_sleep_awake_secs ?? null,
    garminSleepRespirationAvg: todayGarmin?.garmin_sleep_respiration_avg ?? null,
    recoveryScore: recoveryResult.score,
    recoveryBand: recoveryResult.band,
    recoveryExplanation: recoveryResult.explanation,
    maxHr,
  }

  const { coach_note, verdict, headline } = await generateBriefing(ctx)

  await supabase
    .from('daily_briefings')
    .upsert(
      { user_id: user.id, date: today, coach_note, verdict, headline, weather, generated_at: new Date().toISOString() },
      { onConflict: 'user_id,date' }
    )

  return NextResponse.json({ coach_note, verdict, headline, weather, cached: false, ctl, atl, tsb, hrv, readiness_label: readinessLabel(tsb) })
}
