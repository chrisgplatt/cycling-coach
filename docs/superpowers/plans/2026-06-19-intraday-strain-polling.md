# Intraday Strain Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll intervals.icu every 30 minutes for today's body battery drain and surface it as a live fourth life-load signal inside the existing StrainBreakdownSheet with an "as of HH:MM" timestamp.

**Architecture:** A new lightweight API route fetches just today's wellness record from intervals.icu. A custom React hook polls it every 30 minutes and computes battery drain (BodyBatteryMax − BodyBatteryMin). The strain life-load formula gains a `batteryDrain` parameter that participates when the reading is post-8am. StrainBreakdownSheet accepts an optional `liveOverride` prop that triggers recomputation and shows a drain row plus "as of" tag.

**Tech Stack:** Next.js App Router, React hook with `setInterval`, Jest/jsdom

## Global Constraints

- Mobile-first PWA — no UI additions that assume hover or fixed widths
- All intervals.icu field names use the same alias chain as `IntervalsClient.getWellness()` — never assume a single key name
- New parameters to shared functions must default to `null` so all existing call-sites remain valid without changes
- Test environment: `/** @jest-environment node */` on lib tests; run with `npx jest <path>`

---

### Task 1: Extend `lib/strain.ts` with battery drain signal

**Files:**
- Modify: `lib/strain.ts`
- Modify: `__tests__/lib/strain.test.ts`

**Interfaces:**
- Produces:
  - `STRAIN_BATTERY_DRAIN_WEIGHT = 1.5` (exported constant)
  - `computeDailyLifeLoad(sleepScore, bodyBatteryHigh, sleepSecs?, batteryDrain?)` — fourth optional param, defaults null
  - `StrainComponents` gains two new fields: `batteryDrainRawPts: number` and `batteryDrain: number | null`
  - `computeStrainComponents(activityLoad, sleepScore, bodyBatteryHigh, sleepSecs?, batteryDrain?)` — fifth optional param, defaults null

---

- [ ] **Step 1: Add new tests that currently fail**

Open `__tests__/lib/strain.test.ts` and add the following tests inside the existing `describe('computeDailyLifeLoad', ...)` block, after the last existing test:

```ts
test('battery drain alone contributes life load', () => {
  // drain=50 → (50/100)*1.5=0.75, avail=1.5 → (0.75/1.5)*7=3.5
  expect(computeDailyLifeLoad(null, null, null, 50)).toBeCloseTo(3.5, 1)
})

test('battery drain combined with sleep score', () => {
  // sleep=85→(15/100)*2=0.3, drain=50→(50/100)*1.5=0.75; raw=1.05, avail=3.5 → (1.05/3.5)*7=2.1
  expect(computeDailyLifeLoad(85, null, null, 50)).toBeCloseTo(2.1, 1)
})

test('zero drain contributes nothing', () => {
  // drain=0 → 0, avail=1.5 → (0/1.5)*7=0
  expect(computeDailyLifeLoad(null, null, null, 0)).toBeCloseTo(0, 4)
})

test('all four null → null', () => {
  expect(computeDailyLifeLoad(null, null, null, null)).toBeNull()
})
```

And inside the existing `describe('computeStrainComponents', ...)` block, after the last existing test:

```ts
test('batteryDrainRawPts for 50pt drain', () => {
  // drain=50 → (50/100)*1.5=0.75
  const c = computeStrainComponents(0, null, null, null, 50)!
  expect(c.batteryDrainRawPts).toBeCloseTo(0.75, 2)
  expect(c.batteryDrain).toBe(50)
})

test('batteryDrainRawPts is 0 when drain is null', () => {
  const c = computeStrainComponents(0, null, null, null, null)!
  expect(c.batteryDrainRawPts).toBe(0)
  expect(c.batteryDrain).toBeNull()
})

test('drain adds to total strain', () => {
  // sleep=85,battery=75 → lifePts≈1.35 without drain
  // with drain=50 → sleep 0.3 + battery 0.375 + drain 0.75 = 1.425, avail=5.0 → (1.425/5.0)*7≈1.995
  const withDrain = computeStrainComponents(75, 85, 75, null, 50)!
  const withoutDrain = computeStrainComponents(75, 85, 75, null, null)!
  expect(withDrain.total).toBeGreaterThanOrEqual(withoutDrain.total)
  expect(withDrain.batteryDrainRawPts).toBeCloseTo(0.75, 2)
})
```

