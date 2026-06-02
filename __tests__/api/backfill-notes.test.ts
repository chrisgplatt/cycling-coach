/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/claude/coaching-notes', () => ({ generateCoachingNotes: jest.fn() }))

import { POST } from '@/app/api/workouts/backfill-notes/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { generateCoachingNotes } from '@/lib/claude/coaching-notes'

const mockGenerate = generateCoachingNotes as jest.Mock

const workoutsMissing = [
  { id: 'w1', date: '2026-06-03', type: 'endurance', description: 'Z2', target_zones: 'Zone 2', steps: null },
]

function supabaseStub(profileRow: unknown, missing: unknown[]) {
  const updateEq = jest.fn(async () => ({ error: null }))
  const stub = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'user_profile') {
        return { select: () => ({ maybeSingle: async () => ({ data: profileRow }) }) }
      }
      // workouts: select(...).eq('status','planned').is('coaching_notes', null)
      return {
        select: () => ({ eq: () => ({ is: async () => ({ data: missing }) }) }),
        update: () => ({ eq: updateEq }),
      }
    },
    _updateEq: updateEq,
  }
  return stub
}

beforeEach(() => { jest.clearAllMocks() })

describe('POST /api/workouts/backfill-notes', () => {
  it('403s for a non-admin', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseStub({ is_admin: false, current_ftp: 250, weight_kg: 72, goals: 'x' }, workoutsMissing),
    )
    const res = await POST()
    expect(res.status).toBe(403)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('generates and updates notes for missing workouts as an admin', async () => {
    const stub = supabaseStub({ is_admin: true, current_ftp: 250, weight_kg: 72, goals: 'x' }, workoutsMissing)
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(stub)
    mockGenerate.mockResolvedValue({ w1: { summary: 's', focus: [] } })
    const res = await POST()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.updated).toBe(1)
    expect(stub._updateEq).toHaveBeenCalledTimes(1)
  })

  it('no-ops when nothing is missing', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseStub({ is_admin: true, current_ftp: 250, weight_kg: 72, goals: 'x' }, []),
    )
    const res = await POST()
    const body = await res.json()
    expect(body.updated).toBe(0)
    expect(mockGenerate).not.toHaveBeenCalled()
  })
})
