# Strain Trend Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping or hovering a bar/point in the dashboard's strain trend chart shows a tooltip with that day's (or week's, on the 3M tab) full contributing-factor breakdown — workout TSS, sleep score, sleep duration, body battery, plus the workout/wellbeing point split and total.

**Architecture:** `computeStrainComponents` (`lib/strain.ts`) already computes the raw signal values needed; `/api/charts` currently discards them when building `DailyStrainPoint`. Task 1 retains them on the type and threads them through the API route. Task 2 extends the chart's data-shaping function (`strainChartData`) to carry those fields (averaging them for the 3M weekly view), and adds tap/hover hit-targets plus an HTML tooltip overlay to `StrainChart`, both in `components/MetricsBar.tsx`.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, inline SVG, Jest + React Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-16-strain-trend-tooltip-design.md`

---

### Task 1: Thread raw strain signals through `DailyStrainPoint`

**Files:**
- Modify: `types/index.ts:371-376`
- Modify: `app/api/charts/route.ts:68-80`

This task is plumbing only — `computeStrainComponents` (`lib/strain.ts`) already returns `workoutLoad`, `sleepScore`, `sleepSecs`, `bodyBatteryHigh`; the route currently drops them when building each `DailyStrainPoint`. There's no existing test file for this route (it requires live Supabase/intervals.icu mocking that the project hasn't set up elsewhere), and the design spec explicitly scopes route-level testing out as low-risk passthrough — so this task is verified via TypeScript's type checker instead of a new test file: the route's returned object literal must satisfy the extended `DailyStrainPoint` interface, which fails to compile if a field is missing or mistyped.

- [ ] **Step 1: Extend the `DailyStrainPoint` interface**

In `types/index.ts`, replace lines 371-376:

```ts
export interface DailyStrainPoint {
  date: string    // YYYY-MM-DD
  workout: number // workout contribution 0–14 (float)
  life: number    // life signal contribution 0–7 (float)
  total: number   // rounded combined strain score 0–21
}
```

with:

```ts
export interface DailyStrainPoint {
  date: string                       // YYYY-MM-DD
  workout: number                    // workout contribution 0–14 (float)
  life: number                       // life signal contribution 0–7 (float)
  total: number                      // rounded combined strain score 0–21
  workoutLoad: number                // raw activity load (TSS-equivalent) behind `workout`
  sleepScore: number | null          // 0–100, null if not synced
  sleepSecs: number | null           // seconds, null if not synced
  bodyBatteryHigh: number | null     // 0–100 daily peak, null if not synced
}
```

- [ ] **Step 2: Run the type checker to confirm the route now fails to compile**

Run: `npm run typecheck`

Expected: FAIL — `app/api/charts/route.ts` reports a type error because the object literal returned from the `dailyStrain` map (line ~78) is missing `workoutLoad`, `sleepScore`, `sleepSecs`, `bodyBatteryHigh`.

- [ ] **Step 3: Pass the raw fields through in the route**

In `app/api/charts/route.ts`, replace lines 68-80:

```ts
    const dailyStrain: DailyStrainPoint[] = wellness
      .map(w => {
        const activityLoad = computeDailyActivityLoad(activities, w.id, ftp)
        const components = computeStrainComponents(
          activityLoad > 0 ? activityLoad : null,
          w.sleep_score,
          w.body_battery_high,
          w.sleep_secs,
        )
        if (!components) return null
        return { date: w.id, workout: components.workoutPts, life: components.lifePts, total: components.total }
      })
      .filter((p): p is DailyStrainPoint => p !== null && (p.total > 0 || p.life > 0 || p.workout > 0))
```

with:

```ts
    const dailyStrain: DailyStrainPoint[] = wellness
      .map(w => {
        const activityLoad = computeDailyActivityLoad(activities, w.id, ftp)
        const components = computeStrainComponents(
          activityLoad > 0 ? activityLoad : null,
          w.sleep_score,
          w.body_battery_high,
          w.sleep_secs,
        )
        if (!components) return null
        return {
          date: w.id,
          workout: components.workoutPts,
          life: components.lifePts,
          total: components.total,
          workoutLoad: components.workoutLoad,
          sleepScore: components.sleepScore,
          sleepSecs: components.sleepSecs,
          bodyBatteryHigh: components.bodyBatteryHigh,
        }
      })
      .filter((p): p is DailyStrainPoint => p !== null && (p.total > 0 || p.life > 0 || p.workout > 0))
```