- [ ] **Step 2: Verify tests fail**

```
npx jest __tests__/lib/strain.test.ts --no-coverage
```

Expected: several FAIL lines for the new tests (function signatures don't accept the new parameter yet). Existing tests should still pass.

- [ ] **Step 3: Update `lib/strain.ts`**

Replace the entire file content with the following (every change is additive or extends an existing signature):

```ts
export const STRAIN_TRAINING_LOAD_MAX = 150
export const STRAIN_NONPOWER_LOAD_MAX = 50
export const STRAIN_WORKOUT_WEIGHT = 14
export const STRAIN_LIFE_WEIGHT = 7

export const STRAIN_SLEEP_WEIGHT = 2.0
export const STRAIN_BATTERY_WEIGHT = 1.5
export const STRAIN_BATTERY_DRAIN_WEIGHT = 1.5
export const STRAIN_SLEEP_DURATION_WEIGHT = 1.0
export const STRAIN_SLEEP_DURATION_TARGET_SECS = 27000
export const STRAIN_SLEEP_DURATION_MIN_SECS = 18000

function sleepDurationScore(secs: number): number {
  return Math.max(0, Math.min(100,
    ((secs - STRAIN_SLEEP_DURATION_MIN_SECS) /
     (STRAIN_SLEEP_DURATION_TARGET_SECS - STRAIN_SLEEP_DURATION_MIN_SECS)) * 100,
  ))
}

export function computeDailyActivityLoad(
  activities: Array<{
    start_date_local: string
    training_load: number | null
    weighted_average_watts: number | null
    rolling_ftp: number | null
  }>,
  date: string,
  ftpWatts?: number | null,
): number {
  const nonPowerScale = STRAIN_TRAINING_LOAD_MAX / STRAIN_NONPOWER_LOAD_MAX
  return activities
    .filter(a => a.start_date_local.startsWith(date))
    .reduce((sum, a) => {
      const load = a.training_load ?? 0
      if (load === 0) return sum
      const ftp = ftpWatts ?? a.rolling_ftp
      if (a.weighted_average_watts && ftp && ftp > 0) {
        const intensityFactor = Math.min(1.5, a.weighted_average_watts / ftp)
        return sum + load * intensityFactor
      }
      return sum + load * nonPowerScale
    }, 0)
}

// Compute the life component of daily strain (0–7) from Garmin wellness signals.
// batteryDrain (BodyBatteryMax - BodyBatteryMin) is an optional fourth signal
// representing in-day cardiovascular drain; only used when the reading is from a
// post-8am live poll (caller's responsibility to enforce).
export function computeDailyLifeLoad(
  sleepScore: number | null,
  bodyBatteryHigh: number | null,
  sleepSecs: number | null = null,
  batteryDrain: number | null = null,
): number | null {
  if (sleepScore == null && bodyBatteryHigh == null && sleepSecs == null && batteryDrain == null) return null
  let rawScore = 0
  let availableWeight = 0
  if (sleepScore != null) {
    rawScore += ((100 - sleepScore) / 100) * STRAIN_SLEEP_WEIGHT
    availableWeight += STRAIN_SLEEP_WEIGHT
  }
  if (sleepSecs != null) {
    rawScore += ((100 - sleepDurationScore(sleepSecs)) / 100) * STRAIN_SLEEP_DURATION_WEIGHT
    availableWeight += STRAIN_SLEEP_DURATION_WEIGHT
  }
  if (bodyBatteryHigh != null) {
    rawScore += ((100 - bodyBatteryHigh) / 100) * STRAIN_BATTERY_WEIGHT
    availableWeight += STRAIN_BATTERY_WEIGHT
  }
  if (batteryDrain != null) {
    rawScore += (batteryDrain / 100) * STRAIN_BATTERY_DRAIN_WEIGHT
    availableWeight += STRAIN_BATTERY_DRAIN_WEIGHT
  }
  return availableWeight > 0 ? (rawScore / availableWeight) * STRAIN_LIFE_WEIGHT : null
}

export interface StrainComponents {
  total: number
  workoutPts: number
  workoutLoad: number
  lifePts: number
  sleepRawPts: number
  sleepDurationRawPts: number
  batteryRawPts: number
  batteryDrainRawPts: number
  sleepScore: number | null
  sleepSecs: number | null
  bodyBatteryHigh: number | null
  batteryDrain: number | null
}

export function computeStrainComponents(
  activityLoad: number | null,
  sleepScore: number | null,
  bodyBatteryHigh: number | null,
  sleepSecs: number | null = null,
  batteryDrain: number | null = null,
): StrainComponents | null {
  if (activityLoad == null && sleepScore == null && bodyBatteryHigh == null && sleepSecs == null && batteryDrain == null) return null
  const load = activityLoad ?? 0
  const workoutPts = Math.min(STRAIN_WORKOUT_WEIGHT, (load / STRAIN_TRAINING_LOAD_MAX) * STRAIN_WORKOUT_WEIGHT)
  let sleepRawPts = 0
  let sleepDurationRawPts = 0
  let batteryRawPts = 0
  let batteryDrainRawPts = 0
  let availableWeight = 0
  if (sleepScore != null) {
    sleepRawPts = ((100 - sleepScore) / 100) * STRAIN_SLEEP_WEIGHT
    availableWeight += STRAIN_SLEEP_WEIGHT
  }
  if (sleepSecs != null) {
    sleepDurationRawPts = ((100 - sleepDurationScore(sleepSecs)) / 100) * STRAIN_SLEEP_DURATION_WEIGHT
    availableWeight += STRAIN_SLEEP_DURATION_WEIGHT
  }
  if (bodyBatteryHigh != null) {
    batteryRawPts = ((100 - bodyBatteryHigh) / 100) * STRAIN_BATTERY_WEIGHT
    availableWeight += STRAIN_BATTERY_WEIGHT
  }
  if (batteryDrain != null) {
    batteryDrainRawPts = (batteryDrain / 100) * STRAIN_BATTERY_DRAIN_WEIGHT
    availableWeight += STRAIN_BATTERY_DRAIN_WEIGHT
  }
  const rawLife = sleepRawPts + sleepDurationRawPts + batteryRawPts + batteryDrainRawPts
  const lifePts = availableWeight > 0 ? (rawLife / availableWeight) * STRAIN_LIFE_WEIGHT : 0
  const total = Math.min(21, Math.round(workoutPts + lifePts))
  return {
    total, workoutPts, workoutLoad: load, lifePts,
    sleepRawPts, sleepDurationRawPts, batteryRawPts, batteryDrainRawPts,
    sleepScore, sleepSecs, bodyBatteryHigh, batteryDrain,
  }
}

export function computeDailyStrain(
  activityLoad: number | null,
  lifeLoad: number | null,
): number | null {
  if (activityLoad == null && lifeLoad == null) return null
  if ((activityLoad == null || activityLoad === 0) && lifeLoad == null) return null
  const workout = ((activityLoad ?? 0) / STRAIN_TRAINING_LOAD_MAX) * STRAIN_WORKOUT_WEIGHT
  const life = lifeLoad ?? 0
  return Math.min(21, Math.round(workout + life))
}

export function strainLabel(score: number): 'low' | 'moderate' | 'high' {
  if (score < 9) return 'low'
  if (score <= 14) return 'moderate'
  return 'high'
}

export function formatStrainForPrompt(
  strain: number | null,
  sleepScore?: number | null,
  bodyBatteryHigh?: number | null,
  sleepSecs?: number | null,
): string {
  if (strain == null) return ''
  const parts: string[] = []
  if (sleepScore != null && sleepScore < 70) parts.push(`sleep ${sleepScore}/100`)
  if (sleepSecs != null && sleepSecs < 21600) parts.push(`slept ${(sleepSecs / 3600).toFixed(1)}h`)
  if (bodyBatteryHigh != null && bodyBatteryHigh < 50) parts.push(`body battery peak ${bodyBatteryHigh}%`)
  const context = parts.length ? ` — ${parts.join(', ')}` : ''
  return `Daily Strain: ${strain}/21 (${strainLabel(strain)})${context}`
}

export function formatStrainHistoryForPrompt(
  history: Array<{ date: string; strain: number | null }>,
): string {
  if (history.length < 2) return ''
  const scores = history.map(h => h.strain)
  const valid = scores.filter((s): s is number => s != null)
  if (!valid.length) return ''
  const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
  const recent = scores.slice(-3).filter((s): s is number => s != null)
  const earlier = scores.slice(0, 4).filter((s): s is number => s != null)
  const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0
  const earlierAvg = earlier.length ? earlier.reduce((a, b) => a + b, 0) / earlier.length : 0
  const trend = recentAvg > earlierAvg + 2 ? 'rising' : recentAvg < earlierAvg - 2 ? 'falling' : 'stable'
  const vals = scores.map(s => (s == null ? '—' : String(s))).join(' ')
  return `Strain (last ${scores.length} days): ${vals} (avg: ${avg}, trend: ${trend})`
}
```

- [ ] **Step 4: Run all strain tests**

```
npx jest __tests__/lib/strain.test.ts --no-coverage
```

Expected: all tests pass including the new ones.

- [ ] **Step 5: Commit**

```bash
git add lib/strain.ts __tests__/lib/strain.test.ts
git commit -m "feat(strain): add battery drain as fourth life-load signal"
```

---

### Task 2: Add `/api/wellness/today` endpoint

**Files:**
- Create: `app/api/wellness/today/route.ts`

**Interfaces:**
- Produces: `GET /api/wellness/today` → `{ today: WellnessTodayResult | null }`
  ```ts
  interface WellnessTodayResult {
    id: string
    updated: string | null
    bodyBatteryMax: number | null
    bodyBatteryMin: number | null
    sleepScore: number | null
    sleepSecs: number | null
    restingHR: number | null
    steps: number | null
  }
  ```

---

- [ ] **Step 1: Create the route file**

Create `app/api/wellness/today/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

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
  const url = `https://intervals.icu/api/v1/athlete/${profile.intervals_icu_athlete_id}/wellness?start=${today}&end=${today}`

  const res = await fetch(url, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`API_KEY:${profile.intervals_icu_api_key}`).toString('base64'),
    },
    next: { revalidate: 0 },
  })

  if (!res.ok) return NextResponse.json({ error: `intervals.icu returned ${res.status}` }, { status: 502 })

  const raw = await res.json()
  const w = Array.isArray(raw) ? (raw[0] ?? null) : null

  if (!w) return NextResponse.json({ today: null })

  return NextResponse.json({
    today: {
      id: w.id as string,
      updated: (w.updated ?? null) as string | null,
      bodyBatteryMax: (w.BodyBatteryMax ?? w.bodyBatteryMax ?? w.bodyBatteryHigh ?? w.body_battery_high ?? null) as number | null,
      bodyBatteryMin: (w.BodyBatteryMin ?? w.bodyBatteryMin ?? w.bodyBatteryLow ?? w.body_battery_low ?? null) as number | null,
      sleepScore: (w.sleepScore ?? w.sleep_score ?? null) as number | null,
      sleepSecs: (w.sleepSecs ?? w.sleep_secs ?? null) as number | null,
      restingHR: (w.restingHR ?? w.resting_hr ?? null) as number | null,
      steps: (w.steps ?? null) as number | null,
    },
  })
}
```

- [ ] **Step 2: Smoke-test the endpoint manually**

With the dev server running (`npm run dev`), open your browser while logged in and visit:

```
http://localhost:3000/api/wellness/today
```

Expected: JSON with `today` object containing `bodyBatteryMax`, `bodyBatteryMin`, etc. matching what `/api/debug/wellness-raw` returns. Confirm `bodyBatteryMax` and `bodyBatteryMin` are numbers, not null.

- [ ] **Step 3: Commit**

```bash
git add app/api/wellness/today/route.ts
git commit -m "feat: add /api/wellness/today endpoint for intraday battery polling"
```

---

### Task 3: Add `useIntradayWellness` hook

**Files:**
- Create: `hooks/useIntradayWellness.ts`

**Interfaces:**
- Consumes: `GET /api/wellness/today` → `{ today: WellnessTodayResult | null }` (from Task 2)
- Produces:
  ```ts
  interface IntradayWellness {
    bodyBatteryMax: number | null
    bodyBatteryMin: number | null
    batteryDrain: number | null   // Math.max(0, max - min), null if either missing
    asOf: Date | null             // timestamp of last successful poll
    isPostWake: boolean           // local hour >= 8 at time of last poll
  }
  function useIntradayWellness(): IntradayWellness
  ```

---

- [ ] **Step 1: Create the hooks directory and hook file**

Create `hooks/useIntradayWellness.ts`:

```ts
'use client'
import { useState, useEffect } from 'react'

