/** @jest-environment node */
import { NextRequest } from 'next/server'
import { makeDb } from '../support/gear-fake-db'

jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { GET } from '@/app/api/gear/route'
import { POST } from '@/app/api/gear/bikes/route'
import { PATCH, DELETE } from '@/app/api/gear/bikes/[id]/route'

const use = (db: ReturnType<typeof makeDb>) => (createSupabaseServerClient as jest.Mock).mockResolvedValue(db.client)
const req = (body?: unknown, method = 'POST') =>
  new NextRequest('http://t/api', { method, body: body === undefined ? undefined : JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

const bike = (o = {}) => ({
  id: 'b1', user_id: 'u1', name: 'Road', kind: 'road', is_default: true, is_indoor_default: false, retired_at: null, ...o,
})

describe('GET /api/gear', () => {
  it('401s without a user', async () => {
    use(makeDb({}, { userId: null }))
    expect((await GET()).status).toBe(401)
  })

  it('returns bikes with totals, component usage and trigger progress', async () => {
    use(makeDb({
      bikes: [bike()],
      bike_components: [{ id: 'c1', user_id: 'u1', bike_id: 'b1', name: 'Chain', category: 'chain', installed_at: '2026-01-01', retired_at: null }],
      component_triggers: [{ id: 't1', user_id: 'u1', component_id: 'c1', label: 'Re-wax', kind: 'recurring', metric: 'km', interval_value: 100, last_done_at: null }],
      workouts: [{ id: 'w1', user_id: 'u1', status: 'completed', date: '2026-02-01', bike_id: 'b1', duration_minutes: 60, actual_duration_minutes: 90, activity_metrics: { distance_m: 85_000 } }],
    }))
    const body = await (await GET()).json()
    const b = body.bikes[0]
    expect(b.totals).toEqual({ km: 85, hours: 1.5 })
    expect(b.components[0].usage.km).toBe(85)
    expect(b.components[0].triggers[0].progress.status).toBe('due_soon')
  })
})

describe('POST /api/gear/bikes', () => {
  it('makes the first bike the default and reports unassigned enriched rides', async () => {
    const db = makeDb({ workouts: [
      { id: 'w1', user_id: 'u1', icu_activity_id: 'a', activity_metrics: {}, bike_id: null },
      { id: 'w2', user_id: 'u1', icu_activity_id: 'b', activity_metrics: null, bike_id: null },
      { id: 'w3', user_id: 'u1', icu_activity_id: 'c', activity_metrics: {}, bike_id: 'x' },
    ] })
    use(db)
    const res = await POST(req({ name: ' Tarmac ', kind: 'road' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.bike).toMatchObject({ name: 'Tarmac', is_default: true })
    expect(body.unassignedRideCount).toBe(1)
  })

  it('does not make later bikes the default', async () => {
    const db = makeDb({ bikes: [bike()] })
    use(db)
    const body = await (await POST(req({ name: 'Gravel', kind: 'gravel' }))).json()
    expect(body.bike.is_default).toBe(false)
  })

  it('rejects an empty name or unknown kind', async () => {
    use(makeDb())
    expect((await POST(req({ name: '  ' }))).status).toBe(400)
    expect((await POST(req({ name: 'x', kind: 'unicycle' }))).status).toBe(400)
  })
})

describe('PATCH /api/gear/bikes/[id]', () => {
  it('setting a new default clears the old one', async () => {
    const db = makeDb({ bikes: [bike(), bike({ id: 'b2', is_default: false })] })
    use(db)
    expect((await PATCH(req({ is_default: true }, 'PATCH'), ctx('b2'))).status).toBe(200)
    expect(db.tables.bikes.map(b => [b.id, b.is_default])).toEqual([['b1', false], ['b2', true]])
  })

  it('setting a trainer bike clears the old trainer bike', async () => {
    const db = makeDb({ bikes: [bike({ is_default: true }), bike({ id: 'b2', is_default: false, is_indoor_default: true }), bike({ id: 'b3', is_default: false })] })
    use(db)
    expect((await PATCH(req({ is_indoor_default: true }, 'PATCH'), ctx('b3'))).status).toBe(200)
    expect(db.tables.bikes.filter(b => b.is_indoor_default).map(b => b.id)).toEqual(['b3'])
  })

  it('refuses to retire the default bike', async () => {
    use(makeDb({ bikes: [bike()] }))
    expect((await PATCH(req({ retired: true }, 'PATCH'), ctx('b1'))).status).toBe(400)
  })

  it('retires a non-default bike and drops its trainer flag', async () => {
    const db = makeDb({ bikes: [bike(), bike({ id: 'b2', is_default: false, is_indoor_default: true })] })
    use(db)
    expect((await PATCH(req({ retired: true }, 'PATCH'), ctx('b2'))).status).toBe(200)
    const b2 = db.tables.bikes.find(b => b.id === 'b2')!
    expect(b2.retired_at).toEqual(expect.any(String))
    expect(b2.is_indoor_default).toBe(false)
  })

  it('refuses to make a retired bike the default', async () => {
    use(makeDb({ bikes: [bike(), bike({ id: 'b2', is_default: false, retired_at: '2026-01-01T00:00:00Z' })] }))
    expect((await PATCH(req({ is_default: true }, 'PATCH'), ctx('b2'))).status).toBe(400)
  })

  it("404s on another user's bike", async () => {
    use(makeDb({ bikes: [bike({ user_id: 'someone-else' })] }))
    expect((await PATCH(req({ name: 'Mine now' }, 'PATCH'), ctx('b1'))).status).toBe(404)
  })

  it('renames and validates name', async () => {
    const db = makeDb({ bikes: [bike()] })
    use(db)
    expect((await PATCH(req({ name: 'Renamed' }, 'PATCH'), ctx('b1'))).status).toBe(200)
    expect(db.tables.bikes[0].name).toBe('Renamed')
    expect((await PATCH(req({ name: '' }, 'PATCH'), ctx('b1'))).status).toBe(400)
  })
})

describe('DELETE /api/gear/bikes/[id]', () => {
  it('refuses to delete the default bike', async () => {
    use(makeDb({ bikes: [bike()] }))
    expect((await DELETE(req(undefined, 'DELETE'), ctx('b1'))).status).toBe(400)
  })
  it('deletes a non-default bike', async () => {
    const db = makeDb({ bikes: [bike(), bike({ id: 'b2', is_default: false })] })
    use(db)
    expect((await DELETE(req(undefined, 'DELETE'), ctx('b2'))).status).toBe(200)
    expect(db.tables.bikes.map(b => b.id)).toEqual(['b1'])
  })
})
