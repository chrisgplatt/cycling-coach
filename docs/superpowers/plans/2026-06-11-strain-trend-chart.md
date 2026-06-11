# Strain Trend Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible strain trend chart inside MetricsBar showing daily strain history (life + workout stacked bars + total line) with 1W / 1M / 3M tabs.

**Architecture:** Extend `ChartsData` with `dailyStrain`, compute it in `/api/charts`, lift the fetch to the dashboard, and render an inline SVG chart as a collapsible footer inside `MetricsBar`.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, inline SVG, `lib/strain.ts`, `lib/chart-helpers.ts`

---

## File map

| File | Change |
|------|--------|
| `types/index.ts` | Add `DailyStrainPoint` interface; extend `ChartsData` |
| `app/api/charts/route.ts` | Add `current_ftp` to select; compute `dailyStrain` array |
| `components/CtlTrendStrip.tsx` | Accept optional `chartsData?: ChartsData` prop; skip self-fetch if provided |
| `app/dashboard/page.tsx` | Fetch `/api/charts` once; pass `chartsData` to `CtlTrendStrip` and `strainHistory` to `MetricsBar` |
| `components/MetricsBar.tsx` | Accept `strainHistory?` prop; add collapsible SVG chart section |

---

## Task 1 — Add DailyStrainPoint type and extend ChartsData

**Files:**
- Modify: `types/index.ts` (lines around 325–329)

- [ ] **Step 1: Add DailyStrainPoint interface**

Open `types/index.ts`. Insert the new interface directly before `ChartsData`:

```ts
export interface DailyStrainPoint {
  date: string    // YYYY-MM-DD
  workout: number // workout contribution 0–14 (float)
  life: number    // life signal contribution 0–7 (float)
  total: number   // rounded combined strain score 0–21
}
```

- [ ] **Step 2: Extend ChartsData**

Change:
```ts
export interface ChartsData {
  wellness: ICUWellness[]
  weeklyTss: WeeklyTss[]
  rides: RidePoint[]
}
```

To:
```ts
export interface ChartsData {
  wellness: ICUWellness[]
  weeklyTss: WeeklyTss[]
  rides: RidePoint[]
  dailyStrain: DailyStrainPoint[]
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`

Expected: errors only in files that use `ChartsData` without the new field (will fix in subsequent tasks). Zero errors from `types/index.ts` itself.

- [ ] **Step 4: Commit**

```
git add types/index.ts
git commit -m "feat: add DailyStrainPoint type and extend ChartsData

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2 — Compute dailyStrain in /api/charts

**Files:**
- Modify: `app/api/charts/route.ts`

- [ ] **Step 1: Add strain imports at top of file**

The file currently imports from `@/lib/chart-helpers`. Add strain helpers:

```ts
import {
  computeDailyActivityLoad,
  computeDailyLifeLoad,
  computeDailyStrain,
  STRAIN_TRAINING_LOAD_MAX,
  STRAIN_WORKOUT_WEIGHT,
} from '@/lib/strain'
import type { DailyStrainPoint } from '@/types'
```

Add these after the existing imports.

- [ ] **Step 2: Add current_ftp to the profile select**

Change:
```ts
  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()
```

To:
```ts
  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp')
    .maybeSingle()
```

- [ ] **Step 3: Compute dailyStrain after the existing weeklyTss and rides blocks**

Insert after the `rides` array is built but before the `charts` object is assembled:

```ts
    // Daily strain — combine per-day activity load with wellness life signals
    const ftp: number | null = (profile as { current_ftp?: number | null }).current_ftp ?? null
    const dailyStrain: DailyStrainPoint[] = wellness
      .map(w => {
        const activityLoad = computeDailyActivityLoad(activities, w.id, ftp)
        const lifeLoad = computeDailyLifeLoad(
          w.stress_avg,
          w.stress_high ?? null,
          w.sleep_score,
          w.body_battery_low,
        )
        const workoutPts = Math.min(
          STRAIN_WORKOUT_WEIGHT,
          (activityLoad / STRAIN_TRAINING_LOAD_MAX) * STRAIN_WORKOUT_WEIGHT,
        )
        const lifePts = lifeLoad ?? 0
        const total = computeDailyStrain(activityLoad, lifeLoad) ?? 0
        return { date: w.id, workout: workoutPts, life: lifePts, total }
      })
      .filter(p => p.total > 0 || p.life > 0 || p.workout > 0)
