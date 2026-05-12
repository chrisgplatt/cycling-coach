import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { IntervalsClient } from '@/lib/intervals/client'
import { generatePlan } from '@/lib/claude/plan'
import type { GeneratedPlan } from '@/types'

// GET — return the active training plan with its workouts
export async function GET() {
  const { data: plan } = await supabase
    .from('training_plans')
    .select('*, workouts(*)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json(plan ?? null)
}

// POST — generate a new plan (returns proposal, does NOT save yet)
export async function POST(req: NextRequest) {
  const { syncData } = await req.json()
  const { data: profileData } = await supabase.from('user_profile').select('*').maybeSingle()
  if (!profileData) return NextResponse.json({ error: 'Profile not configured' }, { status: 400 })
  if (!profileData.events?.length) return NextResponse.json({ error: 'Add and save at least one event in Settings before generating a plan' }, { status: 400 })
  const profile = profileData

  try {
    const generatedPlan = await generatePlan(profile, syncData ?? { activities: [], wellness: [], athlete_ftp: null, athlete_weight: null })
    return NextResponse.json(generatedPlan)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Plan generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// PATCH — approve a generated plan: archive current, save new, upload to intervals.icu
export async function PATCH(req: NextRequest) {
  let plan: GeneratedPlan
  let name = ''
  try {
    const body = await req.json()
    plan = body.plan
    name = (body.name ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!plan?.workouts?.length) {
    return NextResponse.json({ error: 'Invalid plan data' }, { status: 400 })
  }

  if (!name) {
    return NextResponse.json({ error: 'Plan name is required' }, { status: 400 })
  }

  // Read credentials from DB (not from client)
  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .single()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  // Delete future planned workouts from intervals.icu before archiving
  const today = new Date().toISOString().split('T')[0]
  const { data: activePlan } = await supabase
    .from('training_plans')
    .select('id')
    .eq('status', 'active')
    .maybeSingle()

  if (activePlan) {
    const { data: futureWorkouts } = await supabase
      .from('workouts')
      .select('intervals_icu_event_id')
      .eq('plan_id', activePlan.id)
      .eq('status', 'planned')
      .gte('date', today)
      .not('intervals_icu_event_id', 'is', null)

    for (const w of futureWorkouts ?? []) {
      if (w.intervals_icu_event_id) {
        try { await client.deleteEvent(w.intervals_icu_event_id) } catch { /* already deleted */ }
      }
    }
  }

  // Archive existing active plan
  const { error: archiveError } = await supabase
    .from('training_plans')
    .update({ status: 'archived' })
    .eq('status', 'active')

  if (archiveError) {
    return NextResponse.json({ error: 'Failed to archive existing plan' }, { status: 500 })
  }

  // Save new plan
  const { data: savedPlan, error: planError } = await supabase
    .from('training_plans')
    .insert({
      name,
      status: 'active',
      target_event_name: plan.target_event_name,
      target_event_date: plan.target_event_date,
      phase: plan.phase,
      rationale: plan.rationale,
    })
    .select()
    .single()

  if (planError || !savedPlan) {
    return NextResponse.json({ error: 'Failed to save plan' }, { status: 500 })
  }

  // Upload each workout sequentially to avoid rate limiting
  const uploadErrors: string[] = []
  const workoutsToInsert = []
  for (const w of plan.workouts) {
    let intervals_icu_event_id: string | null = null
    const eventParams = {
      date: w.date,
      name: `${w.type.charAt(0).toUpperCase() + w.type.slice(1)} — ${w.duration_minutes}min`,
      description: `Plan: ${name}\n\n${w.description}\n\nTarget: ${w.target_zones}`,
      duration_minutes: w.duration_minutes,
    }
    try {
      intervals_icu_event_id = await client.createEvent({ ...eventParams, steps: w.steps })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      uploadErrors.push(`${w.date}: ${msg}`)
    }
    workoutsToInsert.push({
      plan_id: savedPlan.id,
      date: w.date,
      type: w.type,
      duration_minutes: w.duration_minutes,
      description: w.description,
      target_zones: w.target_zones,
      intervals_icu_event_id,
      status: 'planned',
    })
  }

  const { error: workoutsError } = await supabase.from('workouts').insert(workoutsToInsert)
  if (workoutsError) {
    return NextResponse.json({ error: 'Failed to save workouts' }, { status: 500 })
  }

  return NextResponse.json({
    plan: savedPlan,
    ...(uploadErrors.length ? { upload_warnings: uploadErrors } : {}),
  })
}
