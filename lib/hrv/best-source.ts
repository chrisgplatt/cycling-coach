import { computeHrvBaseline, type HrvStatus } from './baseline'

/** Pure decision: prefer Garmin's overnight HRV when its own baseline is sufficient
 * (>=14 readings in its window), otherwise fall back to intervals.icu's HRV. Both
 * candidate histories are passed in already-fetched — this function does no I/O,
 * so it can be reused identically for a single date or across a bulk date range. */
export function computeHrvStatusBestSource(
  icuWellnessHrv: { id: string; hrv: number | null }[],
  garminHrvHistory: { id: string; hrv: number | null }[],
  asOf: string,
): HrvStatus {
  const garminStatus = computeHrvBaseline(garminHrvHistory, { asOf })
  if (garminStatus.sufficient) return garminStatus
  return computeHrvBaseline(icuWellnessHrv, { asOf })
}
