/** @jest-environment node */
import { GET, PATCH } from '@/app/api/athlete-model/route'

const state: { beliefs: unknown[]; updated: Record<string, unknown> | null; matchedKey: string | null } = {
  beliefs: [], updated: null, matchedKey: null,
}
jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      // fetchActiveBeliefs chains .select().eq().neq().neq() then sorts in JS (no .order())
      select: () => ({ eq: () => ({ neq: () => ({ neq: () => Promise.resolve({ data: state.beliefs }) }) }) }),
      update: (patch: Record<string, unknown>) => {
        state.updated = patch
        return {
          eq: (col: string, val: string) => {
            if (col !== 'user_id' || val !== 'u1') throw new Error(`first filter must be user_id=u1, got ${col}=${val}`)
            return {
              eq: (col2: string, key: string) => {
                if (col2 !== 'key') throw new Error(`second filter must be key, got ${col2}`)
                state.matchedKey = key
                return Promise.resolve({ error: null })
              },
            }
          },
        }
      },
    }),
  }),
}))

function req(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof PATCH>[0]
}

beforeEach(() => { state.beliefs = []; state.updated = null; state.matchedKey = null })

it('GET returns active beliefs', async () => {
  state.beliefs = [{ key: 'ramp_tolerance' }]
  const res = await GET()
  expect(await res.json()).toEqual({ beliefs: [{ key: 'ramp_tolerance' }] })
})

it('PATCH confirm applies the confirm patch to the keyed belief', async () => {
  const res = await PATCH(req({ key: 'ramp_tolerance', action: 'confirm' }))
  expect(await res.json()).toEqual({ ok: true })
  expect(state.matchedKey).toBe('ramp_tolerance')
  expect(state.updated).toMatchObject({ status: 'confirmed', source: 'athlete' })
})

it('PATCH rejects an invalid action', async () => {
  const res = await PATCH(req({ key: 'ramp_tolerance', action: 'nope' }))
  expect(res.status).toBe(400)
  expect(state.updated).toBeNull()
})

it('PATCH rejects an empty correction', async () => {
  const res = await PATCH(req({ key: 'ramp_tolerance', action: 'correct', value_text: '   ' }))
  expect(res.status).toBe(400)
})
