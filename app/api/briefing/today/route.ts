import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { generateBriefing } from '@/lib/claude/briefing'
import { IntervalsClient } from '@/lib/intervals/client'
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
    .select('intervals_icu_athlete_id, intervals_icu_api_key, events, timezone')
    .maybeSingle()

  const tz = (profile as { timezone?: string } | null)?.timezone ?? 'Europe/London'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())

  // Return cached note unless refresh is requested
  if (!refresh) {
    const { data: cached } = await supabase
      .from('daily_briefings')
      .select('coach_note, generated_at')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle()
    if (cached) return NextResponse.json({ coach_note: cached.coach_note, cached: true })
  }

  const { data: workouts } = await supabase.from('workouts')
    .select('*')
    .eq('date', today)
    .in('status', ['planned', 'completed', 'needs_review'])
    .order('created_at')
    .limit(1)

  const todayWorkout = (workouts?.[0] as Workout | undefined) ?? null

  const fourWeeks = new Date(Date.now() + 28 * 864e5).toISOString().split('T')[0]
  const upcomingEvents = ((profile?.events ?? []) as TrainingEvent[]).filter(
    (e: TrainingEvent) => e.date >= today && e.date <= fourWeeks
  )

  let ctl: number | null = null
  let atl: number | null = null
  let tsb: number | null = null
  let hrv: number | null = null
  let recentWorkouts: BriefingContext['recentWorkouts'] = []

  if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
    const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
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

  const workoutCompleted = todayWorkout?.status === 'completed'

  let completedRide: BriefingContext['completedRide'] = null
  if (workoutCompleted && profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
    const client2 = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    try {
      const todayActivities = await client2.getActivities(today, today)
      const ride = todayActivities.find((a: ICUActivity) => /ride/i.test(a.type))
      if (ride) {
        completedRide = {
          name: ride.name,
          avg_power: ride.average_watts,
          weighted_avg_power: ride.weighted_average_watts,
          tss: ride.training_load,
          moving_time: ride.moving_time,
        }
      }
    } catch { /* if ICU unavailable, proceed without ride data */ }
  }

  const ctx: BriefingContext = {
    today,
    todayWorkout,
    workoutCompleted: workoutCompleted ?? false,
    completedRide,
    ctl,
    atl,
    tsb,
    readinessLabel: readinessLabel(tsb),
    hrv,
    recentWorkouts,
    upcomingEvents,
  }

  const coach_note = await generateBriefing(ctx)

  await supabase
    .from('daily_briefings')
    .upsert(
      { user_id: user.id, date: today, coach_note, generated_at: new Date().toISOString() },
      { onConflict: 'user_id,date' }
    )

  return NextResponse.json({ coach_note, cached: false, ctl, atl, tsb, hrv, readiness_label: readinessLabel(tsb) })
}