```

- [ ] **Step 4: Include dailyStrain in the returned charts object**

Change:
```ts
    const charts: ChartsData = { wellness, weeklyTss, rides }
```

To:
```ts
    const charts: ChartsData = { wellness, weeklyTss, rides, dailyStrain }
```

- [ ] **Step 5: Check stress_high field**

`ICUWellness` in `types/index.ts` has `stress_avg` and `stress_high` fields. Verify:

Run: `grep -n "stress_high" types/index.ts`

Expected output: a line showing `stress_high: number | null` inside `ICUWellness`. If the field doesn't exist, add it — otherwise the `?? null` cast above ensures safety.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "api/charts" | head -20`

Expected: no errors in `app/api/charts/route.ts`.

- [ ] **Step 7: Smoke test the endpoint**

Start dev server if not running: `npm run dev`

In a browser or with curl, visit `/api/charts` while logged in. Confirm `charts.dailyStrain` appears in the response as an array of `{date, workout, life, total}` objects.

- [ ] **Step 8: Commit**

```
git add app/api/charts/route.ts
git commit -m "feat: compute dailyStrain in /api/charts route

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3 — Lift /api/charts fetch to dashboard; thread chartsData into CtlTrendStrip

**Files:**
- Modify: `components/CtlTrendStrip.tsx`
- Modify: `app/dashboard/page.tsx`

### 3a — CtlTrendStrip: accept optional chartsData prop

- [ ] **Step 1: Update CtlTrendStrip prop signature**

Change:
```ts
export default function CtlTrendStrip({ embedded = false }: { embedded?: boolean }) {
  const [data, setData] = useState<ChartsData | null>(null)
  const [range, setRange] = useState<Range>('1m')

  useEffect(() => {
    fetch('/api/charts')
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d?.charts ?? null))
      .catch(() => setData(null))
  }, [])
