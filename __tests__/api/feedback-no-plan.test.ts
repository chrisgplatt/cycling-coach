/** @jest-environment node */
import { POST } from '@/app/api/feedback/route'

jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/claude/usage-log', () => ({ setUsageContext: jest.fn() }))
jest.mock('@/lib/claude/feedback', () => ({ analyseFeedback: jest.fn() }))
jest.mock('@/lib/claude/session-note', () => ({ assessSession: jest.fn() }))
jest.mock('@/lib/claude/dossier', () => ({ fetchDossier: jest.fn().mockResolvedValue(null), formatDossier: jest.fn().mockReturnValue('') }))
jest.mock('@/lib/claude/activity-metrics', () => ({
  formatRideExecution: jest.fn().mockReturnValue(''),
  formatRideShape: jest.fn().mockReturnValue(''),
  formatDistributions: jest.fn().mockReturnValue(''),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { analyseFeedback } from '@/lib/claude/feedback'
import { assessSession } from '@/lib/claude/session-note'

const workout = { id: 'w1', date: '2026-10-31', type: 'endurance', duration_minutes: 60, steps: null, activity_metrics: null }

function makeSupabase(upcoming: unknown[], insertSpy: jest.Mock) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'workouts') {
        return {
          select: () => ({
            eq: (col: string) =>
              col === 'id'
                ? { single: async () => ({ data: workout }) }
                // status = 'planned' → upcoming query chain
                : { gte: () => ({ lte: () => ({ order: async () => ({ data: upcoming }) }) }) },
          }),
        }
      }
      if (table === 'session_feedback') {
        return {
          insert: (row: unknown) => { insertSpy(row); return { select: () => ({ single: async () => ({ data: { id: 'f1' }, error: null }) }) } },
        }
      }
      // user_profile
      return { select: () => ({ maybeSingle: async () => ({ data: { events: [] } }) }) }
    },
  }
}

const req = (body: unknown) => new Request('http://localhost/api/feedback', { method: 'POST', body: JSON.stringify(body) }) as never
const body = { workoutId: 'w1', activityId: 'manual', feedbackText: 'felt fine', adapt: true, rpe: 5 }

beforeEach(() => {
  jest.clearAllMocks()
  ;(assessSession as jest.Mock).mockResolvedValue({ note: 'Nice ride', recommendAdaptations: true })
  ;(analyseFeedback as jest.Mock).mockResolvedValue({ adjustment: { summary: 'x', changes: [] }, workout_steps: [] })
})

describe('POST /api/feedback — no upcoming planned workouts (no live plan)', () => {
  it('does not propose adaptations or recommend adapting when there is nothing to adapt', async () => {
    const insertSpy = jest.fn()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase([], insertSpy))
    await POST(req(body))
    expect(analyseFeedback).not.toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ proposed_adjustment: null, recommend_adaptations: false }))
  })

  it('still adapts and passes the coach recommendation through when upcoming workouts exist', async () => {
    const insertSpy = jest.fn()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase([{ id: 'w2', date: '2026-11-01' }], insertSpy))
    await POST(req(body))
    expect(analyseFeedback).toHaveBeenCalledTimes(1)
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ recommend_adaptations: true }))
  })
})
