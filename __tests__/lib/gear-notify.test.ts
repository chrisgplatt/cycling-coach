import { notifyDueTriggers } from '@/lib/gear/notify'

const mockSendPush = jest.fn(async () => {})
jest.mock('@/lib/push', () => ({ sendPush: (...a: unknown[]) => (mockSendPush as jest.Mock)(...a) }))

const mockLoad = jest.fn()
jest.mock('@/lib/gear/load', () => ({ loadGearState: (...a: unknown[]) => mockLoad(...a) }))

const bike = { id: 'b1', user_id: 'u', name: 'Road', kind: 'road', is_default: true, is_indoor_default: false, retired_at: null }
const comp = { id: 'c1', user_id: 'u', bike_id: 'b1', name: 'Chain', category: 'chain', installed_at: '2026-01-01', retired_at: null }
const trig = (o = {}) => ({
  id: 't1', user_id: 'u', component_id: 'c1', label: 'Re-wax', kind: 'recurring', metric: 'km',
  interval_value: 100, last_done_at: null, heads_up_notified_at: null, due_notified_at: null, ...o,
})
const ride = (km: number) => [{ date: '2026-02-01', bike_id: 'b1', distance_m: km * 1000, minutes: 60 }]

function setup(opts: { km: number; trigger?: object; subs?: unknown[]; components?: unknown[] }) {
  mockLoad.mockResolvedValue({
    bikes: [bike], components: opts.components ?? [comp], triggers: [trig(opts.trigger)], rides: ride(opts.km),
  })
  const updates: unknown[] = []
  const subs = opts.subs ?? [{ endpoint: 'e1', p256dh: 'p', auth: 'a' }]
  const client = {
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => (table === 'push_subscriptions' ? Promise.resolve({ data: subs, error: null }) : b)
      b.update = (p: unknown) => { updates.push(p); return b }
      b.then = (r: (v: unknown) => void) => r({ error: null })
      return b
    },
  } as never
  return { client, updates }
}

beforeEach(() => { mockSendPush.mockClear(); mockSendPush.mockResolvedValue(undefined) })

describe('notifyDueTriggers', () => {
  it('sends a heads-up at 85% and records it', async () => {
    const { client, updates } = setup({ km: 85 })
    expect(await notifyDueTriggers(client, 'u')).toBe(1)
    expect(mockSendPush).toHaveBeenCalledTimes(1)
    const payload = (mockSendPush.mock.calls[0] as unknown[])[1] as { body: string; url: string }
    expect(payload.body).toContain('coming up')
    expect(payload.body).toContain('Re-wax')
    expect(payload.url).toBe('/settings/gear')
    expect(updates).toEqual([expect.objectContaining({ heads_up_notified_at: expect.any(String) })])
    expect(updates[0]).not.toHaveProperty('due_notified_at')
  })

  it('sends due at 105% and sets both timestamps when no heads-up was sent', async () => {
    const { client, updates } = setup({ km: 105 })
    await notifyDueTriggers(client, 'u')
    const payload = (mockSendPush.mock.calls[0] as unknown[])[1] as { body: string }
    expect(payload.body).toContain('due')
    expect(updates[0]).toEqual(expect.objectContaining({
      heads_up_notified_at: expect.any(String), due_notified_at: expect.any(String),
    }))
  })

  it('does not repeat a heads-up already sent', async () => {
    const { client, updates } = setup({ km: 85, trigger: { heads_up_notified_at: '2026-02-01T00:00:00Z' } })
    expect(await notifyDueTriggers(client, 'u')).toBe(0)
    expect(mockSendPush).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('skips retired components', async () => {
    const { client } = setup({ km: 105, components: [{ ...comp, retired_at: '2026-03-01' }] })
    expect(await notifyDueTriggers(client, 'u')).toBe(0)
  })

  it('does nothing and records nothing when there are no push subscriptions', async () => {
    const { client, updates } = setup({ km: 105, subs: [] })
    expect(await notifyDueTriggers(client, 'u')).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('does not record the notification if every push fails', async () => {
    mockSendPush.mockRejectedValue(new Error('gone'))
    const { client, updates } = setup({ km: 105 })
    expect(await notifyDueTriggers(client, 'u')).toBe(0)
    expect(updates).toHaveLength(0)
  })
})
