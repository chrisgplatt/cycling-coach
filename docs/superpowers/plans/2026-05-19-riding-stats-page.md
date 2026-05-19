# Riding Stats Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Stats page showing 4-week riding aggregates (best 5/10/20 min power, distance, elevation, duration, L/R balance) accessible via a new nav link.

**Architecture:** New vertical slice — `lib/stats-helpers.ts` for pure computation functions, `app/api/stats/route.ts` fetches from intervals.icu and returns aggregated `RidingStats`, `app/stats/page.tsx` fetches on mount and renders. `ICUActivity` type is extended with three new fields; `IntervalsClient.getActivities()` maps them. NavBar gains a Stats link.

**Tech Stack:** Next.js App Router, TypeScript, intervals.icu REST API via `IntervalsClient`, React Testing Library + Jest, Tailwind CSS.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `types/index.ts` | Modify | Add `distance`, `total_elevation_gain`, `left_right_balance` to `ICUActivity`; add `RidingStats` interface |
| `lib/intervals/client.ts` | Modify | Map three new fields in `getActivities()` |
| `lib/stats-helpers.ts` | Create | Pure functions: `findNearestPower`, `computeLeftRightBalance` |
| `app/api/stats/route.ts` | Create | GET handler — fetches activities + power curve, computes and returns `RidingStats` |
| `app/stats/page.tsx` | Create | Client page — fetches `/api/stats`, renders three stat sections |
| `components/NavBar.tsx` | Modify | Add `{ href: '/stats', label: 'Stats' }` to `NAV_LINKS` |
| `__tests__/lib/stats-helpers.test.ts` | Create | Unit tests for `findNearestPower` and `computeLeftRightBalance` |
| `__tests__/app/stats/page.test.tsx` | Create | Render tests for `StatsPage` (loading, loaded, error states) |
| `__tests__/components/NavBar.test.tsx` | Modify | Add assertion for Stats link |

---

## Task 1: Extend types

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add three fields to `ICUActivity`**

Open `types/index.ts`. The `ICUActivity` interface currently ends at `rolling_ftp`. Add the three new fields immediately after `rolling_ftp`:

```ts
export interface ICUActivity {
  id: string
  start_date_local: string
  type: string
  moving_time: number
  name: string
  average_watts: number | null
  max_watts: number | null
  weighted_average_watts: number | null
  average_heartrate: number | null
  training_load: number | null
  rolling_ftp: number | null
  distance: number | null              // metres
  total_elevation_gain: number | null  // metres
  left_right_balance: number | null    // left %, e.g. 52.3
}
```

- [ ] **Step 2: Add `RidingStats` interface**

Add this new interface immediately after the `ICUSyncData` interface in `types/index.ts`:

```ts
export interface RidingStats {
  ride_count: number
  total_distance_km: number
  total_elevation_m: number
  total_duration_secs: number
  power_5min: number | null
  power_10min: number | null
  power_20min: number | null
  avg_left_right_balance: number | null  // left %, e.g. 52.3
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts
git commit -m "feat: add distance/elevation/balance fields to ICUActivity and RidingStats type"
```

---

## Task 2: Extend IntervalsClient.getActivities()

**Files:**
- Modify: `lib/intervals/client.ts`

- [ ] **Step 1: Map the three new fields**

In `lib/intervals/client.ts`, `getActivities()` contains a `.map(a => ({...}))` call that currently ends with `rolling_ftp`. Extend it to also map the three new fields:

