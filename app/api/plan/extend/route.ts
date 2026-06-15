import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { createExtendStream, parsePlanText, countPlannedWorkouts } from '@/lib/claude/plan'
import { computeMethodology } from '@/lib/claude/methodology'
import { fetchDossier, formatDossier } from '@/lib/claude/dossier'
import { fetchActiveBeliefs, formatAthleteModel } from '@/lib/claude/athlete-model'
import { fetchHrvStatus } from '@/lib/hrv/server'
import type { AthleteDossier } from '@/lib/claude/dossier'
import type { GeneratedPlan, TrainingPhilosophy, PlanPhase } from '@/types'

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
  if (profileData.intervals_icu_athlete_id && profileData.intervals_icu_api_key) {
    const hrvClient = new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)
    try { hrvStatus = await fetchHrvStatus(hrvClient, today) } catch { /* optional */ }
  }

  // Critical 3: Wrap createExtendStream in try/catch before any mutations
  let messageStream
  try {
    messageStream = createExtendStream(
      profileData,
      { activities: [], wellness: [], athlete_ftp: null, athlete_weight: null },
      remainingWeeks,
      extraWeeks,
      philosophyToUse.phase_weeks,
      today,
      philosophyToUse,
      [formatDossier(dossier as AthleteDossier | null), formatAthleteModel(beliefs)].filter(Boolean).join('\n\n'),
      hrvStatus,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Plan extension failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const totalWorkouts = countPlannedWorkouts(profileData, remainingWeeks + extraWeeks, today)
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

        // Filter out any workouts on event dates
        const eventDates = new Set<string>((profileData.events ?? []).map((e: { date: string }) => e.date))
        const cleanWorkouts = generatedPlan.workouts.filter(w => !eventDates.has(w.date))

        // Critical 1: Deletions moved inside the stream's try block, after AI output is confirmed good

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

        // Important 5: Clamp weeksCompleted to avoid exceeding week_phases array length
        const weekPhasesArray = (activePlan.week_phases as PlanPhase[]) ?? []
        const clampedWeeksCompleted = Math.min(weeksCompleted, weekPhasesArray.length)

        // Update plan record
        const newWeekPhases = [
          ...weekPhasesArray.slice(0, clampedWeeksCompleted),
          ...(generatedPlan.week_phases ?? []),
        ]
        await supabase
          .from('training_plans')
          .update({
            plan_weeks: newTotal,
            week_phases: newWeekPhases,
            phase: generatedPlan.phase,
            training_philosophy: philosophyToUse,
          })
          .eq('id', activePlan.id)

        // Upload to intervals.icu and insert workout rows
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
          for (let i = 0; i < cleanWorkouts.length; i += BATCH) {
            const batch = cleanWorkouts.slice(i, i + BATCH)
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
          eventIds.push(...cleanWorkouts.map(() => null))
        }

        const workoutsToInsert = cleanWorkouts.map((w, idx) => ({
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

        // Critical 2: Check insert result and emit error if it fails
        const { error: insertError } = await supabase.from('workouts').insert(workoutsToInsert)
        if (insertError) {
          controller.enqueue(encoder.encode(
            JSON.stringify({ type: 'error', message: 'Failed to save workouts' }) + '\n'
          ))
          controller.close()
          return
        }

        controller.enqueue(encoder.encode(
          JSON.stringify({ type: 'done', extra_weeks: extraWeeks, new_total_weeks: newTotal, upload_warnings: uploadErrors }) + '\n'
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
