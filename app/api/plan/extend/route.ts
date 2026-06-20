import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { createExtendStream, parsePlanText, countPlannedWorkouts } from '@/lib/claude/plan'
import { computeMethodology } from '@/lib/claude/methodology'
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import { fetchActiveBeliefs, formatAthleteModel } from '@/lib/claude/athlete-model'
import { fetchHrvStatusBestSource } from '@/lib/hrv/server'
import type { AthleteDossier } from '@/lib/claude/dossier'
import type { GeneratedPlan, TrainingPhilosophy } from '@/types'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Important 4: Wrap req.json() in try/catch
  let extraWeeks: number
  try {
    const body = await req.json()
    extraWeeks = typeof body.extra_weeks === 'number' ? Math.round(body.extra_weeks) : 0
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (extraWeeks < 1 || extraWeeks > 26) {
    return NextResponse.json({ error: 'extra_weeks must be between 1 and 26' }, { status: 400 })
  }

  // Fetch active plan
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

  // If there's a completed workout today, start generation from tomorrow
  const { data: todayCompleted } = await supabase
    .from('workouts')
    .select('id')
    .eq('plan_id', activePlan.id)
    .eq('date', today)
    .eq('status', 'completed')
    .limit(1)
    .maybeSingle()
  const genStartDate = todayCompleted
    ? new Date(new Date(today).getTime() + 86400000).toISOString().split('T')[0]
    : today

  // Fetch profile
  const { data: profileData } = await supabase.from('user_profile').select('*').maybeSingle()
  if (!profileData) return NextResponse.json({ error: 'Profile not configured' }, { status: 400 })

  // Recompute phase structure
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

  // Fetch supporting data
  const [dossier, beliefs] = await Promise.all([
    fetchDossier(supabase, user.id),
    fetchActiveBeliefs(supabase, user.id),
  ])

  let hrvStatus = null
  const garminParams = profileData.garmin_email ? { supabase, userId: user.id } : null
  const icuClient = profileData.intervals_icu_athlete_id && profileData.intervals_icu_api_key
    ? new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)
    : null
  try { hrvStatus = await fetchHrvStatusBestSource(today, garminParams, icuClient) } catch { /* optional */ }

  // Critical 3: Wrap createExtendStream in try/catch before any mutations
  let messageStream
  try {
    messageStream = createExtendStream(
      profileData,
      { activities: [], wellness: [], athlete_ftp: null, athlete_weight: null },
      remainingWeeks,
      extraWeeks,
      philosophyToUse.phase_weeks,
      genStartDate,
      philosophyToUse,
      [formatDossier(dossier as AthleteDossier | null), formatAthleteModel(beliefs)].filter(Boolean).join('\n\n'),
      hrvStatus,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Plan extension failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const totalWorkouts = countPlannedWorkouts(profileData, remainingWeeks + extraWeeks, genStartDate)
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
        const generatedPlan: GeneratedPlan = parsePlanText(accumulatedText)

        // Filter out workouts on event dates
        const eventDates = new Set<string>((profileData.events ?? []).map((e: { date: string }) => e.date))
        const cleanWorkouts = generatedPlan.workouts.filter(w => !eventDates.has(w.date))

        // Return the plan to the client for review — no DB mutations here
        controller.enqueue(encoder.encode(
          JSON.stringify({
            type: 'plan',
            plan: { ...generatedPlan, workouts: cleanWorkouts },
            extra_weeks: extraWeeks,
            new_total_weeks: newTotal,
          }) + '\n'
        ))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Plan extension failed'
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message }) + '\n'))
      }
      controller.close()
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}
