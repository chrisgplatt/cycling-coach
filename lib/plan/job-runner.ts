import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedPlan, TrainingPhilosophy, UserProfile } from '@/types'
import { buildPlanSkeleton } from '@/lib/plan/scheduler'
import type { ScheduledSession } from '@/lib/plan/scheduler'
import { interpretGoals } from '@/lib/claude/plan-emphasis'
import { fillSession, fallbackSession } from '@/lib/claude/session-fill'
import { computeWeekPhases } from '@/lib/plan/phases'
import { sendPush } from '@/lib/push'
import type { StoredSubscription } from '@/lib/push'

export interface PlanJobRequest {
  kind: 'generate'
  userId: string
  totalWeeks: number
  startDate: string
  notes: string
  trainingPhilosophy: TrainingPhilosophy | null
  profile: UserProfile
  recentActivitiesSummary: string
  athleteStateLine: string
  pushSubscription?: StoredSubscription | null
}

const CONCURRENCY = 8

async function updateJob(
  supabase: SupabaseClient,
  jobId: string,
  fields: Partial<{ status: string; progress: unknown; result: unknown; error: string }>,
): Promise<void> {
  await supabase.from('plan_generation_jobs').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', jobId)
}

function nearestEvent(events: UserProfile['events'], fromDate: string): { name: string; date: string } {
  const upcoming = [...events].filter(e => e.date >= fromDate).sort((a, b) => a.date.localeCompare(b.date))
  const chosen = upcoming[0] ?? events[0]
  return { name: chosen?.name ?? '', date: chosen?.date ?? fromDate }
}

async function fillAllSessions(
  sessions: ScheduledSession[],
  context: { athleteStateLine: string; recentActivitiesSummary: string; ftp: number },
  onProgress: (completed: number, failedDays: string[]) => Promise<void>,
): Promise<GeneratedPlan['workouts']> {
  const filled: GeneratedPlan['workouts'] = new Array(sessions.length)
  const failedDays: string[] = []
  let completed = 0

  for (let i = 0; i < sessions.length; i += CONCURRENCY) {
    const chunk = sessions.slice(i, i + CONCURRENCY)
    await Promise.all(chunk.map(async (session, offset) => {
      const idx = i + offset
      let result
      try {
        result = await fillSession(session, context)
      } catch {
        try {
          result = await fillSession(session, context)
        } catch {
          result = fallbackSession(session)
          failedDays.push(session.date)
        }
      }
      filled[idx] = {
        date: session.date, type: session.workoutType, duration_minutes: session.durationMinutes,
        description: result.description, target_zones: result.target_zones, steps: result.steps,
        coaching_notes: result.coaching_notes, optional: session.optional,
      }
      completed++
      await onProgress(completed, failedDays)
    }))
  }
  return filled
}

export async function runGeneratePlanJob(
  supabase: SupabaseClient,
  jobId: string,
  request: PlanJobRequest,
): Promise<void> {
  await updateJob(supabase, jobId, { status: 'running' })
  try {
    if (!request.profile.events?.length) {
      throw new Error('Add and save at least one event in Settings before generating a plan')
    }

    const { emphasis, rationale } = await interpretGoals(request.profile.goals, request.notes)
    const phases = computeWeekPhases(request.totalWeeks)
    const endDate = new Date(request.startDate)
    endDate.setUTCDate(endDate.getUTCDate() + request.totalWeeks * 7 - 1)

    const skeleton = buildPlanSkeleton({
      profile: request.profile, planStartDate: request.startDate, phases,
      fromDate: request.startDate, toDate: endDate.toISOString().split('T')[0],
      emphasis, trainingPhilosophy: request.trainingPhilosophy,
    })
    const sessions = skeleton.filter((d): d is ScheduledSession => d.status === 'session')

    await updateJob(supabase, jobId, { progress: { total: sessions.length, completed: 0, failed_days: [] } })

    const context = {
      athleteStateLine: request.athleteStateLine,
      recentActivitiesSummary: request.recentActivitiesSummary,
      ftp: request.profile.current_ftp,
    }
    // finalFailedDays is updated on every progress callback, so by the time
    // fillAllSessions resolves it holds the complete accumulated list — reused
    // in the 'done' update below instead of resetting failed_days to empty.
    let finalFailedDays: string[] = []
    const workouts = await fillAllSessions(sessions, context, (completed, failedDays) => {
      finalFailedDays = failedDays
      return updateJob(supabase, jobId, { progress: { total: sessions.length, completed, failed_days: failedDays } })
    })

    const nearest = nearestEvent(request.profile.events, request.startDate)
    const plan: GeneratedPlan = {
      rationale, target_event_name: nearest.name, target_event_date: nearest.date,
      phase: phases[0], week_phases: phases, workouts,
    }
    await updateJob(supabase, jobId, { status: 'done', result: plan, progress: { total: sessions.length, completed: sessions.length, failed_days: finalFailedDays } })

    if (request.pushSubscription) {
      try {
        await sendPush(request.pushSubscription, {
          title: 'Your training plan is ready',
          body: `${plan.workouts.length} sessions planned through ${plan.target_event_date}.`,
          url: '/plan',
        })
      } catch { /* notification is best-effort; the job already succeeded */ }
    }
  } catch (err) {
    await updateJob(supabase, jobId, { status: 'error', error: err instanceof Error ? err.message : 'Plan generation failed' })
  }
}
