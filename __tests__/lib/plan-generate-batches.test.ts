/** @jest-environment node */
import { generatePlanInBatches } from '@/lib/plan/generate-batches'
import type { ICUSyncData, GeneratedPlan } from '@/types'

const syncData: ICUSyncData = { activities: [], wellness: [], athlete_ftp: null, athlete_weight: null }

function workout(date: string): GeneratedPlan['workouts'][number] {
  return { date, type: 'endurance', duration_minutes: 60, description: 'd', target_zones: 'z', steps: [] }
}

function ndjsonResponse(events: Array<Record<string, unknown>>): Response {
  const body = events.map(e => JSON.stringify(e)).join('\n') + '\n'
  return new Response(body, { status: 200 })
}

describe('generatePlanInBatches', () => {
  beforeEach(() => {
    global.fetch = jest.fn()
  })

  it('makes one request per 4-week batch and merges their workouts', async () => {
    const batch0Workout = workout('2026-06-01')
    const batch1Workout = workout('2026-06-29')
    const bodies: Array<Record<string, unknown>> = []
    ;(global.fetch as jest.Mock).mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      bodies.push(body)
      if (body.batchStartWeek === 0) {
        return ndjsonResponse([
          { type: 'total', count: 2 },
          { type: 'done', plan: { rationale: 'r', target_event_name: 'Dragon Ride', target_event_date: '2026-09-01', workouts: [batch0Workout] } },
        ])
      }
      return ndjsonResponse([{ type: 'done', plan: { workouts: [batch1Workout] } }])
    })

    const result = await generatePlanInBatches(
      8,
      { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null },
      { onTotal: jest.fn(), onProgress: jest.fn() },
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.plan.workouts).toEqual([batch0Workout, batch1Workout])
      expect(result.plan.rationale).toBe('r')
      expect(result.plan.week_phases).toHaveLength(8)
      expect(result.plan.phase).toBe(result.plan.week_phases![0])
    }
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toMatchObject({ totalWeeks: 8, batchStartWeek: 0, batchWeekCount: 4, priorWorkouts: [] })
    expect(bodies[1]).toMatchObject({ totalWeeks: 8, batchStartWeek: 4, batchWeekCount: 4, priorWorkouts: [batch0Workout] })
  })

  it('aborts the whole generation and never fetches a later batch when a batch fails', async () => {
    const bodies: Array<Record<string, unknown>> = []
    ;(global.fetch as jest.Mock).mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      bodies.push(body)
      if (body.batchStartWeek === 0) {
        return ndjsonResponse([
          { type: 'done', plan: { rationale: 'r', target_event_name: 'E', target_event_date: '2026-09-01', workouts: [workout('2026-06-01')] } },
        ])
      }
      return ndjsonResponse([{ type: 'error', message: 'Claude API error' }])
    })

    const result = await generatePlanInBatches(
      12,
      { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null },
      { onTotal: jest.fn(), onProgress: jest.fn() },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('weeks 5-8')
      expect(result.error).toContain('Claude API error')
    }
    expect(bodies).toHaveLength(2) // never reached the third batch (weeks 9-12)
  })

  it('reports cumulative progress across batches, not per-batch', async () => {
    const onProgress = jest.fn()
    ;(global.fetch as jest.Mock).mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      if (body.batchStartWeek === 0) {
        return ndjsonResponse([
          { type: 'progress', found: 3 },
          { type: 'done', plan: { rationale: 'r', target_event_name: 'E', target_event_date: '2026-09-01', workouts: [workout('2026-06-01'), workout('2026-06-02'), workout('2026-06-03')] } },
        ])
      }
      return ndjsonResponse([
        { type: 'progress', found: 2 },
        { type: 'done', plan: { workouts: [workout('2026-06-29')] } },
      ])
    })

    await generatePlanInBatches(
      8,
      { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null },
      { onTotal: jest.fn(), onProgress },
    )

    expect(onProgress).toHaveBeenNthCalledWith(1, 3)  // batch 0: 0 completed-before + 3 found
    expect(onProgress).toHaveBeenNthCalledWith(2, 5)  // batch 1: 3 completed-before + 2 found
  })

  it('fails cleanly when a batch response is not ok', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Add and save at least one event' }), { status: 400 })
    )

    const result = await generatePlanInBatches(
      4,
      { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null },
      { onTotal: jest.fn(), onProgress: jest.fn() },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Plan generation failed while building weeks 1-4: Add and save at least one event')
  })

  it('names the failing batch weeks when a later batch responds not-ok', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      if (body.batchStartWeek === 0) {
        return ndjsonResponse([
          { type: 'done', plan: { rationale: 'r', target_event_name: 'E', target_event_date: '2026-09-01', workouts: [workout('2026-06-01')] } },
        ])
      }
      return new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })
    })

    const result = await generatePlanInBatches(
      12,
      { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null },
      { onTotal: jest.fn(), onProgress: jest.fn() },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('Plan generation failed while building weeks 5-8: Rate limited')
  })

  it('resolves ok:false instead of throwing when the stream errors mid-read', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: () => Promise.reject(new Error('stream broke')),
        }),
      },
    })

    await expect(
      generatePlanInBatches(
        4,
        { syncData, startDate: '2026-06-01', notes: '', trainingPhilosophy: null },
        { onTotal: jest.fn(), onProgress: jest.fn() },
      )
    ).resolves.toEqual({ ok: false, error: 'Network error while building weeks 1-4' })
  })
})
