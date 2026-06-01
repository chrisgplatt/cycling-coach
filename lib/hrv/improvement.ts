// Pure HRV-improvement engine. No React/DOM/Anthropic/Supabase/IntervalsClient.
// May import the (pure) baseline engine. Unit-tested in a node jest env.
import { computeHrvBaseline } from './baseline'
import type { ICUWellness, ICUActivity } from '@/types'

export type LeverKey = 'sleep' | 'load' | 'intensity'
export type LeverStrength = 'none' | 'mild' | 'moderate' | 'strong'
export type LeverDirection = 'helps' | 'hurts' | 'unclear'

export interface LeverInsight {
  key: LeverKey
  label: string
  association: number | null
  strength: LeverStrength
  direction: LeverDirection
  sampleWeeks: number
  sufficient: boolean
  recentValue: number | null
  target: number | null
  gap: number | null
  unit: string
}

export interface HrvFocus {
  key: LeverKey
  reason: 'gap_and_association' | 'fallback_sleep'
  caveat: string | null
  target: number | null
  recentValue: number | null
  progressPct: number | null
  unit: string
}

export interface BaselinePoint { date: string; baselineMean: number | null; lowerBound: number | null; upperBound: number | null }

export interface HrvImprovement {
  baselineSeries: BaselinePoint[]
  baselineDeltaMs: number | null
  baselineDeltaDays: number
  baselineTrend: 'rising' | 'stable' | 'falling'
  levers: LeverInsight[]
  focus: HrvFocus
  hasEnoughHistory: boolean
}

const SLEEP_TARGET_H = 7.5
const EASY_SHARE_TARGET = 0.80
const ACWR_LOW = 0.8, ACWR_HIGH = 1.3
const EASY_IF = 0.85
const MIN_WEEKS = 8
const DELTA_DAYS = 90
const DAY = 864e5
const LABEL: Record<LeverKey, string> = { sleep: 'Sleep', load: 'Load ramp', intensity: 'Easy-ride share' }
const UNIT: Record<LeverKey, string> = { sleep: 'h', load: 'ACWR', intensity: '%' }

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 3) return null
  const mx = mean(xs), my = mean(ys)
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0])
  const r = new Array(xs.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg
    i = j + 1
  }
  return r
}

function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null
  return pearson(ranks(xs), ranks(ys))
}

function isoWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().split('T')[0]
}

function strengthOf(r: number): LeverStrength {
  const a = Math.abs(r)
  if (a < 0.2) return 'none'
  if (a < 0.4) return 'mild'
  if (a < 0.6) return 'moderate'
  return 'strong'
}

function directionOf(r: number | null, positiveIsGood: boolean): LeverDirection {
  if (r === null || Math.abs(r) < 0.2) return 'unclear'
  const helpfulSign = positiveIsGood ? r > 0 : r < 0
  return helpfulSign ? 'helps' : 'hurts'
}

const round1 = (x: number) => Math.round(x * 10) / 10
const round2 = (x: number) => Math.round(x * 100) / 100

