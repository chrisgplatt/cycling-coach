import type { GeneratedPlan, ICUSyncData, TrainingPhilosophy } from '@/types'
import { buildPlanBatches, computeWeekPhases } from './phases'

export interface GeneratePlanRequest {
  syncData: ICUSyncData | null
  startDate: string
  notes: string
  trainingPhilosophy: TrainingPhilosophy | null
}

export interface GeneratePlanCallbacks {
  onTotal: (count: number) => void
  onProgress: (cumulativeFound: number) => void
}

export type GeneratePlanResult =
  | { ok: true; plan: GeneratedPlan }
  | { ok: false; error: string }

interface BatchHead {
  rationale: string
  target_event_name: string
  target_event_date: string
}

/**
 * Drives plan generation as a sequence of separate HTTP requests, one per 4-week
 * batch, so no single request risks the serverless function's execution time limit
 * regardless of total plan length. Aborts the whole generation (no partial plans)
 * if any batch fails.
 */
export async function generatePlanInBatches(
  weeks: number,
  request: GeneratePlanRequest,
  callbacks: GeneratePlanCallbacks,
): Promise<GeneratePlanResult> {
  const batches = buildPlanBatches(weeks)
  let allWorkouts: GeneratedPlan['workouts'] = []
  let head: BatchHead | null = null

  for (const { startWeek, weekCount } of batches) {
    const weekLabel = weekCount === 1 ? `week ${startWeek + 1}` : `weeks ${startWeek + 1}-${startWeek + weekCount}`

    let res: Response
    try {
      res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncData: request.syncData,
          totalWeeks: weeks,
          startDate: request.startDate,
          notes: request.notes,
          training_philosophy: request.trainingPhilosophy,
          batchStartWeek: startWeek,
          batchWeekCount: weekCount,
          priorWorkouts: allWorkouts,
        }),
      })
    } catch {
      return { ok: false, error: `Network error while building ${weekLabel}` }
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      const reason = data.error ?? 'Plan generation failed'
      return { ok: false, error: `Plan generation failed while building ${weekLabel}: ${reason}` }
    }
    if (!res.body) return { ok: false, error: 'No response from server' }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let batchWorkouts: GeneratedPlan['workouts'] | null = null
    let batchError: string | null = null

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)
            if (event.type === 'total') callbacks.onTotal(event.count)
            else if (event.type === 'progress') callbacks.onProgress(allWorkouts.length + event.found)
            else if (event.type === 'done') {
              batchWorkouts = event.plan.workouts
              if (!head) {
                head = {
                  rationale: event.plan.rationale,
                  target_event_name: event.plan.target_event_name,
                  target_event_date: event.plan.target_event_date,
                }
              }
            } else if (event.type === 'error') {
              batchError = event.message
            }
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch {
      return { ok: false, error: `Network error while building ${weekLabel}` }
    }

    if (batchError) return { ok: false, error: `Plan generation failed while building ${weekLabel}: ${batchError}` }
    if (!batchWorkouts) return { ok: false, error: `Plan generation failed while building ${weekLabel}` }
    allWorkouts = allWorkouts.concat(batchWorkouts)
  }

  if (!head) return { ok: false, error: 'Plan generation failed' }
  const phases = computeWeekPhases(weeks)
  return {
    ok: true,
    plan: { ...head, phase: phases[0], week_phases: phases, workouts: allWorkouts },
  }
}
