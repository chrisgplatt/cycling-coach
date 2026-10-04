/** @jest-environment node */
import { NextRequest } from 'next/server'
import { makeDb } from '../support/gear-fake-db'

jest.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: jest.fn() }))
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { POST } from '@/app/api/gear/components/route'
import { PATCH, DELETE } from '@/app/api/gear/components/[id]/route'
import { POST as REPLACE } from '@/app/api/gear/components/[id]/replace/route'

const use = (db: ReturnType<typeof makeDb>) => (createSupabaseServerClient as jest.Mock).mockResolvedValue(db.client)
const req = (body?: unknown, method = 'POST') =>
  new NextRequest('http://t/api', { method, body: body === undefined ? undefined : JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

const bike = (o = {}) => ({ id: 'b1', user_id: 'u1', name: 'Road', kind: 'road', is_default: true, is_indoor_default: false, retired_at: null, ...o })
const comp = (o = {}) => ({ id: 'c1', user_id: 'u1', bike_id: 'b1', name: 'Chain', category: 'chain', installed_at: '2026-01-01', retired_at: null, ...o })
const trig = (o = {}) => ({
  id: 't1', user_id: 'u1', component_id: 'c1', label: 'Re-wax', kind: 'recurring', metric: 'km', interval_value: 300,
  last_done_at: '2026-02-01', heads_up_notified_at: 'x', due_notified_at: 'y', ...o,
})

describe('POST /api/gear/components', () => {
  it('creates a component with its triggers', async () => {
    const db = makeDb({ bikes: [bike()] })
    use(db)
    const res = await POST(req({
      bike_id: 'b1', name: 'KMC chain', category: 'chain', installed_at: '2026-03-01',
      triggers: [
        { label: 'Re-wax', kind: 'recurring', metric: 'km', interval_value: 300 },
        { label: 'Replace chain', kind: 'lifetime', metric: 'km', interval_value: 4000 },
      ],
    }))
    expect(res.status).toBe(200)
    expect(db.tables.bike_components).toHaveLength(1)
    expect(db.tables.component_triggers.map(t => t.label)).toEqual(['Re-wax', 'Replace chain'])
    expect(db.tables.component_triggers.every(t => t.user_id === 'u1' && t.component_id === db.tables.bike_components[0].id)).toBe(true)
  })

  it('rejects a retired or foreign bike, bad category, and bad triggers', async () => {
    const db = makeDb({ bikes: [bike({ id: 'r', retired_at: '2026-01-01T00:00:00Z' }), bike({ id: 'f', user_id: 'other' })] })
    use(db)
    expect((await POST(req({ bike_id: 'r', name: 'x', category: 'chain' }))).status).toBe(400)
    expect((await POST(req({ bike_id: 'f', name: 'x', category: 'chain' }))).status).toBe(404)
    const db2 = makeDb({ bikes: [bike()] })
    use(db2)
    expect((await POST(req({ bike_id: 'b1', name: 'x', category: 'wheel' }))).status).toBe(400)
    expect((await POST(req({ bike_id: 'b1', name: 'x', category: 'chain', triggers: [{ label: 'a', kind: 'recurring', metric: 'km', interval_value: 0 }] }))).status).toBe(400)
    expect(db2.tables.bike_components ?? []).toHaveLength(0)
  })
})

describe('PATCH/DELETE /api/gear/components/[id]', () => {
  it('edits name, category and installed_at; validates', async () => {
    const db = makeDb({ bike_components: [comp()] })
    use(db)
    expect((await PATCH(req({ name: 'New chain', installed_at: '2026-04-01' }, 'PATCH'), ctx('c1'))).status).toBe(200)
    expect(db.tables.bike_components[0]).toMatchObject({ name: 'New chain', installed_at: '2026-04-01' })
    expect((await PATCH(req({ installed_at: 'yesterday' }, 'PATCH'), ctx('c1'))).status).toBe(400)
  })
  it('deletes only the owner’s component', async () => {
    const db = makeDb({ bike_components: [comp(), comp({ id: 'c2', user_id: 'other' })] })
    use(db)
    expect((await DELETE(req(undefined, 'DELETE'), ctx('c2'))).status).toBe(404)
    expect((await DELETE(req(undefined, 'DELETE'), ctx('c1'))).status).toBe(200)
    expect(db.tables.bike_components.map(c => c.id)).toEqual(['c2'])
  })
})

describe('POST /api/gear/components/[id]/replace', () => {
  it('retires the old component and creates a fresh one with reset copies of its triggers', async () => {
    const db = makeDb({
      bikes: [bike()],
      bike_components: [comp()],
      component_triggers: [trig(), trig({ id: 't2', label: 'Replace chain', kind: 'lifetime', interval_value: 4000, last_done_at: null })],
    })
    use(db)
    const res = await REPLACE(req({ installed_at: '2026-05-01' }), ctx('c1'))
    expect(res.status).toBe(200)
    const [oldC, newC] = db.tables.bike_components
    expect(oldC.retired_at).toBe('2026-05-01')
    expect(newC).toMatchObject({ bike_id: 'b1', name: 'Chain', installed_at: '2026-05-01', retired_at: null })
    const copies = db.tables.component_triggers.filter(t => t.component_id === newC.id)
    expect(copies.map(t => [t.label, t.kind, t.interval_value])).toEqual([['Re-wax', 'recurring', 300], ['Replace chain', 'lifetime', 4000]])
    expect(copies.every(t => t.last_done_at == null && t.heads_up_notified_at == null && t.due_notified_at == null)).toBe(true)
    // the originals stay put
    expect(db.tables.component_triggers.filter(t => t.component_id === 'c1')).toHaveLength(2)
  })

  it('rejects an already-retired component and a date before install', async () => {
    const db = makeDb({ bikes: [bike()], bike_components: [comp({ retired_at: '2026-03-01' }), comp({ id: 'c2' })] })
    use(db)
    expect((await REPLACE(req({}), ctx('c1'))).status).toBe(400)
    expect((await REPLACE(req({ installed_at: '2025-12-01' }), ctx('c2'))).status).toBe(400)
  })
})
