// Pure HRV baseline/status engine. No React, DOM, Anthropic, or Supabase imports —
// runs identically on client (UI) and server (prompts), and is unit-testable.
import type { ICUWellness } from '@/types'

export type HrvStatusLabel = 'suppressed' | 'balanced' | 'elevated' | 'building' | 'no_data'
export type HrvTrend = 'rising' | 'stable' | 'falling'

export interface HrvStatus {
  label: HrvStatusLabel
  sufficient: boolean
  daysOfData: number
  today: number | null
  sevenDayAvg: number | null
  baselineMean: number | null
  lowerBound: number | null
  upperBound: number | null
  trend: HrvTrend
  baselineDrift: HrvTrend
}

const BASELINE_DAYS = 60
const MIN_READINGS = 14
const SIGNAL_DAYS = 7

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
function sampleSd(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}
const round1 = (x: number) => Math.round(x * 10) / 10

function recentGeoMean(values: number[], n: number): number | null {
  const slice = values.slice(-n)
  if (!slice.length) return null
  return Math.exp(mean(slice.map(Math.log)))
}

function trendOf(values: number[]): HrvTrend {
  if (values.length < 4) return 'stable'
  const half = Math.floor(values.length / 2)
  const first = recentGeoMean(values.slice(0, half), half)!
  const second = recentGeoMean(values.slice(half), values.length - half)!
  const delta = (second - first) / first
  if (delta > 0.03) return 'rising'
  if (delta < -0.03) return 'falling'
  return 'stable'
}

function empty(label: HrvStatusLabel, daysOfData: number): HrvStatus {
  return {
    label, sufficient: false, daysOfData,
    today: null, sevenDayAvg: null, baselineMean: null,
    lowerBound: null, upperBound: null, trend: 'stable', baselineDrift: 'stable',
  }
}

export function computeHrvBaseline(
  wellness: ICUWellness[],
  opts: { asOf?: string } = {},
): HrvStatus {
  const sorted = [...wellness].sort((a, b) => a.id.localeCompare(b.id))
  const asOf = opts.asOf ?? sorted.at(-1)?.id ?? new Date().toISOString().split('T')[0]
  const startMs = new Date(asOf + 'T00:00:00Z').getTime() - (BASELINE_DAYS - 1) * 864e5
  const start = new Date(startMs).toISOString().split('T')[0]

  const window = sorted.filter(w => w.id >= start && w.id <= asOf)
  const readings = window.filter((w): w is ICUWellness & { hrv: number } => w.hrv !== null)
  const values = readings.map(r => r.hrv)
  const daysOfData = values.length

  if (daysOfData === 0) return empty('no_data', 0)

  const today = round1(values.at(-1)!)
  const logs = values.map(Math.log)
  const mLog = mean(logs)
  const sd = sampleSd(logs)
  const rawBaselineMean = Math.exp(mLog)
  const rawLowerBound = Math.exp(mLog - sd)
  const rawUpperBound = Math.exp(mLog + sd)
  const baselineMean = round1(rawBaselineMean)
  const lowerBound = round1(rawLowerBound)
  const upperBound = round1(rawUpperBound)
  const sevenDayGeo = recentGeoMean(values, SIGNAL_DAYS)!
  const sevenDayAvg = round1(sevenDayGeo)
  const trend = trendOf(values.slice(-SIGNAL_DAYS * 2))
  const baselineDrift = trendOf(values)

  if (daysOfData < MIN_READINGS) {
    return {
      label: 'building', sufficient: false, daysOfData,
      today, sevenDayAvg, baselineMean, lowerBound, upperBound, trend, baselineDrift,
    }
  }

  const label: HrvStatusLabel =
    sevenDayGeo < rawLowerBound ? 'suppressed' : sevenDayGeo > rawUpperBound ? 'elevated' : 'balanced'

  return { label, sufficient: true, daysOfData, today, sevenDayAvg, baselineMean, lowerBound, upperBound, trend, baselineDrift }
}
