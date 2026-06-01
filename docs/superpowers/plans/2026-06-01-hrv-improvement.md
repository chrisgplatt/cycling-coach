# HRV Improvement (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Help the athlete *raise* their HRV baseline over months — a long-horizon baseline trend, honest associations between HRV and the actionable levers (sleep, load/ramp, intensity distribution), and an always-on coaching focus card — all on the fitness HRV view, separate from the cycling plan.

**Architecture:** A pure engine (`lib/hrv/improvement.ts`) computes everything deterministic (baseline-over-time, Spearman lever associations, gap-driven focus). A dedicated `/api/hrv/improvement` route fetches 12 months of wellness + activities, runs the engine, and resolves a Claude-written focus rationale cached weekly in a new `hrv_focus` table. The fitness HRV section renders a baseline-delta annotation, a focus card, and a lever-insight panel.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Anthropic SDK, intervals.icu API, Supabase (Postgres + RLS), Jest (SWC; pure modules use a per-file `node` env), Tailwind, inline SVG.

Spec: `docs/superpowers/specs/2026-06-01-hrv-improvement-design.md`

---

## File Structure

**Create:**
- `lib/hrv/improvement.ts` — pure engine. Exports `LeverKey`, `LeverInsight`, `HrvFocus`, `HrvImprovement`, `computeHrvImprovement`, `focusSignature`.
- `lib/claude/hrv-coach.ts` — pure `buildHrvFocusPrompt(improvement)`.
- `app/api/hrv/improvement/route.ts` — fetch 12mo data, run engine, resolve cached coach note.
- `supabase/migrations/20260601_hrv_focus.sql` — `hrv_focus` cache table.
- `__tests__/lib/hrv-improvement.test.ts`, `__tests__/lib/hrv-coach.test.ts`.

**Modify:**
- `app/fitness/page.tsx` — add `HrvImprovementSection` + baseline-delta annotation on the existing HRV chart.
- `CLAUDE.md` — model-table row for the HRV focus coach.

**Verification gate:** `npm run build` type-checks (Jest/SWC does not). Run it on every task touching `.ts/.tsx`. Pure tests run via `npx jest <name>`. Do NOT stage `.claude/settings.local.json`. End every commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

**Purity boundary:** `lib/hrv/improvement.ts` and `lib/claude/hrv-coach.ts` must not import React/DOM/Anthropic/Supabase/IntervalsClient. `improvement.ts` may import `computeHrvBaseline` from `./baseline` (also pure).

---

## Task 1: Pure improvement engine

**Files:**
- Create: `lib/hrv/improvement.ts`
- Test: `__tests__/lib/hrv-improvement.test.ts`

Constants & method: weekly-averaged paired series; **Spearman** rank correlation; targets sleep ≥ 7.5h, easy-ride share ≥ 0.80, load ACWR band 0.8–1.3; easy ride = IF (`weighted_average_watts ÷ ftp`) < 0.85; minimum 8 paired weeks or a lever is `sufficient=false`; focus = the `helps`-direction, sufficient lever with the largest gap-score, else `fallback_sleep`.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
import { computeHrvImprovement, focusSignature } from '@/lib/hrv/improvement'
import type { ICUWellness, ICUActivity } from '@/types'

const DAY = 864e5
function dayStr(offsetFromEnd: number, end: string): string {
  return new Date(new Date(end + 'T00:00:00Z').getTime() - offsetFromEnd * DAY).toISOString().split('T')[0]
}

// Build `days` of wellness ending at `end`, hrv & sleep produced by callbacks.
function wellness(days: number, end: string, hrv: (i: number) => number | null, sleepH: (i: number) => number | null): ICUWellness[] {
  return Array.from({ length: days }, (_, i) => ({
    id: dayStr(days - 1 - i, end),
    ctl: null, atl: null, form: null,
    hrv: hrv(i),
    resting_hr: null,
    sleep_secs: sleepH(i) === null ? null : (sleepH(i) as number) * 3600,
  }))
}

