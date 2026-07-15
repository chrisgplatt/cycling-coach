# Dashboard HRV Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Fitness page's HRV chart into a shared component, make it interactive (tap/hover tooltips, more visible dots), and surface it as a new collapsible panel on the Dashboard, directly under the HRV metric, defaulting to a 1-week view.

**Architecture:** Three tasks in dependency order. Task 1 mechanically extracts the existing `HrvSection` chart body out of `app/fitness/page.tsx` into a new standalone `components/HrvChart.tsx`, adding a `defaultRangeDays` prop but changing no visuals. Task 2 adds interactivity (tap/hover tooltip + bigger dots) to that same shared component, mirroring the existing `StrainChart` pattern already in `components/MetricsBar.tsx`. Task 3 wires the shared component into `MetricsBar.tsx` as a new collapsible panel and threads the wellness history array through from `app/dashboard/page.tsx`.

**Tech Stack:** Next.js / TypeScript / Jest + React Testing Library.

## Global Constraints

- One shared chart component (`components/HrvChart.tsx`) powers both the Fitness page and the new Dashboard panel — no duplicated chart logic.
- The Fitness page's HRV chart keeps its current 3-month (91-day) default range; only the new Dashboard panel defaults to 1 week (7 days), via the `defaultRangeDays` prop.
- Interactivity (tap/hover tooltip, larger dots) applies everywhere the shared chart is used — it's the same component in both places.
- The Dashboard panel follows the exact same collapsed-by-default, tap-to-expand chevron pattern as the existing "Strain trend" panel in `MetricsBar.tsx`, and is placed directly after the CTL/ATL/Form/HRV/Resting HR metrics row, before the Training Status block.
- The Dashboard panel only renders (including its collapsed header) when at least one wellness entry has a non-null `hrv` value — mirrors the existing `hasStrainHistory` gate.
- `app/dashboard/page.tsx` passes its already-computed `wellnessArr` through; no new data fetching.
- Test fixture dates must be computed relative to `Date.now()` (e.g. `new Date(Date.now() - n * 864e5).toISOString().split('T')[0]`), never hardcoded absolute dates — this codebase has repeatedly hit test-rot bugs from hardcoded dates drifting out of a component's rolling display window.

---

### Task 1: Extract `components/HrvChart.tsx`

