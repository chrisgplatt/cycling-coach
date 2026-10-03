/** @jest-environment node */
jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))

const usageRows: unknown[] = []
const mockGte = jest.fn()
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (table: string) => {
      if (table === 'claude_usage') {
        return {
          select: () => ({
            gte: (col: string, since: string) => {
              mockGte(col, since)
              return { order: () => ({ limit: async () => ({ data: usageRows, error: null }) }) }
            },
          }),
        }
      }
      if (table === 'user_profile') {
        return { select: () => ({ in: async () => ({ data: [{ user_id: 'u1', full_name: 'Chris Platt' }] }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  })),
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/admin/usage/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { summariseUsage, type UsageRow } from '@/lib/claude/usage-summary'

function row(overrides: Partial<UsageRow>): UsageRow {
  return {
    created_at: '2026-10-02T08:00:00Z', user_id: 'u1', label: 'chat.general', model: 'claude-opus-5',
    trigger: 'user', route: '/api/chat', input_tokens: 100, output_tokens: 50,
    cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cost_usd: '0.01', stop_reason: 'end_turn',
    metadata: null, ...overrides,
  }
}

function authAs(isAdmin: boolean | null) {
  ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: isAdmin === null ? null : { id: 'u1' } } }) },
    from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { is_admin: isAdmin } }) }) }),
  })
}

const req = (qs = '') => new NextRequest(`http://localhost/api/admin/usage${qs}`)

beforeEach(() => {
  jest.clearAllMocks()
  usageRows.length = 0
})

describe('GET /api/admin/usage', () => {
  it('returns 401 when signed out', async () => {
    authAs(null)
    expect((await GET(req())).status).toBe(401)
  })

  it('returns 403 for a non-admin', async () => {
    authAs(false)
    expect((await GET(req())).status).toBe(403)
  })

  it('summarises usage for an admin and resolves user names', async () => {
    authAs(true)
    usageRows.push(
      row({ label: 'plan.fillSession', cost_usd: '0.05', stop_reason: 'max_tokens' }),
      row({ label: 'plan.fillSession', cost_usd: '0.03' }),
      row({ label: 'briefing.morning', user_id: null, trigger: 'cron', cost_usd: '0.02', created_at: '2026-10-01T06:00:00Z' }),
    )
    const res = await GET(req('?days=30'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.days).toBe(30)
    expect(body.totals).toMatchObject({ calls: 3, cost_usd: 0.1, truncated: 1 })
    expect(body.byLabel[0]).toMatchObject({ key: 'plan.fillSession', calls: 2, cost_usd: 0.08 })
    expect(body.byDay.map((d: { key: string }) => d.key)).toEqual(['2026-10-01', '2026-10-02'])
    expect(body.userNames).toEqual({ u1: 'Chris Platt' })
    expect(body.recent).toHaveLength(3)
  })

  it('clamps the range to 1–90 days', async () => {
    authAs(true)
    const body = await (await GET(req('?days=500'))).json()
    expect(body.days).toBe(90)
  })
})

describe('summariseUsage', () => {
  it('groups unattributed calls under "system" and sorts groups by cost', () => {
    const s = summariseUsage([
      row({ user_id: null, cost_usd: 0.5 }),
      row({ user_id: 'u1', cost_usd: 1 }),
    ])
    expect(s.byUser.map(g => g.key)).toEqual(['u1', 'system'])
  })
})