- [ ] **Step 4: Run the type checker to confirm it passes**

Run: `npm run typecheck`

Expected: PASS — no output, exit code 0.

- [ ] **Step 5: Run the full test suite to confirm nothing else broke**

Run: `npm test`

Expected: PASS — all existing suites green (this task touches no test files).

- [ ] **Step 6: Commit**

```bash
git add types/index.ts app/api/charts/route.ts
git commit -m "feat(charts): thread raw strain signals through DailyStrainPoint"
```

---

### Task 2: Tappable/hoverable tooltip on the strain trend chart

**Files:**
- Modify: `components/MetricsBar.tsx:1-3` (import), `:49-115` (helpers + `strainChartData`), `:130-242` (`StrainChart`)
- Test: `__tests__/components/MetricsBar.test.tsx`

This is the user-visible feature. `strainChartData` (the function that buckets `DailyStrainPoint[]` into per-tab chart points) needs to carry the new raw fields through for all three tabs, plus a human-readable `dateLabel` for the tooltip header. `StrainChart` needs per-point hit-target rects, `activeIdx` state, and the tooltip overlay itself.

- [ ] **Step 1: Write the failing test**

Open `__tests__/components/MetricsBar.test.tsx`. It currently reads:

```tsx
import { render, screen } from '@testing-library/react'
import MetricsBar from '@/components/MetricsBar'
import type { ICUWellness } from '@/types'

const wellness: ICUWellness = {
  id: '2026-05-11', ctl: 65, atl: 72, form: -7, hrv: 68, resting_hr: 52, sleep_secs: 28800, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null,
}

describe('MetricsBar', () => {
  it('displays CTL, ATL, and form values', () => {
    render(<MetricsBar wellness={wellness} />)
    expect(screen.getByText('65')).toBeInTheDocument()
    expect(screen.getByText('72')).toBeInTheDocument()
    expect(screen.getByText('-7')).toBeInTheDocument()
  })

  it('renders gracefully with null values', () => {
    render(<MetricsBar wellness={{ ...wellness, ctl: null, atl: null, form: null }} />)
    expect(screen.getAllByText('—')).toHaveLength(3)
  })
})
```

Replace the whole file with:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import MetricsBar from '@/components/MetricsBar'
import type { ICUWellness, DailyStrainPoint } from '@/types'

const wellness: ICUWellness = {
  id: '2026-05-11', ctl: 65, atl: 72, form: -7, hrv: 68, resting_hr: 52, sleep_secs: 28800, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null,
}

describe('MetricsBar', () => {
  it('displays CTL, ATL, and form values', () => {
    render(<MetricsBar wellness={wellness} />)
    expect(screen.getByText('65')).toBeInTheDocument()
    expect(screen.getByText('72')).toBeInTheDocument()
    expect(screen.getByText('-7')).toBeInTheDocument()
  })

  it('renders gracefully with null values', () => {
    render(<MetricsBar wellness={{ ...wellness, ctl: null, atl: null, form: null }} />)
    expect(screen.getAllByText('—')).toHaveLength(3)
  })
})

