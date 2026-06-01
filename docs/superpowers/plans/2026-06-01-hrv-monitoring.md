# HRV Monitoring & HRV-Guided Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give HRV a personal rolling baseline + daily status, surface it (dashboard chip + fitness trend chart), feed it into the coaching AI, and let it advise the day's training — all suggestion-first, no plan mutation.

**Architecture:** One pure, dependency-free engine (`lib/hrv/baseline.ts`) turns the intervals.icu daily wellness array into an `HrvStatus` (60-day rolling band, 7-day signal, status, trend, sufficiency guard). It runs identically on the client (UI) and server (AI prompts). A pure formatter renders the status for prompts; a thin server helper fetches the wellness window and computes status for API routes. UI and prompt builders consume the same `HrvStatus`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Anthropic SDK, intervals.icu API, Jest (SWC, jsdom default — pure modules override to `node`), Tailwind, inline SVG charts.

Spec: `docs/superpowers/specs/2026-06-01-hrv-monitoring-design.md`

---

## File Structure

**Create:**
- `lib/hrv/baseline.ts` — pure baseline/status engine. Exports `HrvStatus`, `HrvStatusLabel`, `HrvTrend`, `computeHrvBaseline`.
- `lib/hrv/format.ts` — pure `formatHrvForPrompt(status)`.
- `lib/hrv/server.ts` — server helper `fetchHrvStatus(client, today)` (imports `IntervalsClient`; not pure, server-only).
- `app/api/hrv/route.ts` — wellness-only endpoint returning `{ status }` for the dashboard chip.
- `components/HrvStatusChip.tsx` — dashboard chip (status colour, 7-day vs baseline, trend, suppressed steer).
- `__tests__/lib/hrv-baseline.test.ts`, `__tests__/lib/hrv-format.test.ts`.

**Modify:**
- `app/api/charts/route.ts` — widen wellness window to ~365d (decouple from activities' 112d).
- `app/fitness/page.tsx` — HRV status card + trend chart with range selector.
- `app/dashboard/page.tsx` — render `HrvStatusChip`.
- `lib/claude/briefing.ts` + `types/index.ts` (`BriefingContext`) — Phase 2 advisory + enriched HRV line.
- `app/api/briefing/today/route.ts`, `app/api/cron/daily-briefing/route.ts` — compute + thread `hrvStatus`.
- `lib/claude/plan.ts`, `review.ts`, `interview.ts`, `chat.ts`, `session-chat.ts` — athlete-state HRV line via `formatHrvForPrompt`.
- `app/api/plan/route.ts`, `app/api/plan/review/route.ts`, `app/api/chat/route.ts`, `app/api/chat/session/route.ts`, `app/api/chat/interview/route.ts` — supply `hrvStatus`.
- `CLAUDE.md` — Athlete State HRV line update.

**Verification gate:** `npm run build` type-checks (Jest via SWC does not). Run it at the end of every task that touches `.ts/.tsx`.

---

## Task 1: Pure HRV baseline engine

**Files:**
- Create: `lib/hrv/baseline.ts`
- Test: `__tests__/lib/hrv-baseline.test.ts`

Method: work in `ln(hrv)` (HRV is right-skewed). Baseline = last **60 days ending `asOf`** (nulls filtered). `lowerBound/upperBound = exp(meanLog ± sampleSD_log)`, `baselineMean = exp(meanLog)`. `sevenDayAvg = exp(mean of last-7 logs)`. Status compares the 7-day geometric mean to the bounds. Sufficiency: `< 14` non-null readings in window → `building`; `0` → `no_data`.

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
import { computeHrvBaseline } from '@/lib/hrv/baseline'
import type { ICUWellness } from '@/types'

// Build a wellness series of `n` days ending at `end`, with a value-producing fn.
function series(n: number, end: string, val: (i: number) => number | null): ICUWellness[] {
  const endMs = new Date(end + 'T00:00:00Z').getTime()
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(endMs - (n - 1 - i) * 864e5).toISOString().split('T')[0]
    return { id: date, ctl: null, atl: null, form: null, hrv: val(i), resting_hr: null, sleep_secs: null }
  })
}