```ts
async getActivities(oldest: string, newest: string): Promise<ICUActivity[]> {
  const raw = await this.request<Record<string, unknown>[]>(
    `/athlete/${this.athleteId}/activities?oldest=${oldest}&newest=${newest}`
  )
  return raw.map(a => ({
    id: a.id as string,
    start_date_local: a.start_date_local as string,
    type: a.type as string,
    moving_time: a.moving_time as number,
    name: a.name as string,
    average_watts: (a.icu_average_watts ?? null) as number | null,
    max_watts: (a.p_max ?? null) as number | null,
    weighted_average_watts: (a.icu_weighted_avg_watts ?? null) as number | null,
    average_heartrate: (a.average_heartrate ?? null) as number | null,
    training_load: (a.icu_training_load ?? null) as number | null,
    rolling_ftp: (a.icu_rolling_ftp ?? null) as number | null,
    distance: (a.distance ?? null) as number | null,
    total_elevation_gain: (a.total_elevation_gain ?? null) as number | null,
    left_right_balance: (a.left_right_balance ?? null) as number | null,
  }))
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/intervals/client.ts
git commit -m "feat: map distance, elevation, and L/R balance in getActivities"
```

---

## Task 3: Stats helper functions (TDD)

**Files:**
- Create: `lib/stats-helpers.ts`
- Create: `__tests__/lib/stats-helpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/stats-helpers.test.ts`:

```ts
import { findNearestPower, computeLeftRightBalance } from '@/lib/stats-helpers'
import type { ICUPowerCurvePoint } from '@/types'

describe('findNearestPower', () => {
  it('returns null for empty curve', () => {
    expect(findNearestPower([], 300)).toBeNull()
  })

  it('returns watts for exact match', () => {
    const curve: ICUPowerCurvePoint[] = [{ secs: 300, watts: 320 }]
    expect(findNearestPower(curve, 300)).toBe(320)
  })

  it('returns watts for nearest point within 30s', () => {
    const curve: ICUPowerCurvePoint[] = [{ secs: 295, watts: 315 }]
    expect(findNearestPower(curve, 300)).toBe(315)
  })

  it('returns null when nearest point is more than 30s away', () => {
    const curve: ICUPowerCurvePoint[] = [{ secs: 260, watts: 350 }]
    expect(findNearestPower(curve, 300)).toBeNull()
  })

  it('picks the closest of multiple candidates', () => {
    const curve: ICUPowerCurvePoint[] = [
      { secs: 290, watts: 310 },
      { secs: 302, watts: 318 },
    ]
    expect(findNearestPower(curve, 300)).toBe(318)
  })
})

describe('computeLeftRightBalance', () => {
  it('returns null for empty array', () => {
    expect(computeLeftRightBalance([])).toBeNull()
  })

  it('returns null when all values are null', () => {
    expect(computeLeftRightBalance([
      { left_right_balance: null },
      { left_right_balance: null },
    ])).toBeNull()
  })

  it('returns average of non-null values, ignoring nulls', () => {
    expect(computeLeftRightBalance([
      { left_right_balance: 52 },
      { left_right_balance: 50 },
      { left_right_balance: null },
    ])).toBe(51)
  })

  it('returns the single non-null value unchanged', () => {
    expect(computeLeftRightBalance([{ left_right_balance: 48.5 }])).toBe(48.5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/lib/stats-helpers.test.ts --no-coverage
```

Expected: FAIL — "Cannot find module '@/lib/stats-helpers'"

- [ ] **Step 3: Implement the helper functions**

Create `lib/stats-helpers.ts`:

```ts
import type { ICUPowerCurvePoint } from '@/types'

export function findNearestPower(curve: ICUPowerCurvePoint[], targetSecs: number): number | null {
  if (curve.length === 0) return null
  const nearest = curve.reduce((best, p) =>
    Math.abs(p.secs - targetSecs) < Math.abs(best.secs - targetSecs) ? p : best
  )
  return Math.abs(nearest.secs - targetSecs) <= 30 ? nearest.watts : null
}

export function computeLeftRightBalance(
  activities: Array<{ left_right_balance: number | null }>
): number | null {
  const values = activities
    .map(a => a.left_right_balance)
    .filter((v): v is number => v !== null)
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/lib/stats-helpers.test.ts --no-coverage
```

