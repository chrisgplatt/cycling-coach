import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { nameForWorkout } from '@/lib/workout-names'
import type { WorkoutStep } from '@/types'

function estimateTss(steps: WorkoutStep[]): number {
  return Math.round(steps.reduce((sum, s) => sum + (s.duration_minutes * 60 * (s.power_pct_ftp / 100) ** 2) / 36, 0))
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const { date, type, duration_minutes, description, target_zones, steps, optional } = body
  if (!date || !type || !duration_minutes || !description || !target_zones) {
    return NextResponse.json({ error: 'Missing required fields: date, type, duration_minutes, description, target_zones' }, { status: 400 })
  }

  const { data: plan } = await supabase
    .from('training_plans')
    .select('id, name')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!plan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const tss = Array.isArray(steps) && steps.length ? estimateTss(steps as WorkoutStep[]) : null
  const name = nameForWorkout(type, duration_minutes, Array.isArray(steps) ? (steps as WorkoutStep[]) : [])

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  let icuEventId: string | null = null
  if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
    const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    try {
      icuEventId = await client.createEvent({
        date,
        name,
        description: `Plan: ${plan.name}\n\n${description}\n\nTarget: ${target_zones}`,
        duration_minutes,
        steps: Array.isArray(steps) ? steps : [],
      })
    } catch { /* proceed without ICU event */ }
  }

  const { data: workout, error } = await supabase
    .from('workouts')
    .insert({
      plan_id: plan.id,
      user_id: user.id,
      date,
      type,
      duration_minutes,
      description,
      target_zones,
      steps: Array.isArray(steps) && steps.length ? steps : null,
      tss,
      intervals_icu_event_id: icuEventId,
      status: 'planned',
      optional: optional ?? false,
      name,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ workout })
}
