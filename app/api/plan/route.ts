import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { createPlanStream, parsePlanText, countPlannedWorkouts } from '@/lib/claude/plan'
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import { fetchActiveBeliefs, formatAthleteModel } from '@/lib/claude/athlete-model'
import type { AthleteDossier } from '@/lib/claude/dossier'
import { fetchHrvStatusBestSource } from '@/lib/hrv/server'
import { nameForWorkout } from '@/lib/workout-names'
import { archivePlan } from '@/lib/plan/archive'
import type { GeneratedPlan, TrainingPhilosophy } from '@/types'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: plan }, { data: unplanned }] = await Promise.all([
    supabase
      .from('training_plans')
      .select('*, workouts(*)')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('workouts')
      .select('*')
      .is('plan_id', null)
      .eq('status', 'completed'),
  ])

  if (!plan) {
    // No active plan — return a synthetic shell so the dashboard can still render rides
    if (!unplanned?.length) return NextResponse.json(null)
    return NextResponse.json({ workouts: unplanned })
  }

  // Merge unplanned rides onto the plan's workout list, avoiding duplicates by icu_activity_id
  const planActivityIds = new Set(
    (plan.workouts ?? []).map((w: { icu_activity_id: string | null }) => w.icu_activity_id).filter(Boolean)
  )
  const extra = (unplanned ?? []).filter(w => !planActivityIds.has(w.icu_activity_id))

  return NextResponse.json({ ...plan, workouts: [...(plan.workouts ?? []), ...extra] })
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { syncData, weeks = 6, startDate, notes = '', training_philosophy = null } = await req.json()
  const safeWeeks = Math.min(13, Math.max(1, Math.round(Number(weeks) || 6)))
  const safeStartDate = typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    ? startDate
    : new Date().toISOString().split('T')[0]
  const [{ data: profileData }, dossier, beliefs] = await Promise.all([
    supabase.from('user_profile').select('*').maybeSingle(),
    fetchDossier(supabase, user.id),
    fetchActiveBeliefs(supabase, user.id),
  ])
  if (!profileData) return NextResponse.json({ error: 'Profile not configured' }, { status: 400 })
  if (!profileData.events?.length) return NextResponse.json({ error: 'Add and save at least one event in Settings before generating a plan' }, { status: 400 })

  const hrvToday = new Date().toISOString().split('T')[0]
  let hrvStatus = null
  const garminParams = profileData?.garmin_email ? { supabase, userId: user.id } : null
  const icuClient = profileData?.intervals_icu_athlete_id && profileData?.intervals_icu_api_key
    ? new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)
    : null
  try { hrvStatus = await fetchHrvStatusBestSource(hrvToday, garminParams, icuClient) } catch { /* optional */ }

  let messageStream
  try {
    messageStream = createPlanStream(
      profileData,
      syncData ?? { activities: [], wellness: [], athlete_ftp: null, athlete_weight: null },
      safeWeeks,
      safeStartDate,
      typeof notes === 'string' ? notes.trim() : '',
      [formatDossier(dossier as AthleteDossier | null), formatAthleteModel(beliefs)].filter(Boolean).join('\n\n'),
      hrvStatus,
      (training_philosophy as TrainingPhilosophy | null) ?? null,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Plan generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const totalWorkouts = countPlannedWorkouts(profileData, safeWeeks, safeStartDate)
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'total', count: totalWorkouts }) + '\n'))
      let accumulatedText = ''
      let workoutsFound = 0

      messageStream.on('text', (text: string) => {
        accumulatedText += text
        const newCount = (accumulatedText.match(/"date"\s*:/g) ?? []).length
        if (newCount > workoutsFound) {
          workoutsFound = newCount
          controller.enqueue(encoder.encode(
            JSON.stringify({ type: 'progress', found: workoutsFound }) + '\n'
          ))
        }
      })

      try {
        await messageStream.finalMessage()
        const plan = parsePlanText(accumulatedText)
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'done', plan }) + '\n'))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Plan generation failed'
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message }) + '\n'))
      }
      controller.close()
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let plan: GeneratedPlan
  let name = ''
  let planWeeks: number | null = null
  let bodyTrainingPhilosophy: TrainingPhilosophy | null = null
  let isPhilosophyOnly = false
  let isRenameOnly = false
  try {
    const body = await req.json()
    plan = body.plan
    name = (body.name ?? '').trim()
    const rawWeeks = body.weeks
    planWeeks = typeof rawWeeks === 'number' && rawWeeks > 0 ? Math.min(13, Math.round(rawWeeks)) : null
    bodyTrainingPhilosophy = (body.training_philosophy as TrainingPhilosophy | null) ?? null
    isPhilosophyOnly = !body.plan && body.training_philosophy !== undefined
    isRenameOnly = !body.plan && typeof body.name === 'string' && body.name.trim().length > 0
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Philosophy-only update path (for legacy plan re-evaluation)
  if (isPhilosophyOnly) {
    const { data: activePlan } = await supabase
      .from('training_plans')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!activePlan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })
    const { error } = await supabase
      .from('training_plans')
      .update({ training_philosophy: bodyTrainingPhilosophy })
      .eq('id', activePlan.id)
    if (error) return NextResponse.json({ error: 'Failed to update philosophy' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Rename-only update path
  if (isRenameOnly) {
    const newName = name
    if (newName.length > 100) {
      return NextResponse.json({ error: 'Plan name must be 100 characters or fewer' }, { status: 400 })
    }
    const { data: activePlan } = await supabase
      .from('training_plans')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!activePlan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })
    const { error } = await supabase
      .from('training_plans')
      .update({ name: newName })
      .eq('id', activePlan.id)
    if (error) return NextResponse.json({ error: 'Failed to rename plan' }, { status: 500 })
    return NextResponse.json({ ok: true, name: newName })
  }

  if (!plan?.workouts?.length) {
    return NextResponse.json({ error: 'Invalid plan data' }, { status: 400 })
  }

  if (!name) {
    return NextResponse.json({ error: 'Plan name is required' }, { status: 400 })
  }

  if (name.length > 100) {
    return NextResponse.json({ error: 'Plan name must be 100 characters or fewer' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, events, current_ftp')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  // Remove any workout Claude placed on an event date (belt-and-braces)
  const eventDates = new Set<string>((profile.events ?? []).map((e: { date: string }) => e.date))
  const blockedDates = plan.workouts.filter(w => eventDates.has(w.date)).map(w => w.date)
  plan = { ...plan, workouts: plan.workouts.filter(w => !eventDates.has(w.date)) }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  const today = new Date().toISOString().split('T')[0]
  const { data: activePlan } = await supabase
    .from('training_plans')
    .select('id')
    .eq('status', 'active')
    .maybeSingle()

  if (activePlan) {
    await archivePlan(supabase, client, activePlan.id, today)
  }

  const { data: savedPlan, error: planError } = await supabase
    .from('training_plans')
    .insert({
      name,
      status: 'active',
      target_event_name: plan.target_event_name,
      target_event_date: plan.target_event_date,
      phase: plan.phase,
      week_phases: plan.week_phases ?? null,
      rationale: plan.rationale,
      plan_weeks: planWeeks,
      user_id: user.id,
      baseline_ftp: profile.current_ftp ?? null,
      training_philosophy: bodyTrainingPhilosophy ?? null,
    })
    .select()
    .single()

  if (planError || !savedPlan) {
    return NextResponse.json({ error: 'Failed to save plan' }, { status: 500 })
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
        description: `Plan: ${name}\n\n${w.description}\n\nTarget: ${w.target_zones}`,
        duration_minutes: w.duration_minutes,
        steps: w.steps,
        note: w.coaching_notes?.summary,
      })
    } catch (err) {
      uploadErrors.push(`${w.date}: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  // Upload in batches of 5 to avoid rate limits
  const BATCH = 5
  const eventIds: (string | null)[] = []
  for (let i = 0; i < plan.workouts.length; i += BATCH) {
    const batch = plan.workouts.slice(i, i + BATCH)
    const ids = await Promise.all(batch.map(createEventSafe))
    eventIds.push(...ids)
  }

  const workoutsToInsert = plan.workouts.map((w, idx) => ({
    plan_id: savedPlan.id,
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

  return NextResponse.json({
    plan: savedPlan,
    ...(uploadErrors.length ? { upload_warnings: uploadErrors } : {}),
    ...(blockedDates.length ? { blocked_dates: blockedDates } : {}),
  })
}
