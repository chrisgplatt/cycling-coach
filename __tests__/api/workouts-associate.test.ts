/** @jest-environment node */
import { POST } from '@/app/api/workouts/associate/route'

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

const plannedRow = { plan_id: 'p1', icu_activity_id: null, status: 'planned', date: '2026-07-10' }
const unplannedRow = { plan_id: null, icu_activity_id: 'a1', tss: 65, duration_minutes: 60, ftp_at_completion: 245, date: '2026-07-10' }

function makeSupabase({
  planned = plannedRow as unknown,
  unplanned = unplannedRow as unknown,
  updateSpy = jest.fn(async (_fields: unknown) => ({ error: null })),
  deleteSpy = jest.fn(async (_id: string) => ({ error: null })),
}: {
  planned?: unknown
  unplanned?: unknown
  updateSpy?: jest.Mock
  deleteSpy?: jest.Mock
} = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => ({
            data: id === 'planned1' ? planned : id === 'unplanned1' ? unplanned : null,
          }),
        }),
      }),
      update: (fields: unknown) => ({ eq: () => updateSpy(fields) }),
      delete: () => ({ eq: (_col: string, id: string) => deleteSpy(id) }),
    }),
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/workouts/associate', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/workouts/associate', () => {
  it('copies ride data onto the planned workout and marks it completed', async () => {
    const updateSpy = jest.fn(async (_fields: unknown) => ({ error: null }))
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ updateSpy }))

    const res = await POST(makeRequest({ plannedWorkoutId: 'planned1', unplannedWorkoutId: 'unplanned1' }))
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith({
      status: 'completed', icu_activity_id: 'a1', tss: 65, actual_duration_minutes: 60, ftp_at_completion: 245,
    })
  })

  it('deletes the unplanned ride row after associating', async () => {
    const deleteSpy = jest.fn(async (_id: string) => ({ error: null }))
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ deleteSpy }))

    await POST(makeRequest({ plannedWorkoutId: 'planned1', unplannedWorkoutId: 'unplanned1' }))
    expect(deleteSpy).toHaveBeenCalledWith('unplanned1')
  })

  it('returns 400 when the "planned" workout is already matched', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ planned: { ...plannedRow, icu_activity_id: 'already-matched' } })
    )
    const res = await POST(makeRequest({ plannedWorkoutId: 'planned1', unplannedWorkoutId: 'unplanned1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the "unplanned" workout actually has a plan_id', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ unplanned: { ...unplannedRow, plan_id: 'p2' } })
    )
    const res = await POST(makeRequest({ plannedWorkoutId: 'planned1', unplannedWorkoutId: 'unplanned1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the two workouts are on different dates', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ unplanned: { ...unplannedRow, date: '2026-07-11' } })
    )
    const res = await POST(makeRequest({ plannedWorkoutId: 'planned1', unplannedWorkoutId: 'unplanned1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when required body fields are missing', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({ plannedWorkoutId: 'planned1' }))
    expect(res.status).toBe(400)
  })

  it('returns 404 when either workout does not exist', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase())
    const res = await POST(makeRequest({ plannedWorkoutId: 'planned1', unplannedWorkoutId: 'missing-id' }))
    expect(res.status).toBe(404)
  })
})
