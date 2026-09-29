import type { GeneratedPlan, ICUSyncData, TrainingPhilosophy } from '@/types'

export interface GeneratePlanRequest {
  syncData: ICUSyncData | null
  startDate: string
  notes: string
  trainingPhilosophy: TrainingPhilosophy | null
}

export interface GeneratePlanCallbacks {
  onTotal: (count: number) => void
  onProgress: (completed: number) => void
  onPhase: (phase: 'scheduling' | 'writing_sessions') => void
}

export type GeneratePlanResult = { ok: true; plan: GeneratedPlan } | { ok: false; error: string }

interface JobStatusResponse {
  status: 'pending' | 'running' | 'done' | 'error'
  progress: { total: number; completed: number; failed_days: string[] }
  result: GeneratedPlan | null
  error: string | null
}

const POLL_INTERVAL_MS = 3000

async function pollJob(jobId: string, statusUrl: string, callbacks: GeneratePlanCallbacks): Promise<GeneratePlanResult> {
  let sawWriting = false
  while (true) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    const res = await fetch(`${statusUrl}/${jobId}`)
    if (!res.ok) return { ok: false, error: `Failed to check plan status (${res.status})` }
    const job = (await res.json()) as JobStatusResponse

    if (job.progress.total > 0) {
      callbacks.onTotal(job.progress.total)
      if (!sawWriting) { callbacks.onPhase('writing_sessions'); sawWriting = true }
      callbacks.onProgress(job.progress.completed)
    }
    if (job.status === 'done' && job.result) return { ok: true, plan: job.result }
    if (job.status === 'error') return { ok: false, error: job.error ?? 'Plan generation failed' }
  }
}

export async function generatePlan(
  weeks: number,
  request: GeneratePlanRequest,
  callbacks: GeneratePlanCallbacks,
): Promise<GeneratePlanResult> {
  callbacks.onPhase('scheduling')
  let res: Response
  try {
    res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        syncData: request.syncData, totalWeeks: weeks, startDate: request.startDate,
        notes: request.notes, training_philosophy: request.trainingPhilosophy,
      }),
    })
  } catch {
    return { ok: false, error: 'Network error while starting plan generation' }
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    return { ok: false, error: data.error ?? 'Plan generation failed' }
  }
  const startData = await res.json().catch(() => null)
  if (!startData?.job_id) return { ok: false, error: 'Invalid response from server' }
  try {
    return await pollJob(startData.job_id, '/api/plan/jobs', callbacks)
  } catch {
    return { ok: false, error: 'Network error while checking plan status' }
  }
}