```

To:
```ts
export default function CtlTrendStrip({
  embedded = false,
  chartsData,
}: {
  embedded?: boolean
  chartsData?: ChartsData | null
}) {
  const [fetched, setFetched] = useState<ChartsData | null>(null)
  const [range, setRange] = useState<Range>('1m')

  useEffect(() => {
    if (chartsData !== undefined) return   // skip self-fetch when data is provided
    fetch('/api/charts')
      .then(r => r.ok ? r.json() : null)
      .then(d => setFetched(d?.charts ?? null))
      .catch(() => setFetched(null))
  }, [chartsData])

  const data = chartsData ?? fetched
```

Everywhere below in the component, `data` is used unchanged — no other edits needed in this file.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "CtlTrendStrip" | head -10`

Expected: no errors.

### 3b — Dashboard: fetch charts once, pass to both components

- [ ] **Step 3: Add chartsData state to dashboard page**

Find the existing state declarations near the top of the default export in `app/dashboard/page.tsx`. Add:

```ts
const [chartsData, setChartsData] = useState<import('@/types').ChartsData | null>(null)
```

- [ ] **Step 4: Add useEffect to fetch /api/charts**

After the existing useEffect hooks, add:

```ts
useEffect(() => {
  fetch('/api/charts')
    .then(r => r.ok ? r.json() : null)
    .then(d => setChartsData(d?.charts ?? null))
    .catch(() => setChartsData(null))
}, [])
```

- [ ] **Step 5: Pass chartsData to CtlTrendStrip**

Find:
```tsx
<CtlTrendStrip embedded />
```

Change to:
```tsx
<CtlTrendStrip embedded chartsData={chartsData} />
```

- [ ] **Step 6: Pass strainHistory to MetricsBar**

Find the `<MetricsBar` render (around line 434). It currently has props: `wellness`, `syncedAt`, `stale`, `lastRideLabel`, `onStrainTap`. Add `strainHistory`:

```tsx
<MetricsBar
  wellness={latestWellnessWithLoad}
  syncedAt={lastSyncedAt}
  stale={wellnessStale}
  lastRideLabel={lastRideLabel}
  onStrainTap={() => setStrainSheetOpen(true)}
  strainHistory={chartsData?.dailyStrain}
/>
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "dashboard|CtlTrend" | head -20`

Expected: no errors (MetricsBar will error until Task 4 adds the prop — that's acceptable; fix in sequence).

- [ ] **Step 8: Commit**

```
git add components/CtlTrendStrip.tsx app/dashboard/page.tsx
git commit -m "feat: lift /api/charts fetch to dashboard, thread into CtlTrendStrip

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4 — Add collapsible strain trend chart to MetricsBar

**Files:**
- Modify: `components/MetricsBar.tsx`

This is the largest task. Implement it in sub-steps.

### 4a — Props and state

- [ ] **Step 1: Add strainHistory prop and internal state**

Add `DailyStrainPoint` to the import at the top of `MetricsBar.tsx`:

```ts
import type { ICUWellness, DailyStrainPoint } from '@/types'
```

Add `useState` to the React imports:
```ts
import { useState } from 'react'
```

Update the component signature from:
```ts
export default function MetricsBar({
  wellness,
  syncedAt = null,
  stale = {},
  embedded = false,
  lastRideLabel,
  onStrainTap,
}: {
  wellness: ICUWellness | null
  syncedAt?: Date | null
  stale?: { hrv?: boolean; restingHr?: boolean }
  embedded?: boolean
  lastRideLabel?: string
  onStrainTap?: () => void
}) {
```

To:
```ts
export default function MetricsBar({
  wellness,
  syncedAt = null,
  stale = {},
  embedded = false,
  lastRideLabel,
  onStrainTap,
  strainHistory,
}: {
  wellness: ICUWellness | null
  syncedAt?: Date | null
  stale?: { hrv?: boolean; restingHr?: boolean }
  embedded?: boolean
  lastRideLabel?: string
  onStrainTap?: () => void
  strainHistory?: DailyStrainPoint[]
}) {
```

Add after the existing `const strainCategory` line:
```ts
  const [trendOpen, setTrendOpen] = useState(false)
  const [trendTab, setTrendTab] = useState<'1w' | '1m' | '3m'>('1w')
  const hasStrainHistory = (strainHistory?.length ?? 0) > 0
```

### 4b — Helper functions (add inside the file, before the component or as module-level functions)

- [ ] **Step 2: Add isoWeekStart import and chart helper functions**

Add import at top of file (after the types import):
```ts
import { isoWeekStart } from '@/lib/chart-helpers'
```

Add these helper functions at the module level (outside the component, near the top of the file after the imports):

```ts
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function strainChartData(
  history: DailyStrainPoint[],
  tab: '1w' | '1m' | '3m',
): Array<{ label: string; workout: number; life: number; total: number }> {
  if (tab === '3m') {
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - 3)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const filtered = history.filter(p => p.date >= cutoffStr)
    const weekMap = new Map<string, DailyStrainPoint[]>()
    for (const p of filtered) {
      const wk = isoWeekStart(p.date)
      const arr = weekMap.get(wk) ?? []
      arr.push(p)
      weekMap.set(wk, arr)
    }
    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([wk, pts]) => {
        const [, month, day] = wk.split('-').map(Number)
        const label = `${MONTHS_SHORT[month - 1]} ${day}`
        const n = pts.length
        return {
          label,
          workout: pts.reduce((s, p) => s + p.workout, 0) / n,
          life: pts.reduce((s, p) => s + p.life, 0) / n,
          total: Math.round(pts.reduce((s, p) => s + p.total, 0) / n),
        }
      })
  }

  const days = tab === '1w' ? 7 : 30
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days + 1)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const filtered = history.filter(p => p.date >= cutoffStr)

  // Build a slot for every day in the window (fill missing days with zeros)
  const result: Array<{ label: string; workout: number; life: number; total: number }> = []
  for (let i = 0; i < days; i++) {
    const d = new Date(cutoff)
    d.setDate(cutoff.getDate() + i)
    const dateStr = d.toISOString().slice(0, 10)
    const found = filtered.find(p => p.date === dateStr)
    let label = ''
    if (tab === '1w') {
      label = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
    } else {
      // label every 7th slot
      if (i % 7 === 0) {
        label = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
      }
    }
    result.push({
      label,
      workout: found?.workout ?? 0,
      life: found?.life ?? 0,
      total: found?.total ?? 0,
    })
  }
  return result
}
```

### 4c — SVG chart component

- [ ] **Step 3: Add StrainChart component**

Add this component at the module level (outside MetricsBar, after the helper functions):

```tsx
const VW = 340, VH = 104
const PAD_L = 26, PAD_R = 6, PAD_T = 8, PAD_B = 18
const CW = VW - PAD_L - PAD_R
const CH = VH - PAD_T - PAD_B
const Y_MAX = 21

function yOf(v: number) {
  return PAD_T + (Y_MAX - v) / Y_MAX * CH
}

function StrainChart({
  data,
  tab,
}: {
  data: Array<{ label: string; workout: number; life: number; total: number }>
  tab: '1w' | '1m' | '3m'
}) {
  if (!data.length) return null
  const n = data.length
  const slot = CW / n
  const barW = Math.max(3, Math.min(22, slot * 0.65))
  const showDots = tab !== '3m' && n <= 31

  const gridLines = [0, 10, 20].map(v => {
    const y = yOf(v).toFixed(1)
    return (
      <g key={v}>
        <line
          x1={PAD_L} y1={y} x2={PAD_L + CW} y2={y}
          stroke={v === 0 ? '#e5e7eb' : '#f3f4f6'} strokeWidth="1"
        />
        <text
          x={(PAD_L - 4).toFixed(1)} y={(yOf(v) + 3).toFixed(1)}
          fontSize="7.5" fill="#9ca3af" textAnchor="end"
          fontFamily="system-ui,sans-serif"
        >
          {v}
        </text>
      </g>
    )
  })

  const bars: React.ReactNode[] = []
  const linePoints: string[] = []

  data.forEach((d, i) => {
    const cx = PAD_L + slot * i + slot / 2
    const bx = (cx - barW / 2).toFixed(1)
    const bwStr = barW.toFixed(1)

    if (d.life > 0) {
      const h = (d.life / Y_MAX * CH).toFixed(1)
      bars.push(
        <rect key={`life-${i}`}
          x={bx} y={yOf(d.life).toFixed(1)}
          width={bwStr} height={h}
          fill="#f59e0b" rx="1.5"
        />
      )
    }
    if (d.workout > 0) {
      const stackTop = d.life + d.workout
      const h = (d.workout / Y_MAX * CH).toFixed(1)
      bars.push(
        <rect key={`work-${i}`}
          x={bx} y={yOf(stackTop).toFixed(1)}
          width={bwStr} height={h}
          fill="#3b82f6" rx="1.5"
        />
      )
    }

    linePoints.push(`${cx.toFixed(1)},${yOf(d.total).toFixed(1)}`)

    if (d.label) {
      bars.push(
        <text key={`lbl-${i}`}
          x={cx.toFixed(1)} y={(VH - 2).toFixed(1)}
          fontSize={n > 10 ? '6' : '7.5'} fill="#9ca3af"
          textAnchor="middle" fontFamily="system-ui,sans-serif"
        >
          {d.label}
        </text>
      )
    }
  })

  const dots = showDots ? data.map((d, i) => {
    const cx = PAD_L + slot * i + slot / 2
    const r = n > 15 ? '1.6' : '2.4'
    return (
      <circle key={`dot-${i}`}
        cx={cx.toFixed(1)} cy={yOf(d.total).toFixed(1)}
        r={r} fill="#fff" stroke="#374151" strokeWidth="1.4"
      />
    )
  }) : null

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
      {gridLines}
      {bars}
      {linePoints.length > 1 && (
        <polyline
          points={linePoints.join(' ')}
          fill="none" stroke="#374151" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round"
        />
      )}
      {dots}
    </svg>
  )
}
```

### 4d — Toggle row and expanded section in MetricsBar JSX

- [ ] **Step 4: Add toggle row and chart section to the MetricsBar return**

The MetricsBar return currently ends with:
```tsx
      <div className="flex divide-x divide-gray-100">
        <Metric ... />
        ...
      </div>
    </div>
  )
