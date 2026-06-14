import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { generateBriefing } from '@/lib/claude/briefing'
import { fetchDossier } from '@/lib/claude/dossier'
import { fetchActiveBeliefs, formatAthleteModel } from '@/lib/claude/athlete-model'
import { IntervalsClient } from '@/lib/intervals/client'
import { fetchHrvStatus } from '@/lib/hrv/server'
import { fetchDailyForecast } from '@/lib/weather/open-meteo'
import { computeDailyStrain, computeDailyActivityLoad, computeDailyLifeLoad } from '@/lib/strain'
import type { Workout, TrainingEvent, BriefingContext, ICUActivity, ICUWellness } from '@/types'

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
    .select('intervals_icu_athlete_id, intervals_icu_api_key, events, timezone, latitude, longitude')
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

  const [{ data: workouts }, { data: upcomingWorkoutsData }, dossier, beliefs] = await Promise.all([
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
  ])

  const todayWorkouts = (workouts ?? []) as Workout[]
  const todayWorkout = todayWorkouts[0] ?? null

  const allEvents = (profile?.events ?? []) as TrainingEvent[]
  const todayEvent = allEvents.find((e: TrainingEvent) => e.date === today) ?? null
  const fourWeeks = new Date(Date.now() + 28 * 864e5).toISOString().split('T')[0]
  const upcomingEvents = allEvents.filter(
    (e: TrainingEvent) => e.date >= today && e.date <= fourWeeks
  )

  let ctl: number | null = null
  let atl: number | null = null
  let tsb: number | null = null
  let hrv: number | null = null
  let hrvStatus: BriefingContext['hrvStatus'] = null
  let recentWorkouts: BriefingContext['recentWorkouts'] = []
  let dailyStrain: number | null = null
  let strainHistory: Array<{ date: string; strain: number | null }> = []

  if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
    const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    try { hrvStatus = await fetchHrvStatus(client, today) } catch { /* HRV optional */ }
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0]
      const [wellness, activities] = await Promise.all([
        client.getWellness(sevenDaysAgo, today),
        client.getActivities(sevenDaysAgo, today),
      ])
      const latest: ICUWellness | undefined = wellness.at(-1)
      ctl = latest?.ctl ?? null
      atl = latest?.atl ?? null
      tsb = latest?.form ?? (ctl !== null && atl !== null ? ctl - atl : null)
      hrv = latest?.hrv ?? null
      const todayLoad = computeDailyActivityLoad(activities, today)
      const todayLifeLoad = computeDailyLifeLoad(
        latest?.sleep_score ?? null,
        latest?.body_battery_high ?? null,
        latest?.sleep_secs ?? null,
      )
      dailyStrain = computeDailyStrain(
        todayLoad > 0 ? todayLoad : null,
        todayLifeLoad,
      )
      strainHistory = wellness.map(w => ({
        date: w.id,
        strain: computeDailyStrain(
          computeDailyActivityLoad(activities, w.id) || null,
          computeDailyLifeLoad(w.sleep_score, w.body_battery_high, w.sleep_secs),
        ),
      }))
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

  const lat = (profile as { latitude?: number } | null)?.latitude
  const lon = (profile as { longitude?: number } | null)?.longitude
  let weather: BriefingContext['weather'] = null
  if (!workoutCompleted && typeof lat === 'number' && typeof lon === 'number') {
    weather = await fetchDailyForecast(lat, lon, today, tz)
  }

  const ctx: BriefingContext = {
    today,
    todayWorkout,
    todayWorkouts,
    todayEvent,
    workoutCompleted,
    completedRide,
    completedRides,
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
    strainHistory,
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