export interface IntradayWellness {
  bodyBatteryMax: number | null
  bodyBatteryMin: number | null
  batteryDrain: number | null
  asOf: Date | null
  isPostWake: boolean
}

const POLL_INTERVAL_MS = 30 * 60 * 1000

export function useIntradayWellness(): IntradayWellness {
  const [state, setState] = useState<IntradayWellness>({
    bodyBatteryMax: null,
    bodyBatteryMin: null,
    batteryDrain: null,
    asOf: null,
    isPostWake: false,
  })

  useEffect(() => {
    let cancelled = false

    async function poll() {
      const isPostWake = new Date().getHours() >= 8
      try {
        const res = await fetch('/api/wellness/today')
        if (!res.ok || cancelled) return
        const json = await res.json()
        const today = json.today
        if (!today || cancelled) return
        const max: number | null = today.bodyBatteryMax ?? null
        const min: number | null = today.bodyBatteryMin ?? null
        const drain = max !== null && min !== null ? Math.max(0, max - min) : null
        setState({ bodyBatteryMax: max, bodyBatteryMin: min, batteryDrain: drain, asOf: new Date(), isPostWake })
      } catch {
        // silent on network failure — keep previous state
      }
    }

    poll()
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return state
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors in `hooks/useIntradayWellness.ts`.

- [ ] **Step 3: Commit**

```bash
git add hooks/useIntradayWellness.ts
git commit -m "feat: add useIntradayWellness polling hook"
```

---

### Task 4: Update `StrainBreakdownSheet` with live override

**Files:**
- Modify: `components/StrainBreakdownSheet.tsx`

**Interfaces:**
- Consumes:
  - `computeStrainComponents(activityLoad, sleepScore, bodyBatteryHigh, sleepSecs, batteryDrain?)` (Task 1)
  - `IntradayWellness` shape: `{ batteryDrain, asOf, isPostWake }` (Task 3)
- The `liveOverride` prop is optional — all existing render paths must work when it is omitted

---

- [ ] **Step 1: Replace `components/StrainBreakdownSheet.tsx`**

```tsx
'use client'
import { computeStrainComponents, strainLabel, STRAIN_WORKOUT_WEIGHT, STRAIN_LIFE_WEIGHT } from '@/lib/strain'
import type { ICUWellness } from '@/types'

interface LiveOverride {
  batteryDrain: number | null
  asOf: Date | null
  isPostWake: boolean
}

interface Props {
  wellness: ICUWellness
  activitySummary?: string
  onClose: () => void
  liveOverride?: LiveOverride
}

const BAND_BG: Record<string, string> = {
  low: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  high: 'bg-red-500',
}

export default function StrainBreakdownSheet({ wellness, activitySummary, onClose, liveOverride }: Props) {
  const liveDrain = liveOverride?.isPostWake ? (liveOverride.batteryDrain ?? null) : null

  const c = computeStrainComponents(
    wellness.garmin_training_load,
    wellness.sleep_score,
    wellness.body_battery_high,
    wellness.sleep_secs,
    liveDrain,
  )
  if (!c) return null

  const totalStrain = c.total
  const label = strainLabel(totalStrain)

  const asOfLabel = liveOverride?.asOf
    ? liveOverride.asOf.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  // Donut: use raw un-normalised pts as fractions of 21 for proportional arcs
  const d = 21
  const w  = (c.workoutPts          / d) * 100
  const sl = (c.sleepRawPts         / d) * 100
  const sd = (c.sleepDurationRawPts / d) * 100
  const b  = (c.batteryRawPts       / d) * 100
  const dr = (c.batteryDrainRawPts  / d) * 100
  const donut = `conic-gradient(#3b82f6 0% ${w}%, #8b5cf6 ${w}% ${w+sl}%, #a78bfa ${w+sl}% ${w+sl+sd}%, #10b981 ${w+sl+sd}% ${w+sl+sd+b}%, #f97316 ${w+sl+sd+b}% ${w+sl+sd+b+dr}%, #e2e8f0 ${w+sl+sd+b+dr}% 100%)`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40"
        role="button"
        tabIndex={0}
        aria-label="Close"
        onClick={onClose}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClose() }}
      />
      <div className="relative bg-white w-full max-w-sm rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 pb-5 pt-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em] mb-1">
                Strain Breakdown
              </p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-gray-900">{totalStrain}</span>
                <span className="text-sm text-gray-400">/ 21</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white ${BAND_BG[label]}`}>
                  {label.charAt(0).toUpperCase() + label.slice(1)}
                </span>
              </div>
              {asOfLabel && (
                <p className="text-[10px] font-medium text-gray-400 mt-0.5">as of {asOfLabel}</p>
              )}
            </div>
            {/* Donut ring */}
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: donut }}
            >
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-base font-black text-gray-900">
                {totalStrain}
              </div>
            </div>
          </div>

          {/* Workout bar */}
          <div className="mb-4">
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-sm font-semibold text-gray-800">Workout load</span>
              <span className="text-sm font-bold text-blue-600">
                {(Math.round(c.workoutPts * 10) / 10).toFixed(1)}
                <span className="text-xs font-normal text-gray-400"> / {STRAIN_WORKOUT_WEIGHT} pts</span>
              </span>
            </div>
            <div className="h-2 bg-blue-50 rounded-full mb-1.5">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, (c.workoutPts / STRAIN_WORKOUT_WEIGHT) * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-400">
              {activitySummary ?? (c.workoutLoad > 0 ? `${Math.round(c.workoutLoad)} TSS` : 'no activity recorded')}
            </p>
          </div>

          <div className="border-t border-gray-100 mb-4" />

          {/* Wellbeing bar */}
          <div>
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-sm font-semibold text-gray-800">Wellbeing</span>
              <span className="text-sm font-bold text-amber-500">
                {(Math.round(c.lifePts * 10) / 10).toFixed(1)}
                <span className="text-xs font-normal text-gray-400"> / {STRAIN_LIFE_WEIGHT} pts</span>
              </span>
            </div>
            <div className="h-2 bg-amber-50 rounded-full mb-3">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (c.lifePts / STRAIN_LIFE_WEIGHT) * 100)}%`,
                  background: 'linear-gradient(90deg, #f59e0b, #fb923c)',
                }}
              />
            </div>

            {/* Sub-signal rows */}
            <div className="space-y-2.5 pl-1">
              {/* Sleep quality */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.sleepScore != null ? 'bg-violet-400' : 'bg-gray-200'}`} />
                {c.sleepScore != null ? (
                  <span className="text-xs text-gray-700">
                    Sleep quality <span className="text-gray-400">score {c.sleepScore} / 100</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Sleep quality <em>not synced</em></span>
                )}
              </div>
              {/* Sleep duration */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.sleepSecs != null ? 'bg-violet-300' : 'bg-gray-200'}`} />
                {c.sleepSecs != null ? (
                  <span className="text-xs text-gray-700">
                    Sleep duration <span className="text-gray-400">{(c.sleepSecs / 3600).toFixed(1)}h</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Sleep duration <em>not synced</em></span>
                )}
              </div>
              {/* Body battery peak */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.bodyBatteryHigh != null ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                {c.bodyBatteryHigh != null ? (
                  <span className="text-xs text-gray-700">
                    Body battery <span className="text-gray-400">peak {c.bodyBatteryHigh}%</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Body battery <em>not synced</em></span>
                )}
              </div>
              {/* Battery drain — only shown when live post-wake reading available */}
              {liveOverride?.isPostWake && liveOverride.batteryDrain !== null && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-orange-400" />
                  <span className="text-xs text-gray-700">
                    Battery drain{' '}
                    <span className="text-gray-400">
                      {liveOverride.batteryDrain === 0 ? 'no drain' : `${liveOverride.batteryDrain} pt drop`}
                    </span>
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end mt-5">
            <button
              onClick={onClose}
              className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/StrainBreakdownSheet.tsx
git commit -m "feat(StrainBreakdownSheet): add live battery drain row and as-of timestamp"
```

---

### Task 5: Wire hook into dashboard

**Files:**
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes:
  - `useIntradayWellness()` → `IntradayWellness` (Task 3)
  - `StrainBreakdownSheet` `liveOverride` prop (Task 4)

---

- [ ] **Step 1: Add import and hook call**

In `app/dashboard/page.tsx`, add the import alongside the existing imports at the top of the file:

```ts
import { useIntradayWellness } from '@/hooks/useIntradayWellness'
```

Then, inside the dashboard component function, add after the existing `useState` declarations (around line 115):

```ts
const intradayWellness = useIntradayWellness()
```

- [ ] **Step 2: Pass `liveOverride` to `StrainBreakdownSheet`**

Find the existing `<StrainBreakdownSheet>` render (currently around line 824–829):

```tsx
{strainSheetOpen && latestWellnessWithLoad && (
  <StrainBreakdownSheet
    wellness={latestWellnessWithLoad}
    activitySummary={activitySummary}
    onClose={() => setStrainSheetOpen(false)}
  />
)}
```

Replace with:

```tsx
{strainSheetOpen && latestWellnessWithLoad && (
  <StrainBreakdownSheet
    wellness={latestWellnessWithLoad}
    activitySummary={activitySummary}
    onClose={() => setStrainSheetOpen(false)}
    liveOverride={intradayWellness}
  />
)}
```

- [ ] **Step 3: Verify TypeScript compiles and run tests**

```
npx tsc --noEmit && npx jest __tests__/lib/strain.test.ts --no-coverage
```

Expected: no type errors, all strain tests pass.

- [ ] **Step 4: Manual verification**

With `npm run dev` running:
1. Open the dashboard, wait for data to load
2. Tap the strain band in the MetricsBar
3. The StrainBreakdownSheet should open showing:
   - "Strain Breakdown" header
   - Score with "as of HH:MM" tag below it (if it's after 8am)
   - Battery drain row in the Wellbeing section showing e.g. "35 pt drop"
   - The donut ring with an orange segment for drain

- [ ] **Step 5: Commit and push**

```bash
git add app/dashboard/page.tsx
git commit -m "feat(dashboard): wire useIntradayWellness into StrainBreakdownSheet"
git push
```
