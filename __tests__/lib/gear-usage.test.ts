import { bikeTotals, componentUsage, triggerProgress, type UsageRide } from '@/lib/gear/usage'
import type { BikeComponent, ComponentTrigger } from '@/types'

const rides: UsageRide[] = [
  { date: '2026-09-01', bike_id: 'b1', distance_m: 50_000, minutes: 120 },
  { date: '2026-09-10', bike_id: 'b1', distance_m: 100_000, minutes: 240 },
  { date: '2026-09-20', bike_id: 'b1', distance_m: null, minutes: 60 },
  { date: '2026-09-15', bike_id: 'b2', distance_m: 30_000, minutes: 60 },
]
const comp = (o: Partial<BikeComponent> = {}): BikeComponent => ({
  id: 'c1', user_id: 'u', bike_id: 'b1', name: 'Chain', category: 'chain',
  installed_at: '2026-09-05', retired_at: null, ...o,
})
const trig = (o: Partial<ComponentTrigger> = {}): ComponentTrigger => ({
  id: 't1', user_id: 'u', component_id: 'c1', label: 'Re-wax', kind: 'recurring', metric: 'km',
  interval_value: 200, last_done_at: null, heads_up_notified_at: null, due_notified_at: null, ...o,
})

describe('bikeTotals', () => {
  it('sums only that bike, treating null distance as 0', () => {
    expect(bikeTotals('b1', rides)).toEqual({ km: 150, hours: 7 })
  })
})

describe('componentUsage', () => {
  it('counts only rides on/after installed_at', () => {
    expect(componentUsage(comp(), rides)).toEqual({ km: 100, hours: 5 })
  })
  it('stops counting after retired_at', () => {
    expect(componentUsage(comp({ retired_at: '2026-09-12' }), rides)).toEqual({ km: 100, hours: 4 })
  })
})

describe('triggerProgress', () => {
  it('recurring: counts from last_done_at', () => {
    const p = triggerProgress(trig({ last_done_at: '2026-09-11' }), comp(), rides)
    expect(p.used).toBe(0)
    expect(p.status).toBe('ok')
  })
  it('recurring: falls back to installed_at when never done', () => {
    expect(triggerProgress(trig(), comp(), rides).used).toBe(100)
  })
  it('lifetime: ignores last_done_at', () => {
    const p = triggerProgress(trig({ kind: 'lifetime', last_done_at: '2026-09-11' }), comp(), rides)
    expect(p.used).toBe(100)
  })
  it('hours metric uses time', () => {
    expect(triggerProgress(trig({ metric: 'hours', interval_value: 10 }), comp(), rides).used).toBe(5)
  })
  it('flags due_soon at 80% and overdue at 100%', () => {
    expect(triggerProgress(trig({ interval_value: 125 }), comp(), rides).status).toBe('due_soon')
    expect(triggerProgress(trig({ interval_value: 100 }), comp(), rides).status).toBe('overdue')
    expect(triggerProgress(trig({ interval_value: 125.01 }), comp(), rides).status).toBe('ok')
  })
})
