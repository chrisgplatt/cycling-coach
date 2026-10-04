/** @jest-environment node */
import { NextRequest } from 'next/server'
import { makeDb } from '../support/gear-fake-db'

jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { POST } from '@/app/api/gear/backfill/route'
import { PATCH } from '@/app/api/workouts/[id]/bike/route'

const use = (db: ReturnType<typeof makeDb>) => (createSupabaseServerClient as jest.Mock).mockResolvedValue(db.client)
const req = (body?: unknown, method = 'POST') =>
  new NextRequest('http://t/api', { method, body: body === undefined ? undefined : JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

const bike = (o = {}) => ({ id: 'b1', user_id: 'u1', name: 'Road', kind: 'road', is_default: true, is_indoor_default: false, retired_at: null, ...o })
const ride = (o = {}) => ({ id: 'w1', user_id: 'u1', date: '2026-09-10', icu_activity_id: 'a1', bike_id: null, activity_metrics: {}, ...o })

describe('POST /api/gear/backfill', () => {
  it('401s without a user', async () => {
    use(makeDb({}, { userId: null }))
    expect((await POST(req({}))).status).toBe(401)
  })
  it('assigns existing rides, optionally from a date', async () => {
    const db = makeDb({ bikes: [bike()], workouts: [ride(), ride({ id: 'w2', date: '2026-01-01' })] })
    use(db)
    const res = await POST(req({ from: '2026-06-01' }))
    expect((await res.json()).assigned).toBe(1)
    expect(db.tables.workouts.map(w => w.bike_id)).toEqual(['b1', null])
  })
  it('rejects a malformed date', async () => {
    use(makeDb({ bikes: [bike()] }))
    expect((await POST(req({ from: 'last year' }))).status).toBe(400)
  })
})

describe('PATCH /api/workouts/[id]/bike', () => {
  it('overrides the bike on a ride', async () => {
    const db = makeDb({ bikes: [bike(), bike({ id: 'b2', is_default: false })], workouts: [ride({ bike_id: 'b1' })] })
    use(db)
    expect((await PATCH(req({ bike_id: 'b2' }, 'PATCH'), ctx('w1'))).status).toBe(200)
    expect(db.tables.workouts[0].bike_id).toBe('b2')
  })
  it('unassigns with null', async () => {
    const db = makeDb({ workouts: [ride({ bike_id: 'b1' })] })
    use(db)
    expect((await PATCH(req({ bike_id: null }, 'PATCH'), ctx('w1'))).status).toBe(200)
    expect(db.tables.workouts[0].bike_id).toBeNull()
  })
  it("404s for another user's ride or bike, 400 for a missing field or retired bike", async () => {
    const db = makeDb({
      bikes: [bike({ id: 'theirs', user_id: 'other' }), bike({ id: 'old', retired_at: '2026-01-01T00:00:00Z', is_default: false })],
      workouts: [ride(), ride({ id: 'w9', user_id: 'other' })],
    })
    use(db)
    expect((await PATCH(req({ bike_id: 'b1' }, 'PATCH'), ctx('w9'))).status).toBe(404)
    expect((await PATCH(req({ bike_id: 'theirs' }, 'PATCH'), ctx('w1'))).status).toBe(404)
    expect((await PATCH(req({ bike_id: 'old' }, 'PATCH'), ctx('w1'))).status).toBe(400)
    expect((await PATCH(req({}, 'PATCH'), ctx('w1'))).status).toBe(400)
  })
})