describe('MetricsBar strain trend tooltip', () => {
  // The 1W tab renders 7 days ending today, so "today" is always index 6 —
  // computed locally (not via toISOString) to match the component's local-date bucketing.
  function localToday(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const strainHistory: DailyStrainPoint[] = [
    {
      date: localToday(),
      workout: 8.2,
      life: 3.1,
      total: 11,
      workoutLoad: 45,
      sleepScore: 72,
      sleepSecs: 25920, // 7.2h
      bodyBatteryHigh: 68,
    },
  ]

  it('shows the contributing-factor tooltip when a chart point is tapped', () => {
    render(<MetricsBar wellness={wellness} strainHistory={strainHistory} />)

    fireEvent.click(screen.getByText('Strain trend'))
    fireEvent.click(screen.getByTestId('strain-hit-6'))

    const tooltip = screen.getByTestId('strain-tooltip')
    expect(tooltip).toHaveTextContent('Sleep 72/100')
    expect(tooltip).toHaveTextContent('Duration 7.2h')
    expect(tooltip).toHaveTextContent('Battery 68%')
    expect(tooltip).toHaveTextContent('45 TSS')
    expect(tooltip).toHaveTextContent('Total 11/21')
  })

  it('closes the tooltip when the same point is tapped again', () => {
    render(<MetricsBar wellness={wellness} strainHistory={strainHistory} />)

    fireEvent.click(screen.getByText('Strain trend'))
    const point = screen.getByTestId('strain-hit-6')

    fireEvent.click(point)
    expect(screen.getByTestId('strain-tooltip')).toBeInTheDocument()

    fireEvent.click(point)
    expect(screen.queryByTestId('strain-tooltip')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npm test -- MetricsBar`

Expected: FAIL — `screen.getByTestId('strain-hit-6')` throws `Unable to find an element by: [data-testid="strain-hit-6"]`, since no hit-target rects exist yet.

- [ ] **Step 3: Add the `useEffect` import**

In `components/MetricsBar.tsx`, replace line 3:

```ts
import React, { useState } from 'react'
```

with:

```ts
import React, { useState, useEffect } from 'react'
```

- [ ] **Step 4: Replace `strainChartData` and add the new helpers**

In `components/MetricsBar.tsx`, find the `strainChartData` function (currently lines 55-115, immediately after the `localDateStr` helper and before the `const VW = 340, VH = 104` line). Replace it — and add two new helpers above it — with:

```ts
function dayLabel(d: Date): string {
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
  return `${dow} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}

function avgOrNull(vals: Array<number | null>): number | null {
  const present = vals.filter((v): v is number => v != null)
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null
}

interface StrainChartPoint {
  label: string
  workout: number
  life: number
  total: number
  workoutLoad: number
  sleepScore: number | null
  sleepSecs: number | null
  bodyBatteryHigh: number | null
  dateLabel: string
}

function strainChartData(
  history: DailyStrainPoint[],
  tab: '1w' | '1m' | '3m',
): StrainChartPoint[] {
  if (tab === '3m') {
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - 3)
    const cutoffStr = localDateStr(cutoff)
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
          workoutLoad: pts.reduce((s, p) => s + p.workoutLoad, 0) / n,
          sleepScore: avgOrNull(pts.map(p => p.sleepScore)),
          sleepSecs: avgOrNull(pts.map(p => p.sleepSecs)),
          bodyBatteryHigh: avgOrNull(pts.map(p => p.bodyBatteryHigh)),
          dateLabel: label,
        }
      })
  }

  const days = tab === '1w' ? 7 : 30
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days + 1)
  cutoff.setHours(0, 0, 0, 0)
  const cutoffStr = localDateStr(cutoff)
  const filtered = history.filter(p => p.date >= cutoffStr)

  const result: StrainChartPoint[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(cutoff)
    d.setDate(cutoff.getDate() + i)
    const dateStr = localDateStr(d)
    const found = filtered.find(p => p.date === dateStr)
    let label = ''
    if (tab === '1w') {
      label = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
    } else {
      if (i % 7 === 0) {
        label = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
      }
    }
    result.push({
      label,
      workout: found?.workout ?? 0,
      life: found?.life ?? 0,
      total: found?.total ?? 0,
      workoutLoad: found?.workoutLoad ?? 0,
      sleepScore: found?.sleepScore ?? null,
      sleepSecs: found?.sleepSecs ?? null,
      bodyBatteryHigh: found?.bodyBatteryHigh ?? null,
      dateLabel: dayLabel(d),
    })
  }
  return result
}
```

- [ ] **Step 5: Replace `StrainChart` with the interactive version**

In `components/MetricsBar.tsx`, find the `StrainChart` function (currently lines 130-242, from `function StrainChart({` through its closing `}` right before `const BAND_BG`). Replace the entire function with:

```tsx
function StrainChart({
  data,
  tab,
}: {
  data: StrainChartPoint[]
  tab: '1w' | '1m' | '3m'
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null)

  useEffect(() => {
    setActiveIdx(null)
  }, [data])

  if (!data.length) return null
  const n = data.length
  const slot = CW / n
  const barW = Math.max(3, Math.min(22, slot * 0.65))
  const showDots = tab !== '3m' && n <= 31

  const gridLines = [0, 10, 20].map(v => {
    const y = yOf(v).toFixed(1)
    return (
      <line key={v}
        x1={PAD_L} y1={y} x2={PAD_L + CW} y2={y}
        stroke={v === 0 ? '#e5e7eb' : '#f3f4f6'} strokeWidth="1"
      />
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

    // x-axis labels rendered in HTML overlay below
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

  const hitTargets = data.map((d, i) => (
    <rect
      key={`hit-${i}`}
      data-testid={`strain-hit-${i}`}
      x={(PAD_L + slot * i).toFixed(1)}
      y={PAD_T}
      width={slot.toFixed(1)}
      height={CH}
      fill="transparent"
      onClick={() => setActiveIdx(cur => cur === i ? null : i)}
      onMouseEnter={() => setActiveIdx(i)}
      onMouseLeave={() => setActiveIdx(cur => cur === i ? null : cur)}
      style={{ cursor: 'pointer' }}
    />
  ))

  return (
    <div className="relative">
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
        {hitTargets}
      </svg>
      {/* HTML label overlay — font-size here is real CSS pixels, not SVG user units */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Y-axis labels */}
        {[0, 10, 20].map(v => (
          <span
            key={v}
            className="absolute text-[9px] leading-none font-sans text-gray-400 whitespace-nowrap"
            style={{ left: xPct(PAD_L - 2), top: yPct(yOf(v)), transform: 'translate(-100%, -50%)' }}
          >
            {v}
          </span>
        ))}
        {/* X-axis labels */}
        {data.map((d, i) => {
          if (!d.label) return null
          const cx = PAD_L + (CW / n) * i + (CW / n) / 2
          return (
            <span
              key={i}
              className={`absolute leading-none font-sans text-gray-400 whitespace-nowrap ${n > 10 ? 'text-[8px]' : 'text-[9px]'}`}
              style={{ left: xPct(cx), top: yPct(VH - 2), transform: 'translate(-50%, -100%)' }}
            >
              {d.label}
            </span>
          )
        })}
        {/* Tooltip */}
        {activeIdx !== null && (() => {
          const d = data[activeIdx]
          const cx = PAD_L + (CW / n) * activeIdx + (CW / n) / 2
          // Clamp so the tooltip box doesn't overflow the card's left/right edges
          const clampedPct = Math.min(82, Math.max(18, (cx / VW) * 100))
          return (
            <div
              data-testid="strain-tooltip"
              className="absolute z-10 bg-gray-900 text-white text-[10px] leading-snug rounded-lg px-2.5 py-2 shadow-lg pointer-events-none whitespace-nowrap"
              style={{ left: `${clampedPct}%`, top: yPct(yOf(d.total)), transform: 'translate(-50%, -100%) translateY(-8px)' }}
            >
              <div className="font-bold mb-1">{d.dateLabel}</div>
              <div>
                Workout <span className="text-blue-300">{(Math.round(d.workout * 10) / 10).toFixed(1)}/14</span>
                {d.workoutLoad > 0 && ` (${Math.round(d.workoutLoad)} TSS)`}
              </div>
              <div>Wellbeing <span className="text-amber-300">{(Math.round(d.life * 10) / 10).toFixed(1)}/7</span></div>
              {d.sleepScore != null && <div className="pl-2 text-gray-300">Sleep {Math.round(d.sleepScore)}/100</div>}
              {d.sleepSecs != null && <div className="pl-2 text-gray-300">Duration {(d.sleepSecs / 3600).toFixed(1)}h</div>}
              {d.bodyBatteryHigh != null && <div className="pl-2 text-gray-300">Battery {Math.round(d.bodyBatteryHigh)}%</div>}
              <div className="font-bold mt-1">Total {d.total}/21</div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- MetricsBar`

Expected: PASS — all 4 tests in `MetricsBar.test.tsx` green.

- [ ] **Step 7: Run the type checker and full test suite**

Run: `npm run test:ci`

Expected: PASS — typecheck clean, full Jest suite green.

- [ ] **Step 8: Commit**

```bash
git add components/MetricsBar.tsx __tests__/components/MetricsBar.test.tsx
git commit -m "feat(strain-chart): add tap/hover tooltip with contributing-factor breakdown"
```

---

## Manual verification (mobile-first UI check)

Per this project's UI rules, manually verify in a browser at ~375px width before considering this done:
1. `npm run dev`, open the dashboard, confirm the strain band renders and "Strain trend" expands.
2. Tap a bar on the 1W tab — tooltip appears above the bar, doesn't overflow the card edges, dismisses on tapping the same bar again.
3. Switch to 1M and 3M tabs — tapping still works, tooltip content reflects per-week averages on 3M (e.g. fractional-looking but rounded sleep/battery values).
4. On a desktop browser, hover (no click) over a few points — tooltip follows the cursor between points without needing a click.
