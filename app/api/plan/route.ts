import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { generatePlan } from '@/lib/claude/plan'
import type { GeneratedPlan } from '@/types'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: plan } = await supabase
    .from('training_plans')
    .select('*, workouts(*)')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json(plan ?? null)
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { syncData, weeks = 6 } = await req.json()
  const safeWeeks = Math.min(16, Math.max(2, Math.round(Number(weeks) || 6)))
  const { data: profileData } = await supabase.from('user_profile').select('*').maybeSingle()
  if (!profileData) return NextResponse.json({ error: 'Profile not configured' }, { status: 400 })
  if (!profileData.events?.length) return NextResponse.json({ error: 'Add and save at least one event in Settings before generating a plan' }, { status: 400 })

  try {
    const generatedPlan = await generatePlan(profileData, syncData ?? { activities: [], wellness: [], athlete_ftp: null, athlete_weight: null }, safeWeeks)
    return NextResponse.json(generatedPlan)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Plan generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  if (name.length > 100) {
    return NextResponse.json({ error: 'Plan name must be 100 characters or fewer' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

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

  const { error: archiveError } = await supabase
    .from('training_plans')
    .update({ status: 'archived' })
    .eq('status', 'active')

  if (archiveError) {
    return NextResponse.json({ error: 'Failed to archive existing plan' }, { status: 500 })
  }

  const { data: savedPlan, error: planError } = await supabase
    .from('training_plans')
    .insert({
      name,
      status: 'active',
      target_event_name: plan.target_event_name,
      target_event_date: plan.target_event_date,
      phase: plan.phase,
      rationale: plan.rationale,
      user_id: user.id,
    })
    .select()
    .single()

  if (planError || !savedPlan) {
    return NextResponse.json({ error: 'Failed to save plan' }, { status: 500 })
  }

  const uploadErrors: string[] = []
  const workoutsToInsert = []
  for (const w of plan.workouts) {
    let intervals_icu_event_id: string | null = null
    try {
      intervals_icu_event_id = await client.createEvent({
        date: w.date,
        name: `${w.type.charAt(0).toUpperCase() + w.type.slice(1)} — ${w.duration_minutes}min`,
        description: `Plan: ${name}\n\n${w.description}\n\nTarget: ${w.target_zones}`,
        duration_minutes: w.duration_minutes,
        steps: w.steps,
      })
    } catch (err) {
      uploadErrors.push(`${w.date}: ${err instanceof Error ? err.message : String(err)}`)
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
      user_id: user.id,
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
