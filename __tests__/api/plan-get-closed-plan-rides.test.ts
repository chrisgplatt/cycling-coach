/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

import { GET } from '@/app/api/plan/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase({
  activePlan = null as unknown,
  completedWorkouts = [] as Array<{ id: string; plan_id: string | null; icu_activity_id: string | null; status: string }>,
  otherPlanNames = [] as Array<{ id: string; name: string }>,
}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'training_plans') {
        return {
          select: (cols: string) => {
            if (cols === 'id, name') {
              return { in: async (_col: string, ids: string[]) => ({ data: otherPlanNames.filter(p => ids.includes(p.id)) }) }
            }
            return {
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: activePlan }),
                  }),
                }),
              }),
            }
          },
        }
      }
      if (table === 'workouts') {
        return {
          select: () => ({
            eq: () => ({ data: completedWorkouts }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

beforeEach(() => jest.clearAllMocks())

describe('GET /api/plan — closed-plan rides stay plan-linked', () => {
  it('includes a completed ride that still carries a closed plan\'s plan_id when there is no active plan', async () => {
    const closedPlanRide = { id: 'w1', plan_id: 'archived-plan-1', icu_activity_id: 'a1', status: 'completed' }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ activePlan: null, completedWorkouts: [closedPlanRide] })
    )

    const res = await GET()
    const data = await res.json()

    expect(data.workouts).toEqual([{ ...closedPlanRide, plan_name: null }])
  })

  it('returns null when there is no active plan and no completed rides at all', async () => {
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ activePlan: null, completedWorkouts: [] })
    )

    const res = await GET()
    const data = await res.json()

    expect(data).toBeNull()
  })

  it('merges a closed-plan ride alongside a new active plan\'s own workouts', async () => {
    const activePlan = {
      id: 'plan2',
      name: 'New Plan',
      workouts: [{ id: 'w2', plan_id: 'plan2', icu_activity_id: 'a2', status: 'planned' }],
    }
    const closedPlanRide = { id: 'w1', plan_id: 'archived-plan-1', icu_activity_id: 'a1', status: 'completed' }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ activePlan, completedWorkouts: [closedPlanRide] })
    )

    const res = await GET()
    const data = await res.json()

    expect(data.workouts).toEqual(expect.arrayContaining([
      { ...closedPlanRide, plan_name: null },
      { ...activePlan.workouts[0], plan_name: 'New Plan' },
    ]))
    expect(data.workouts).toHaveLength(2)
  })

  it('does not duplicate the active plan\'s own completed ride', async () => {
    const activePlanRide = { id: 'w3', plan_id: 'plan3', icu_activity_id: 'a3', status: 'completed' }
    const activePlan = { id: 'plan3', name: 'Active Plan', workouts: [activePlanRide] }
    // The broader "completed" query also returns the active plan's own ride —
    // it must be excluded from `extra`, not duplicated.
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ activePlan, completedWorkouts: [activePlanRide] })
    )

    const res = await GET()
    const data = await res.json()

    expect(data.workouts).toEqual([{ ...activePlanRide, plan_name: 'Active Plan' }])
  })
})

describe('GET /api/plan — plan_name attachment', () => {
  it('looks up and attaches the closed plan\'s own name for a ride from a different plan', async () => {
    const closedPlanRide = { id: 'w1', plan_id: 'archived-plan-1', icu_activity_id: 'a1', status: 'completed' }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({
        activePlan: null,
        completedWorkouts: [closedPlanRide],
        otherPlanNames: [{ id: 'archived-plan-1', name: 'Summer Base Block' }],
      })
    )

    const res = await GET()
    const data = await res.json()

    expect(data.workouts[0].plan_name).toBe('Summer Base Block')
  })

  it('leaves plan_name null for a ride never linked to any plan', async () => {
    const unlinkedRide = { id: 'w1', plan_id: null, icu_activity_id: 'a1', status: 'completed' }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ activePlan: null, completedWorkouts: [unlinkedRide] })
    )

    const res = await GET()
    const data = await res.json()

    expect(data.workouts[0].plan_name).toBeNull()
  })

  it('attaches the active plan\'s own name to its own workouts without a lookup', async () => {
    const activePlan = {
      id: 'plan1',
      name: 'Base Block 1',
      workouts: [{ id: 'w1', plan_id: 'plan1', icu_activity_id: null, status: 'planned' }],
    }
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ activePlan, completedWorkouts: [] })
    )

    const res = await GET()
    const data = await res.json()

    expect(data.workouts[0].plan_name).toBe('Base Block 1')
  })
})