describe('computeHrvBaseline', () => {
  test('stable series → balanced, bounds bracket the mean', () => {
    const w = series(60, '2026-06-01', () => 50)
    const s = computeHrvBaseline(w, { asOf: '2026-06-01' })
    expect(s.label).toBe('balanced')
    expect(s.sufficient).toBe(true)
    expect(s.baselineMean).toBeCloseTo(50, 0)
    expect(s.sevenDayAvg).toBeCloseTo(50, 0)
    expect(s.lowerBound).toBeLessThanOrEqual(s.baselineMean as number)
    expect(s.upperBound).toBeGreaterThanOrEqual(s.baselineMean as number)
  })

  test('recent drop below band → suppressed, falling', () => {
    // 53 days around 55, last 7 days at 38
    const w = series(60, '2026-06-01', i => (i >= 53 ? 38 : 55))
    const s = computeHrvBaseline(w, { asOf: '2026-06-01' })
    expect(s.label).toBe('suppressed')
    expect(s.trend).toBe('falling')
  })

  test('recent rise above band → elevated, rising', () => {
    const w = series(60, '2026-06-01', i => (i >= 53 ? 72 : 55))
    const s = computeHrvBaseline(w, { asOf: '2026-06-01' })
    expect(s.label).toBe('elevated')
    expect(s.trend).toBe('rising')
  })

  test('fewer than 14 readings → building, no false status', () => {
    const w = series(60, '2026-06-01', i => (i >= 50 ? 50 : null)) // 10 readings
    const s = computeHrvBaseline(w, { asOf: '2026-06-01' })
    expect(s.label).toBe('building')
    expect(s.sufficient).toBe(false)
    expect(s.daysOfData).toBe(10)
  })

  test('no readings → no_data', () => {
    const w = series(60, '2026-06-01', () => null)
    const s = computeHrvBaseline(w, { asOf: '2026-06-01' })
    expect(s.label).toBe('no_data')
    expect(s.today).toBeNull()
    expect(s.baselineMean).toBeNull()
  })

  test('only counts the 60-day window ending asOf', () => {
    // 120 days; old half very high, recent 60 stable at 50 → baseline ~50
    const w = series(120, '2026-06-01', i => (i < 60 ? 90 : 50))
    const s = computeHrvBaseline(w, { asOf: '2026-06-01' })
    expect(s.baselineMean).toBeCloseTo(50, 0)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest hrv-baseline -t "stable series"`
Expected: FAIL — cannot find module `@/lib/hrv/baseline`.

- [ ] **Step 3: Implement `lib/hrv/baseline.ts`**

```ts
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

// Geometric mean (exp of mean-of-logs) of the most recent `n` non-null readings.
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
  const baselineMean = round1(Math.exp(mLog))
  const lowerBound = round1(Math.exp(mLog - sd))
  const upperBound = round1(Math.exp(mLog + sd))
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
    sevenDayGeo < lowerBound ? 'suppressed' : sevenDayGeo > upperBound ? 'elevated' : 'balanced'

  return { label, sufficient: true, daysOfData, today, sevenDayAvg, baselineMean, lowerBound, upperBound, trend, baselineDrift }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx jest hrv-baseline`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add lib/hrv/baseline.ts __tests__/lib/hrv-baseline.test.ts
git commit -m "feat: add pure HRV baseline/status engine"
```

---

## Task 2: Pure prompt formatter

**Files:**
- Create: `lib/hrv/format.ts`
- Test: `__tests__/lib/hrv-format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
/** @jest-environment node */
import { formatHrvForPrompt } from '@/lib/hrv/format'
import type { HrvStatus } from '@/lib/hrv/baseline'

function status(over: Partial<HrvStatus>): HrvStatus {
  return {
    label: 'balanced', sufficient: true, daysOfData: 60,
    today: 50, sevenDayAvg: 51, baselineMean: 51, lowerBound: 47, upperBound: 55,
    trend: 'stable', baselineDrift: 'stable', ...over,
  }
}

describe('formatHrvForPrompt', () => {
  test('balanced line names band + status + trend', () => {
    const s = formatHrvForPrompt(status({}))
    expect(s).toMatch(/HRV/)
    expect(s).toMatch(/51/)
    expect(s).toMatch(/BALANCED/)
  })
  test('suppressed line flags SUPPRESSED', () => {
    expect(formatHrvForPrompt(status({ label: 'suppressed', sevenDayAvg: 44, trend: 'falling' }))).toMatch(/SUPPRESSED/)
  })
  test('building line warns to interpret with caution', () => {
    expect(formatHrvForPrompt(status({ label: 'building', sufficient: false, daysOfData: 9 }))).toMatch(/building/i)
  })
  test('no_data line states no data', () => {
    expect(formatHrvForPrompt(status({ label: 'no_data', today: null, sevenDayAvg: null, baselineMean: null }))).toMatch(/no recent/i)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx jest hrv-format`
Expected: FAIL — cannot find module `@/lib/hrv/format`.

- [ ] **Step 3: Implement `lib/hrv/format.ts`**

```ts
// Pure: renders an HrvStatus as a single athlete-state line for AI prompts.
import type { HrvStatus } from './baseline'

export function formatHrvForPrompt(s: HrvStatus): string {
  if (s.label === 'no_data') return 'HRV: no recent data'
  if (s.label === 'building') {
    return `HRV: baseline still building (only ${s.daysOfData} readings) — interpret with caution`
  }
  const dir = s.trend === 'stable' ? 'stable' : s.trend
  return `HRV: ${s.sevenDayAvg}ms 7-day avg vs ${s.baselineMean}ms baseline (normal ${s.lowerBound}–${s.upperBound}ms) — ${s.label.toUpperCase()}, ${dir}`
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx jest hrv-format`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add lib/hrv/format.ts __tests__/lib/hrv-format.test.ts
git commit -m "feat: add HRV prompt formatter"
```

---

## Task 3: Server helper + data endpoints

**Files:**
- Create: `lib/hrv/server.ts`, `app/api/hrv/route.ts`
- Modify: `app/api/charts/route.ts:25-40`

- [ ] **Step 1: Create `lib/hrv/server.ts`**

```ts
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
```

- [ ] **Step 2: Create `app/api/hrv/route.ts`**

Mirror the auth/profile pattern of `app/api/charts/route.ts`.

```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { fetchHrvStatus } from '@/lib/hrv/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]
  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  try {
    const status = await fetchHrvStatus(client, today)
    return NextResponse.json({ status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
```

- [ ] **Step 3: Widen the charts wellness window**

In `app/api/charts/route.ts`, replace the single `oldest` (112d used for both fetches) so wellness pulls ~365d while activities stay 112d. Change lines 25-40:

```ts
  const today = new Date()
  const newest = today.toISOString().split('T')[0]
  const activitiesOldest = new Date(today.getTime() - 112 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0]
  const wellnessOldest = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0]

  const client = new IntervalsClient(
    profile.intervals_icu_athlete_id,
    profile.intervals_icu_api_key,
  )

  try {
    const [wellness, activities] = await Promise.all([
      client.getWellness(wellnessOldest, newest),
      client.getActivities(activitiesOldest, newest),
    ])
```

(The rest of the handler — `rides`/`tssMap`/`weeklyTss` from `activities`, and `charts = { wellness, weeklyTss }` — is unchanged.)

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: compiles; `/api/hrv` appears in the route list.

- [ ] **Step 5: Commit**

```bash
git add lib/hrv/server.ts app/api/hrv/route.ts app/api/charts/route.ts
git commit -m "feat: add HRV server helper, /api/hrv endpoint, widen charts wellness to 12mo"
```

---

## Task 4: Dashboard HRV status chip

**Files:**
- Create: `components/HrvStatusChip.tsx`
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Create `components/HrvStatusChip.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'
import type { HrvStatus } from '@/lib/hrv/baseline'

const STYLE: Record<string, { dot: string; text: string; label: string }> = {
  suppressed: { dot: 'bg-rose-500', text: 'text-rose-600', label: 'Suppressed' },
  balanced:   { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Balanced' },
  elevated:   { dot: 'bg-violet-500', text: 'text-violet-600', label: 'Elevated' },
  building:   { dot: 'bg-slate-300', text: 'text-slate-500', label: 'Building baseline' },
  no_data:    { dot: 'bg-slate-300', text: 'text-slate-400', label: 'No HRV data' },
}

const ARROW: Record<string, string> = { rising: '↑', falling: '↓', stable: '→' }

export default function HrvStatusChip() {
  const [status, setStatus] = useState<HrvStatus | null | 'loading'>('loading')

  useEffect(() => {
    fetch('/api/hrv')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setStatus(d?.status ?? null))
      .catch(() => setStatus(null))
  }, [])

  if (status === 'loading' || status === null) return null
  const st = STYLE[status.label]
  const showNumbers = status.sevenDayAvg !== null && status.baselineMean !== null

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 flex items-center justify-between min-h-[44px]">
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em]">HRV</span>
        <span className={`text-sm font-semibold ${st.text}`}>{st.label}</span>
      </div>
      <div className="text-right">
        {showNumbers && (
          <div className="text-xs text-gray-500">
            {status.sevenDayAvg}ms · base {status.baselineMean}ms {ARROW[status.trend]}
          </div>
        )}
        {status.label === 'suppressed' && (
          <div className="text-[11px] font-medium text-rose-500">ease today</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Render it on the dashboard**

In `app/dashboard/page.tsx`: add `import HrvStatusChip from '@/components/HrvStatusChip'` with the other component imports, then render `<HrvStatusChip />` directly beneath the `<MetricsBar .../>` element in the JSX (search for `<MetricsBar` to locate it).

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add components/HrvStatusChip.tsx app/dashboard/page.tsx
git commit -m "feat: add HRV status chip to dashboard"
```

---

## Task 5: Fitness-page HRV status card + trend chart

**Files:**
- Modify: `app/fitness/page.tsx`

The fitness page already loads `charts` (now with ~365d wellness). Add an `HrvSection` that runs `computeHrvBaseline` client-side and renders a status card + SVG trend chart in the existing `PMCChart` idiom (`svgLeft=30, svgRight=420, svgTop=15, svgBottom=115`, `normalizeY` from `@/lib/chart-helpers`).

- [ ] **Step 1: Add imports**

At the top of `app/fitness/page.tsx`, add one import (note: `useState` and `ICUWellness` are already imported on lines 2 and 4 — do not re-import them):

```ts
import { computeHrvBaseline, type HrvStatus } from '@/lib/hrv/baseline'
```

- [ ] **Step 2: Add the `HrvSection` component**

Place above the page component (next to `PMCChart`). Range selector filters `wellness` by date before charting; baseline/status always come from the full array (the engine uses its own 60-day window).

```tsx
const HRV_RANGES: { label: string; days: number }[] = [
  { label: '3m', days: 91 }, { label: '6m', days: 182 }, { label: '12m', days: 365 },
]
const HRV_STATUS_STYLE: Record<string, { text: string; label: string }> = {
  suppressed: { text: 'text-rose-600', label: 'Suppressed' },
  balanced: { text: 'text-emerald-600', label: 'Balanced' },
  elevated: { text: 'text-violet-600', label: 'Elevated' },
  building: { text: 'text-slate-500', label: 'Building baseline' },
  no_data: { text: 'text-slate-400', label: 'No HRV data' },
}

function HrvSection({ wellness }: { wellness: ICUWellness[] }) {
  const [rangeDays, setRangeDays] = useState(91)
  const status: HrvStatus = computeHrvBaseline(wellness)

  const cutoff = new Date(Date.now() - rangeDays * 864e5).toISOString().split('T')[0]
  const data = wellness.filter(w => w.hrv !== null && w.id >= cutoff)

  const svgLeft = 30, svgRight = 420, svgTop = 15, svgBottom = 115
  const chartW = svgRight - svgLeft
  const vals = data.map(w => w.hrv as number)
  const lo = status.lowerBound, hi = status.upperBound
  const allY = [...vals, ...(lo ? [lo] : []), ...(hi ? [hi] : [])]
  const dataMin = allY.length ? Math.floor(Math.min(...allY) / 5) * 5 - 2 : 0
  const dataMax = allY.length ? Math.ceil(Math.max(...allY) / 5) * 5 + 2 : 100
  const xOf = (i: number) => svgLeft + (i / Math.max(data.length - 1, 1)) * chartW
  const yOf = (v: number) => normalizeY(v, dataMin, dataMax, svgTop, svgBottom)

  // 7-day trailing arithmetic average line for visual smoothing
  const avgLine = data.map((_, i) => {
    const slice = vals.slice(Math.max(0, i - 6), i + 1)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
  const avgPoly = avgLine.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ')

  const st = HRV_STATUS_STYLE[status.label]

  return (
    <SectionCard title="HRV" accent="bg-violet-500">
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
        <div>
          <div className={`text-sm font-semibold ${st.text}`}>{st.label}</div>
          {status.sevenDayAvg !== null && status.baselineMean !== null && (
            <div className="text-xs text-gray-500 mt-0.5">
              {status.sevenDayAvg}ms 7-day · baseline {status.baselineMean}ms
              {status.lowerBound !== null && ` (${status.lowerBound}–${status.upperBound}ms)`}
            </div>
          )}
        </div>
        <div className="flex gap-1">
          {HRV_RANGES.map(r => (
            <button
              key={r.label}
              onClick={() => setRangeDays(r.days)}
              className={`text-[11px] font-semibold px-2 py-1.5 rounded min-h-[44px] ${
                rangeDays === r.days ? 'bg-violet-100 text-violet-700' : 'text-gray-400'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {data.length ? (
        <svg viewBox={`0 0 ${svgRight + 10} 130`} className="w-full">
          {lo !== null && hi !== null && (
            <rect x={svgLeft} y={yOf(hi)} width={chartW} height={Math.max(0, yOf(lo) - yOf(hi))}
              fill="#ede9fe" opacity="0.7" />
          )}
          {data.map((w, i) => (
            <circle key={w.id} cx={xOf(i)} cy={yOf(w.hrv as number)} r="1.3" fill="#c4b5fd" />
          ))}
          <polyline points={avgPoly} fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      ) : (
        <p className="text-sm text-gray-400 p-4">No HRV data in this range.</p>
      )}
      <div className="flex gap-3 px-3 pb-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded inline-block bg-violet-600" />7-day avg</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block" style={{ background: '#ede9fe' }} />normal range</span>
      </div>
    </SectionCard>
  )
}
```

- [ ] **Step 3: Render `HrvSection` in the page**

Find where `<PMCChart wellness={charts.wellness} />` is rendered (inside a `SectionCard`) and add, immediately after that section, a render of `<HrvSection wellness={charts.wellness} />`. Ensure `ICUWellness` is already imported (it is, line 4).

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 5: Commit**

```bash
git add app/fitness/page.tsx
git commit -m "feat: add HRV status card + trend chart to fitness page"
```

---

## Task 6: Phase 2 — briefing advisory + enriched HRV context

**Files:**
- Modify: `types/index.ts` (`BriefingContext`), `lib/claude/briefing.ts`, `app/api/briefing/today/route.ts`, `app/api/cron/daily-briefing/route.ts`
- Test: `__tests__/lib/claude-briefing.test.ts`

- [ ] **Step 1: Add `hrvStatus` to `BriefingContext`**

In `types/index.ts`, in the `BriefingContext` interface, add (near the existing `hrv` field):

```ts
  hrvStatus?: import('@/lib/hrv/baseline').HrvStatus | null
```

- [ ] **Step 2: Write the failing briefing test**

Add to `__tests__/lib/claude-briefing.test.ts` (match the file's existing mocking style for `anthropic`; assert on the prompt passed to the mocked client). Add a case where `hrvStatus.label === 'suppressed'` is present in `ctx` and assert the generated prompt contains `SUPPRESSED`. If the existing tests assert prompt text via a captured mock, extend that; otherwise add a focused test importing `buildLoadString`-equivalent behaviour through `generateBriefing`.

```ts
test('suppressed HRV status surfaces in the morning prompt', async () => {
  // Arrange ctx with a planned session and a suppressed hrvStatus, then call
  // generateBriefing and inspect the prompt captured by the anthropic mock.
  // Expected: captured prompt matches /SUPPRESSED/.
})
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npx jest claude-briefing -t "suppressed HRV"`
Expected: FAIL (prompt has no HRV status line yet).

- [ ] **Step 4: Use the formatter in `buildLoadString` and add morning guidance**

In `lib/claude/briefing.ts`:

Add import at top: `import { formatHrvForPrompt } from '@/lib/hrv/format'`

Replace the HRV line in `buildLoadString` (line 15) so it prefers the rich status:

```ts
function buildLoadString(ctx: BriefingContext): string {
  return [
    ctx.ctl !== null ? `Fitness (CTL): ${Math.round(ctx.ctl)}` : null,
    ctx.atl !== null ? `Fatigue (ATL): ${Math.round(ctx.atl)}` : null,
    ctx.tsb !== null ? `Form (TSB): ${Math.round(ctx.tsb)}` : null,
    ctx.hrvStatus ? formatHrvForPrompt(ctx.hrvStatus)
      : ctx.hrv !== null ? `HRV: ${Math.round(ctx.hrv)} ms` : null,
    `Readiness: ${ctx.readinessLabel}`,
  ].filter(Boolean).join(', ')
}
```

Extend `SYSTEM_MORNING` (line 4) by appending this sentence before the closing quote:

```
 When HRV is SUPPRESSED, steer the athlete toward easing or rescheduling today's planned session; when ELEVATED or well-recovered before a hard day, green-light it; when BALANCED, proceed as planned. Only raise HRV when it genuinely changes today's advice.
```

- [ ] **Step 5: Compute and thread `hrvStatus` in the today route**

In `app/api/briefing/today/route.ts`: widen the wellness fetch from 7d to the HRV window and compute status. Add import `import { fetchHrvStatus } from '@/lib/hrv/server'` and a parallel `import { computeHrvBaseline } from '@/lib/hrv/baseline'` is not needed (helper covers it). Inside the `if (profile?.intervals_icu_athlete_id …)` block, after the client is built, fetch status alongside the existing calls:

```ts
      let hrvStatus = null
      try { hrvStatus = await fetchHrvStatus(client, today) } catch { /* HRV optional */ }
```

Then add `hrvStatus,` to the `ctx: BriefingContext = { … }` object (Step 1 added the field). Keep the existing `hrv` assignment as a fallback.

- [ ] **Step 6: Mirror in the cron route**

In `app/api/cron/daily-briefing/route.ts`, locate where it builds its `BriefingContext` (same shape as the today route). Apply the identical change: build/obtain the `IntervalsClient`, `const hrvStatus = await fetchHrvStatus(client, today).catch(() => null)`, and add `hrvStatus` to the context object. (Read the file first; insert the fetch next to the existing wellness fetch and the field next to `hrv`.)

- [ ] **Step 7: Run tests + build**

Run: `npx jest claude-briefing` then `npm run build`
Expected: PASS; compiles.

- [ ] **Step 8: Commit**

```bash
git add types/index.ts lib/claude/briefing.ts app/api/briefing/today/route.ts app/api/cron/daily-briefing/route.ts __tests__/lib/claude-briefing.test.ts
git commit -m "feat: HRV-guided advisory in daily briefing + enriched HRV context"
```

---

## Task 7: Enrich load-bearing prompt builders (plan + review) + CLAUDE.md

**Files:**
- Modify: `lib/claude/plan.ts:14-18,128-131`, `lib/claude/review.ts:50-55,132-135`, `app/api/plan/route.ts`, `app/api/plan/review/route.ts`, `CLAUDE.md`

Pattern: pass an optional precomputed `hrvStatus` into the builder; when present, append its formatted line to the athlete-state block. Routes compute it via `fetchHrvStatus`.

- [ ] **Step 1: `plan.ts` — accept and surface `hrvStatus`**

Add import: `import { formatHrvForPrompt } from '@/lib/hrv/format'` and `import type { HrvStatus } from '@/lib/hrv/baseline'`.

Change `summariseWellness` to take an optional status and append the rich line:

```ts
function summariseWellness(wellness: ICUWellness[], hrvStatus?: HrvStatus | null): string {
  const latest = wellness[wellness.length - 1]
  if (!latest) return hrvStatus ? formatHrvForPrompt(hrvStatus) : 'No wellness data.'
  const base = `CTL: ${latest.ctl ?? '?'} TSS/day (aerobic fitness base), ATL: ${latest.atl ?? '?'} TSS/day (recent fatigue), Form (TSB): ${latest.form ?? '?'} (positive = fresh, negative = fatigued), HRV: ${latest.hrv ?? '?'} ms, Resting HR: ${latest.resting_hr ?? '?'} bpm`
  return hrvStatus ? `${base}\n${formatHrvForPrompt(hrvStatus)}` : base
}
```

Thread the param through the exported builder that constructs the prompt (the function that calls `summariseWellness(syncData.wellness)` near line 130): add a trailing optional `hrvStatus?: HrvStatus | null` parameter and pass it: `${summariseWellness(syncData.wellness, hrvStatus)}`.

- [ ] **Step 2: `plan.ts` route — compute and pass status**

In `app/api/plan/route.ts`, after the profile/creds are available and `syncData` is destructured, build a client from the profile creds and compute status, then pass it to the builder call:

```ts
import { fetchHrvStatus } from '@/lib/hrv/server'
import { IntervalsClient } from '@/lib/intervals/client'
// …
const today = new Date().toISOString().split('T')[0]
let hrvStatus = null
if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  try { hrvStatus = await fetchHrvStatus(client, today) } catch { /* optional */ }
}
```

Pass `hrvStatus` as the new trailing argument to the plan-prompt builder call. (Read the route to confirm where `profile` is fetched; the plan route already loads the profile for creds.)

- [ ] **Step 3: `review.ts` — surface `hrvStatus`**

Add the same imports. In `buildReviewPrompt`, add a trailing optional `hrvStatus?: HrvStatus | null` param and replace the inline athlete-state HRV line (lines 132-135) so it appends the formatted line when present:

```ts
CURRENT ATHLETE STATE:
${latestWellness
  ? `CTL: ${latestWellness.ctl ?? '?'} TSS/day (fitness), ATL: ${latestWellness.atl ?? '?'} TSS/day (fatigue), Form (TSB): ${latestWellness.form ?? '?'}, HRV: ${latestWellness.hrv ?? '?'} ms, Resting HR: ${latestWellness.resting_hr ?? '?'} bpm`
  : 'No wellness data.'}${hrvStatus ? '\n' + formatHrvForPrompt(hrvStatus) : ''}
```

Thread `hrvStatus` from `createReviewStream` (line 194) through to `buildReviewPrompt`.

- [ ] **Step 4: `review.ts` route — compute and pass status**

In `app/api/plan/review/route.ts`, the client and `today` already exist (it calls `client.getWellness(fourteenDaysAgo, today)`). Add `import { fetchHrvStatus } from '@/lib/hrv/server'`, compute `const hrvStatus = await fetchHrvStatus(client, today).catch(() => null)` near the existing wellness fetch, and pass `hrvStatus` as the new trailing arg to `createReviewStream(...)` (line 68).

- [ ] **Step 5: Update `CLAUDE.md` Athlete State**

In the "Athlete State (always include)" section, change the HRV bullet to note the enriched line, e.g.:

```
- **HRV** — heart rate variability; supplied as the 7-day average against the athlete's personal 60-day baseline band with a status (suppressed / balanced / elevated) and trend, via `formatHrvForPrompt`. Low/suppressed HRV signals accumulated stress or illness
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 7: Commit**

```bash
git add lib/claude/plan.ts lib/claude/review.ts app/api/plan/route.ts app/api/plan/review/route.ts CLAUDE.md
git commit -m "feat: enrich plan + review prompts with HRV baseline status"
```

---

## Task 8: Enrich conversational prompt builders (interview, chat, session)

**Files:**
- Modify: `lib/claude/interview.ts:59-64`, `lib/claude/chat.ts:52-54`, `lib/claude/session-chat.ts:23-29`, and routes `app/api/chat/interview/route.ts`, `app/api/chat/route.ts`, `app/api/chat/session/route.ts`

Same pattern: optional `hrvStatus` param appended to the athlete-state section; route computes via `fetchHrvStatus`. These builders receive a single `wellness` today, so add a separate `hrvStatus` param rather than changing the wellness shape.

- [ ] **Step 1: `interview.ts`**

Add imports (`formatHrvForPrompt`, `type HrvStatus`). Add a trailing optional `hrvStatus?: HrvStatus | null` to `buildInterviewSystemPrompt`. Replace the `fitnessSection` (lines 62-64) so it appends the rich line:

```ts
  const fitnessSection = (wellness
    ? `CTL: ${wellness.ctl ?? '?'} TSS/day, ATL: ${wellness.atl ?? '?'} TSS/day, Form (TSB): ${tsb != null ? Math.round(tsb) : '?'}, HRV: ${wellness.hrv ?? '?'} ms, Resting HR: ${wellness.resting_hr ?? '?'} bpm`
    : 'No fitness data available.')
    + (hrvStatus ? '\n' + formatHrvForPrompt(hrvStatus) : '')
```

- [ ] **Step 2: `interview.ts` test update**

In `__tests__/lib/interview.test.ts`, `buildInterviewSystemPrompt` is called without `hrvStatus` — the optional param keeps existing tests green. Add one test: pass a `suppressed` `HrvStatus` and assert the prompt matches `/SUPPRESSED/`.

- [ ] **Step 3: `chat.ts`**

Add imports. Add trailing optional `hrvStatus?: HrvStatus | null` to the system-prompt builder. Replace `fitnessSection` (lines 52-54):

```ts
  const fitnessSection = (latestWellness
    ? `CTL: ${latestWellness.ctl ?? '?'}, ATL: ${latestWellness.atl ?? '?'}, Form: ${latestWellness.form ?? '?'}, HRV: ${latestWellness.hrv ?? '?'}, Resting HR: ${latestWellness.resting_hr ?? '?'}`
    : 'No wellness data.')
    + (hrvStatus ? '\n' + formatHrvForPrompt(hrvStatus) : '')
```

- [ ] **Step 4: `session-chat.ts`**

Add imports. Add trailing optional `hrvStatus?: HrvStatus | null`. Replace `fitnessSection` (lines 27-29):

```ts
  const fitnessSection = (wellness
    ? `CTL: ${wellness.ctl ?? '?'}, ATL: ${wellness.atl ?? '?'}, Form: ${tsb != null ? Math.round(tsb) : '?'}, HRV: ${wellness.hrv ?? '?'}`
    : 'No fitness data available.')
    + (hrvStatus ? '\n' + formatHrvForPrompt(hrvStatus) : '')
```

- [ ] **Step 5: Routes compute and pass `hrvStatus`**

In each of `app/api/chat/interview/route.ts`, `app/api/chat/route.ts`, `app/api/chat/session/route.ts`: add `import { fetchHrvStatus } from '@/lib/hrv/server'` and `import { IntervalsClient } from '@/lib/intervals/client'` (where not already imported). After the profile is loaded, compute:

```ts
const today = new Date().toISOString().split('T')[0]
let hrvStatus = null
if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
  const c = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  try { hrvStatus = await fetchHrvStatus(c, today) } catch { /* optional */ }
}
```

Pass `hrvStatus` as the new trailing argument to the respective builder call. (The interview route already selects `*` from `user_profile`; the chat/session routes may select limited columns — extend the `.select(...)` to include `intervals_icu_athlete_id, intervals_icu_api_key` if not already present.)

- [ ] **Step 6: Run tests + build**

Run: `npx jest interview` then `npm run build`
Expected: PASS; compiles.

- [ ] **Step 7: Commit**

```bash
git add lib/claude/interview.ts lib/claude/chat.ts lib/claude/session-chat.ts app/api/chat/interview/route.ts app/api/chat/route.ts app/api/chat/session/route.ts __tests__/lib/interview.test.ts
git commit -m "feat: enrich interview/chat/session prompts with HRV baseline status"
```

---

## Final verification

- [ ] `npx jest` — full suite green (HRV baseline, format, briefing, interview).
- [ ] `npm run build` — clean compile; `/api/hrv` registered.
- [ ] Manual (device/dev): dashboard shows the HRV chip with status; fitness page shows the HRV card + trend chart with working 3m/6m/12m selector; a forced `refresh=true` briefing reflects HRV when suppressed.
- [ ] Confirm `.claude/settings.local.json` is **not** staged in any commit.

## Notes for the implementer

- **Purity boundary:** `lib/hrv/baseline.ts` and `lib/hrv/format.ts` must stay free of `IntervalsClient`, Anthropic, Supabase, React, and DOM imports (jest runs them in a `node` env via the per-file `/** @jest-environment node */` pragma). Anything that touches `IntervalsClient` goes in `lib/hrv/server.ts`.
- **Backward compatibility:** every builder gets `hrvStatus` as an *optional trailing* parameter, so existing callers and tests keep compiling; the bare-HRV fallback stays in place for when intervals.icu is unavailable.
- **No new storage:** all HRV history is fetched live from intervals.icu; do not add tables or persistence.
