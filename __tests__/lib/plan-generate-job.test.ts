/** @jest-environment node */
import { generatePlan } from '@/lib/plan/generate-job'
import type { ICUSyncData, GeneratedPlan } from '@/types'

const syncData: ICUSyncData = { activities: [], wellness: [], athlete_ftp: null, athlete_weight: null }

function plan(): GeneratedPlan {
  return { rationale: 'r', target_event_name: 'E', target_event_date: '2026-09-01', phase: 'base', week_phases: ['base'], workouts: [] }
}

function callbacks() {
  return { onTotal: jest.fn(), onProgress: jest.fn(), onPhase: jest.fn() }
}

describe('generatePlan', () => {
  beforeEach(() => {
    global.fetch = jest.fn()
    jest.useFakeTimers()
  })
  afterEach(() => jest.useRealTimers())

  it('submits the job, polls until done, and resolves with the plan', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(new Response(JSON.stringify({ job_id: 'job1' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'running', progress: { total: 5, completed: 2, failed_days: [] }, result: null, error: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'done', progress: { total: 5, completed: 5, failed_days: [] }, result: plan(), error: null })))

    const cb = callbacks()
    const resultPromise = generatePlan(6, { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null }, cb)
    await jest.advanceTimersByTimeAsync(3000)
    await jest.advanceTimersByTimeAsync(3000)
    const result = await resultPromise

    expect(result).toEqual({ ok: true, plan: plan() })
    expect(cb.onTotal).toHaveBeenCalledWith(5)
    expect(cb.onProgress).toHaveBeenCalledWith(2)
    expect(cb.onProgress).toHaveBeenCalledWith(5)
  })

  it('resolves ok:false when the job errors', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(new Response(JSON.stringify({ job_id: 'job1' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'error', progress: { total: 0, completed: 0, failed_days: [] }, result: null, error: 'Claude API error' })))

    const resultPromise = generatePlan(6, { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null }, callbacks())
    await jest.advanceTimersByTimeAsync(3000)
    await expect(resultPromise).resolves.toEqual({ ok: false, error: 'Claude API error' })
  })

  it('resolves ok:false when job submission fails', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Add and save at least one event' }), { status: 400 }))
    const result = await generatePlan(6, { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null }, callbacks())
    expect(result).toEqual({ ok: false, error: 'Add and save at least one event' })
  })
})
