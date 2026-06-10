# Fitness Trend Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the RPE sparkline below MetricsBar on the dashboard with a compact CTL + per-session HR dual chart with 1M/3M/6M/12M time-window tabs.

**Architecture:** Four small changes: add a `RidePoint` type + extend `ChartsData`; extend the charts API to expose per-activity HR alongside existing wellness; create a new `CtlTrendStrip` client component that fetches `/api/charts` and renders a dual-axis SVG; swap the old `RpeTrendStrip` for the new component in the dashboard.

**Tech Stack:** Next.js App Router, React, Tailwind CSS, pure SVG (no chart library), Jest + React Testing Library.

---

## File Map

| File | Action |
|------|--------|
| `types/index.ts` | Add `RidePoint` interface; add `rides: RidePoint[]` to `ChartsData` |
| `app/api/charts/route.ts` | Extend activities window from 112→365 days; map all activities → `rides`; include in response |
| `components/CtlTrendStrip.tsx` | New component — fetches `/api/charts`, renders tab bar + dual SVG |
| `__tests__/components/CtlTrendStrip.test.tsx` | New test file |
| `app/dashboard/page.tsx` | Swap `RpeTrendStrip` import + JSX for `CtlTrendStrip` |
| `components/RpeTrendStrip.tsx` | Delete |

---

## Task 1: Add `RidePoint` type and extend `ChartsData`

**Files:**
- Modify: `types/index.ts` (around line 319 — the `ChartsData` interface)

- [ ] **Step 1: Add `RidePoint` and update `ChartsData`**

Open `types/index.ts`. Find the `WeeklyTss` interface (around line 314) and the `ChartsData` interface (around line 319). Add `RidePoint` immediately before `ChartsData`, then extend `ChartsData`:

```typescript
export interface RidePoint {
  date: string          // YYYY-MM-DD
  avgHr: number | null
}

export interface ChartsData {
  wellness: ICUWellness[]
  weeklyTss: WeeklyTss[]
  rides: RidePoint[]
}
```

- [ ] **Step 2: Verify types compile**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add types/index.ts
git commit -m "types: add RidePoint; extend ChartsData with rides"
```

---

## Task 2: Update charts API to expose per-activity HR

**Files:**
- Modify: `app/api/charts/route.ts`

**Context:** The route currently fetches activities for only 112 days (needed for weekly TSS bars). We need 365 days to cover the 12M HR window. The `rides` variable in the route is already filtered to cycling-only (`/ride/i.test(a.type)`) for TSS — but the new `rides` array for HR should include **all** activity types (per spec). Rename the local cycling-only variable to `cyclingRides` to avoid collision.

- [ ] **Step 1: Update the route**

Replace the full content of `app/api/charts/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { isoWeekStart } from '@/lib/chart-helpers'
import type { ChartsData, WeeklyTss, RidePoint } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key')
    .maybeSingle()

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 })

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const today = new Date()
  const newest = today.toISOString().split('T')[0]
  // Both wellness and activities fetched for 365 days so all time windows are covered
  const oldest = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0]

  const client = new IntervalsClient(
    profile.intervals_icu_athlete_id,
    profile.intervals_icu_api_key,
  )

  try {
    const [wellness, activities] = await Promise.all([
      client.getWellness(oldest, newest),
      client.getActivities(oldest, newest),
    ])

    // Weekly TSS — cycling only
    const cyclingRides = activities.filter(a => /ride/i.test(a.type))
    const tssMap = new Map<string, number>()
    for (const ride of cyclingRides) {
      const week = isoWeekStart(ride.start_date_local)
      tssMap.set(week, (tssMap.get(week) ?? 0) + (ride.training_load ?? 0))
    }
    const weeklyTss: WeeklyTss[] = Array.from(tssMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, tss]) => ({ weekStart, tss: Math.round(tss) }))

    // Per-activity HR — all types
    const rides: RidePoint[] = activities.map(a => ({
      date: a.start_date_local.slice(0, 10),
      avgHr: a.average_heartrate,
    }))

    const charts: ChartsData = { wellness, weeklyTss, rides }
    return NextResponse.json({ charts })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
```

- [ ] **Step 2: Verify types compile**

```powershell
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add app/api/charts/route.ts
git commit -m "feat: extend charts API — 365-day activities window + per-activity HR in rides array"
```

---

## Task 3: Create `CtlTrendStrip` component

**Files:**
- Create: `components/CtlTrendStrip.tsx`
- Create: `__tests__/components/CtlTrendStrip.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/CtlTrendStrip.test.tsx`:

```typescript
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CtlTrendStrip from '@/components/CtlTrendStrip'
import type { ChartsData } from '@/types'

