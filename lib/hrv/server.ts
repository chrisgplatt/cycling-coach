import { IntervalsClient } from '@/lib/intervals/client'
import { computeHrvBaseline, type HrvStatus } from './baseline'
import type { SupabaseClient } from '@supabase/supabase-js'

export const HRV_WINDOW_DAYS = 90

export async function fetchHrvStatus(client: IntervalsClient, today: string): Promise<HrvStatus> {
  const start = new Date(new Date(today + 'T00:00:00Z').getTime() - HRV_WINDOW_DAYS * 864e5)
    .toISOString().split('T')[0]
  const wellness = await client.getWellness(start, today)
  return computeHrvBaseline(wellness, { asOf: today })
}

export async function fetchHrvStatusFromGarmin(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<HrvStatus> {
  const start = new Date(new Date(today + 'T00:00:00Z').getTime() - HRV_WINDOW_DAYS * 864e5)
    .toISOString().split('T')[0]
  const { data } = await supabase
    .from('garmin_wellness')
    .select('date, garmin_hrv_overnight')
    .eq('user_id', userId)
    .gte('date', start)
    .lte('date', today)
    .order('date', { ascending: true })
  const rows = (data ?? []) as { date: string; garmin_hrv_overnight: number | null }[]
  const mapped = rows.map(r => ({ id: r.date, hrv: r.garmin_hrv_overnight }))
  return computeHrvBaseline(mapped, { asOf: today })
}

export async function fetchHrvStatusBestSource(
  today: string,
  garminParams: { supabase: SupabaseClient; userId: string } | null,
  icuClient: IntervalsClient | null,
): Promise<HrvStatus> {
  if (garminParams) {
    const status = await fetchHrvStatusFromGarmin(garminParams.supabase, garminParams.userId, today)
    if (status.sufficient) return status
  }
  if (icuClient) return fetchHrvStatus(icuClient, today)
  return computeHrvBaseline([], { asOf: today })
}