```

Add the toggle row and expanded section after the metrics row, just before the outer closing `</div>`:

```tsx
      {hasStrainHistory && (
        <>
          {/* Collapsed / expanded toggle */}
          <div
            className="flex items-center justify-between px-3.5 py-2 cursor-pointer select-none"
            onClick={() => setTrendOpen(o => !o)}
          >
            <span className={`text-[11px] font-bold uppercase tracking-[0.06em] ${trendOpen ? 'text-gray-600' : 'text-gray-400'}`}>
              Strain trend
            </span>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              {trendOpen
                ? <path d="M3 9l4-4 4 4" stroke={trendOpen ? '#4b5563' : '#9ca3af'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                : <path d="M3 5l4 4 4-4" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              }
            </svg>
          </div>

          {trendOpen && (
            <div className="border-t border-gray-100">
              {/* Tab pills */}
              <div className="flex gap-1 px-3 pt-2.5 pb-1">
                {(['1w', '1m', '3m'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTrendTab(t)}
                    className={`text-[11px] font-bold uppercase tracking-[0.06em] px-2 py-1 rounded-full transition-colors ${
                      trendTab === t
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Chart */}
              <div className="px-2 pt-1 pb-0">
                <StrainChart
                  data={strainChartData(strainHistory!, trendTab)}
                  tab={trendTab}
                />
              </div>

              {/* Legend */}
              <div className="flex gap-3 justify-center pb-2.5 pt-1">
                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                  <div className="w-2 h-2 rounded-[2px]" style={{ background: '#f59e0b' }} />
                  Wellbeing
                </div>
                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                  <div className="w-2 h-2 rounded-[2px]" style={{ background: '#3b82f6' }} />
                  Workout
                </div>
                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                  <svg width="14" height="8" style={{ flexShrink: 0 }}>
                    <line x1="0" y1="4" x2="14" y2="4" stroke="#374151" strokeWidth="1.6"/>
                    <circle cx="7" cy="4" r="2" fill="#fff" stroke="#374151" strokeWidth="1.3"/>
                  </svg>
                  Total
                </div>
              </div>
            </div>
          )}
        </>
      )}
```

- [ ] **Step 5: Verify TypeScript compiles clean**

Run: `npx tsc --noEmit 2>&1 | head -40`

Expected: 0 errors.

- [ ] **Step 6: Visual test in browser**

Open the dashboard. Verify:
1. "Strain trend" toggle row appears at the bottom of the MetricsBar card (only if chartsData has loaded)
2. Tapping the row expands the chart section below
3. 1W tab shows 7 bars with Mon–Sun labels
4. 1M tab shows ~30 narrower bars with date labels every 7 days
5. 3M tab shows weekly average bars with month/date labels
6. Amber bars (wellbeing) appear at the base; blue bars (workout) stack on top
7. Gray line connects the total points
8. Tapping again collapses the section

- [ ] **Step 7: Commit**

```
git add components/MetricsBar.tsx
git commit -m "feat: add collapsible strain trend chart to MetricsBar

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Verification checklist

1. `npx tsc --noEmit` — zero errors
2. Dashboard loads without console errors
3. `chartsData` is fetched once from the dashboard page (not duplicated in CtlTrendStrip)
4. `CtlTrendStrip` still renders correctly (CTL + RHR lines intact)
5. MetricsBar renders the toggle row only when `chartsData` has loaded and has `dailyStrain` entries
6. Chart switches correctly between 1W, 1M, and 3M — scale stays 0–21 on all three
7. 3M shows weekly averages (not sums) — total line values stay ≤21
8. Days with no activity or wellness data render as zero-height bars (not gaps)
9. Toggle open/close animates only the expand chevron, no layout jump
10. `stress_high` field from `ICUWellness` is passed correctly (was already in the type)
