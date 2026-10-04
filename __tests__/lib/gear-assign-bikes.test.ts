import { assignBikesToRides } from '@/lib/gear/assign-bikes'

type Call = { table: string; filters: unknown[][]; update?: unknown }

function makeSupabase(bikes: unknown[], rows: unknown[]) {
  const calls: Call[] = []
  const from = (table: string) => {
    const call: Call = { table, filters: [] }
    calls.push(call)
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'not', 'gte', 'in']) {
      b[m] = (...args: unknown[]) => { if (m !== 'select') call.filters.push([m, ...args]); return b }
    }
    b.update = (payload: unknown) => { call.update = payload; return b }
    b.then = (resolve: (v: unknown) => void) =>
      resolve(call.update !== undefined
        ? { error: null }
        : { data: table === 'bikes' ? bikes : rows, error: null })
    return b
  }
  return { client: { from } as never, calls }
}

const road = { id: 'road', is_default: true, is_indoor_default: false, retired_at: null }
const trainer = { id: 'trainer', is_default: false, is_indoor_default: true, retired_at: null }

describe('assignBikesToRides', () => {
  it('sends indoor rides to the trainer bike and outdoor rides to the default, one update per bike', async () => {
    const { client, calls } = makeSupabase([road, trainer], [
      { id: 'w1', activity_metrics: { is_indoor: true } },
      { id: 'w2', activity_metrics: { is_indoor: false } },
      { id: 'w3', activity_metrics: {} },
    ])
    const n = await assignBikesToRides(client, 'u1')
    expect(n).toBe(3)
    const updates = calls.filter(c => c.update !== undefined)
    expect(updates).toHaveLength(2)
    const byBike = Object.fromEntries(updates.map(u => [(u.update as { bike_id: string }).bike_id, u.filters.find(f => f[0] === 'in')![2]]))
    expect(byBike).toEqual({ trainer: ['w1'], road: ['w2', 'w3'] })
  })

  it('only selects completed-enriched rides with no bike yet', async () => {
    const { client, calls } = makeSupabase([road], [])
    await assignBikesToRides(client, 'u1')
    const q = calls.find(c => c.table === 'workouts')!
    expect(q.filters).toEqual(expect.arrayContaining([
      ['is', 'bike_id', null],
      ['not', 'activity_metrics', 'is', null],
      ['not', 'icu_activity_id', 'is', null],
    ]))
  })

  it('applies the from-date bound', async () => {
    const { client, calls } = makeSupabase([road], [])
    await assignBikesToRides(client, 'u1', { from: '2026-09-01' })
    expect(calls.find(c => c.table === 'workouts')!.filters).toContainEqual(['gte', 'date', '2026-09-01'])
  })

  it('does nothing when the user has no bikes', async () => {
    const { client, calls } = makeSupabase([], [{ id: 'w1', activity_metrics: {} }])
    expect(await assignBikesToRides(client, 'u1')).toBe(0)
    expect(calls.some(c => c.table === 'workouts')).toBe(false)
  })
})
