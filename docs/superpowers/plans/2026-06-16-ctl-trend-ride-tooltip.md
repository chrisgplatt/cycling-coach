# CTL Trend Ride Breakdown Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the dashboard's "Progress (CTL)" / RHR strip (`components/CtlTrendStrip.tsx`), tapping or hovering near a session dot on the 1M tab shows a tooltip listing the ride(s) that contributed to that day — name, TSS, duration — plus a CTL/RHR header.

**Architecture:** Extend `RidePoint` with `name`/`durationSecs` so the existing per-activity data survives into the chart. Replace the chart's per-date TSS-sum map with a per-date ride-list map (same total, richer data). Add one invisible hit-target rect per day in the 1m window, each pre-mapped to its nearest session dot, and render an HTML tooltip overlay matching the style already shipped on the Strain trend chart.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, inline SVG (no new dependencies).

Full design rationale: `docs/superpowers/specs/2026-06-16-ctl-trend-ride-tooltip-design.md`

---

### Task 1: Extend `RidePoint` with `name` and `durationSecs`

**Files:**
- Modify: `types/index.ts:365-369`
- Modify: `app/api/charts/route.ts:58-64`
- Test: `__tests__/components/CtlTrendStrip.test.tsx:13-26`

- [ ] **Step 1: Update the test fixture to use the new (not-yet-existing) fields**

In `__tests__/components/CtlTrendStrip.test.tsx`, replace the `rides` array inside `mockCharts`:

```ts
  rides: [
    { date: daysAgo(100), avgHr: 138, tss: 80 },
    { date: daysAgo(10),  avgHr: 142, tss: 95 },
    { date: daysAgo(5),   avgHr: 143, tss: 60 },
  ],
```

with:

```ts
  rides: [
    { date: daysAgo(100), avgHr: 138, tss: 80, name: 'Century Ride', durationSecs: 14400 },
    { date: daysAgo(10),  avgHr: 142, tss: 95, name: 'Threshold Intervals', durationSecs: 5400 },
    { date: daysAgo(5),   avgHr: 143, tss: 60, name: 'Morning Endurance Ride', durationSecs: 6300 },
  ],
```

- [ ] **Step 2: Run the type checker to confirm it fails**

Run: `npm run typecheck`
Expected: FAIL — `Object literal may only specify known properties, and 'name' does not exist in type 'RidePoint'` (or similar), pointing at `__tests__/components/CtlTrendStrip.test.tsx`.

- [ ] **Step 3: Extend the `RidePoint` interface**

In `types/index.ts`, replace:

```ts
export interface RidePoint {
  date: string          // YYYY-MM-DD
  avgHr: number | null
  tss: number | null
}
```

with:

```ts
export interface RidePoint {
  date: string          // YYYY-MM-DD
  avgHr: number | null
  tss: number | null
  name: string                // activity name, for the ride breakdown tooltip
  durationSecs: number        // from ICUActivity.moving_time
}
```

- [ ] **Step 4: Update the `/api/charts` route to populate the new fields**

In `app/api/charts/route.ts`, replace:

```ts
    const rides: RidePoint[] = activities
      .map(a => ({
        date: a.start_date_local.slice(0, 10),
        avgHr: a.average_heartrate,
        tss: a.training_load ?? null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
```

with:

```ts
    const rides: RidePoint[] = activities
      .map(a => ({
        date: a.start_date_local.slice(0, 10),
        avgHr: a.average_heartrate,
        tss: a.training_load ?? null,
        name: a.name,
        durationSecs: a.moving_time,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
```

- [ ] **Step 5: Run the type checker to confirm it passes**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 6: Run the existing CtlTrendStrip tests to confirm nothing broke**

Run: `npx jest __tests__/components/CtlTrendStrip.test.tsx`
Expected: PASS — all existing tests green (fixture change is additive-only, no rendering behavior changed yet).

- [ ] **Step 7: Commit**

```bash
git add types/index.ts app/api/charts/route.ts __tests__/components/CtlTrendStrip.test.tsx
git commit -m "feat: thread ride name and duration through to /api/charts"
```

---

### Task 2: Ride breakdown tooltip on the CTL trend chart (1M tab only)

**Files:**
- Modify: `components/CtlTrendStrip.tsx`
- Test: `__tests__/components/CtlTrendStrip.test.tsx`

- [ ] **Step 1: Add a second same-day ride to the fixture, and write the failing tests**