**Files:**
- Create: `components/HrvChart.tsx`
- Modify: `app/fitness/page.tsx:181-305` (delete `HRV_RANGES`, `HRV_STATUS_STYLE`, replace `HrvSection`'s body)
- Test: `__tests__/components/HrvChart.test.tsx`

**Interfaces:**
- Produces: `export default function HrvChart({ wellness, defaultRangeDays = 91 }: { wellness: ICUWellness[]; defaultRangeDays?: number })`. Task 2 adds interactivity on top of this same signature (no change to the signature itself). Task 3 renders `<HrvChart wellness={...} defaultRangeDays={7} />` from `MetricsBar.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/HrvChart.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import HrvChart from '@/components/HrvChart'
import type { ICUWellness } from '@/types'

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 864e5).toISOString().split('T')[0]
}

function makeWellness(n: number): ICUWellness[] {
  return Array.from({ length: n }, (_, i) => ({
    id: daysAgo(n - 1 - i), ctl: null, atl: null, form: null, hrv: 50 + i, resting_hr: null,
    sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null,
    stress_high: null, garmin_training_load: null, sleep_score: null,
  }))
}

describe('HrvChart', () => {
  it('renders the HRV status header and one dot per day when data is present', () => {
    const { container } = render(<HrvChart wellness={makeWellness(10)} />)
    // 10 days of data is below the 14-reading minimum computeHrvBaseline needs
    // for a suppressed/balanced/elevated verdict, so it reports "building baseline".
    expect(screen.getByText('Building baseline')).toBeInTheDocument()
    expect(container.querySelectorAll('circle').length).toBe(10)
  })

  it('shows the "no data in this range" fallback when the wellness array is empty', () => {
    render(<HrvChart wellness={[]} />)
    expect(screen.getByText('No HRV data in this range.')).toBeInTheDocument()
  })

  it('narrows the visible points when a shorter range button is clicked', () => {
    const { container } = render(<HrvChart wellness={makeWellness(10)} />)
    expect(container.querySelectorAll('circle').length).toBe(10)

    fireEvent.click(screen.getByText('1w'))
    expect(container.querySelectorAll('circle').length).toBeLessThan(10)
  })

  it('uses defaultRangeDays for the initial visible window', () => {
    const { container } = render(<HrvChart wellness={makeWellness(10)} defaultRangeDays={7} />)
    // Same 10-day fixture as above, but starting on the 7-day range instead of the
    // default 91-day range should exclude the two oldest points from the start.
    expect(container.querySelectorAll('circle').length).toBeLessThan(10)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/components/HrvChart.test.tsx`
Expected: FAIL with "Cannot find module '@/components/HrvChart'"

- [ ] **Step 3: Create `components/HrvChart.tsx`**

```typescript
'use client'

import { useState } from 'react'
import type { ICUWellness } from '@/types'
import { computeHrvBaseline, type HrvStatus } from '@/lib/hrv/baseline'
import { normalizeY } from '@/lib/chart-helpers'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const HRV_RANGES: { label: string; days: number }[] = [
  { label: '1w', days: 7 }, { label: '1m', days: 30 },
  { label: '3m', days: 91 }, { label: '6m', days: 182 }, { label: '12m', days: 365 },
]

const HRV_STATUS_STYLE: Record<string, { text: string; label: string }> = {
  suppressed: { text: 'text-rose-600', label: 'Suppressed' },
  balanced: { text: 'text-emerald-600', label: 'Balanced' },
  elevated: { text: 'text-violet-600', label: 'Elevated' },
  building: { text: 'text-slate-500', label: 'Building baseline' },
  no_data: { text: 'text-slate-400', label: 'No HRV data' },
}

export default function HrvChart({
  wellness,
  defaultRangeDays = 91,
}: {
  wellness: ICUWellness[]
  defaultRangeDays?: number
}) {
  const [rangeDays, setRangeDays] = useState(defaultRangeDays)
  const status: HrvStatus = computeHrvBaseline(wellness)

  const cutoff = new Date(Date.now() - rangeDays * 864e5).toISOString().split('T')[0]
  const data = wellness.filter(w => w.hrv !== null && w.id >= cutoff)

  const svgLeft = 30, svgRight = 420, svgTop = 15, svgBottom = 105
  const chartW = svgRight - svgLeft
  const vals = data.map(w => w.hrv as number)
  const lo = status.lowerBound, hi = status.upperBound
  const allY = [...vals, ...(lo ? [lo] : []), ...(hi ? [hi] : [])]
  const dataMin = allY.length ? Math.floor(Math.min(...allY) / 5) * 5 - 2 : 0
  const dataMax = allY.length ? Math.ceil(Math.max(...allY) / 5) * 5 + 2 : 100
  const xOf = (i: number) => svgLeft + (i / Math.max(data.length - 1, 1)) * chartW
  const yOf = (v: number) => normalizeY(v, dataMin, dataMax, svgTop, svgBottom)

  // Raw daily HRV connected into a thin "detailed" line
  const detailPoly = data.map((w, i) => `${xOf(i)},${yOf(w.hrv as number)}`).join(' ')

  // Straight linear-regression trend over the chosen period (least squares on index vs HRV)
  let trendPoly: string | null = null
  if (vals.length >= 2) {
    const n = vals.length
    const meanX = (n - 1) / 2
    const meanY = vals.reduce((a, b) => a + b, 0) / n
    let num = 0, den = 0
    vals.forEach((v, i) => { num += (i - meanX) * (v - meanY); den += (i - meanX) ** 2 })
    const slope = den === 0 ? 0 : num / den
    const intercept = meanY - slope * meanX
    const y0 = intercept
    const y1 = intercept + slope * (n - 1)
    trendPoly = `${xOf(0)},${yOf(y0)} ${xOf(n - 1)},${yOf(y1)}`
  }

  // Y-axis scale: max / mid / min ticks
  const yTicks = [dataMax, Math.round((dataMin + dataMax) / 2), dataMin]
  const yTickYs = yTicks.map(v => yOf(v))

  // X-axis scale: month labels at each month boundary
  const monthLabels: { x: number; label: string }[] = []
  let lastMonth = -1
  data.forEach((w, i) => {
    const m = new Date(w.id).getUTCMonth()
    if (m !== lastMonth) { monthLabels.push({ x: xOf(i), label: MONTHS[m] }); lastMonth = m }
  })

  const st = HRV_STATUS_STYLE[status.label]

  return (
    <>
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
          {/* Y-axis scale: gridlines + ms labels */}
          {yTickYs.map((y, i) => (
            <g key={yTicks[i]}>
              <line x1={svgLeft} y1={y} x2={svgRight} y2={y} stroke="#f3f4f6" strokeWidth="1" />
              <text x={svgLeft - 4} y={y + 4} fontSize="9" fill="#d1d5db" textAnchor="end">{yTicks[i]}</text>
            </g>
          ))}
          <text x={6} y={svgTop + 2} fontSize="8" fill="#d1d5db" textAnchor="start">ms</text>
          {lo !== null && hi !== null && (
            <rect x={svgLeft} y={yOf(hi)} width={chartW} height={Math.max(0, yOf(lo) - yOf(hi))}
              fill="#ede9fe" opacity="0.7" />
          )}
          {/* Detailed daily line */}
          <polyline points={detailPoly} fill="none" stroke="#c4b5fd" strokeWidth="1" strokeLinejoin="round" opacity="0.9" />
          {data.map((w, i) => (
            <circle key={w.id} cx={xOf(i)} cy={yOf(w.hrv as number)} r="1.3" fill="#c4b5fd" />
          ))}
          {/* Straight linear trend line over the period */}
          {trendPoly && (
            <polyline points={trendPoly} fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />
          )}
          {/* X-axis scale: month labels */}
          {monthLabels.map(ml => (
            <text key={ml.label + ml.x} x={ml.x} y={svgBottom + 18} fontSize="8" fill="#d1d5db" textAnchor="middle">{ml.label}</text>
          ))}
        </svg>
      ) : (
        <p className="text-sm text-gray-400 p-4">No HRV data in this range.</p>
      )}
      <div className="flex gap-3 px-3 pb-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded inline-block bg-violet-600" />trend</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded inline-block bg-violet-300" />daily HRV</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block" style={{ background: '#ede9fe' }} />normal range</span>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Replace `HrvSection` in `app/fitness/page.tsx` with a thin wrapper**

In `app/fitness/page.tsx`, delete the `HRV_RANGES` const and `HRV_STATUS_STYLE` const (lines 181-190 — the two consts immediately before `HrvSection`), and replace the entire `HrvSection` function (lines 192-305) with:

```typescript
function HrvSection({ wellness }: { wellness: ICUWellness[] }) {
  return (
    <SectionCard title="HRV" accent="bg-violet-500">
      <HrvChart wellness={wellness} />
    </SectionCard>
  )
}
```

Add the import near the top of the file, alongside the other component imports (e.g. next to `import WeightHistoryChart from '@/components/WeightHistoryChart'`):

```typescript
import HrvChart from '@/components/HrvChart'
```

Do **not** remove the existing `MONTHS` const (top of file), the `normalizeY` import, or the `computeHrvBaseline`/`HrvStatus` import — all three are still used elsewhere in this file (`RecoverySection` and other charts), just no longer by `HrvSection` specifically.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/components/HrvChart.test.tsx __tests__/components/FitnessPage.test.tsx`
Expected: PASS (both files — `FitnessPage.test.tsx` is included because it renders the full page, including `HrvSection`, and must still work through the new wrapper)

- [ ] **Step 6: Commit**

```bash
git add components/HrvChart.tsx app/fitness/page.tsx __tests__/components/HrvChart.test.tsx
git commit -m "refactor: extract HrvChart out of the Fitness page's HrvSection"
```

---

### Task 2: Add tap/hover tooltip and more visible dots to `HrvChart`

**Files:**
- Modify: `components/HrvChart.tsx` (entire file — see Step 3 for exact new contents)
- Test: `__tests__/components/HrvChart.test.tsx`

**Interfaces:**
- Consumes: `components/HrvChart.tsx` as produced by Task 1 (same external signature, no change).
- Produces: `HrvChart` now renders `data-testid="hrv-hit-{index}"` invisible hit-target rects and a `data-testid="hrv-tooltip"` popup when a point is active. No signature or prop changes — Task 3 consumes `HrvChart` exactly as Task 1 defined it.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/components/HrvChart.test.tsx`, inside the existing `describe('HrvChart', ...)` block, after the last existing test:

```typescript
  it('shows a tooltip with the date and exact HRV value when a point is tapped', () => {
    render(<HrvChart wellness={makeWellness(10)} />)
    fireEvent.click(screen.getByTestId('hrv-hit-9')) // most recent day, hrv = 59

    const tooltip = screen.getByTestId('hrv-tooltip')
    expect(tooltip).toHaveTextContent('59ms')
  })

  it('closes the tooltip when the same point is tapped again', () => {
    render(<HrvChart wellness={makeWellness(10)} />)
    const point = screen.getByTestId('hrv-hit-9')

    fireEvent.click(point)
    expect(screen.getByTestId('hrv-tooltip')).toBeInTheDocument()

    fireEvent.click(point)
    expect(screen.queryByTestId('hrv-tooltip')).not.toBeInTheDocument()
  })

  it('resets the open tooltip when the range changes', () => {
    render(<HrvChart wellness={makeWellness(10)} />)
    fireEvent.click(screen.getByTestId('hrv-hit-9'))
    expect(screen.getByTestId('hrv-tooltip')).toBeInTheDocument()

    fireEvent.click(screen.getByText('1w'))
    expect(screen.queryByTestId('hrv-tooltip')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/components/HrvChart.test.tsx -t "tooltip"`
Expected: FAIL — `getByTestId('hrv-hit-9')` finds nothing (no hit targets exist yet)

- [ ] **Step 3: Replace `components/HrvChart.tsx` with the interactive version**

Replace the entire file with:

```typescript
'use client'

import { useState, useEffect } from 'react'
import type { ICUWellness } from '@/types'
import { computeHrvBaseline, type HrvStatus } from '@/lib/hrv/baseline'
import { normalizeY } from '@/lib/chart-helpers'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const HRV_RANGES: { label: string; days: number }[] = [
  { label: '1w', days: 7 }, { label: '1m', days: 30 },
  { label: '3m', days: 91 }, { label: '6m', days: 182 }, { label: '12m', days: 365 },
]

const HRV_STATUS_STYLE: Record<string, { text: string; label: string }> = {
  suppressed: { text: 'text-rose-600', label: 'Suppressed' },
  balanced: { text: 'text-emerald-600', label: 'Balanced' },
  elevated: { text: 'text-violet-600', label: 'Elevated' },
  building: { text: 'text-slate-500', label: 'Building baseline' },
  no_data: { text: 'text-slate-400', label: 'No HRV data' },
}

// dateStr is YYYY-MM-DD; parsed and read with UTC getters (matching the month-label
// logic below) so the label doesn't shift a day depending on the browser's local timezone.
function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr)
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export default function HrvChart({
  wellness,
  defaultRangeDays = 91,
}: {
  wellness: ICUWellness[]
  defaultRangeDays?: number
}) {
  const [rangeDays, setRangeDays] = useState(defaultRangeDays)
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const status: HrvStatus = computeHrvBaseline(wellness)

  const cutoff = new Date(Date.now() - rangeDays * 864e5).toISOString().split('T')[0]
  const data = wellness.filter(w => w.hrv !== null && w.id >= cutoff)

  useEffect(() => setActiveIdx(null), [rangeDays])

  const svgLeft = 30, svgRight = 420, svgTop = 15, svgBottom = 105
  const svgViewW = svgRight + 10, svgViewH = 130
  const chartW = svgRight - svgLeft
  const vals = data.map(w => w.hrv as number)
  const lo = status.lowerBound, hi = status.upperBound
  const allY = [...vals, ...(lo ? [lo] : []), ...(hi ? [hi] : [])]
  const dataMin = allY.length ? Math.floor(Math.min(...allY) / 5) * 5 - 2 : 0
  const dataMax = allY.length ? Math.ceil(Math.max(...allY) / 5) * 5 + 2 : 100
  const xOf = (i: number) => svgLeft + (i / Math.max(data.length - 1, 1)) * chartW
  const yOf = (v: number) => normalizeY(v, dataMin, dataMax, svgTop, svgBottom)
  const xPct = (x: number) => `${(x / svgViewW * 100).toFixed(2)}%`
  const yPct = (y: number) => `${(y / svgViewH * 100).toFixed(2)}%`
  const pointGap = data.length > 1 ? chartW / (data.length - 1) : chartW

  // Raw daily HRV connected into a thin "detailed" line
  const detailPoly = data.map((w, i) => `${xOf(i)},${yOf(w.hrv as number)}`).join(' ')

  // Straight linear-regression trend over the chosen period (least squares on index vs HRV)
  let trendPoly: string | null = null
  if (vals.length >= 2) {
    const n = vals.length
    const meanX = (n - 1) / 2
    const meanY = vals.reduce((a, b) => a + b, 0) / n
    let num = 0, den = 0
    vals.forEach((v, i) => { num += (i - meanX) * (v - meanY); den += (i - meanX) ** 2 })
    const slope = den === 0 ? 0 : num / den
    const intercept = meanY - slope * meanX
    const y0 = intercept
    const y1 = intercept + slope * (n - 1)
    trendPoly = `${xOf(0)},${yOf(y0)} ${xOf(n - 1)},${yOf(y1)}`
  }

  // Y-axis scale: max / mid / min ticks
  const yTicks = [dataMax, Math.round((dataMin + dataMax) / 2), dataMin]
  const yTickYs = yTicks.map(v => yOf(v))

  // X-axis scale: month labels at each month boundary
  const monthLabels: { x: number; label: string }[] = []
  let lastMonth = -1
  data.forEach((w, i) => {
    const m = new Date(w.id).getUTCMonth()
    if (m !== lastMonth) { monthLabels.push({ x: xOf(i), label: MONTHS[m] }); lastMonth = m }
  })

  const st = HRV_STATUS_STYLE[status.label]
  const activePoint = activeIdx !== null ? data[activeIdx] : null

  return (
    <>
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
        <div className="relative">
          <svg viewBox={`0 0 ${svgViewW} ${svgViewH}`} className="w-full">
            {/* Y-axis scale: gridlines + ms labels */}
            {yTickYs.map((y, i) => (
              <g key={yTicks[i]}>
                <line x1={svgLeft} y1={y} x2={svgRight} y2={y} stroke="#f3f4f6" strokeWidth="1" />
                <text x={svgLeft - 4} y={y + 4} fontSize="9" fill="#d1d5db" textAnchor="end">{yTicks[i]}</text>
              </g>
            ))}
            <text x={6} y={svgTop + 2} fontSize="8" fill="#d1d5db" textAnchor="start">ms</text>
            {lo !== null && hi !== null && (
              <rect x={svgLeft} y={yOf(hi)} width={chartW} height={Math.max(0, yOf(lo) - yOf(hi))}
                fill="#ede9fe" opacity="0.7" />
            )}
            {/* Detailed daily line */}
            <polyline points={detailPoly} fill="none" stroke="#c4b5fd" strokeWidth="1" strokeLinejoin="round" opacity="0.9" />
            {/* Straight linear trend line over the period */}
            {trendPoly && (
              <polyline points={trendPoly} fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />
            )}
            {/* Daily HRV dots — larger "pop" style (white fill, violet stroke) for visibility,
                painted after the trend line so they're never hidden underneath it. */}
            {data.map((w, i) => (
              <circle key={w.id} cx={xOf(i)} cy={yOf(w.hrv as number)}
                r={data.length > 15 ? 2 : 2.8} fill="#fff" stroke="#7c3aed" strokeWidth="1.4" />
            ))}
            {/* X-axis scale: month labels */}
            {monthLabels.map(ml => (
              <text key={ml.label + ml.x} x={ml.x} y={svgBottom + 18} fontSize="8" fill="#d1d5db" textAnchor="middle">{ml.label}</text>
            ))}
            {/* Invisible per-day hit targets for the tap/hover tooltip */}
            {data.map((w, i) => (
              <rect
                key={`hit-${w.id}`}
                data-testid={`hrv-hit-${i}`}
                x={xOf(i) - pointGap / 2}
                y={svgTop}
                width={pointGap}
                height={svgBottom - svgTop}
                fill="transparent"
                onClick={() => setActiveIdx(cur => cur === i ? null : i)}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseLeave={() => setActiveIdx(cur => cur === i ? null : cur)}
                style={{ cursor: 'pointer' }}
              />
            ))}
          </svg>
          {activePoint && activeIdx !== null && (() => {
            const cx = xOf(activeIdx)
            const cy = yOf(activePoint.hrv as number)
            const pct = (cx / svgViewW) * 100
            // Past 55% of chart width, anchor from the right so the tooltip grows
            // leftward and never clips the right screen edge.
            const anchorRight = pct > 55
            const posStyle = anchorRight
              ? { right: `${100 - pct}%`, transform: 'translate(0, -100%) translateY(-8px)' }
              : { left: `${Math.max(18, pct)}%`, transform: 'translate(-50%, -100%) translateY(-8px)' }
            return (
              <div
                data-testid="hrv-tooltip"
                className="absolute z-10 bg-gray-900 text-white text-[10px] leading-snug rounded-lg px-2.5 py-2 shadow-lg pointer-events-none whitespace-nowrap"
                style={{ top: yPct(cy), ...posStyle }}
              >
                <div className="font-bold mb-1">{formatDayLabel(activePoint.id)}</div>
                <div>HRV <span className="text-violet-300">{Math.round(activePoint.hrv as number)}ms</span></div>
              </div>
            )
          })()}
        </div>
      ) : (
        <p className="text-sm text-gray-400 p-4">No HRV data in this range.</p>
      )}
      <div className="flex gap-3 px-3 pb-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded inline-block bg-violet-600" />trend</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded inline-block bg-violet-300" />daily HRV</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm inline-block" style={{ background: '#ede9fe' }} />normal range</span>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/components/HrvChart.test.tsx`
Expected: PASS (all tests in the file, including the 3 new tooltip tests)

- [ ] **Step 5: Commit**

```bash
git add components/HrvChart.tsx __tests__/components/HrvChart.test.tsx
git commit -m "feat: add tap/hover tooltip and more visible dots to HrvChart"
```

---

### Task 3: Dashboard collapsible HRV panel

**Files:**
- Modify: `components/MetricsBar.tsx` (see Steps 3-5 for exact changes)
- Modify: `app/dashboard/page.tsx:674-683`
- Test: `__tests__/components/MetricsBar.test.tsx`

**Interfaces:**
- Consumes: `components/HrvChart.tsx` as produced by Tasks 1-2 — `<HrvChart wellness={ICUWellness[]} defaultRangeDays={7} />`.
- Produces: `MetricsBar` gains a new optional prop `wellnessHistory?: ICUWellness[]`. This is the final task — nothing downstream consumes anything new from this task.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/components/MetricsBar.test.tsx`, as a new `describe` block after the existing `describe('MetricsBar strain trend tooltip', ...)` block:

```typescript
describe('MetricsBar HRV trend panel', () => {
  function daysAgo(n: number): string {
    return new Date(Date.now() - n * 864e5).toISOString().split('T')[0]
  }

  function makeWellnessHistory(n: number): ICUWellness[] {
    return Array.from({ length: n }, (_, i) => ({
      id: daysAgo(n - 1 - i), ctl: null, atl: null, form: null, hrv: 50 + i, resting_hr: null,
      sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null,
      stress_high: null, garmin_training_load: null, sleep_score: null,
    }))
  }

  it('does not show the HRV trend toggle when there is no HRV history', () => {
    render(<MetricsBar wellness={wellness} wellnessHistory={[]} />)
    expect(screen.queryByText('HRV trend')).not.toBeInTheDocument()
  })

  it('shows the HRV trend toggle and expands the chart on tap', () => {
    render(<MetricsBar wellness={wellness} wellnessHistory={makeWellnessHistory(10)} />)
    expect(screen.getByText('HRV trend')).toBeInTheDocument()
    expect(screen.queryByText('Building baseline')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('HRV trend'))
    expect(screen.getByText('Building baseline')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/components/MetricsBar.test.tsx -t "HRV trend panel"`
Expected: FAIL — "HRV trend" text does not exist anywhere yet

- [ ] **Step 3: Add the `HrvChart` import to `components/MetricsBar.tsx`**

At the top of `components/MetricsBar.tsx`, alongside the existing imports:

```typescript
import HrvChart from '@/components/HrvChart'
```

- [ ] **Step 4: Add the `wellnessHistory` prop, `hrvOpen` state, and `hasHrvHistory` gate**

In `components/MetricsBar.tsx`, replace:

```typescript
export default function MetricsBar({
  wellness,
  stale = {},
  embedded = false,
  lastRideLabel,
  onStrainTap,
  strainHistory,
  hrvStatus,
  todayDailyWellness,
}: {
  wellness: ICUWellness | null
  stale?: { hrv?: boolean; restingHr?: boolean }
  embedded?: boolean
  lastRideLabel?: string
  onStrainTap?: () => void
  strainHistory?: DailyStrainPoint[]
  hrvStatus?: HrvStatus | null
  todayDailyWellness?: { energy: number | null; leg_freshness: number | null } | null
}) {
  const [trendOpen, setTrendOpen] = useState(false)
  const [trendTab, setTrendTab] = useState<'1w' | '1m' | '3m'>('1w')
  const hasStrainHistory = (strainHistory?.length ?? 0) > 0
```

with:

```typescript
export default function MetricsBar({
  wellness,
  stale = {},
  embedded = false,
  lastRideLabel,
  onStrainTap,
  strainHistory,
  hrvStatus,
  todayDailyWellness,
  wellnessHistory,
}: {
  wellness: ICUWellness | null
  stale?: { hrv?: boolean; restingHr?: boolean }
  embedded?: boolean
  lastRideLabel?: string
  onStrainTap?: () => void
  strainHistory?: DailyStrainPoint[]
  hrvStatus?: HrvStatus | null
  todayDailyWellness?: { energy: number | null; leg_freshness: number | null } | null
  wellnessHistory?: ICUWellness[]
}) {
  const [trendOpen, setTrendOpen] = useState(false)
  const [trendTab, setTrendTab] = useState<'1w' | '1m' | '3m'>('1w')
  const [hrvOpen, setHrvOpen] = useState(false)
  const hasStrainHistory = (strainHistory?.length ?? 0) > 0
  const hasHrvHistory = (wellnessHistory ?? []).some(w => w.hrv !== null)
```

- [ ] **Step 5: Insert the collapsible HRV panel after the metrics row**

In `components/MetricsBar.tsx`, find this block (the closing of the CTL/ATL/Form/HRV/Resting-HR metrics row, immediately followed by the Training Status block):

```typescript
        {wellness.resting_hr !== null && (
          <Metric label="Resting HR" value={wellness.resting_hr} valueClass="text-rose-500" unit="bpm" stale={stale.restingHr} />
        )}
      </div>

      {wellness?.garmin_training_status && TRAINING_STATUS_CONFIG[wellness.garmin_training_status] && (
```

Replace it with (inserting the new collapsible panel between the two):

```typescript
        {wellness.resting_hr !== null && (
          <Metric label="Resting HR" value={wellness.resting_hr} valueClass="text-rose-500" unit="bpm" stale={stale.restingHr} />
        )}
      </div>

      {hasHrvHistory && (
        <>
          <div
            className="flex items-center justify-between px-3.5 py-2 cursor-pointer select-none"
            onClick={() => setHrvOpen(o => !o)}
          >
            <span className={`text-[11px] font-bold uppercase tracking-[0.06em] ${hrvOpen ? 'text-gray-600' : 'text-gray-400'}`}>
              HRV trend
            </span>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              {hrvOpen
                ? <path d="M3 9l4-4 4 4" stroke="#4b5563" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                : <path d="M3 5l4 4 4-4" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              }
            </svg>
          </div>

          {hrvOpen && (
            <div className="border-t border-gray-100">
              <HrvChart wellness={wellnessHistory ?? []} defaultRangeDays={7} />
            </div>
          )}
        </>
      )}

      {wellness?.garmin_training_status && TRAINING_STATUS_CONFIG[wellness.garmin_training_status] && (
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest __tests__/components/MetricsBar.test.tsx`
Expected: PASS (all tests in the file, including the 2 new ones — this also confirms the pre-existing tests, which don't pass `wellnessHistory`, are unaffected)

- [ ] **Step 7: Wire `wellnessArr` through from the Dashboard page**

In `app/dashboard/page.tsx`, find the `<MetricsBar ...>` call:

```typescript
          <MetricsBar
            wellness={latestWellnessWithLoad}
            stale={wellnessStale}
            embedded
            lastRideLabel={lastRide ? formatLastRide() : undefined}
            onStrainTap={() => setStrainSheetOpen(true)}
            strainHistory={chartsData?.dailyStrain}
            hrvStatus={hrvStatus}
            todayDailyWellness={todayDailyWellnessForCard}
          />
```

Replace it with:

```typescript
          <MetricsBar
            wellness={latestWellnessWithLoad}
            stale={wellnessStale}
            embedded
            lastRideLabel={lastRide ? formatLastRide() : undefined}
            onStrainTap={() => setStrainSheetOpen(true)}
            strainHistory={chartsData?.dailyStrain}
            hrvStatus={hrvStatus}
            todayDailyWellness={todayDailyWellnessForCard}
            wellnessHistory={wellnessArr}
          />
```

- [ ] **Step 8: Run typecheck and the full test suite**

Run: `npm run typecheck`
Expected: no errors

Run: `npx jest`
Expected: all suites pass (aside from any pre-existing, unrelated failures already present on `master` before this branch — none are expected at this point)

- [ ] **Step 9: Manual verification**

`app/dashboard/page.tsx` has no dedicated test file (established convention for large interactive pages in this codebase — verified via typecheck + full suite + manual reasoning instead). Start the dev server (`npm run dev`) and confirm on the Dashboard, for an athlete with HRV history:
- The new "HRV trend" toggle appears directly under the metrics row (CTL/ATL/Form/HRV/Resting HR), above Training Status / Strain trend, collapsed by default.
- Tapping it expands the chart, defaulted to the 1-week view (the "1w" range button highlighted).
- Tapping a day's point shows the tooltip with its date and exact HRV value; tapping again closes it.
- The dots are visibly larger/more prominent than before this change.
- On the Fitness page, the HRV chart still works exactly as before (still defaults to 3 months), with the same new tooltip/dot behavior.
- Confirm on a narrow viewport (375px) that the new panel doesn't overflow or clip.

- [ ] **Step 10: Commit**

```bash
git add components/MetricsBar.tsx app/dashboard/page.tsx __tests__/components/MetricsBar.test.tsx
git commit -m "feat: add collapsible HRV trend panel to the dashboard"
```
