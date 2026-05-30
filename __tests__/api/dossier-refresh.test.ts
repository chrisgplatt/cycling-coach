/** @jest-environment node */
import { POST } from '@/app/api/dossier/refresh/route'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { synthesizeDossier } from '@/lib/claude/synthesize-dossier'

jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
jest.mock('@/lib/claude/synthesize-dossier', () => ({ synthesizeDossier: jest.fn() }))

function supabaseWith(user: unknown, profile: unknown) {
  return {
    auth: { getUser: () => Promise.resolve({ data: { user } }) },
    from: () => ({
      select: () => ({ maybeSingle: () => Promise.resolve({ data: profile }) }),
    }),
  }
}

beforeEach(() => jest.clearAllMocks())

describe('POST /api/dossier/refresh', () => {
  it('returns 401 when unauthenticated', async () => {
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(supabaseWith(null, null))
    const res = await POST()
    expect(res.status).toBe(401)
    expect(synthesizeDossier).not.toHaveBeenCalled()
  })

  it('synthesizes and returns ok for an authed user with a profile', async () => {
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseWith({ id: 'u1' }, { goals: 'g', current_ftp: 250, weight_kg: 72, events: [] })
    );
    (synthesizeDossier as jest.Mock).mockResolvedValue(undefined)
    const res = await POST()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(synthesizeDossier).toHaveBeenCalledTimes(1)
    const [, passedProfile] = (synthesizeDossier as jest.Mock).mock.calls[0]
    expect(passedProfile).toMatchObject({ user_id: 'u1', goals: 'g', current_ftp: 250 })
  })

  it('returns 500 when synthesis fails, surfacing nothing destructive', async () => {
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(
      supabaseWith({ id: 'u1' }, { goals: 'g', current_ftp: 250, weight_kg: 72, events: [] })
    );
    (synthesizeDossier as jest.Mock).mockRejectedValue(new Error('claude down'))
    const res = await POST()
    expect(res.status).toBe(500)
  })
})