// Build dates relative to today so the 3m filter always includes them
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const mockCharts: ChartsData = {
  wellness: [
    { id: daysAgo(80), ctl: 55, atl: 60, form: -5, hrv: null, resting_hr: null, sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null },
    { id: daysAgo(10), ctl: 62, atl: 65, form: -3, hrv: null, resting_hr: null, sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null },
    { id: daysAgo(5),  ctl: 68, atl: 70, form: -2, hrv: null, resting_hr: null, sleep_secs: null, body_battery_low: null, body_battery_high: null, stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null },
  ],
  weeklyTss: [],
  rides: [
    { date: daysAgo(70), avgHr: 138 },
    { date: daysAgo(9),  avgHr: 142 },
    { date: daysAgo(4),  avgHr: 143 },
  ],
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ charts: mockCharts }),
  } as unknown as Response)
})

afterEach(() => {
  jest.restoreAllMocks()
})

it('renders nothing before data loads', () => {
  const { container } = render(<CtlTrendStrip />)
  expect(container.firstChild).toBeNull()
})

it('renders the strip after data loads', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  expect(screen.getByTestId('ctl-trend-strip')).toBeInTheDocument()
})

it('shows current CTL value', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  expect(screen.getByText(/CTL 68/)).toBeInTheDocument()
})

it('shows current HR value', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  expect(screen.getByText(/HR 143 bpm/)).toBeInTheDocument()
})

it('renders the SVG with CTL path and HR dots', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  const svg = screen.getByTestId('ctl-trend-svg')
  expect(svg.querySelector('path')).not.toBeNull()    // CTL line
  expect(svg.querySelectorAll('circle').length).toBe(3) // 3 HR dots
})

it('renders time-range tabs', async () => {
  await act(async () => { render(<CtlTrendStrip />) })
  expect(screen.getByRole('button', { name: /1m/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /3m/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /6m/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /12m/i })).toBeInTheDocument()
})

it('changing range tab re-filters data', async () => {
  const user = userEvent.setup()
  await act(async () => { render(<CtlTrendStrip />) })
  // Switch to 3m — daysAgo(80) CTL point is excluded; only 2 points remain, strip still renders
  await user.click(screen.getByRole('button', { name: /3m/i }))
  expect(screen.getByTestId('ctl-trend-strip')).toBeInTheDocument()
  // HR dots within 3m: daysAgo(9) and daysAgo(4) — 2 dots
  expect(screen.getByTestId('ctl-trend-svg').querySelectorAll('circle').length).toBe(2)
})

it('renders nothing when fetch fails', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network'))
  await act(async () => { render(<CtlTrendStrip />) })
  expect(screen.queryByTestId('ctl-trend-strip')).toBeNull()
})

