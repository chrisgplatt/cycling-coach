// Server-only helper: fetch the wellness window and compute HrvStatus. Imports
// IntervalsClient, so NOT pure — never import from client UI or pure tests.
import { IntervalsClient } from '@/lib/intervals/client'
import { computeHrvBaseline, type HrvStatus } from './baseline'

export const HRV_WINDOW_DAYS = 90

export async function fetchHrvStatus(client: IntervalsClient, today: string): Promise<HrvStatus> {
  const start = new Date(new Date(today + 'T00:00:00Z').getTime() - HRV_WINDOW_DAYS * 864e5)
    .toISOString().split('T')[0]
  const wellness = await client.getWellness(start, today)
  return computeHrvBaseline(wellness, { asOf: today })
}
