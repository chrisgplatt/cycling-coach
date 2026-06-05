/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

import { POST } from '@/app/api/workouts/backfill-zones/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const stepped = [
  {
    id: 'w1', date: '2026-06-10', type: 'threshold',
    description: '2x20min at 240-265W with recovery',
    target_zones: 'Zone 4 (240-265W)',
    steps: [
      { label: 'Warm Up', duration_minutes: 10, power_pct_ftp: 60 },
      { label: 'Effort', duration_minutes: 20, power_pct_ftp: 100 },
      { label: 'Cool Down', duration_minutes: 10, power_pct_ftp: 55 },
    ],
  },
]

function makeReq(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0]
}

function supabaseStub(profileRow: unknown, rows: unknown[]) {
  const updateEq = jest.fn(async () => ({ error: null }))
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'user_profile') {
        return { select: () => ({ maybeSingle: async () => ({ data: profileRow }) }) }
      }
      // workouts: select(...).eq('status','planned').gte('date', today).order(...)
      return {
        select: () => ({ eq: () => ({ gte: () => ({ order: async () => ({ data: rows, error: null }) }) }) }),
        update: () => ({ eq: updateEq }),
      }
    },
    _updateEq: updateEq,
  }
}

beforeEach(() => { jest.clearAllMocks() })

describe('POST /api/workouts/backfill-zones', () => {
  it('403s for a non-admin', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseStub({ is_admin: false }, stepped))
    const res = await POST(makeReq({}))
    expect(res.status).toBe(403)
  })

  it('dry run by default: previews changes without writing', async () => {
    const stub = supabaseStub({ is_admin: true }, stepped)
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(stub)
    const res = await POST(makeReq({}))
    const body = await res.json()
    expect(body.dryRun).toBe(true)
    expect(body.changeCount).toBe(1)
    expect(body.preview[0].target_zones.after).toBe('Z4 Threshold (100% FTP)')
    expect(body.preview[0].description.after).toBe('2x20min with recovery')
    expect(stub._updateEq).not.toHaveBeenCalled()
  })

  it('apply: persists the corrected fields', async () => {
    const stub = supabaseStub({ is_admin: true }, stepped)
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(stub)
    const res = await POST(makeReq({ apply: true }))
    const body = await res.json()
    expect(body.applied).toBe(true)
    expect(body.updated).toBe(1)
    expect(stub._updateEq).toHaveBeenCalledTimes(1)
  })

  it('skips stepless workouts (nothing to derive from)', async () => {
    const stepless = [{ ...stepped[0], steps: null }]
    const stub = supabaseStub({ is_admin: true }, stepless)
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(stub)
    const res = await POST(makeReq({ apply: true }))
    const body = await res.json()
    expect(body.changeCount).toBe(0)
    expect(body.updated).toBe(0)
    expect(stub._updateEq).not.toHaveBeenCalled()
  })
})