it('applies embedded styling when embedded prop is true', async () => {
  await act(async () => { render(<CtlTrendStrip embedded />) })
  const strip = screen.getByTestId('ctl-trend-strip')
  // embedded version has no bg-white/border classes
  expect(strip.className).not.toContain('bg-white')
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```powershell
npx jest __tests__/components/CtlTrendStrip.test.tsx --no-coverage
```

Expected: all tests FAIL with "Cannot find module '@/components/CtlTrendStrip'".

- [ ] **Step 3: Create the component**

Create `components/CtlTrendStrip.tsx`:

```typescript
'use client'
import { useEffect, useState } from 'react'
import type { ChartsData } from '@/types'

type Range = '1m' | '3m' | '6m' | '12m'

const RANGE_MONTHS: Record<Range, number> = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }
const RANGES: Range[] = ['1m', '3m', '6m', '12m']

const W = 320, H = 64, PAD = 4

export default function CtlTrendStrip({ embedded = false }: { embedded?: boolean }) {
  const [data, setData] = useState<ChartsData | null>(null)
  const [range, setRange] = useState<Range>('3m')

  useEffect(() => {
    fetch('/api/charts')
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d?.charts ?? null))
      .catch(() => setData(null))
  }, [])

  if (!data) return null

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - RANGE_MONTHS[range])
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const ctlPoints = (data.wellness ?? []).filter(w => w.id >= cutoffStr && w.ctl !== null)
  const hrPoints  = (data.rides ?? []).filter(r => r.date >= cutoffStr && r.avgHr !== null)

  if (ctlPoints.length < 2) return null

  // Shared x-axis (time)
  const startMs = new Date(ctlPoints[0].id).getTime()
  const endMs   = new Date(ctlPoints[ctlPoints.length - 1].id).getTime()
  const spanMs  = Math.max(endMs - startMs, 1)
  const xOf = (dateStr: string) =>
    PAD + ((new Date(dateStr).getTime() - startMs) / spanMs) * (W - PAD * 2)

  // CTL y-axis (left)
  const ctlVals = ctlPoints.map(w => w.ctl as number)
  const ctlMin  = Math.min(...ctlVals) - 5
  const ctlMax  = Math.max(...ctlVals) + 5
  const ctlY = (v: number) =>
    PAD + ((ctlMax - v) / (ctlMax - ctlMin)) * (H - PAD * 2)

  // HR y-axis (right — independent scale)
  const hrVals = hrPoints.map(r => r.avgHr as number)
  const hrMin  = hrVals.length ? Math.min(...hrVals) - 5 : 0
  const hrMax  = hrVals.length ? Math.max(...hrVals) + 5 : 200
  const hrY = (v: number) =>
    PAD + ((hrMax - v) / (hrMax - hrMin)) * (H - PAD * 2)

  // CTL path
  const ctlPath = ctlPoints
    .map((w, i) => `${i === 0 ? 'M' : 'L'}${xOf(w.id).toFixed(1)},${ctlY(w.ctl as number).toFixed(1)}`)
    .join(' ')

  // Current-value badges
  const latestCtl = ctlVals[ctlVals.length - 1] ?? null
  const latestHr  = hrVals.length ? hrVals[hrVals.length - 1] : null

  const inner = (
    <div>
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex gap-1">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`text-[11px] font-bold uppercase tracking-wide px-2 py-1.5 rounded-full transition-colors ${
                r === range
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold">
          {latestCtl !== null && (
            <span className="text-blue-600">CTL {Math.round(latestCtl)}</span>
          )}
          {latestHr !== null && (
            <>
              <span className="text-gray-300" aria-hidden="true">·</span>
              <span className="text-rose-500">HR {Math.round(latestHr)} bpm</span>
            </>
          )}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        preserveAspectRatio="none"
        aria-hidden="true"
        data-testid="ctl-trend-svg"
        className="px-1"
      >
        <path
          d={ctlPath}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hrPoints.map((r, i) => (
          <circle
            key={i}
            cx={xOf(r.date)}
            cy={hrY(r.avgHr as number)}
            r={2}
            fill="#f43f5e"
          />
        ))}
      </svg>
    </div>
  )

  if (embedded) {
    return <div data-testid="ctl-trend-strip">{inner}</div>
  }
  return (
    <div data-testid="ctl-trend-strip" className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {inner}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```powershell
npx jest __tests__/components/CtlTrendStrip.test.tsx --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```powershell
npx jest --no-coverage
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```powershell
git add components/CtlTrendStrip.tsx __tests__/components/CtlTrendStrip.test.tsx
git commit -m "feat: add CtlTrendStrip — CTL + per-session HR chart with 1M/3M/6M/12M tabs"
```

---

## Task 4: Wire into dashboard and delete `RpeTrendStrip`

**Files:**
- Modify: `app/dashboard/page.tsx`
- Delete: `components/RpeTrendStrip.tsx`

- [ ] **Step 1: Swap the import in `app/dashboard/page.tsx`**

Find the line (near the top of the file):
```typescript
import RpeTrendStrip from '@/components/RpeTrendStrip'
```

Replace with:
```typescript
import CtlTrendStrip from '@/components/CtlTrendStrip'
```

- [ ] **Step 2: Swap the JSX usage**

Find (in the dashboard JSX, near MetricsBar):
```tsx
<RpeTrendStrip embedded />
```

Replace with:
```tsx
<CtlTrendStrip embedded />
```

- [ ] **Step 3: Delete `RpeTrendStrip`**

```powershell
Remove-Item components/RpeTrendStrip.tsx
```

- [ ] **Step 4: Verify types compile**

```powershell
npx tsc --noEmit
```

Expected: no errors. (If `RpeTrendStrip` is referenced elsewhere the compiler will tell you — fix those references if any.)

- [ ] **Step 5: Run full test suite**

```powershell
npx jest --no-coverage
```

Expected: all tests pass. (There is no `RpeTrendStrip.test.tsx` to worry about.)

- [ ] **Step 6: Commit**

```powershell
git add app/dashboard/page.tsx
git add -u components/RpeTrendStrip.tsx
git commit -m "feat: replace RpeTrendStrip with CtlTrendStrip on dashboard"
```