In `__tests__/components/CtlTrendStrip.test.tsx`, replace the `rides` array (from Task 1) with one that adds a second ride on `daysAgo(5)`, so that day has two contributing rides:

```ts
  rides: [
    { date: daysAgo(100), avgHr: 138, tss: 80, name: 'Century Ride', durationSecs: 14400 },
    { date: daysAgo(10),  avgHr: 142, tss: 95, name: 'Threshold Intervals', durationSecs: 5400 },
    { date: daysAgo(5),   avgHr: 143, tss: 60, name: 'Morning Endurance Ride', durationSecs: 6300 },
    { date: daysAgo(5),   avgHr: 110, tss: 18, name: 'Evening Recovery Spin', durationSecs: 2400 },
  ],
```

Add these three tests at the end of the file (after the existing `'defaults to the 1m tab'` test):

```ts
it('shows a ride breakdown tooltip when a 1m hit-target is tapped', async () => {
  const user = userEvent.setup()
  await act(async () => { render(<CtlTrendStrip />) })
  // ctlPoints in the 1m window are [daysAgo(10), daysAgo(5)] in that order,
  // so slot index 1 is nearest the daysAgo(5) session dot (the 2-ride day).
  await user.click(screen.getByTestId('ctl-hit-1'))
  expect(screen.getByTestId('ctl-ride-tooltip')).toBeInTheDocument()
  expect(screen.getByText(/Morning Endurance Ride/)).toBeInTheDocument()
  expect(screen.getByText(/60 TSS/)).toBeInTheDocument()
  expect(screen.getByText(/1h 45m/)).toBeInTheDocument()
  expect(screen.getByText(/Evening Recovery Spin/)).toBeInTheDocument()
  expect(screen.getByText(/18 TSS/)).toBeInTheDocument()
  expect(screen.getByText(/0h 40m/)).toBeInTheDocument()
  expect(screen.getByText(/Total 78 TSS/)).toBeInTheDocument()
  expect(screen.getByText(/CTL 68/)).toBeInTheDocument()
  expect(screen.getByText(/RHR 50/)).toBeInTheDocument()
})

it('clicking the same hit-target again closes the tooltip', async () => {
  const user = userEvent.setup()
  await act(async () => { render(<CtlTrendStrip />) })
  const hit = screen.getByTestId('ctl-hit-1')
  await user.click(hit)
  expect(screen.getByTestId('ctl-ride-tooltip')).toBeInTheDocument()
  await user.click(hit)
  expect(screen.queryByTestId('ctl-ride-tooltip')).toBeNull()
})

it('has no hit-targets or tooltip on the 3m tab', async () => {
  const user = userEvent.setup()
  await act(async () => { render(<CtlTrendStrip />) })
  await user.click(screen.getByTestId('ctl-hit-1'))
  expect(screen.getByTestId('ctl-ride-tooltip')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /3m/i }))
  expect(screen.queryByTestId('ctl-ride-tooltip')).toBeNull()
  expect(screen.queryAllByTestId(/^ctl-hit-/).length).toBe(0)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/components/CtlTrendStrip.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="ctl-hit-1"]` (no hit-targets exist yet).

- [ ] **Step 3: Add imports, the date-label helper, and the `activeDotIdx` state**

In `components/CtlTrendStrip.tsx`, replace the top of the file:

```tsx
'use client'
import { useEffect, useState } from 'react'
import type { ChartsData } from '@/types'

type Range = '1m' | '3m' | '6m' | '12m'

const RANGE_MONTHS: Record<Range, number> = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }
const RANGES: Range[] = ['1m', '3m', '6m', '12m']
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
```

with:

```tsx
'use client'
import { useEffect, useState } from 'react'
import type { ChartsData, RidePoint } from '@/types'
import { formatDuration } from '@/components/RideStats'

type Range = '1m' | '3m' | '6m' | '12m'

const RANGE_MONTHS: Record<Range, number> = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }
const RANGES: Range[] = ['1m', '3m', '6m', '12m']
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function dotDateLabel(dateStr: string): string {
  const d = new Date(dateStr)
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}
```

Then add `activeDotIdx` state next to the existing `range` state:

```tsx
  const [fetched, setFetched] = useState<ChartsData | null>(null)
  const [range, setRange] = useState<Range>('1m')
```

becomes:

```tsx
  const [fetched, setFetched] = useState<ChartsData | null>(null)
  const [range, setRange] = useState<Range>('1m')
  const [activeDotIdx, setActiveDotIdx] = useState<number | null>(null)
```

- [ ] **Step 4: Add the reset effect after `data` is computed, before the early return**

