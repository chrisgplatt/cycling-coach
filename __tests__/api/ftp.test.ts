/** @jest-environment node */
import { POST } from '@/app/api/ftp/route'

const mockGetActivities = jest.fn()
const mockGetPowerCurve = jest.fn()

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getActivities: mockGetActivities,
    getPowerCurve: mockGetPowerCurve,
  })),
}))
jest.mock('@/lib/claude/dossier', () => ({
  fetchDossier: jest.fn().mockResolvedValue(null),
  formatDossier: jest.fn(() => ''),
}))
jest.mock('@/lib/claude/ftp', () => ({
  predictFTP: jest.fn(),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { predictFTP } from '@/lib/claude/ftp'

const profile = { intervals_icu_athlete_id: 'i1', intervals_icu_api_key: 'k', current_ftp: 220 }

function chainable(result: { data: unknown }) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
      return () => chainable(result)
    },
  }
  return new Proxy({}, handler)
}

function makeSupabase({
  profileRow = profile as unknown,
  insertSpy = jest.fn(),
}: { profileRow?: unknown; insertSpy?: jest.Mock } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'user_profile') return chainable({ data: profileRow })
      if (table === 'ftp_predictions') {
        return { insert: (...args: unknown[]) => { insertSpy(...args); return chainable({ data: null }) } }
      }
      return chainable({ data: [] })
    },
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/ftp', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetActivities.mockResolvedValue([])
  mockGetPowerCurve.mockResolvedValue([])
  ;(predictFTP as jest.Mock).mockResolvedValue({
    predicted_ftp: 225,
    reasoning: 'Steady progress.',
    confidence: 'medium',
  })
})

describe('POST /api/ftp', () => {
  it('returns the predicted result without saving it to the database', async () => {
    const insertSpy = jest.fn()
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ insertSpy }))
    const res = await POST(makeRequest({ currentFTP: 220 }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({
      predicted_ftp: 225,
      reasoning: 'Steady progress.',
      confidence: 'medium',
      activity_ids: [],
    })
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: () => chainable({ data: null }),
    })
    const res = await POST(makeRequest({ currentFTP: 220 }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when intervals.icu is not configured', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ profileRow: { intervals_icu_athlete_id: null, intervals_icu_api_key: null } })
    )
    const res = await POST(makeRequest({ currentFTP: 220 }))
    expect(res.status).toBe(400)
  })
})
