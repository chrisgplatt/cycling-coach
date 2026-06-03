import type { WeekBucket } from '@/lib/plan/progress'

const CTL_TAU = 42

/** Whole UTC days from `from` to `to` (negative if `to` precedes `from`). */
export function daysBetweenUtc(from: string, to: string): number {
  const a = Date.parse(from.split('T')[0] + 'T00:00:00Z')
  const b = Date.parse(to.split('T')[0] + 'T00:00:00Z')
  return Math.round((b - a) / 86_400_000)
}

/** ISO date `n` days after `dateStr`, in UTC. */
export function addDaysUtc(dateStr: string, n: number): string {
  const t = Date.parse(dateStr.split('T')[0] + 'T00:00:00Z') + n * 86_400_000
  return new Date(t).toISOString().split('T')[0]
}

/** Advance CTL one day given that day's TSS (Banister impulse-response). */
function stepCtl(ctl: number, tss: number): number {
  return ctl + (tss - ctl) / CTL_TAU
}

/** Project CTL across a daily TSS sequence; returns one point per day, including the start. */
export function projectCtl(startCtl: number, dailyTss: number[]): number[] {
  const out = [startCtl]
  let ctl = startCtl
  for (const tss of dailyTss) {
    ctl = stepCtl(ctl, tss)
    out.push(ctl)
  }
  return out
}

export interface ForecastInput {
  startCtl: number          // latest actual CTL ("today")
  buckets: WeekBucket[]     // from lib/plan/progress.ts
  planStart: string         // plan start date (YYYY-MM-DD)
  today: string             // today (YYYY-MM-DD)
  horizonDays: number       // days from today to event (or plan end)
  hitPct: number            // adherence %, from consistency()
}

export interface ForecastResult {
  planCtl: number           // projected CTL at horizon, full planned load
  paceCtl: number           // projected CTL at horizon, planned load * adherence
  planSeries: number[]      // daily CTL incl. start (full plan)
  paceSeries: number[]      // daily CTL incl. start (current pace)
  horizonDays: number
}

/** Forward CTL projection to the horizon, plan vs. current pace. */
export function buildForecast(input: ForecastInput): ForecastResult {
  const { startCtl, buckets, planStart, today, horizonDays, hitPct } = input
  if (horizonDays <= 0) {
    return { planCtl: startCtl, paceCtl: startCtl, planSeries: [], paceSeries: [], horizonDays: 0 }
  }
  const scale = Math.max(0, hitPct) / 100
  const planDaily: number[] = []
  const paceDaily: number[] = []
  for (let k = 1; k <= horizonDays; k++) {
    const dayDate = addDaysUtc(today, k)
    const weekIdx = Math.floor(daysBetweenUtc(planStart, dayDate) / 7)
    const weekTss = weekIdx >= 0 && weekIdx < buckets.length ? buckets[weekIdx].plannedTss : 0
    const daily = weekTss / 7
    planDaily.push(daily)
    paceDaily.push(daily * scale)
  }
  const planSeries = projectCtl(startCtl, planDaily)
  const paceSeries = projectCtl(startCtl, paceDaily)
  return {
    planCtl: planSeries[planSeries.length - 1],
    paceCtl: paceSeries[paceSeries.length - 1],
    planSeries,
    paceSeries,
    horizonDays,
  }
}