Replace:

```tsx
  const data = chartsData ?? fetched

  if (!data) return null
```

with:

```tsx
  const data = chartsData ?? fetched

  useEffect(() => {
    setActiveDotIdx(null)
  }, [range, data])

  if (!data) return null
```

This must go here (not next to the other `useEffect` above it) because it depends on `data`, which isn't computed until this point — and it must come before the early return since React hooks can never run conditionally.

- [ ] **Step 5: Group rides by date instead of summing TSS**

Replace:

```tsx
  // Session dots — one circle per training day, radius ∝ TSS
  const ctlByDate = new Map(ctlPoints.map(w => [w.id, w.ctl as number]))
  const dailyTss = new Map<string, number>()
  for (const r of (data.rides ?? []).filter(r => r.date >= ctlWindowStart && r.tss)) {
    dailyTss.set(r.date, (dailyTss.get(r.date) ?? 0) + (r.tss as number))
  }
  const sessionDots = Array.from(dailyTss.entries()).flatMap(([date, tss]) => {
    const ctl = ctlByDate.get(date)
    if (ctl === undefined) return []
    return [{ x: xOf(date), y: ctlY(ctl), r: Math.max(1.5, Math.min(tss / 25, 5)) }]
  })

  // Resting HR — daily values from wellness, same window as CTL
  const rhrPoints = ctlPoints.filter(w => w.resting_hr !== null)
```

with:

```tsx
  // Session dots — one circle per training day, radius ∝ total TSS that day.
  // Rides are grouped (not just summed) so the tooltip can list each contributing ride.
  const ctlByDate = new Map(ctlPoints.map(w => [w.id, w.ctl as number]))
  const ridesByDate = new Map<string, RidePoint[]>()
  for (const r of (data.rides ?? []).filter(r => r.date >= ctlWindowStart && r.tss)) {
    const arr = ridesByDate.get(r.date) ?? []
    arr.push(r)
    ridesByDate.set(r.date, arr)
  }
  const sessionDots = Array.from(ridesByDate.entries()).flatMap(([date, dayRides]) => {
    const ctl = ctlByDate.get(date)
    if (ctl === undefined) return []
    const totalTss = dayRides.reduce((s, r) => s + (r.tss as number), 0)
    return [{ date, x: xOf(date), y: ctlY(ctl), r: Math.max(1.5, Math.min(totalTss / 25, 5)), rides: dayRides, totalTss }]
  })

  // Resting HR — daily values from wellness, same window as CTL
  const rhrPoints = ctlPoints.filter(w => w.resting_hr !== null)
  const rhrByDate = new Map(rhrPoints.map(w => [w.id, w.resting_hr as number]))
```

- [ ] **Step 6: Add hit-target rects inside the `<svg>`, after the x-axis tick marks**

Replace:

```tsx
        {/* X-axis tick marks */}
        {xTicks.map((tick, i) => (
          <line
            key={i}
            x1={tick.x.toFixed(1)} y1={PAD_T + CH}
            x2={tick.x.toFixed(1)} y2={PAD_T + CH + 3}
            stroke="#e5e7eb"
            strokeWidth="1"
          />
        ))}
      </svg>
```

with:

```tsx
        {/* X-axis tick marks */}
        {xTicks.map((tick, i) => (
          <line
            key={i}
            x1={tick.x.toFixed(1)} y1={PAD_T + CH}
            x2={tick.x.toFixed(1)} y2={PAD_T + CH + 3}
            stroke="#e5e7eb"
            strokeWidth="1"
          />
        ))}
        {/* Ride hit-targets — 1m tab only, one slot per day, snapped to nearest session dot */}
        {range === '1m' && sessionDots.length > 0 && (() => {
          const nSlots = ctlPoints.length
          const slotW = CW / nSlots
          return ctlPoints.map((w, i) => {
            const slotX = PAD_L + slotW * i + slotW / 2
            let nearest = 0
            let nearestDist = Infinity
            sessionDots.forEach((dot, di) => {
              const dist = Math.abs(dot.x - slotX)
              if (dist < nearestDist) { nearestDist = dist; nearest = di }
            })
            return (
              <rect
                key={`hit-${w.id}`}
                data-testid={`ctl-hit-${i}`}
                x={(PAD_L + slotW * i).toFixed(1)}
                y={PAD_T}
                width={slotW.toFixed(1)}
                height={CH}
                fill="transparent"
                onClick={() => setActiveDotIdx(cur => cur === nearest ? null : nearest)}
                onMouseEnter={() => setActiveDotIdx(nearest)}
                onMouseLeave={() => setActiveDotIdx(cur => cur === nearest ? null : cur)}
                style={{ cursor: 'pointer' }}
              />
            )
          })
        })()}
      </svg>
```