Expected: PASS — 9 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/stats-helpers.ts __tests__/lib/stats-helpers.test.ts
git commit -m "feat: add findNearestPower and computeLeftRightBalance helpers with tests"
```

---

## Task 4: Stats API route

**Files:**
- Create: `app/api/stats/route.ts`

- [ ] **Step 1: Create the route handler**

Create `app/api/stats/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { findNearestPower, computeLeftRightBalance } from '@/lib/stats-helpers'
import type { RidingStats } from '@/types'

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

  const today = new Date()
  const oldest = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const newest = today.toISOString().split('T')[0]

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  try {
    const [activities, powerCurve] = await Promise.all([
      client.getActivities(oldest, newest),
      client.getPowerCurve(oldest, newest),
    ])

    const rides = activities.filter(a => /ride/i.test(a.type))

    const stats: RidingStats = {
      ride_count: rides.length,
      total_distance_km: rides.reduce((sum, r) => sum + (r.distance ?? 0), 0) / 1000,
      total_elevation_m: rides.reduce((sum, r) => sum + (r.total_elevation_gain ?? 0), 0),
      total_duration_secs: rides.reduce((sum, r) => sum + r.moving_time, 0),
      power_5min: findNearestPower(powerCurve, 300),
      power_10min: findNearestPower(powerCurve, 600),
      power_20min: findNearestPower(powerCurve, 1200),
      avg_left_right_balance: computeLeftRightBalance(rides),
    }

    return NextResponse.json({ stats })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/stats/route.ts
git commit -m "feat: add GET /api/stats route for 28-day riding aggregates"
```

---

## Task 5: Stats page

**Files:**
- Create: `app/stats/page.tsx`

- [ ] **Step 1: Create the page component**

Create `app/stats/page.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import type { RidingStats } from '@/types'

function StatCell({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex-1 text-center px-2 py-3 sm:px-3 sm:py-4">
      <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">
        {value}
        {unit && <span className="text-xs font-medium text-gray-400 ml-0.5">{unit}</span>}
      </div>
      <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">{label}</div>
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return `${h}h ${m}m`
}

export default function StatsPage() {
  const [stats, setStats] = useState<RidingStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setStats(data.stats)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    )
  }

  if (!stats) return null

  const balance = stats.avg_left_right_balance !== null
    ? `${stats.avg_left_right_balance.toFixed(1)}% L / ${(100 - stats.avg_left_right_balance).toFixed(1)}% R`
    : '—'

  return (
    <main className="max-w-xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Stats</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Last 28 days · {stats.ride_count} ride{stats.ride_count !== 1 ? 's' : ''}
        </p>
      </div>

      <SectionCard title="Best Power">
        <div className="flex divide-x divide-gray-100">
          <StatCell
            label="5 min"
            value={stats.power_5min !== null ? String(Math.round(stats.power_5min)) : '—'}
            unit={stats.power_5min !== null ? 'w' : undefined}
          />
          <StatCell
            label="10 min"
            value={stats.power_10min !== null ? String(Math.round(stats.power_10min)) : '—'}
            unit={stats.power_10min !== null ? 'w' : undefined}
          />
          <StatCell
            label="20 min"
            value={stats.power_20min !== null ? String(Math.round(stats.power_20min)) : '—'}
            unit={stats.power_20min !== null ? 'w' : undefined}
          />
        </div>
      </SectionCard>

      <SectionCard title="Totals">
        <div className="flex divide-x divide-gray-100">
          <StatCell label="Distance" value={stats.total_distance_km.toFixed(1)} unit="km" />
          <StatCell label="Elevation" value={String(Math.round(stats.total_elevation_m))} unit="m" />
          <StatCell label="Duration" value={formatDuration(stats.total_duration_secs)} />
        </div>
      </SectionCard>

      <SectionCard title="L/R Balance">
        <div className="text-center px-2 py-3 sm:px-3 sm:py-4">
          <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">{balance}</div>
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">Avg Left / Right</div>
        </div>
      </SectionCard>
    </main>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/stats/page.tsx
git commit -m "feat: add Stats page with 28-day riding metrics"
```

---

## Task 6: Stats page tests

**Files:**
- Create: `__tests__/app/stats/page.test.tsx`

- [ ] **Step 1: Write the tests**

Create `__tests__/app/stats/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import StatsPage from '@/app/stats/page'
import type { RidingStats } from '@/types'

const mockStats: RidingStats = {
  ride_count: 8,
  total_distance_km: 342.5,
  total_elevation_m: 4200,
  total_duration_secs: 43200,  // 12h 0m
  power_5min: 380,
  power_10min: 355,
  power_20min: 320,
  avg_left_right_balance: 52.3,
}

global.fetch = jest.fn()

describe('StatsPage', () => {
  it('shows loading spinner initially', () => {
    ;(global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}))
    render(<StatsPage />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders power stats after load', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => ({ stats: mockStats }) })
    render(<StatsPage />)
    expect(await screen.findByText('380')).toBeInTheDocument()
    expect(screen.getByText('355')).toBeInTheDocument()
    expect(screen.getByText('320')).toBeInTheDocument()
  })

  it('renders totals after load', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => ({ stats: mockStats }) })
    render(<StatsPage />)
    expect(await screen.findByText('342.5')).toBeInTheDocument()
    expect(screen.getByText('4200')).toBeInTheDocument()
    expect(screen.getByText('12h 0m')).toBeInTheDocument()
  })

  it('renders balance after load', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => ({ stats: mockStats }) })
    render(<StatsPage />)
    expect(await screen.findByText('52.3% L / 47.7% R')).toBeInTheDocument()
  })

  it('shows — for null power values', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({
        stats: { ...mockStats, power_5min: null, power_10min: null, power_20min: null },
      }),
    })
    render(<StatsPage />)
    await screen.findByText('342.5')
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(3)
  })

  it('shows — for null balance', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ stats: { ...mockStats, avg_left_right_balance: null } }),
    })
    render(<StatsPage />)
    await screen.findByText('342.5')
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })

  it('shows error message on fetch failure', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ error: 'intervals.icu not configured' }),
    })
    render(<StatsPage />)
    expect(await screen.findByText('intervals.icu not configured')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx jest __tests__/app/stats/page.test.tsx --no-coverage
```

Expected: PASS — 7 tests passing.

- [ ] **Step 3: Commit**

```bash
git add __tests__/app/stats/page.test.tsx
git commit -m "test: add StatsPage render tests"
```

---

## Task 7: NavBar — add Stats link

**Files:**
- Modify: `components/NavBar.tsx`
- Modify: `__tests__/components/NavBar.test.tsx`

- [ ] **Step 1: Write the failing test first**

Open `__tests__/components/NavBar.test.tsx` and add one new test inside the existing `describe('NavBar', ...)` block:

```ts
it('renders Stats link pointing to /stats', () => {
  render(<NavBar />)
  expect(screen.getByRole('link', { name: 'Stats' })).toHaveAttribute('href', '/stats')
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest __tests__/components/NavBar.test.tsx --no-coverage
```

Expected: FAIL — `Unable to find an accessible element with the role "link" and name "Stats"`

- [ ] **Step 3: Add Stats to NAV_LINKS**

In `components/NavBar.tsx`, the `NAV_LINKS` array currently reads:

```ts
const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/plan', label: 'Plan' },
  { href: '/fitness', label: 'Fitness' },
  { href: '/settings', label: 'Account' },
]
```

Add the Stats entry in second position (after Dashboard):

```ts
const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/stats', label: 'Stats' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/plan', label: 'Plan' },
  { href: '/fitness', label: 'Fitness' },
  { href: '/settings', label: 'Account' },
]
```

- [ ] **Step 4: Run all NavBar tests to verify they pass**

```bash
npx jest __tests__/components/NavBar.test.tsx --no-coverage
```

Expected: PASS — all tests including the new Stats link test.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/NavBar.tsx __tests__/components/NavBar.test.tsx
git commit -m "feat: add Stats nav link"
```