function ride(date: string, watts: number, tss: number, secs = 3600): ICUActivity {
  return {
    id: 'a' + date + watts, start_date_local: date + 'T08:00:00', type: 'Ride',
    moving_time: secs, name: 'Ride', average_watts: watts, max_watts: watts + 50,
    weighted_average_watts: watts, average_heartrate: 140, training_load: tss,
    rolling_ftp: null, distance: null, total_elevation_gain: null, left_right_balance: null,
  }
}

const END = '2026-06-01'

describe('computeHrvImprovement', () => {
  test('rising baseline yields a positive delta and rising trend', () => {
    // 200 days, HRV ramps 40 → 60; constant 7h sleep; no rides
    const w = wellness(200, END, i => 40 + (i / 199) * 20, () => 7)
    const r = computeHrvImprovement(w, [], 250, { asOf: END })
    expect(r.hasEnoughHistory).toBe(true)
    expect(r.baselineSeries.length).toBeGreaterThan(4)
    expect(r.baselineDeltaMs as number).toBeGreaterThan(0)
    expect(r.baselineTrend).toBe('rising')
  })

  test('sleep coupled to HRV surfaces as a strong, helpful lever', () => {
    // HRV mirrors sleep week to week (both oscillate together)
    const w = wellness(180, END, i => 50 + 8 * Math.sin(i / 7), i => 7 + 1.2 * Math.sin(i / 7))
    const r = computeHrvImprovement(w, [], 250, { asOf: END })
    const sleep = r.levers.find(l => l.key === 'sleep')!
    expect(sleep.sufficient).toBe(true)
    expect(sleep.direction).toBe('helps')
    expect(['moderate', 'strong']).toContain(sleep.strength)
  })

  test('short history reports not-enough-history and falls back to sleep focus', () => {
    const w = wellness(20, END, () => 50, () => 6)
    const r = computeHrvImprovement(w, [], 250, { asOf: END })
    expect(r.hasEnoughHistory).toBe(false)
    expect(r.focus.reason).toBe('fallback_sleep')
    expect(r.focus.caveat).toBeTruthy()
  })

  test('focus picks the helpful lever with the biggest gap (low sleep)', () => {
    // sleep low (6h, target 7.5) and tracking HRV; plenty of easy riding already
    const w = wellness(180, END, i => 50 + 6 * Math.sin(i / 7), i => 6 + 1.0 * Math.sin(i / 7))
    const rides = Array.from({ length: 120 }, (_, k) => ride(dayStr(119 - k, END), 120, 40)) // IF 0.48 → easy, daily
    const r = computeHrvImprovement(w, rides, 250, { asOf: END })
    expect(r.focus.key).toBe('sleep')
    expect(r.focus.reason).toBe('gap_and_association')
    expect(r.focus.progressPct).not.toBeNull()
  })

  test('intensity uses per-ride IF (weighted_average_watts / ftp)', () => {
    const w = wellness(180, END, () => 50, () => 7.5)
    // all hard rides: IF = 230/250 = 0.92 (>0.85) → easy share ~0
    const hard = Array.from({ length: 60 }, (_, k) => ride(dayStr(120 - k, END), 230, 70))
    const r = computeHrvImprovement(w, hard, 250, { asOf: END })
    const intensity = r.levers.find(l => l.key === 'intensity')!
    expect(intensity.recentValue as number).toBeLessThan(0.2) // low easy share
  })

  test('focusSignature is stable for the same focus and changes when it moves', () => {
    const base = { key: 'sleep' as const, reason: 'gap_and_association' as const, caveat: null, target: 7.5, recentValue: 6.4, progressPct: 85, unit: 'h' }
    expect(focusSignature(base)).toBe(focusSignature({ ...base, progressPct: 86 }))
    expect(focusSignature(base)).not.toBe(focusSignature({ ...base, recentValue: 7.1 }))
    expect(focusSignature(base)).not.toBe(focusSignature({ ...base, key: 'load', unit: 'ACWR', target: 1.3 }))
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest hrv-improvement`
Expected: FAIL — cannot find module `@/lib/hrv/improvement`.

- [ ] **Step 3: Implement `lib/hrv/improvement.ts`**

```ts
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

// `positiveIsGood` — for sleep/intensity more is better; for load less is better.
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

  // ---- baseline-over-time (weekly steps) ----
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

  // ---- weekly aggregation ----
  type Wk = { hrv: number[]; sleepH: number[]; tss: number; easySecs: number; totalSecs: number }
  const weeks = new Map<string, Wk>()
  const wk = (k: string) => weeks.get(k) ?? weeks.set(k, { hrv: [], sleepH: [], tss: 0, easySecs: 0, totalSecs: 0 }).get(k)!
  for (const w of sortedW) {
    const k = isoWeek(w.id); const b = wk(k)
    if (w.hrv !== null) b.hrv.push(w.hrv)
    if (w.sleep_secs !== null) b.sleepH.push(w.sleep_secs / 3600)
  }
  // daily TSS for ACWR
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

  // ACWR as the load lever's recentValue (acute 7d / chronic 28d-avg-7d)
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

  // ---- focus selection ----
  const hasEnoughHistory = hrvDays >= 90 && levers.some(l => l.sufficient)
  const gapScore = (l: LeverInsight): number => {
    if (l.gap === null || l.recentValue === null) return 0
    if (l.key === 'sleep') return clamp01(l.gap / SLEEP_TARGET_H)
    if (l.key === 'intensity') return clamp01(l.gap / EASY_SHARE_TARGET)
    return clamp01(l.gap / 0.7) // load: distance outside band over 0.7
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

// Stable cache key: regenerate the coach note only when the focus or the
// rounded standing changes — not on every recompute.
export function focusSignature(f: HrvFocus): string {
  const rv = f.recentValue === null ? 'na' : Math.round(f.recentValue * 10) / 10
  const tg = f.target === null ? 'na' : f.target
  return `${f.key}|${rv}|${tg}`
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx jest hrv-improvement`
Expected: PASS (6/6). If a band/threshold makes a test flaky, adjust the *implementation* thresholds — not the tests — until green.

- [ ] **Step 5: Commit**

```bash
git add lib/hrv/improvement.ts __tests__/lib/hrv-improvement.test.ts
git commit -m "feat: add pure HRV-improvement engine (baseline trend, lever insight, focus)"
```

---

## Task 2: Coaching prompt builder

**Files:**
- Create: `lib/claude/hrv-coach.ts`
- Test: `__tests__/lib/hrv-coach.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
import { buildHrvFocusPrompt } from '@/lib/claude/hrv-coach'
import type { HrvImprovement } from '@/lib/hrv/improvement'

function imp(over: Partial<HrvImprovement> = {}): HrvImprovement {
  return {
    baselineSeries: [], baselineDeltaMs: 3, baselineDeltaDays: 90, baselineTrend: 'rising',
    levers: [
      { key: 'sleep', label: 'Sleep', association: 0.5, strength: 'moderate', direction: 'helps', sampleWeeks: 14, sufficient: true, recentValue: 6.4, target: 7.5, gap: 1.1, unit: 'h' },
    ],
    focus: { key: 'sleep', reason: 'gap_and_association', caveat: null, target: 7.5, recentValue: 6.4, progressPct: 85, unit: 'h' },
    hasEnoughHistory: true, ...over,
  }
}

describe('buildHrvFocusPrompt', () => {
  test('embeds the chosen focus and its numbers', () => {
    const p = buildHrvFocusPrompt(imp())
    expect(p).toMatch(/sleep/i)
    expect(p).toContain('6.4')
    expect(p).toContain('7.5')
  })
  test('frames it as lifestyle levers, not the cycling plan', () => {
    const p = buildHrvFocusPrompt(imp())
    expect(p.toLowerCase()).toMatch(/not (the|their) (training|cycling) plan|do not change the plan|separate from the (training|cycling) plan/)
  })
  test('instructs the model to use the given focus, not choose one', () => {
    const p = buildHrvFocusPrompt(imp())
    expect(p.toLowerCase()).toMatch(/do not (pick|choose|select)|use the focus (provided|given)|already (chosen|selected)/)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest hrv-coach`
Expected: FAIL — cannot find module `@/lib/claude/hrv-coach`.

- [ ] **Step 3: Implement `lib/claude/hrv-coach.ts`**

```ts
// Pure: builds the prompt for the HRV focus-card coaching line. The focus and
// all numbers are already decided by the deterministic engine — the model only
// writes the words. No Anthropic/Supabase imports.
import type { HrvImprovement, LeverInsight } from '@/lib/hrv/improvement'

function leverLine(l: LeverInsight): string {
  const assoc = l.sufficient && l.association !== null ? `${l.direction} (r=${l.association}, ${l.sampleWeeks} wks)` : 'still learning'
  const val = l.recentValue === null ? '?' : l.recentValue
  return `- ${l.label}: recent ${val}${l.unit}, target ${l.target ?? '?'}${l.unit} — ${assoc}`
}

export function buildHrvFocusPrompt(imp: HrvImprovement): string {
  const f = imp.focus
  const delta = imp.baselineDeltaMs === null ? 'not enough history to trend' : `${imp.baselineDeltaMs > 0 ? '+' : ''}${imp.baselineDeltaMs}ms over ${imp.baselineDeltaDays} days (${imp.baselineTrend})`
  return `You are a cycling coach writing ONE short, warm note (2-3 sentences, plain text — no markdown, no bullet points) about the ONE lifestyle factor the athlete should focus on to raise their HRV baseline.

This is about recovery/lifestyle levers — sleep, training load balance, and easy-vs-hard riding mix. It is SEPARATE from their cycling training plan: do NOT change, prescribe, or reference specific workouts.

The focus has ALREADY been chosen for you by analysis — use the focus provided, do NOT pick a different one.

HRV baseline trend: ${delta}

Levers (associations, not proof):
${imp.levers.map(leverLine).join('\n')}

CHOSEN FOCUS: ${f.key} — recent ${f.recentValue ?? '?'}${f.unit}, target ${f.target ?? '?'}${f.unit}${f.caveat ? ` (note: ${f.caveat})` : ''}

Write the note: explain why this focus matters for their HRV and give one concrete, encouraging nudge toward the target. If the data is still thin (a caveat is present), be honest that it is an early steer.`
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx jest hrv-coach`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add lib/claude/hrv-coach.ts __tests__/lib/hrv-coach.test.ts
git commit -m "feat: add HRV focus-card coaching prompt builder"
```

---

## Task 3: Migration + API route with cached coaching

**Files:**
- Create: `supabase/migrations/20260601_hrv_focus.sql`, `app/api/hrv/improvement/route.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Create the migration**

`supabase/migrations/20260601_hrv_focus.sql`:
```sql
-- HRV focus-card coaching note cache (one row per user, refreshed ~weekly)
create table if not exists hrv_focus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  focus_lever text not null,
  focus_signature text not null,
  coach_note text not null,
  generated_at timestamptz not null default now(),
  unique (user_id)
);

alter table hrv_focus enable row level security;
create policy "own data" on hrv_focus
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 2: Create the route**

`app/api/hrv/improvement/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { computeHrvImprovement, focusSignature } from '@/lib/hrv/improvement'
import { buildHrvFocusPrompt } from '@/lib/claude/hrv-coach'
import { anthropic, MODEL } from '@/lib/claude/client'

export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 365

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp')
    .maybeSingle()
  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]
  const oldest = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString().split('T')[0]
  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  let improvement
  try {
    const [wellness, activities] = await Promise.all([
      client.getWellness(oldest, today),
      client.getActivities(oldest, today),
    ])
    improvement = computeHrvImprovement(wellness, activities, profile.current_ftp ?? 200, { asOf: today })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  // Resolve the cached coaching note (regenerate on focus/standing change or weekly).
  let coachNote: string | null = null
  try {
    const sig = focusSignature(improvement.focus)
    const { data: cached } = await supabase
      .from('hrv_focus').select('focus_signature, coach_note, generated_at')
      .eq('user_id', user.id).maybeSingle()
    const fresh = cached && cached.focus_signature === sig &&
      Date.now() - new Date(cached.generated_at).getTime() < 7 * 864e5
    if (fresh) {
      coachNote = cached!.coach_note
    } else {
      const res = await anthropic.messages.create({
        model: MODEL, max_tokens: 256,
        messages: [{ role: 'user', content: buildHrvFocusPrompt(improvement) }],
      })
      const block = res.content.find(b => b.type === 'text')
      coachNote = block?.type === 'text' ? block.text.trim() : null
      if (coachNote) {
        await supabase.from('hrv_focus').upsert(
          { user_id: user.id, focus_lever: improvement.focus.key, focus_signature: sig, coach_note: coachNote, generated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        )
      }
    }
  } catch { /* coaching note is optional adornment — the deterministic card stands alone */ }

  return NextResponse.json({ improvement, coachNote })
}
```

(Confirm `@/lib/claude/client` exports `anthropic` and `MODEL` — it does, per `lib/claude/briefing.ts`. `MODEL` is `claude-opus-4-8`.)

- [ ] **Step 3: Add the CLAUDE.md model row**

In CLAUDE.md's Model Selection table, add after the Coach interview row:
```
| HRV focus coaching (`lib/claude/hrv-coach.ts`) | `claude-opus-4-8` |
```

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: compiles; `/api/hrv/improvement` registered.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260601_hrv_focus.sql app/api/hrv/improvement/route.ts CLAUDE.md
git commit -m "feat: add /api/hrv/improvement with weekly-cached focus coaching + hrv_focus table"
```

---

## Task 4: Fitness UI — focus card, lever panel, baseline delta

**Files:**
- Modify: `app/fitness/page.tsx`

The HRV section already renders `<HrvSection wellness={charts.wellness} />` (around line 535). Add an `HrvImprovementSection` that fetches `/api/hrv/improvement` and renders a baseline-delta readout, the focus card, and the lever panel (a self-contained section — no cross-wiring into the existing `HrvSection`).

- [ ] **Step 1: Add imports + types**

At the top of `app/fitness/page.tsx`, add:
```ts
import type { HrvImprovement } from '@/lib/hrv/improvement'
```
(`useState`/`useEffect` are already imported.)

- [ ] **Step 2: Add the `HrvImprovementSection` component**

Place next to `HrvSection` (above the page component):
```tsx
const STRENGTH_DOTS: Record<string, number> = { none: 0, mild: 1, moderate: 2, strong: 3 }
const DIR_SIGN: Record<string, string> = { helps: '+', hurts: '−', unclear: '·' }
const LEVER_FMT: Record<string, (v: number) => string> = {
  sleep: v => `${v.toFixed(1)}h`,
  load: v => v.toFixed(2),
  intensity: v => `${Math.round(v * 100)}%`,
}

function HrvImprovementSection() {
  const [data, setData] = useState<{ improvement: HrvImprovement; coachNote: string | null } | null | 'loading'>('loading')

  useEffect(() => {
    fetch('/api/hrv/improvement')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setData(d ?? null))
      .catch(() => setData(null))
  }, [])

  if (data === 'loading' || data === null) return null
  const { improvement: imp, coachNote } = data

  if (!imp.hasEnoughHistory) {
    return (
      <SectionCard title="HRV improvement" accent="bg-violet-500">
        <p className="text-sm text-gray-400 p-4">Keep syncing — building your HRV picture. Trends and a focus appear once there's enough history.</p>
      </SectionCard>
    )
  }

  const f = imp.focus
  const fmt = LEVER_FMT[f.key] ?? ((v: number) => String(v))
  return (
    <SectionCard title="HRV improvement" accent="bg-violet-500">
      {/* Baseline-trend delta */}
      {imp.baselineDeltaMs !== null && (
        <div className="px-4 pt-3">
          <p className="text-xs text-gray-500">
            Baseline {imp.baselineDeltaMs > 0 ? '+' : ''}{imp.baselineDeltaMs}ms over {imp.baselineDeltaDays} days{' '}
            {imp.baselineTrend === 'rising' ? '↑' : imp.baselineTrend === 'falling' ? '↓' : '→'}
          </p>
        </div>
      )}
      {/* Focus card */}
      <div className="p-4 border-b border-gray-100">
        <p className="text-[11px] font-bold text-violet-600 uppercase tracking-[0.06em]">Your focus</p>
        <p className="text-base font-semibold text-slate-900 mt-0.5 capitalize">{f.key === 'load' ? 'Balance training load' : f.key === 'intensity' ? 'Ride easier more often' : 'Protect sleep'}</p>
        {coachNote && <p className="text-sm text-slate-600 leading-relaxed mt-1.5">{coachNote}</p>}
        {f.recentValue !== null && f.target !== null && (
          <div className="mt-2.5">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{fmt(f.recentValue)} now</span><span>target {fmt(f.target)}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full" style={{ width: `${f.progressPct ?? 0}%` }} />
            </div>
          </div>
        )}
        {f.caveat && <p className="text-xs text-gray-400 mt-2">{f.caveat}</p>}
      </div>
      {/* Lever insight */}
      <div className="p-4 space-y-2">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em]">What's moving your HRV</p>
        {imp.levers.map(l => (
          <div key={l.key} className="flex items-center justify-between text-sm">
            <span className="text-slate-700">{l.label}</span>
            {l.sufficient ? (
              <span className="flex items-center gap-2 text-gray-500">
                <span className="tracking-tight">{'●'.repeat(STRENGTH_DOTS[l.strength])}{'○'.repeat(3 - STRENGTH_DOTS[l.strength])}</span>
                <span className="w-4 text-center">{DIR_SIGN[l.direction]}</span>
              </span>
            ) : (
              <span className="text-xs text-gray-400 italic">still learning</span>
            )}
          </div>
        ))}
        <p className="text-[11px] text-gray-400 pt-1">Associations, not proof.</p>
      </div>
    </SectionCard>
  )
}
```

- [ ] **Step 3: Render it after the existing HRV section**

Find `<HrvSection wellness={charts.wellness} />` and add immediately after it:
```tsx
          <HrvImprovementSection />
```

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add app/fitness/page.tsx
git commit -m "feat: add HRV improvement section (focus card + lever insight) to fitness page"
```

---

## Final verification

- [ ] `npx jest hrv-improvement hrv-coach` — all green.
- [ ] `npx jest` — full suite still green (no regressions; new tests pass).
- [ ] `npm run build` — clean; `/api/hrv/improvement` registered.
- [ ] Apply the `20260601_hrv_focus.sql` migration in Supabase before relying on cached notes (manual step for the user).
- [ ] Manual (device/dev): fitness page shows the HRV improvement section — focus card with progress bar, coaching line, lever dots; "keep syncing" state when history is thin.
- [ ] Confirm `.claude/settings.local.json` is never staged.

## Notes for the implementer

- **Purity:** `improvement.ts` and `hrv-coach.ts` import only types + the pure `./baseline`. Anything touching Supabase/Anthropic/IntervalsClient lives in the route.
- **Thresholds are tunable:** if a Task 1 test is marginally flaky on a band boundary, adjust the *implementation* constant, never the test's intent.
- **Migration is a manual deploy step** — the route degrades gracefully if `hrv_focus` is absent (the cache read/write is wrapped in try/catch; `coachNote` just won't persist), so the UI still works pre-migration.
