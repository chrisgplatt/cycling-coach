import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { createReviewStream, parsePlanText } from '@/lib/claude/review'
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import type { AthleteDossier } from '@/lib/claude/dossier'
import { fetchHrvStatus } from '@/lib/hrv/server'
import { isoWeek } from '@/lib/iso-week'
import type { GeneratedPlan, ICUActivity, Workout, TrainingPhilosophy } from '@/types'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { note: rawNote = '' } = await req.json().catch(() => ({}))
  const note = String(rawNote).slice(0, 1000)

  const [{ data: profile }, dossier] = await Promise.all([
    supabase.from('user_profile').select('*').maybeSingle(),
    fetchDossier(supabase, user.id),
  ])
  if (!profile) return NextResponse.json({ error: 'Profile not configured' }, { status: 400 })
  if (!profile.intervals_icu_athlete_id || !profile.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const { data: plan } = await supabase
    .from('training_plans')
    .select('*, workouts(*)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!plan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const trainingPhilosophy = plan.training_philosophy as TrainingPhilosophy | null ?? null

  const today = new Date().toISOString().split('T')[0]
  const fourteenDaysAgo = new Date(Date.now() - 14 * 864e5).toISOString().split('T')[0]

  // Compute last week date range (Mon–Sun)
  const todayDate = new Date()
  const dayOfWeek = (todayDate.getDay() + 6) % 7  // 0=Mon, 6=Sun
  const thisMonday = new Date(todayDate)
  thisMonday.setDate(todayDate.getDate() - dayOfWeek)
  const lastMonday = new Date(thisMonday)
  lastMonday.setDate(thisMonday.getDate() - 7)
  const lastSunday = new Date(thisMonday)
  lastSunday.setDate(thisMonday.getDate() - 1)
  const lastMondayStr = lastMonday.toISOString().split('T')[0]
  const lastSundayStr = lastSunday.toISOString().split('T')[0]

  const workouts: Workout[] = plan.workouts ?? []
  const lastWeekWorkouts = workouts.filter(w => w.date >= lastMondayStr && w.date <= lastSundayStr)
  const remainingWorkouts = workouts.filter(w => w.date >= today && w.status === 'planned')

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  let wellness: Awaited<ReturnType<typeof client.getWellness>> = []
  let recentActivities: ICUActivity[] = []
  try {
    ;[wellness, recentActivities] = await Promise.all([
      client.getWellness(fourteenDaysAgo, today),
      client.getActivities(fourteenDaysAgo, today),
    ])
  } catch { /* proceed without live data */ }

  const hrvStatus = await fetchHrvStatus(client, today).catch(() => null)

  let messageStream
  try {
    messageStream = createReviewStream(profile, lastWeekWorkouts, wellness, remainingWorkouts, note, recentActivities, formatDossier(dossier as AthleteDossier | null), hrvStatus, trainingPhilosophy)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Review generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ type: 'total', count: remainingWorkouts.length }) + '\n'))
      let accumulatedText = ''
      let workoutsFound = 0

      messageStream.on('text', (text: string) => {
        accumulatedText += text
        const newCount = (accumulatedText.match(/"date"\s*:/g) ?? []).length
        if (newCount > workoutsFound) {
          workoutsFound = newCount
          try {
            controller.enqueue(encoder.encode(
              JSON.stringify({ type: 'progress', found: workoutsFound }) + '\n'
            ))
          } catch { /* stream already closed */ }
        }
      })

      try {
        await messageStream.finalMessage()
        const generatedPlan = parsePlanText(accumulatedText)
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'done', plan: generatedPlan }) + '\n'))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Review generation failed'
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message }) + '\n'))
      }
      controller.close()
    },
  })

  return new Response(readable, { headers: { 'Content-Type': 'application/x-ndjson' } })
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
        name: `${w.type.charAt(0).toUpperCase() + w.type.slice(1)} — ${w.duration_minutes}min`,
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
