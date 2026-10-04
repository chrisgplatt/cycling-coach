/** @jest-environment node */
import { NextRequest } from 'next/server'
import { makeDb } from '../support/gear-fake-db'

jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { POST } from '@/app/api/gear/triggers/route'
import { PATCH, DELETE } from '@/app/api/gear/triggers/[id]/route'
import { POST as DONE } from '@/app/api/gear/triggers/[id]/done/route'

const use = (db: ReturnType<typeof makeDb>) => (createSupabaseServerClient as jest.Mock).mockResolvedValue(db.client)
const req = (body?: unknown, method = 'POST') =>
  new NextRequest('http://t/api', { method, body: body === undefined ? undefined : JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

const comp = (o = {}) => ({ id: 'c1', user_id: 'u1', bike_id: 'b1', name: 'Chain', category: 'chain', installed_at: '2026-01-01', retired_at: null, ...o })
const trig = (o = {}) => ({
  id: 't1', user_id: 'u1', component_id: 'c1', label: 'Re-wax', kind: 'recurring', metric: 'km', interval_value: 300,
  last_done_at: '2026-02-01', heads_up_notified_at: 'x', due_notified_at: 'y', ...o,
})
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().split('T')[0]

describe('POST /api/gear/triggers', () => {
  it('creates a trigger on the user’s active component', async () => {
    const db = makeDb({ bike_components: [comp()] })
    use(db)
    const res = await POST(req({ component_id: 'c1', label: 'Service', kind: 'recurring', metric: 'hours', interval_value: 50 }))
    expect(res.status).toBe(200)
    expect(db.tables.component_triggers[0]).toMatchObject({ user_id: 'u1', component_id: 'c1', label: 'Service', metric: 'hours' })
  })
  it('rejects retired/foreign components and invalid input', async () => {
    const db = makeDb({ bike_components: [comp({ id: 'r', retired_at: '2026-03-01' }), comp({ id: 'f', user_id: 'other' })] })
    use(db)
    const t = { label: 'x', kind: 'recurring', metric: 'km', interval_value: 10 }
    expect((await POST(req({ component_id: 'r', ...t }))).status).toBe(400)
    expect((await POST(req({ component_id: 'f', ...t }))).status).toBe(404)
    expect((await POST(req({ component_id: 'c1', ...t, interval_value: -5 }))).status).toBe(400)
  })
})

describe('PATCH/DELETE /api/gear/triggers/[id]', () => {
  it('changing the interval re-arms notifications', async () => {
    const db = makeDb({ bike_components: [comp()], component_triggers: [trig()] })
    use(db)
    expect((await PATCH(req({ interval_value: 500 }, 'PATCH'), ctx('t1'))).status).toBe(200)
    expect(db.tables.component_triggers[0]).toMatchObject({ interval_value: 500, heads_up_notified_at: null, due_notified_at: null })
  })
  it('renaming does not re-arm notifications', async () => {
    const db = makeDb({ bike_components: [comp()], component_triggers: [trig()] })
    use(db)
    await PATCH(req({ label: 'Wax chain' }, 'PATCH'), ctx('t1'))
    expect(db.tables.component_triggers[0]).toMatchObject({ label: 'Wax chain', heads_up_notified_at: 'x', due_notified_at: 'y' })
  })
  it('rejects last_done_at on a lifetime trigger and bad intervals', async () => {
    const db = makeDb({ bike_components: [comp()], component_triggers: [trig({ kind: 'lifetime', last_done_at: null })] })
    use(db)
    expect((await PATCH(req({ last_done_at: '2026-03-01' }, 'PATCH'), ctx('t1'))).status).toBe(400)
    expect((await PATCH(req({ interval_value: 0 }, 'PATCH'), ctx('t1'))).status).toBe(400)
  })
  it('deletes only the owner’s trigger', async () => {
    const db = makeDb({ component_triggers: [trig(), trig({ id: 't2', user_id: 'other' })] })
    use(db)
    expect((await DELETE(req(undefined, 'DELETE'), ctx('t2'))).status).toBe(404)
    expect((await DELETE(req(undefined, 'DELETE'), ctx('t1'))).status).toBe(200)
  })
})

describe('POST /api/gear/triggers/[id]/done', () => {
  it('sets last_done_at (back-datable) and clears both notified timestamps', async () => {
    const db = makeDb({ bike_components: [comp()], component_triggers: [trig()] })
    use(db)
    expect((await DONE(req({ date: '2026-03-10' }), ctx('t1'))).status).toBe(200)
    expect(db.tables.component_triggers[0]).toMatchObject({ last_done_at: '2026-03-10', heads_up_notified_at: null, due_notified_at: null })
  })
  it('defaults to today', async () => {
    const db = makeDb({ bike_components: [comp()], component_triggers: [trig()] })
    use(db)
    await DONE(req({}), ctx('t1'))
    expect(db.tables.component_triggers[0].last_done_at).toBe(new Date().toISOString().split('T')[0])
  })
  it('rejects lifetime triggers and future dates', async () => {
    const db = makeDb({ component_triggers: [trig({ id: 'life', kind: 'lifetime' }), trig()] })
    use(db)
    expect((await DONE(req({}), ctx('life'))).status).toBe(400)
    expect((await DONE(req({ date: tomorrow() }), ctx('t1'))).status).toBe(400)
    expect((await DONE(req({ date: 'soon' }), ctx('t1'))).status).toBe(400)
  })
})
