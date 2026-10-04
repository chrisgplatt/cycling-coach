import type { BikeComponent, ComponentTrigger } from '@/types'

export const DUE_SOON_FRACTION = 0.8

export interface UsageRide {
  date: string            // YYYY-MM-DD
  bike_id: string | null
  distance_m: number | null
  minutes: number
}
export interface Usage { km: number; hours: number }
export type TriggerStatus = 'ok' | 'due_soon' | 'overdue'
export interface TriggerProgress { used: number; interval: number; fraction: number; status: TriggerStatus }

function sum(rides: UsageRide[], bikeId: string, from: string | null, to: string | null): Usage {
  let metres = 0
  let minutes = 0
  for (const r of rides) {
    if (r.bike_id !== bikeId) continue
    if (from && r.date < from) continue
    if (to && r.date > to) continue
    metres += r.distance_m ?? 0
    minutes += r.minutes
  }
  return { km: metres / 1000, hours: minutes / 60 }
}

export function bikeTotals(bikeId: string, rides: UsageRide[]): Usage {
  return sum(rides, bikeId, null, null)
}

export function componentUsage(c: BikeComponent, rides: UsageRide[]): Usage {
  return sum(rides, c.bike_id, c.installed_at, c.retired_at)
}

export function triggerProgress(t: ComponentTrigger, c: BikeComponent, rides: UsageRide[]): TriggerProgress {
  const from = t.kind === 'recurring' ? (t.last_done_at ?? c.installed_at) : c.installed_at
  const u = sum(rides, c.bike_id, from, c.retired_at)
  const used = t.metric === 'km' ? u.km : u.hours
  const fraction = used / t.interval_value
  const status: TriggerStatus = fraction >= 1 ? 'overdue' : fraction >= DUE_SOON_FRACTION ? 'due_soon' : 'ok'
  return { used, interval: t.interval_value, fraction, status }
}