- [ ] **Step 7: Add the tooltip to the HTML overlay, after the RHR axis labels**

Replace:

```tsx
        {/* RHR y-axis labels: left-aligned just outside right edge */}
        {showRhrAxis && (
          <>
            <span
              className="absolute text-[10px] leading-none font-sans text-rose-500 font-medium"
              style={{ left: xPct(PAD_L + CW), top: yPct(rhrY(rhrActMax!)), transform: 'translateY(-50%)' }}
            >
              {r10(rhrActMax!)}
            </span>
            <span
              className="absolute text-[10px] leading-none font-sans text-rose-500 font-medium"
              style={{ left: xPct(PAD_L + CW), top: yPct(rhrY(rhrActMin!)), transform: 'translateY(-50%)' }}
            >
              {r10(rhrActMin!)}
            </span>
          </>
        )}
      </div>
    </div>
  )
```

with:

```tsx
        {/* RHR y-axis labels: left-aligned just outside right edge */}
        {showRhrAxis && (
          <>
            <span
              className="absolute text-[10px] leading-none font-sans text-rose-500 font-medium"
              style={{ left: xPct(PAD_L + CW), top: yPct(rhrY(rhrActMax!)), transform: 'translateY(-50%)' }}
            >
              {r10(rhrActMax!)}
            </span>
            <span
              className="absolute text-[10px] leading-none font-sans text-rose-500 font-medium"
              style={{ left: xPct(PAD_L + CW), top: yPct(rhrY(rhrActMin!)), transform: 'translateY(-50%)' }}
            >
              {r10(rhrActMin!)}
            </span>
          </>
        )}
        {/* Ride breakdown tooltip — 1m tab only */}
        {activeDotIdx !== null && sessionDots[activeDotIdx] && (() => {
          const dot = sessionDots[activeDotIdx]
          const rhr = rhrByDate.get(dot.date)
          const clampedPct = Math.min(82, Math.max(18, (dot.x / W) * 100))
          return (
            <div
              data-testid="ctl-ride-tooltip"
              className="absolute z-10 bg-gray-900 text-white text-[10px] leading-snug rounded-lg px-2.5 py-2 shadow-lg pointer-events-none whitespace-nowrap"
              style={{ left: `${clampedPct}%`, top: yPct(dot.y), transform: 'translate(-50%, -100%) translateY(-8px)' }}
            >
              <div className="font-bold mb-1">
                {dotDateLabel(dot.date)} · CTL {Math.round(ctlByDate.get(dot.date)!)}
                {rhr !== undefined && ` · RHR ${Math.round(rhr)}`}
              </div>
              {dot.rides.map((r, i) => (
                <div key={i}>{r.name} — {Math.round(r.tss as number)} TSS · {formatDuration(r.durationSecs)}</div>
              ))}
              {dot.rides.length > 1 && (
                <div className="font-bold mt-1">Total {Math.round(dot.totalTss)} TSS</div>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx jest __tests__/components/CtlTrendStrip.test.tsx`
Expected: PASS — all tests green, including the 3 new ones.

- [ ] **Step 9: Run the full test suite and type checker**

Run: `npm run test:ci`
Expected: PASS — no regressions elsewhere.

- [ ] **Step 10: Commit**

```bash
git add components/CtlTrendStrip.tsx __tests__/components/CtlTrendStrip.test.tsx
git commit -m "feat: show ride breakdown tooltip on CTL trend chart (1M tab)"
```

---

## Manual verification (mobile-first UI check)

Not exercised by the automated tests above — do this in a browser at ~375px width before considering the feature done:

1. Open the dashboard, scroll to the "Progress (CTL)" strip, confirm it's on the 1M tab by default.
2. Tap a session dot (or anywhere near one) — confirm the tooltip appears above it, showing the date, CTL, RHR (if synced), and one line per ride that day with name/TSS/duration.
3. Tap the same spot again — confirm the tooltip closes. Tap a different dot — confirm it switches directly.
4. Switch to 3m/6m/12m — confirm there's no hover cursor or tooltip on any dot, and switching back to 1m still works.
5. On a desktop browser, hover (without clicking) over a 1m dot — confirm the tooltip appears, and moving the mouse away closes it.
