import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { fetchHrvStatusBestSource } from '@/lib/hrv/server'
import { isoWeek } from '@/lib/iso-week'
import { runPlanJob } from '@/lib/plan/job-runner'
import { computeLoadMultiplier } from '@/lib/plan/load-calibration'
import { computeWeekPhases } from '@/lib/plan/phases'
import { buildAthleteStateLine } from '@/lib/claude/athlete-state'
import { formatHrvForPrompt } from '@/lib/hrv/format'
import { nameForWorkout } from '@/lib/workout-names'
import type { GeneratedPlan, ICUActivity, Workout } from '@/types'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { note: rawNote = '' } = await req.json().catch(() => ({}))
  const note = String(rawNote).slice(0, 1000)

  const { data: profile } = await supabase.from('user_profile').select('*').maybeSingle()
  if (!profile) return NextResponse.json({ error: 'Profile not configured' }, { status: 400 })
  if (!profile.intervals_icu_athlete_id || !profile.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  let pushSubscription = null
  if (profile.notifications_enabled) {
    const { data: sub } = await supabase.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', user.id).limit(1).maybeSingle()
    pushSubscription = sub ?? null
  }

  const { data: plan } = await supabase
    .from('training_plans')
    .select('*, workouts(*)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!plan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const today = new Date().toISOString().split('T')[0]
  const todayDate = new Date()
  const dayOfWeek = (todayDate.getDay() + 6) % 7
  const thisMonday = new Date(todayDate); thisMonday.setDate(todayDate.getDate() - dayOfWeek)
  const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7)
  const lastSunday = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1)
  const lastMondayStr = lastMonday.toISOString().split('T')[0]
  const lastSundayStr = lastSunday.toISOString().split('T')[0]

  const workouts: Workout[] = plan.workouts ?? []
  const lastWeekPlanned = workouts.filter(w => w.date >= lastMondayStr && w.date <= lastSundayStr)
  const plannedTss = lastWeekPlanned.reduce((sum, w) => sum + (w.tss ?? 0), 0)
  const actualTss = lastWeekPlanned.filter(w => w.status === 'completed').reduce((sum, w) => sum + (w.tss ?? 0), 0)
  const allPlannedCompleted = lastWeekPlanned.length > 0 && lastWeekPlanned.every(w => w.status === 'completed')

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  const fourteenDaysAgo = new Date(Date.now() - 14 * 864e5).toISOString().split('T')[0]
  let recentActivities: ICUActivity[] = []
  try { recentActivities = await client.getActivities(fourteenDaysAgo, today) } catch { /* proceed without */ }
  const plannedActivityIds = new Set(lastWeekPlanned.map(w => w.icu_activity_id).filter(Boolean))
  const unplannedTss = recentActivities
    .filter(a => a.start_date_local.split('T')[0] >= lastMondayStr && a.start_date_local.split('T')[0] <= lastSundayStr && !plannedActivityIds.has(a.id))
    .reduce((sum, a) => sum + (a.training_load ?? 0), 0)

  const loadMultiplier = computeLoadMultiplier({
    plannedTss, actualTss, unplannedTss, allPlannedCompleted, positiveFeedback: note.length > 0 && !/tired|struggl|hard|sore/i.test(note),
  })

  const planStartDate = plan.created_at.split('T')[0]
  const planWeeks = plan.plan_weeks ?? 12  // matches the existing fallback convention in app/api/plan/extend/route.ts
  const phases = plan.week_phases ?? computeWeekPhases(planWeeks)
  const toDate = new Date(planStartDate); toDate.setUTCDate(toDate.getUTCDate() + phases.length * 7 - 1)

  const garminParams = profile.garmin_email ? { supabase, userId: user.id } : null
  const hrvStatus = await fetchHrvStatusBestSource(today, garminParams, client).catch(() => null)
  const wellness = await client.getWellness(fourteenDaysAgo, today).catch(() => [])
  const latest = wellness[wellness.length - 1] ?? null
  const athleteStateLine = hrvStatus ? `${buildAthleteStateLine(latest, null)}\n${formatHrvForPrompt(hrvStatus)}` : buildAthleteStateLine(latest, null)
  const recentActivitiesSummary = recentActivities.slice(-10).map(a =>
    `- ${a.start_date_local.split('T')[0]}: ${a.name} [${a.type}], ${Math.round(a.moving_time / 60)}min, NP ${a.weighted_average_watts ?? '?'}W, TSS ${a.training_load ?? '?'}`
  ).join('\n') || 'No recent activities.'

  const { data: job, error } = await supabase
    .from('plan_generation_jobs')
    .insert({ user_id: user.id, kind: 'review', status: 'pending' })
    .select('id')
    .single()
  if (error || !job) return NextResponse.json({ error: 'Failed to start review' }, { status: 500 })

  waitUntil(runPlanJob(supabase, job.id, {
    kind: 'review', userId: user.id, planStartDate, phases, fromDate: today, toDate: toDate.toISOString().split('T')[0],
    loadMultiplier, note, trainingPhilosophy: plan.training_philosophy ?? null, profile, recentActivitiesSummary, athleteStateLine,
    priorRationale: plan.rationale, priorTargetEventName: plan.target_event_name, priorTargetEventDate: plan.target_event_date,
    pushSubscription,
  }))

  return NextResponse.json({ job_id: job.id }, { status: 202 })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const { data: activePlan } = await supabase
    .from('training_plans')
    .select('id, name')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!activePlan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const currentWeek = isoWeek(new Date())

  // Dismiss path — update last_reviewed_week only
  if (body.dismiss) {
    const { error: dismissError } = await supabase
      .from('training_plans')
      .update({ last_reviewed_week: currentWeek })
      .eq('id', activePlan.id)
    if (dismissError) return NextResponse.json({ error: 'Failed to update review week' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Apply path
  let plan: GeneratedPlan
  try {
    plan = body.plan
    if (!plan?.workouts?.length) throw new Error('no workouts')
  } catch {
    return NextResponse.json({ error: 'Invalid plan data' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, events')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  // Remove workouts that fall on event dates
  const eventDates = new Set<string>((profile.events ?? []).map((e: { date: string }) => e.date))
  plan = { ...plan, workouts: plan.workouts.filter(w => !eventDates.has(w.date)) }

  if (!plan.workouts.length) {
    return NextResponse.json({ error: 'All adapted workouts conflict with event dates' }, { status: 400 })
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  const today = new Date().toISOString().split('T')[0]

  // Delete existing planned future workouts from intervals.icu
  const { data: futureWorkouts } = await supabase
    .from('workouts')
    .select('id, intervals_icu_event_id')
    .eq('plan_id', activePlan.id)
    .eq('status', 'planned')
    .gte('date', today)

  for (const w of futureWorkouts ?? []) {
    if (w.intervals_icu_event_id) {
      try { await client.deleteEvent(w.intervals_icu_event_id) } catch { /* already deleted */ }
    }
  }

  // Delete existing planned future workouts from DB
  const workoutIds = (futureWorkouts ?? []).map((w: { id: string }) => w.id)
  if (workoutIds.length) {
    await supabase.from('workouts').delete().in('id', workoutIds)
  }

  function estimateTss(steps: Array<{ duration_minutes: number; power_pct_ftp: number }>): number {
    return Math.round(
      steps.reduce((sum, s) => sum + (s.duration_minutes * 60 * (s.power_pct_ftp / 100) ** 2) / 36, 0)
    )
  }

  const uploadErrors: string[] = []

  async function createEventSafe(w: typeof plan.workouts[number]): Promise<string | null> {
    try {
      return await client.createEvent({
        date: w.date,
        name: nameForWorkout(w.type, w.duration_minutes, w.steps),
        description: `Plan: ${activePlan!.name}\n\n${w.description}\n\nTarget: ${w.target_zones}`,
        duration_minutes: w.duration_minutes,
        steps: w.steps,
        note: w.coaching_notes?.summary,
      })
    } catch (err) {
      uploadErrors.push(`${w.date}: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  const BATCH = 5
  const eventIds: (string | null)[] = []
  for (let i = 0; i < plan.workouts.length; i += BATCH) {
    const batch = plan.workouts.slice(i, i + BATCH)
    const ids = await Promise.all(batch.map(createEventSafe))
    eventIds.push(...ids)
  }

  const workoutsToInsert = plan.workouts.map((w, idx) => ({
    plan_id: activePlan.id,
    date: w.date,
    type: w.type,
    duration_minutes: w.duration_minutes,
    description: w.description,
    target_zones: w.target_zones,
    intervals_icu_event_id: eventIds[idx],
    status: 'planned',
    user_id: user.id,
    tss: w.steps?.length ? estimateTss(w.steps) : null,
    steps: w.steps ?? null,
    coaching_notes: w.coaching_notes ?? null,
    optional: w.optional ?? false,
    name: nameForWorkout(w.type, w.duration_minutes, w.steps),
  }))

  const { error: workoutsError } = await supabase.from('workouts').insert(workoutsToInsert)
  if (workoutsError) {
    return NextResponse.json({ error: 'Failed to save workouts' }, { status: 500 })
  }

  const { error: updateError } = await supabase
    .from('training_plans')
    .update({ last_reviewed_week: currentWeek })
    .eq('id', activePlan.id)
  if (updateError) return NextResponse.json({ error: 'Failed to update review week' }, { status: 500 })

  return NextResponse.json({
    ok: true,
    ...(uploadErrors.length ? { upload_warnings: uploadErrors } : {}),
  })
}
