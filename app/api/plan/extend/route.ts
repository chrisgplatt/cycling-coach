import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { runPlanJob } from '@/lib/plan/job-runner'
import { computeMethodology } from '@/lib/claude/methodology'
import { computeWeekPhases } from '@/lib/plan/phases'
import { buildAthleteStateLine } from '@/lib/claude/athlete-state'
import { formatHrvForPrompt } from '@/lib/hrv/format'
import { fetchHrvStatusBestSource } from '@/lib/hrv/server'
import type { TrainingPhilosophy } from '@/types'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const { data: activePlan } = await supabase
    .from('training_plans')
    .select('id, plan_weeks, created_at, training_philosophy, week_phases, phase, rationale, target_event_name, target_event_date')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!activePlan) return NextResponse.json({ error: 'No active plan' }, { status: 400 })

  const today = new Date().toISOString().split('T')[0]
  const planStart = activePlan.created_at.split('T')[0]
  const weeksCompleted = Math.max(0, Math.floor((new Date(today).getTime() - new Date(planStart).getTime()) / (7 * 86400000)))
  const currentPlanWeeks = activePlan.plan_weeks ?? 12
  const remainingWeeks = Math.max(1, currentPlanWeeks - weeksCompleted)
  const newTotal = Math.min(52, weeksCompleted + remainingWeeks + extraWeeks)

  const { data: todayCompleted } = await supabase
    .from('workouts').select('id').eq('plan_id', activePlan.id).eq('date', today).eq('status', 'completed').limit(1).maybeSingle()
  const genStartDate = todayCompleted
    ? new Date(new Date(today).getTime() + 86400000).toISOString().split('T')[0]
    : today

  const { data: profileData } = await supabase.from('user_profile').select('*').maybeSingle()
  if (!profileData) return NextResponse.json({ error: 'Profile not configured' }, { status: 400 })

  let pushSubscription = null
  if (profileData.notifications_enabled) {
    const { data: sub } = await supabase.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', user.id).limit(1).maybeSingle()
    pushSubscription = sub ?? null
  }

  const weeklyHours = ((profileData.weekly_availability ?? []) as Array<{ duration_minutes: number }>).reduce((sum, a) => sum + a.duration_minutes, 0) / 60
  const nearestEvent = [...(profileData.events ?? [])]
    .filter((e: { date: string; priority: string }) => e.date >= today && (e.priority === 'A' || e.priority === 'B'))
    .sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date))[0]
    ?? [...(profileData.events ?? [])].filter((e: { date: string }) => e.date >= today).sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date))[0]
    ?? null
  const updatedPhilosophy = computeMethodology({
    weeklyHours, weeksToEvent: newTotal, eventType: nearestEvent?.type ?? null, eventPriority: nearestEvent?.priority ?? null,
    currentCTL: null, goals: profileData.goals ?? '',
  })
  const storedPhilosophy: TrainingPhilosophy | null = activePlan.training_philosophy ?? null
  const philosophyToUse: TrainingPhilosophy = storedPhilosophy ? { ...storedPhilosophy, phase_weeks: updatedPhilosophy.phase_weeks } : updatedPhilosophy

  const client = new IntervalsClient(profileData.intervals_icu_athlete_id, profileData.intervals_icu_api_key)
  const garminParams = profileData.garmin_email ? { supabase, userId: user.id } : null
  let hrvStatus = null
  try { hrvStatus = await fetchHrvStatusBestSource(today, garminParams, client) } catch { /* optional */ }
  const athleteStateLine = hrvStatus ? `${buildAthleteStateLine(null, null)}\n${formatHrvForPrompt(hrvStatus)}` : buildAthleteStateLine(null, null)

  const newPhases = computeWeekPhases(newTotal)
  const toDate = new Date(planStart); toDate.setUTCDate(toDate.getUTCDate() + newTotal * 7 - 1)

  const { data: job, error } = await supabase
    .from('plan_generation_jobs')
    .insert({ user_id: user.id, kind: 'extend', status: 'pending' })
    .select('id')
    .single()
  if (error || !job) return NextResponse.json({ error: 'Failed to start plan extension' }, { status: 500 })

  waitUntil(runPlanJob(supabase, job.id, {
    kind: 'extend', userId: user.id, planStartDate: planStart, phases: newPhases,
    fromDate: genStartDate, toDate: toDate.toISOString().split('T')[0], trainingPhilosophy: philosophyToUse,
    profile: profileData, recentActivitiesSummary: 'No recent activities.', athleteStateLine,
    priorRationale: activePlan.rationale, priorTargetEventName: activePlan.target_event_name, priorTargetEventDate: activePlan.target_event_date,
    pushSubscription,
  }))

  return NextResponse.json({ job_id: job.id, extra_weeks: extraWeeks, new_total_weeks: newTotal }, { status: 202 })
}
