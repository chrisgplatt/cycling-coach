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
  const { profile, syncData } = await req.json()

  try {
    const generatedPlan = await generatePlan(profile, syncData)
    return NextResponse.json(generatedPlan)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Plan generation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// PATCH — approve a generated plan: archive current, save new, upload to intervals.icu
export async function PATCH(req: NextRequest) {
  const { plan, profile }: { plan: GeneratedPlan; profile: { intervals_icu_athlete_id: string; intervals_icu_api_key: string } } = await req.json()

  // Archive existing active plan
  await supabase
    .from('training_plans')
    .update({ status: 'archived' })
    .eq('status', 'active')

  // Save new plan
  const { data: savedPlan, error: planError } = await supabase
    .from('training_plans')
    .insert({
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

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  // Upload each workout and save with intervals.icu event ID
  const workoutsToInsert = await Promise.all(
    plan.workouts.map(async w => {
      let intervals_icu_event_id: string | null = null
      try {
        intervals_icu_event_id = await client.createEvent({
          date: w.date,
          name: `${w.type.charAt(0).toUpperCase() + w.type.slice(1)} — ${w.duration_minutes}min`,
          description: `${w.description}\n\nTarget: ${w.target_zones}`,
          duration_minutes: w.duration_minutes,
        })
      } catch {
        // Log but don't fail the whole plan save if one event upload fails
        console.error(`Failed to upload event for ${w.date}`)
      }
      return {
        plan_id: savedPlan.id,
        date: w.date,
        type: w.type,
        duration_minutes: w.duration_minutes,
        description: w.description,
        target_zones: w.target_zones,
        intervals_icu_event_id,
        status: 'planned',
      }
    })
  )

  await supabase.from('workouts').insert(workoutsToInsert)

  return NextResponse.json({ plan: savedPlan })
}
