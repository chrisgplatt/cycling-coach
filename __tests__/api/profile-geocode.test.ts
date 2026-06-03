/** @jest-environment node */
import { GET } from '@/app/api/profile/geocode/route'

const mockGeocode = jest.fn()
jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock('@/lib/weather/open-meteo', () => ({
  geocodeLocation: (...args: unknown[]) => mockGeocode(...args),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

function authedSupabase(userId: string | null) {
  return { auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) } }
}
const req = (url: string) => ({ url }) as Request

beforeEach(() => {
  jest.clearAllMocks()
  ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(authedSupabase('u1'))
})

describe('GET /api/profile/geocode', () => {
  it('401s when unauthenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(authedSupabase(null))
    const res = await GET(req('http://x/api/profile/geocode?q=bristol') as never)
    expect(res.status).toBe(401)
  })

  it('returns empty matches when q is blank', async () => {
    const res = await GET(req('http://x/api/profile/geocode') as never)
    const body = await res.json()
    expect(body.matches).toEqual([])
    expect(mockGeocode).not.toHaveBeenCalled()
  })

  it('returns geocoder matches for a query', async () => {
    mockGeocode.mockResolvedValue([{ label: 'Bristol, England, United Kingdom', latitude: 51.45, longitude: -2.58 }])
    const res = await GET(req('http://x/api/profile/geocode?q=bristol') as never)
    const body = await res.json()
    expect(mockGeocode).toHaveBeenCalledWith('bristol')
    expect(body.matches).toHaveLength(1)
    expect(body.matches[0].label).toContain('Bristol')
  })
})
