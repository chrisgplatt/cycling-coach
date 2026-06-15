import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { computeMethodology } from '@/lib/claude/methodology'
import type { GeneratedPlan, TrainingPhilosophy, PlanPhase } from '@/types'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let extraWeeks: number
  let incomingPlan: GeneratedPlan
  try {
    const body = await req.json()
    extraWeeks = typeof body.extra_weeks === 'number' ? Math.round(body.extra_weeks) : 0
    incomingPlan = body.plan
    if (!incomingPlan?.workouts?.length) throw new Error('missing plan')
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (extraWeeks < 1 || extraWeeks > 26) {
    return NextResponse.json({ error: 'extra_weeks out of range' }, { status: 400 })
  }

  const { data: activePlan } = await supabase
    .from('training_plans')
    .select('id, plan_weeks, created_at, training_philosophy, week_phases, phase')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!activePlan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const today = new Date().toISOString().split('T')[0]
  const planStart = activePlan.created_at.split('T')[0]
  const weeksCompleted = Math.max(0, Math.floor(
    (new Date(today).getTime() - new Date(planStart).getTime()) / (7 * 86400000)
  ))
  const currentPlanWeeks = activePlan.plan_weeks ?? 12
  const remainingWeeks = Math.max(1, currentPlanWeeks - weeksCompleted)
  const newTotal = Math.min(52, weeksCompleted + remainingWeeks + extraWeeks)

  const { data: profileData } = await supabase.from('user_profile').select('*').maybeSingle()
  if (!profileData) return NextResponse.json({ error: 'Profile not configured' }, { status: 400 })

  const weeklyHours = ((profileData.weekly_availability ?? []) as Array<{ duration_minutes: number }>)
    .reduce((sum, a) => sum + a.duration_minutes, 0) / 60
  const nearestEvent = [...(profileData.events ?? [])]
    .filter((e: { date: string; priority: string }) => e.date >= today && (e.priority === 'A' || e.priority === 'B'))
    .sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date))[0]
    ?? [...(profileData.events ?? [])].filter((e: { date: string }) => e.date >= today).sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date))[0]
    ?? null
  const updatedPhilosophy = computeMethodology({
    weeklyHours,
    weeksToEvent: newTotal,
    eventType: nearestEvent?.type ?? null,
    eventPriority: nearestEvent?.priority ?? null,
    currentCTL: null,
    goals: profileData.goals ?? '',
  })
  const storedPhilosophy: TrainingPhilosophy | null = activePlan.training_philosophy ?? null
  const philosophyToUse: TrainingPhilosophy = storedPhilosophy
    ? { ...storedPhilosophy, phase_weeks: updatedPhilosophy.phase_weeks }
    : updatedPhilosophy

  // Delete future unplanned workouts from intervals.icu
  if (profileData.intervals_icu_athlete_id && profileData.intervals_icu_api_key) {
    const client = new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)
    const { data: futureWorkouts } = await supabase
      .from('workouts')
      .select('intervals_icu_event_id')
      .eq('plan_id', activePlan.id)
      .neq('status', 'completed')
      .gte('date', today)
      .not('intervals_icu_event_id', 'is', null)
    for (const w of futureWorkouts ?? []) {
      if (w.intervals_icu_event_id) {
        try { await client.deleteEvent(w.intervals_icu_event_id) } catch { /* already gone */ }
      }
    }
  }

  // Delete future unplanned workout rows from DB
  await supabase
    .from('workouts')
    .delete()
    .eq('plan_id', activePlan.id)
    .neq('status', 'completed')
    .gte('date', today)

  // Update plan record
  const weekPhasesArray = (activePlan.week_phases as PlanPhase[]) ?? []
  const clampedWeeksCompleted = Math.min(weeksCompleted, weekPhasesArray.length)
  const newWeekPhases = [
    ...weekPhasesArray.slice(0, clampedWeeksCompleted),
    ...(incomingPlan.week_phases ?? []),
  ]
  await supabase
    .from('training_plans')
    .update({
      plan_weeks: newTotal,
      week_phases: newWeekPhases,
      phase: incomingPlan.phase,
      training_philosophy: philosophyToUse,
    })
    .eq('id', activePlan.id)

  function estimateTss(steps: Array<{ duration_minutes: number; power_pct_ftp: number }>): number {
    return Math.round(
      steps.reduce((sum, s) => sum + (s.duration_minutes * 60 * (s.power_pct_ftp / 100) ** 2) / 36, 0)
    )
  }

  const uploadErrors: string[] = []
  const eventIds: (string | null)[] = []

  if (profileData.intervals_icu_athlete_id && profileData.intervals_icu_api_key) {
    const client = new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)
    const BATCH = 5
    for (let i = 0; i < incomingPlan.workouts.length; i += BATCH) {
      const batch = incomingPlan.workouts.slice(i, i + BATCH)
      const ids = await Promise.all(batch.map(async w => {
        try {
          return await client.createEvent({
            date: w.date,
            name: `${w.type.charAt(0).toUpperCase() + w.type.slice(1)} — ${w.duration_minutes}min`,
            description: `${w.description}\n\nTarget: ${w.target_zones}`,
            duration_minutes: w.duration_minutes,
            steps: w.steps,
            note: w.coaching_notes?.summary,
          })
        } catch (err) {
          uploadErrors.push(`${w.date}: ${err instanceof Error ? err.message : String(err)}`)
          return null
        }
      }))
      eventIds.push(...ids)
    }
  } else {
    eventIds.push(...incomingPlan.workouts.map(() => null))
  }

  const workoutsToInsert = incomingPlan.workouts.map((w, idx) => ({
    plan_id: activePlan.id,
    date: w.date,
    type: w.type,
    duration_minutes: w.duration_minutes,
    description: w.description,
    target_zones: w.target_zones,
    intervals_icu_event_id: eventIds[idx] ?? null,
    status: 'planned',
    user_id: user.id,
    tss: w.steps?.length ? estimateTss(w.steps) : null,
    steps: w.steps ?? null,
    coaching_notes: w.coaching_notes ?? null,
  }))

  const { error: insertError } = await supabase.from('workouts').insert(workoutsToInsert)
  if (insertError) {
    return NextResponse.json({ error: 'Failed to save workouts' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, upload_warnings: uploadErrors })
}