export function computeHrvImprovement(
  wellness: ICUWellness[],
  activities: ICUActivity[],
  ftp: number,
  opts: { asOf?: string } = {},
): HrvImprovement {
  const sortedW = [...wellness].sort((a, b) => a.id.localeCompare(b.id))
  const asOf = opts.asOf ?? sortedW.at(-1)?.id ?? new Date().toISOString().split('T')[0]
  const asOfMs = new Date(asOf + 'T00:00:00Z').getTime()
  const hrvDays = sortedW.filter(w => w.hrv !== null).length

  const startMs = sortedW.length ? new Date(sortedW[0].id + 'T00:00:00Z').getTime() : asOfMs
  const baselineSeries: BaselinePoint[] = []
  for (let t = startMs + 60 * DAY; t <= asOfMs; t += 7 * DAY) {
    const d = new Date(t).toISOString().split('T')[0]
    const b = computeHrvBaseline(sortedW, { asOf: d })
    baselineSeries.push({ date: d, baselineMean: b.baselineMean, lowerBound: b.lowerBound, upperBound: b.upperBound })
  }
  const withMean = baselineSeries.filter(p => p.baselineMean !== null)
  const latestMean = withMean.at(-1)?.baselineMean ?? null
  const pastTargetMs = asOfMs - DELTA_DAYS * DAY
  let pastMean: number | null = null
  for (const p of withMean) { if (new Date(p.date + 'T00:00:00Z').getTime() <= pastTargetMs) pastMean = p.baselineMean }
  if (pastMean === null) pastMean = withMean[0]?.baselineMean ?? null
  const baselineDeltaMs = latestMean !== null && pastMean !== null ? round1(latestMean - pastMean) : null
  const baselineTrend: HrvImprovement['baselineTrend'] =
    baselineDeltaMs === null ? 'stable' : baselineDeltaMs > 1 ? 'rising' : baselineDeltaMs < -1 ? 'falling' : 'stable'

  type Wk = { hrv: number[]; sleepH: number[]; tss: number; easySecs: number; totalSecs: number }
  const weeks = new Map<string, Wk>()
  const wk = (k: string) => weeks.get(k) ?? weeks.set(k, { hrv: [], sleepH: [], tss: 0, easySecs: 0, totalSecs: 0 }).get(k)!
  for (const w of sortedW) {
    const k = isoWeek(w.id); const b = wk(k)
    if (w.hrv !== null) b.hrv.push(w.hrv)
    if (w.sleep_secs !== null) b.sleepH.push(w.sleep_secs / 3600)
  }
  const dailyTss = new Map<string, number>()
  for (const a of activities) {
    if (!/ride/i.test(a.type)) continue
    const date = a.start_date_local.split('T')[0]
    const k = isoWeek(date); const b = wk(k)
    b.tss += a.training_load ?? 0
    b.totalSecs += a.moving_time
    const ifv = a.weighted_average_watts !== null && ftp > 0 ? a.weighted_average_watts / ftp : null
    if (ifv !== null && ifv < EASY_IF) b.easySecs += a.moving_time
    dailyTss.set(date, (dailyTss.get(date) ?? 0) + (a.training_load ?? 0))
  }

  const orderedKeys = [...weeks.keys()].sort()
  const series = (sel: (b: Wk) => number | null) =>
    orderedKeys.map(k => ({ k, v: sel(weeks.get(k)!) })).filter(p => p.v !== null) as { k: string; v: number }[]

  const hrvWk = new Map(series(b => b.hrv.length ? mean(b.hrv) : null).map(p => [p.k, p.v]))
  const sleepWk = series(b => b.sleepH.length ? mean(b.sleepH) : null)
  const easyWk = series(b => b.totalSecs > 0 ? b.easySecs / b.totalSecs : null)
  const tssWk = series(b => b.totalSecs > 0 ? b.tss : null)

  function lever(key: LeverKey, points: { k: string; v: number }[], target: number, positiveIsGood: boolean, recentN = 4): LeverInsight {
    const paired = points.filter(p => hrvWk.has(p.k))
    const xs = paired.map(p => p.v), ys = paired.map(p => hrvWk.get(p.k)!)
    const assoc = paired.length >= 3 ? spearman(xs, ys) : null
    const sampleWeeks = paired.length
    const sufficient = sampleWeeks >= MIN_WEEKS && assoc !== null
    const recentValue = points.length ? round2(mean(points.slice(-recentN).map(p => p.v))) : null
    let gap: number | null = null
    if (recentValue !== null) {
      if (key === 'load') gap = recentValue > ACWR_HIGH ? round2(recentValue - ACWR_HIGH) : recentValue < ACWR_LOW ? round2(ACWR_LOW - recentValue) : 0
      else gap = recentValue < target ? round2(target - recentValue) : 0
    }
    return {
      key, label: LABEL[key], unit: UNIT[key],
      association: assoc === null ? null : round2(assoc),
      strength: assoc === null ? 'none' : strengthOf(assoc),
      direction: sufficient ? directionOf(assoc, positiveIsGood) : 'unclear',
      sampleWeeks, sufficient, recentValue, target, gap,
    }
  }

  const acute = sumTss(dailyTss, asOfMs, 7)
  const chronic = sumTss(dailyTss, asOfMs, 28) / 4
  const acwr = chronic > 0 ? round2(acute / chronic) : null
  const loadLever = lever('load', tssWk, ACWR_HIGH, false)
  loadLever.recentValue = acwr
  loadLever.gap = acwr === null ? null : acwr > ACWR_HIGH ? round2(acwr - ACWR_HIGH) : acwr < ACWR_LOW ? round2(ACWR_LOW - acwr) : 0

  const levers: LeverInsight[] = [
    lever('sleep', sleepWk, SLEEP_TARGET_H, true),
    loadLever,
    lever('intensity', easyWk, EASY_SHARE_TARGET, true),
  ]

  const hasEnoughHistory = hrvDays >= 90 && levers.some(l => l.sampleWeeks >= MIN_WEEKS)
  const gapScore = (l: LeverInsight): number => {
    if (l.gap === null || l.recentValue === null) return 0
    if (l.key === 'sleep') return clamp01(l.gap / SLEEP_TARGET_H)
    if (l.key === 'intensity') return clamp01(l.gap / EASY_SHARE_TARGET)
    return clamp01(l.gap / 0.7)
  }
  const candidates = levers
    .filter(l => l.sufficient && l.direction === 'helps' && (l.gap ?? 0) > 0)
    .sort((a, b) => gapScore(b) - gapScore(a) || Math.abs(b.association ?? 0) - Math.abs(a.association ?? 0))

  let focus: HrvFocus
  if (candidates.length) {
    const c = candidates[0]
    const prog = c.key === 'load'
      ? Math.round(100 * (1 - gapScore(c)))
      : c.target ? clampInt(Math.round(100 * (c.recentValue! / c.target)), 0, 100) : null
    focus = { key: c.key, reason: 'gap_and_association', caveat: null, target: c.target, recentValue: c.recentValue, progressPct: prog, unit: c.unit }
  } else {
    const sleep = levers.find(l => l.key === 'sleep')!
    focus = {
      key: 'sleep', reason: 'fallback_sleep',
      caveat: hasEnoughHistory ? 'No lever stands out yet — sleep is the safest place to start.' : 'Building your picture — keep syncing.',
      target: SLEEP_TARGET_H, recentValue: sleep.recentValue,
      progressPct: sleep.recentValue !== null ? clampInt(Math.round(100 * (sleep.recentValue / SLEEP_TARGET_H)), 0, 100) : null,
      unit: 'h',
    }
  }

  return { baselineSeries, baselineDeltaMs, baselineDeltaDays: DELTA_DAYS, baselineTrend, levers, focus, hasEnoughHistory }
}

function sumTss(daily: Map<string, number>, endMs: number, days: number): number {
  let s = 0
  for (let i = 0; i < days; i++) {
    const d = new Date(endMs - i * DAY).toISOString().split('T')[0]
    s += daily.get(d) ?? 0
  }
  return s
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const clampInt = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

export function focusSignature(f: HrvFocus): string {
  const rv = f.recentValue === null ? 'na' : Math.round(f.recentValue * 10) / 10
  const tg = f.target === null ? 'na' : f.target
  return `${f.key}|${rv}|${tg}`
}
