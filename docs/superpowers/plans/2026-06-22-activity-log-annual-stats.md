# Activity Log & Annual Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "This Year" tab (annual totals + monthly bar chart + year selector) and an "Activity Log" tab (paginated reverse-chronological activity list) to the Stats page.

**Architecture:** Two new API routes fetch from `IntervalsClient.getActivities()`. Two new self-contained React components consume those routes. `app/stats/page.tsx` gets its tab state widened from `number` to a string/number union and conditionally renders the new components.

**Tech Stack:** Next.js App Router, TypeScript strict mode, React Testing Library, Jest, Tailwind CSS, `@testing-library/user-event`

## Global Constraints

- Mobile-first PWA: design for 375px width minimum; touch targets ≥44px tall
- TypeScript strict mode — no `any`, no `!` non-null assertions
- No new Supabase tables or schema changes
- No annual goals/targets — display only
- No social/sharing features
- `force-dynamic` on all new API routes
- Test files use `/** @jest-environment node */` for API route tests, `jsdom` (default) for component tests
- Run tests with: `npx jest --testPathPattern=<pattern> --no-coverage`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `app/api/stats/year/route.ts` | Create | Yearly totals + monthly breakdown endpoint |
| `app/api/activities/route.ts` | Create | Paginated activity log endpoint |
| `components/YearView.tsx` | Create | Year headline stats + monthly bar chart + year selector |
| `components/ActivityLogView.tsx` | Create | Paginated activity list + ActivityDetailModal integration |
| `app/stats/page.tsx` | Modify | Add new tabs, widen tab state type |
| `__tests__/api/stats-year.test.ts` | Create | Route handler unit tests |
| `__tests__/api/activities.test.ts` | Create | Route handler unit tests |
| `__tests__/components/YearView.test.tsx` | Create | Component render + interaction tests |
| `__tests__/components/ActivityLogView.test.tsx` | Create | Component render + pagination + modal tests |
| `__tests__/app/stats/page.test.tsx` | Modify | Add new-tab smoke tests |

---

## Task 1: `/api/stats/year` route

**Files:**
- Create: `app/api/stats/year/route.ts`
- Test: `__tests__/api/stats-year.test.ts`

**Interfaces:**
- Consumes: `IntervalsClient.getActivities(start: string, end: string): Promise<ICUActivity[]>`
- Produces:
  ```typescript
  // GET /api/stats/year?year=YYYY
  interface YearStats {
    year: number
    totalRides: number
    totalKm: number          // rounded to 1 d.p.
    totalElevationM: number  // rounded integer
    totalMovingTimeSecs: number
    monthly: { month: number; km: number }[]  // always 12 entries, months 1–12
  }
  ```

- [ ] **Step 1: Write failing tests**

Create `__tests__/api/stats-year.test.ts`:

```typescript
/** @jest-environment node */
import { GET } from '@/app/api/stats/year/route'

const mockGetActivities = jest.fn()

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getActivities: mockGetActivities,
  })),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase(user: { id: string } | null, profile: unknown) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({ maybeSingle: async () => ({ data: profile }) }),
    }),
  }
}

function makeActivity(overrides: Partial<{
  start_date_local: string; type: string; distance: number | null;
  total_elevation_gain: number | null; moving_time: number;
}> = {}) {
  return {
    id: 'a1', name: 'Ride', type: 'Ride', moving_time: 3600,
    average_watts: null, max_watts: null, weighted_average_watts: null,
    average_heartrate: null, training_load: null, rolling_ftp: null,
    left_right_balance: null,
    start_date_local: '2026-01-15T08:00:00',
    distance: 50000,
    total_elevation_gain: 500,
    ...overrides,
  }
}

function makeRequest(year?: string) {
  return new Request(`http://localhost/api/stats/year${year ? `?year=${year}` : ''}`)
}

const PROFILE = { intervals_icu_athlete_id: 'ath1', intervals_icu_api_key: 'key1' }

describe('GET /api/stats/year', () => {
  const currentYear = new Date().getFullYear()

  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(null, null))
    const res = await GET(makeRequest(String(currentYear)))
    expect(res.status).toBe(401)
  })

  it('returns 400 when intervals.icu not configured', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ id: 'u1' }, { intervals_icu_athlete_id: null, intervals_icu_api_key: null })
    )
    const res = await GET(makeRequest(String(currentYear)))
    expect(res.status).toBe(400)
  })

  it('returns 400 for a future year', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ id: 'u1' }, PROFILE))
    const res = await GET(makeRequest(String(currentYear + 1)))
    expect(res.status).toBe(400)
  })

  it('returns 400 for a year older than 4 years ago', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ id: 'u1' }, PROFILE))
    const res = await GET(makeRequest(String(currentYear - 5)))
    expect(res.status).toBe(400)
  })

  it('computes totals and monthly breakdown from activities', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ id: 'u1' }, PROFILE))
    mockGetActivities.mockResolvedValue([
      makeActivity({ start_date_local: `${currentYear}-01-10T08:00:00`, distance: 50000, total_elevation_gain: 500, moving_time: 5400 }),
      makeActivity({ start_date_local: `${currentYear}-01-25T08:00:00`, distance: 40000, total_elevation_gain: 300, moving_time: 3600 }),
      makeActivity({ start_date_local: `${currentYear}-03-05T08:00:00`, distance: 60000, total_elevation_gain: 600, moving_time: 7200 }),
    ])
    const res = await GET(makeRequest(String(currentYear)))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.year).toBe(currentYear)
    expect(body.totalRides).toBe(3)
    expect(body.totalKm).toBeCloseTo(150, 0)
    expect(body.totalElevationM).toBe(1400)
    expect(body.totalMovingTimeSecs).toBe(16200)
    expect(body.monthly).toHaveLength(12)
    const jan = body.monthly.find((m: { month: number }) => m.month === 1)
    expect(jan.km).toBeCloseTo(90, 0)
    const mar = body.monthly.find((m: { month: number }) => m.month === 3)
    expect(mar.km).toBeCloseTo(60, 0)
    const feb = body.monthly.find((m: { month: number }) => m.month === 2)
    expect(feb.km).toBe(0)
  })

  it('returns 502 when intervals.icu throws', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ id: 'u1' }, PROFILE))
    mockGetActivities.mockRejectedValue(new Error('ICU down'))
    const res = await GET(makeRequest(String(currentYear)))
    expect(res.status).toBe(502)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest --testPathPattern=stats-year --no-coverage
```

Expected: FAIL — `Cannot find module '@/app/api/stats/year/route'`

- [ ] **Step 3: Implement the route**

Create `app/api/stats/year/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'

export const dynamic = 'force-dynamic'

interface MonthlyBucket { month: number; km: number }

export interface YearStats {
  year: number
  totalRides: number
  totalKm: number
  totalElevationM: number
  totalMovingTimeSecs: number
  monthly: MonthlyBucket[]
}

export async function GET(req: NextRequest) {
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

  const currentYear = new Date().getFullYear()
  const yearParam = new URL(req.url).searchParams.get('year')
  const year = yearParam ? parseInt(yearParam, 10) : currentYear

  if (isNaN(year) || year < currentYear - 4 || year > currentYear) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
  }

  const start = `${year}-01-01`
  const end = year === currentYear
    ? new Date().toISOString().split('T')[0]
    : `${year}-12-31`

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  try {
    const activities = await client.getActivities(start, end)

    const monthly: MonthlyBucket[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, km: 0 }))
    let totalRides = 0
    let totalKm = 0
    let totalElevationM = 0
    let totalMovingTimeSecs = 0

    for (const a of activities) {
      totalRides++
      totalKm += (a.distance ?? 0) / 1000
      totalElevationM += a.total_elevation_gain ?? 0
      totalMovingTimeSecs += a.moving_time
      const month = new Date(a.start_date_local).getMonth() + 1
      monthly[month - 1].km += (a.distance ?? 0) / 1000
    }

    monthly.forEach(b => { b.km = Math.round(b.km * 10) / 10 })

    const stats: YearStats = {
      year,
      totalRides,
      totalKm: Math.round(totalKm * 10) / 10,
      totalElevationM: Math.round(totalElevationM),
      totalMovingTimeSecs,
      monthly,
    }

    return NextResponse.json(stats)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx jest --testPathPattern=stats-year --no-coverage
```

Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add app/api/stats/year/route.ts __tests__/api/stats-year.test.ts
git commit -m "feat(api): add /api/stats/year endpoint for annual totals and monthly breakdown"
```

---

## Task 2: `/api/activities` route

**Files:**
- Create: `app/api/activities/route.ts`
- Test: `__tests__/api/activities.test.ts`

**Interfaces:**
- Consumes: `IntervalsClient.getActivities(start: string, end: string): Promise<ICUActivity[]>`
- Produces:
  ```typescript
  // GET /api/activities?page=N  (1-based, default 1, page size 30)
  interface ActivitiesResponse {
    activities: ICUActivity[]
    hasMore: boolean
    total: number
  }
  ```

- [ ] **Step 1: Write failing tests**

Create `__tests__/api/activities.test.ts`:

```typescript
/** @jest-environment node */
import { GET } from '@/app/api/activities/route'

const mockGetActivities = jest.fn()

jest.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: jest.fn(),
}))

jest.mock('@/lib/intervals/client', () => ({
  IntervalsClient: jest.fn().mockImplementation(() => ({
    getActivities: mockGetActivities,
  })),
}))

import { createSupabaseServerClient } from '@/lib/supabase-server'

function makeSupabase(user: { id: string } | null, profile: unknown) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({ maybeSingle: async () => ({ data: profile }) }),
    }),
  }
}

function makeActivity(id: string, date = '2026-01-01T08:00:00') {
  return {
    id, name: `Ride ${id}`, type: 'Ride', moving_time: 3600,
    start_date_local: date, distance: 40000, total_elevation_gain: 400,
    average_watts: null, max_watts: null, weighted_average_watts: null,
    average_heartrate: null, training_load: null, rolling_ftp: null,
    left_right_balance: null,
  }
}

function makeRequest(page?: number) {
  return new Request(`http://localhost/api/activities${page ? `?page=${page}` : ''}`)
}

const PROFILE = { intervals_icu_athlete_id: 'ath1', intervals_icu_api_key: 'key1' }

// Build 35 activities with descending dates (a1 most recent)
const THIRTY_FIVE = Array.from({ length: 35 }, (_, i) => {
  const d = new Date('2026-06-01')
  d.setDate(d.getDate() - i)
  return makeActivity(`a${i + 1}`, d.toISOString())
})

describe('GET /api/activities', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when not authenticated', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase(null, null))
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 400 when intervals.icu not configured', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(
      makeSupabase({ id: 'u1' }, { intervals_icu_athlete_id: null, intervals_icu_api_key: null })
    )
    const res = await GET(makeRequest())
    expect(res.status).toBe(400)
  })

  it('returns first 30 activities sorted descending, hasMore true', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ id: 'u1' }, PROFILE))
    mockGetActivities.mockResolvedValue(THIRTY_FIVE)
    const res = await GET(makeRequest(1))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.activities).toHaveLength(30)
    expect(body.activities[0].id).toBe('a1')
    expect(body.hasMore).toBe(true)
    expect(body.total).toBe(35)
  })

  it('returns remaining 5 on page 2, hasMore false', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ id: 'u1' }, PROFILE))
    mockGetActivities.mockResolvedValue(THIRTY_FIVE)
    const res = await GET(makeRequest(2))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.activities).toHaveLength(5)
    expect(body.hasMore).toBe(false)
  })

  it('returns 502 when intervals.icu throws', async () => {
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(makeSupabase({ id: 'u1' }, PROFILE))
    mockGetActivities.mockRejectedValue(new Error('ICU down'))
    const res = await GET(makeRequest())
    expect(res.status).toBe(502)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest --testPathPattern="__tests__/api/activities" --no-coverage
```

Expected: FAIL — `Cannot find module '@/app/api/activities/route'`

- [ ] **Step 3: Implement the route**

Create `app/api/activities/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30

export async function GET(req: NextRequest) {
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

  const pageParam = new URL(req.url).searchParams.get('page')
  const page = pageParam ? Math.max(1, parseInt(pageParam, 10)) : 1

  const today = new Date()
  const oldest = `${today.getFullYear() - 4}-01-01`
  const newest = today.toISOString().split('T')[0]

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)

  try {
    const all = await client.getActivities(oldest, newest)
    const sorted = [...all].sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))
    const total = sorted.length
    const start = (page - 1) * PAGE_SIZE
    const activities = sorted.slice(start, start + PAGE_SIZE)
    const hasMore = start + PAGE_SIZE < total
    return NextResponse.json({ activities, hasMore, total })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx jest --testPathPattern="__tests__/api/activities" --no-coverage
```

Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add app/api/activities/route.ts __tests__/api/activities.test.ts
git commit -m "feat(api): add /api/activities endpoint with pagination (30 per page, 5-year window)"
```

---

## Task 3: `YearView` component

**Files:**
- Create: `components/YearView.tsx`
- Test: `__tests__/components/YearView.test.tsx`

**Interfaces:**
- Consumes: `GET /api/stats/year?year=YYYY` — returns `YearStats` shape from Task 1
- Consumes (imports): `StatCell`, `SectionCard`, `formatDuration` from `@/components/RideStats`
- Consumes (imports): `AnimatedLogo` from `@/components/AnimatedLogo`
- Produces: `export default function YearView(): JSX.Element` — no props

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/YearView.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import YearView from '@/components/YearView'

const currentYear = new Date().getFullYear()

function makeYearStats(year = currentYear) {
  return {
    year,
    totalRides: 48,
    totalKm: 1842.5,
    totalElevationM: 21300,
    totalMovingTimeSecs: 226800,  // 63h 0m
    monthly: Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      km: i < 6 ? (i + 1) * 20.0 : 0,  // Jan-Jun have data, rest empty
    })),
  }
}

global.fetch = jest.fn()

describe('YearView', () => {
  afterEach(() => jest.clearAllMocks())

  it('shows loading spinner while fetching', () => {
    ;(global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}))
    render(<YearView />)
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('renders headline stats after successful fetch', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      json: async () => makeYearStats(),
    })
    render(<YearView />)
    expect(await screen.findByText('48')).toBeInTheDocument()
    expect(screen.getByText('1842.5')).toBeInTheDocument()
    expect(screen.getByText('21300')).toBeInTheDocument()
    expect(screen.getByText('63h 0m')).toBeInTheDocument()
  })

  it('shows error message on fetch failure', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ error: 'intervals.icu not configured' }),
    })
    render(<YearView />)
    expect(await screen.findByText('intervals.icu not configured')).toBeInTheDocument()
  })

  it('renders year selector showing current year', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => makeYearStats() })
    render(<YearView />)
    await screen.findByText('48')
    expect(screen.getByText(String(currentYear))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next year' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous year' })).not.toBeDisabled()
  })

  it('disables previous-year button at minimum year (current - 4)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => makeYearStats(currentYear - 4) })
    render(<YearView />)
    // Navigate back 4 times
    const prevBtn = await screen.findByRole('button', { name: 'Previous year' })
    for (let i = 0; i < 4; i++) {
      ;(global.fetch as jest.Mock).mockResolvedValue({ json: async () => makeYearStats(currentYear - (i + 1)) })
      fireEvent.click(prevBtn)
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(i + 2))
    }
    await waitFor(() => expect(prevBtn).toBeDisabled())
  })

  it('re-fetches when previous year button is clicked', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: async () => makeYearStats(currentYear) })
      .mockResolvedValueOnce({ json: async () => makeYearStats(currentYear - 1) })
    render(<YearView />)
    await screen.findByText('48')
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    expect(global.fetch).toHaveBeenLastCalledWith(`/api/stats/year?year=${currentYear - 1}`)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest --testPathPattern=YearView --no-coverage
```

Expected: FAIL — `Cannot find module '@/components/YearView'`

- [ ] **Step 3: Implement the component**

Create `components/YearView.tsx`:

```typescript
'use client'
import { useEffect, useState } from 'react'
import AnimatedLogo from '@/components/AnimatedLogo'
import { StatCell, SectionCard, formatDuration } from '@/components/RideStats'

interface MonthlyBucket { month: number; km: number }

interface YearStats {
  year: number
  totalRides: number
  totalKm: number
  totalElevationM: number
  totalMovingTimeSecs: number
  monthly: MonthlyBucket[]
}

const MONTHS_SHORT = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

function MonthlyBarChart({ monthly, year }: { monthly: MonthlyBucket[]; year: number }) {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  const maxKm = Math.max(...monthly.map(b => b.km), 1)
  const svgLeft = 28, svgRight = 332, svgTop = 8, svgBottom = 88
  const chartW = svgRight - svgLeft
  const chartH = svgBottom - svgTop
  const slotW = chartW / 12
  const barW = Math.max(slotW - 4, 4)
  const yOf = (km: number) => svgBottom - (km / maxKm) * chartH
  const ticks = [0, Math.round(maxKm / 2), Math.round(maxKm)]

  return (
    <svg viewBox="0 0 360 104" className="w-full">
      {ticks.map(v => (
        <g key={v}>
          <line x1={svgLeft - 2} y1={yOf(v)} x2={svgRight} y2={yOf(v)} stroke="#f1f5f9" strokeWidth="1" />
          <text x={svgLeft - 4} y={yOf(v)} textAnchor="end" dominantBaseline="middle" fontSize="8" fill="#9ca3af">
            {v}
          </text>
        </g>
      ))}
      {monthly.map(({ month, km }) => {
        const isFuture = year === currentYear && month > currentMonth
        const isCurrent = year === currentYear && month === currentMonth
        const x = svgLeft + (month - 1) * slotW + (slotW - barW) / 2
        const barH = isFuture ? 0 : Math.max((km / maxKm) * chartH, km > 0 ? 2 : 0)
        const y = svgBottom - barH
        return (
          <g key={month}>
            {isFuture
              ? <rect x={x} y={svgBottom - 4} width={barW} height={4} rx={1} fill="#e5e7eb" />
              : <rect x={x} y={y} width={barW} height={barH} rx={1} fill={isCurrent ? '#3b82f6' : '#93c5fd'} />
            }
            <text
              x={svgLeft + (month - 1) * slotW + slotW / 2}
              y={svgBottom + 10}
              textAnchor="middle"
              fontSize="8"
              fill={isCurrent ? '#3b82f6' : '#9ca3af'}
              fontWeight={isCurrent ? 'bold' : 'normal'}
            >
              {MONTHS_SHORT[month - 1]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export default function YearView() {
  const currentYear = new Date().getFullYear()
  const minYear = currentYear - 4

  const [year, setYear] = useState(currentYear)
  const [data, setData] = useState<YearStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setData(null)
    fetch(`/api/stats/year?year=${year}`)
      .then(r => r.json())
      .then((d: YearStats & { error?: string }) => {
        if (d.error) throw new Error(d.error)
        setData(d)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [year])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <AnimatedLogo size={48} />
      </div>
    )
  }

  if (error) return <p className="text-sm text-red-600 p-4">{error}</p>

  if (!data) return null

  return (
    <div className="space-y-4">
      <SectionCard title={`${year} Totals`} accent="bg-blue-500">
        <div className="flex divide-x divide-gray-100">
          <StatCell label="Rides" value={String(data.totalRides)} valueClass="text-blue-600" />
          <StatCell
            label="Distance"
            value={(Math.round(data.totalKm * 10) / 10).toFixed(1)}
            unit="km"
            valueClass="text-blue-600"
          />
          <StatCell
            label="Elevation"
            value={String(data.totalElevationM)}
            unit="m"
            valueClass="text-emerald-600"
          />
          <StatCell
            label="Hours"
            value={formatDuration(data.totalMovingTimeSecs)}
            valueClass="text-violet-600"
          />
        </div>
      </SectionCard>

      <SectionCard title="Distance by Month" accent="bg-blue-400">
        <div className="px-3 py-3">
          <MonthlyBarChart monthly={data.monthly} year={year} />
        </div>
      </SectionCard>

      <div className="flex items-center justify-center gap-6 py-2">
        <button
          onClick={() => setYear(y => y - 1)}
          disabled={year <= minYear}
          className="text-2xl text-gray-400 disabled:opacity-30 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Previous year"
        >
          ←
        </button>
        <span className="text-sm font-semibold text-gray-700 w-12 text-center">{year}</span>
        <button
          onClick={() => setYear(y => y + 1)}
          disabled={year >= currentYear}
          className="text-2xl text-gray-400 disabled:opacity-30 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Next year"
        >
          →
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx jest --testPathPattern=YearView --no-coverage
```

Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add components/YearView.tsx __tests__/components/YearView.test.tsx
git commit -m "feat(ui): add YearView component with annual totals and monthly bar chart"
```

---

## Task 4: `ActivityLogView` component

**Files:**
- Create: `components/ActivityLogView.tsx`
- Test: `__tests__/components/ActivityLogView.test.tsx`

**Interfaces:**
- Consumes: `GET /api/activities?page=N` — returns `{ activities: ICUActivity[], hasMore: boolean, total: number }`
- Consumes (imports): `ActivityDetailModal` from `@/components/ActivityDetailModal`
- Consumes (imports): `AnimatedLogo` from `@/components/AnimatedLogo`
- Consumes (imports): `formatDuration` from `@/components/RideStats`
- Produces: `export default function ActivityLogView(): JSX.Element` — no props

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/ActivityLogView.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ActivityLogView from '@/components/ActivityLogView'
import type { ICUActivity } from '@/types'

function makeActivity(id: string, overrides: Partial<ICUActivity> = {}): ICUActivity {
  return {
    id,
    name: `Ride ${id}`,
    type: 'Ride',
    start_date_local: '2026-06-15T08:00:00',
    moving_time: 5400,         // 1h 30m
    distance: 45000,           // 45.0 km
    total_elevation_gain: 350,
    average_watts: 200,
    max_watts: 400,
    weighted_average_watts: 215,
    average_heartrate: 145,
    training_load: 85,
    rolling_ftp: null,
    left_right_balance: null,
    ...overrides,
  }
}

// ActivityDetailModal fetches streams; suppress those requests in tests
global.fetch = jest.fn()

function mockPage1(hasMore = false, count = 2) {
  const activities = Array.from({ length: count }, (_, i) => makeActivity(`a${i + 1}`))
  ;(global.fetch as jest.Mock).mockResolvedValueOnce({
    json: async () => ({ activities, hasMore, total: count }),
  })
  return activities
}

describe('ActivityLogView', () => {
  afterEach(() => jest.clearAllMocks())

  it('shows loading spinner while fetching', () => {
    ;(global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}))
    render(<ActivityLogView />)
    expect(document.querySelector('svg')).toBeInTheDocument()
  })

  it('renders activity rows with name, date, distance, and time', async () => {
    mockPage1()
    render(<ActivityLogView />)
    expect(await screen.findByText('Ride a1')).toBeInTheDocument()
    expect(screen.getByText('45.0')).toBeInTheDocument()
    expect(screen.getAllByText('1h 30m').length).toBeGreaterThan(0)
  })

  it('hides "Load more" when hasMore is false', async () => {
    mockPage1(false)
    render(<ActivityLogView />)
    await screen.findByText('Ride a1')
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
  })

  it('shows "Load more" when hasMore is true', async () => {
    mockPage1(true, 30)
    render(<ActivityLogView />)
    await screen.findByText('Ride a1')
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument()
  })

  it('appends activities when "Load more" is clicked', async () => {
    // Page 1: 30 activities, hasMore true
    const page1 = Array.from({ length: 30 }, (_, i) => makeActivity(`p1-${i + 1}`))
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({ activities: page1, hasMore: true, total: 35 }),
    })
    render(<ActivityLogView />)
    await screen.findByText('Ride p1-1')

    // Page 2: 5 activities, hasMore false
    const page2 = Array.from({ length: 5 }, (_, i) => makeActivity(`p2-${i + 1}`))
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      json: async () => ({ activities: page2, hasMore: false, total: 35 }),
    })
    fireEvent.click(screen.getByRole('button', { name: /load more/i }))
    await screen.findByText('Ride p2-1')
    expect(screen.getByText('Ride p1-1')).toBeInTheDocument()  // page 1 still visible
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
  })

  it('opens ActivityDetailModal when a row is clicked', async () => {
    mockPage1()
    // Suppress ActivityDetailModal's own fetch calls
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false, json: async () => ({ streams: null }),
    })
    render(<ActivityLogView />)
    const row = await screen.findByText('Ride a1')
    fireEvent.click(row.closest('button')!)
    await waitFor(() => expect(screen.getByText(/Activity/i)).toBeInTheDocument())
  })

  it('shows empty state when no activities returned', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ activities: [], hasMore: false, total: 0 }),
    })
    render(<ActivityLogView />)
    expect(await screen.findByText(/No activities found/i)).toBeInTheDocument()
  })

  it('shows error message on fetch failure', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      json: async () => ({ error: 'intervals.icu not configured' }),
    })
    render(<ActivityLogView />)
    expect(await screen.findByText('intervals.icu not configured')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest --testPathPattern=ActivityLogView --no-coverage
```

Expected: FAIL — `Cannot find module '@/components/ActivityLogView'`

- [ ] **Step 3: Implement the component**

Create `components/ActivityLogView.tsx`:

```typescript
'use client'
import { useState, useEffect } from 'react'
import type { ICUActivity } from '@/types'
import ActivityDetailModal from '@/components/ActivityDetailModal'
import AnimatedLogo from '@/components/AnimatedLogo'
import { formatDuration } from '@/components/RideStats'

const ACTIVITY_EMOJI: Record<string, string> = {
  Walk: '🚶', Hike: '🥾', Run: '🏃', VirtualRun: '🏃',
  WeightTraining: '🏋️', Yoga: '🧘', Swim: '🏊',
  Rowing: '🚣', Kayaking: '🛶',
}

function activityEmoji(type: string): string {
  return ACTIVITY_EMOJI[type] ?? '🚴'
}

function formatActivityDate(iso: string): string {
  const d = new Date(iso)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

interface ActivitiesResponse {
  activities: ICUActivity[]
  hasMore: boolean
  total: number
  error?: string
}

function ActivityRow({ activity, onClick }: { activity: ICUActivity; onClick: () => void }) {
  const distKm = activity.distance != null ? (activity.distance / 1000).toFixed(1) : null
  const elevM = activity.total_elevation_gain != null ? Math.round(activity.total_elevation_gain) : null
  const np = activity.weighted_average_watts

  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 active:bg-gray-100 min-h-[56px]"
    >
      <span className="text-xl mt-0.5 shrink-0">{activityEmoji(activity.type)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900 truncate">{activity.name || activity.type}</p>
          <div className="text-right shrink-0">
            {distKm && <p className="text-sm font-semibold text-blue-600">{distKm}</p>}
            {elevM != null && elevM > 0 && <p className="text-xs text-emerald-600">↑ {elevM}m</p>}
          </div>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <p className="text-xs text-gray-400">{formatActivityDate(activity.start_date_local)}</p>
          <div className="flex gap-2 text-xs text-gray-500">
            <span>{formatDuration(activity.moving_time)}</span>
            {np != null && <span>· NP {np}w</span>}
          </div>
        </div>
      </div>
    </button>
  )
}

export default function ActivityLogView() {
  const [activities, setActivities] = useState<ICUActivity[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ICUActivity | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch('/api/activities?page=1')
      .then(r => r.json())
      .then((d: ActivitiesResponse) => {
        if (d.error) throw new Error(d.error)
        setActivities(d.activities)
        setHasMore(d.hasMore)
        setPage(1)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  function loadMore() {
    const nextPage = page + 1
    setLoadingMore(true)
    fetch(`/api/activities?page=${nextPage}`)
      .then(r => r.json())
      .then((d: ActivitiesResponse) => {
        if (d.error) throw new Error(d.error)
        setActivities(prev => [...prev, ...d.activities])
        setHasMore(d.hasMore)
        setPage(nextPage)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingMore(false))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <AnimatedLogo size={48} />
      </div>
    )
  }

  if (error) return <p className="text-sm text-red-600 p-4">{error}</p>

  if (!activities.length) return <p className="text-sm text-gray-400 p-4">No activities found.</p>

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {activities.map(a => (
          <ActivityRow key={a.id} activity={a} onClick={() => setSelected(a)} />
        ))}
        {hasMore && (
          <div className="px-4 py-3 border-t border-gray-100">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full py-2.5 text-sm font-semibold text-blue-600 disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
      {selected && (
        <ActivityDetailModal activity={selected} onClose={() => setSelected(null)} />
      )}
    </>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```
npx jest --testPathPattern=ActivityLogView --no-coverage
```

Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add components/ActivityLogView.tsx __tests__/components/ActivityLogView.test.tsx
git commit -m "feat(ui): add ActivityLogView component with paginated activity list"
```

---

## Task 5: Wire new tabs into StatsPage

**Files:**
- Modify: `app/stats/page.tsx`
- Modify: `__tests__/app/stats/page.test.tsx`

**Interfaces:**
- Consumes: `YearView` from `@/components/YearView`
- Consumes: `ActivityLogView` from `@/components/ActivityLogView`

- [ ] **Step 1: Replace the entire test file**

**Replace** `__tests__/app/stats/page.test.tsx` with the content below. Two things changed in existing tests:
- Tabs now have `role="tab"` (not just `role="button"`), so `getByRole('button', ...)` → `getByRole('tab', ...)`
- Page defaults to "This Year" tab, so tests checking 28d content must click "28 Days" first. A `mockWithYear` helper and `go28d` utility are added at the top to handle this cleanly.

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StatsPage from '@/app/stats/page'
import type { RidingStats } from '@/types'
import { makeRidingStats } from '../../support/factories'

const mockStats = makeRidingStats({
  ride_count: 8,
  total_distance_km: 342.5,
  total_elevation_m: 4200,
  total_duration_secs: 43200,  // 12h 0m
  power_5min: 380,
  power_10min: 355,
  power_20min: 320,
  avg_left_right_balance: 52.3,
  balance_ride_count: 6,
  recent_rides: [
    {
      id: 'a1', name: 'Morning Ride', start_date_local: '2026-05-19T07:30:00', type: 'Ride',
      moving_time: 3600, average_watts: 210, max_watts: 450, weighted_average_watts: 225,
      average_heartrate: 148, training_load: 72, rolling_ftp: null,
      distance: 40000, total_elevation_gain: 350, left_right_balance: 52.0,
    },
    {
      id: 'a2', name: 'Evening Zone 2', start_date_local: '2026-05-17T18:00:00', type: 'Ride',
      moving_time: 5400, average_watts: 185, max_watts: 390, weighted_average_watts: 195,
      average_heartrate: null, training_load: 58, rolling_ftp: null,
      distance: 55000, total_elevation_gain: 220, left_right_balance: null,
    },
  ],
  cross_training: [],
})

// Minimal valid YearStats — returned by default for /api/stats/year
const minimalYearStats = {
  year: new Date().getFullYear(),
  totalRides: 99, totalKm: 0, totalElevationM: 0, totalMovingTimeSecs: 0,
  monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, km: 0 })),
}

// Mock fetch with URL routing: year endpoint returns minimalYearStats; stats returns
// provided stats object; weight-log returns empty.
function mockWithYear(statsOverride?: Partial<RidingStats>) {
  ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
    if (String(url).includes('/api/stats/year')) {
      return Promise.resolve({ json: async () => minimalYearStats })
    }
    if (String(url).includes('/api/weight-log')) {
      return Promise.resolve({ json: async () => ({ entries: [] }) })
    }
    const stats = statsOverride ? { ...mockStats, ...statsOverride } : mockStats
    return Promise.resolve({ json: async () => ({ stats }) })
  })
}

// Wait for YearView to finish loading (totalRides=99 appears), then click "28 Days".
async function go28d() {
  expect(await screen.findByText('99')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: '28 Days' }))
}

global.fetch = jest.fn()

describe('StatsPage', () => {
  afterEach(() => jest.clearAllMocks())

  it('shows loading spinner initially', () => {
    ;(global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}))
    render(<StatsPage />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders power stats after load', async () => {
    mockWithYear()
    render(<StatsPage />)
    await go28d()
    expect(await screen.findByText('380')).toBeInTheDocument()
    expect(screen.getByText('355')).toBeInTheDocument()
    expect(screen.getByText('320')).toBeInTheDocument()
  })

  it('renders totals after load', async () => {
    mockWithYear()
    render(<StatsPage />)
    await go28d()
    expect(await screen.findByText('342.5')).toBeInTheDocument()
    expect(screen.getByText('4200')).toBeInTheDocument()
    expect(screen.getByText('12h 0m')).toBeInTheDocument()
  })

  it('renders balance after load', async () => {
    mockWithYear()
    render(<StatsPage />)
    await go28d()
    expect(await screen.findByText('47.7% L / 52.3% R')).toBeInTheDocument()
  })

  it('shows — for null power values', async () => {
    mockWithYear({ power_5min: null, power_10min: null, power_20min: null })
    render(<StatsPage />)
    await go28d()
    await screen.findByText('342.5')
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(3)
  })

  it('shows — for null balance', async () => {
    mockWithYear({ avg_left_right_balance: null })
    render(<StatsPage />)
    await go28d()
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

  it('renders ride tabs for recent rides', async () => {
    mockWithYear()
    render(<StatsPage />)
    expect(await screen.findByRole('tab', { name: '28 Days' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Tue 19 May' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sun 17 May' })).toBeInTheDocument()
  })

  it('shows per-ride stats when a ride tab is clicked', async () => {
    mockWithYear()
    const user = userEvent.setup()
    render(<StatsPage />)
    await screen.findByRole('tab', { name: 'Tue 19 May' })
    await user.click(screen.getByRole('tab', { name: 'Tue 19 May' }))
    expect(await screen.findByText('210')).toBeInTheDocument()  // avg watts
    expect(screen.getByText('225')).toBeInTheDocument()          // NP
    expect(screen.getByText('72')).toBeInTheDocument()           // TSS
    expect(screen.getByText('Morning Ride')).toBeInTheDocument()
  })

  it('hides cross-training section when cross_training is empty', async () => {
    mockWithYear({ cross_training: [] })
    render(<StatsPage />)
    await go28d()
    await screen.findByText('342.5')
    expect(screen.queryByText(/Other Activity/)).not.toBeInTheDocument()
  })

  it('renders cross-training groups when present', async () => {
    mockWithYear({
      cross_training: [
        { type: 'Run', count: 2, total_duration_secs: 4800, total_distance_m: 16000, total_tss: 80 },
        { type: 'Walk', count: 3, total_duration_secs: 9900, total_distance_m: 12000, total_tss: 45 },
      ],
    })
    render(<StatsPage />)
    await go28d()
    expect(await screen.findByText('Run')).toBeInTheDocument()
    expect(screen.getByText('Walk')).toBeInTheDocument()
    expect(screen.getByText('2 sessions')).toBeInTheDocument()
    expect(screen.getByText('3 sessions')).toBeInTheDocument()
  })

  it('shows correct TSS and distance per group', async () => {
    mockWithYear({
      cross_training: [
        { type: 'Run', count: 2, total_duration_secs: 4800, total_distance_m: 16000, total_tss: 80 },
        { type: 'Walk', count: 3, total_duration_secs: 9900, total_distance_m: 0, total_tss: 45 },
      ],
    })
    render(<StatsPage />)
    await go28d()
    expect(await screen.findByText('Run')).toBeInTheDocument()
    expect(screen.getAllByText(/16\.0 km/).length).toBeGreaterThan(0)
    expect(screen.getByText(/80 TSS/)).toBeInTheDocument()
    expect(screen.getByText(/45 TSS/)).toBeInTheDocument()
  })

  it('shows footer totals across all cross-training groups', async () => {
    mockWithYear({
      cross_training: [
        { type: 'Run', count: 2, total_duration_secs: 4800, total_distance_m: 16000, total_tss: 80 },
        { type: 'Walk', count: 3, total_duration_secs: 9900, total_distance_m: 12000, total_tss: 45 },
      ],
    })
    render(<StatsPage />)
    await go28d()
    expect(await screen.findByText('Run')).toBeInTheDocument()
    expect(screen.getByText(/5 activities/)).toBeInTheDocument()
    expect(screen.getByText(/125 TSS contributed/)).toBeInTheDocument()
  })

  // ── New tab tests ──────────────────────────────────────────────────────────

  it('defaults to the "This Year" tab and shows year totals', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (String(url).includes('/api/stats/year')) {
        return Promise.resolve({ json: async () => ({
          year: new Date().getFullYear(),
          totalRides: 42, totalKm: 1500, totalElevationM: 15000, totalMovingTimeSecs: 180000,
          monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, km: 0 })),
        }) })
      }
      return Promise.resolve({ json: async () => ({ stats: mockStats }) })
    })
    render(<StatsPage />)
    expect(await screen.findByText('42')).toBeInTheDocument()  // totalRides from YearView
  })

  it('shows "Activity Log" tab and renders activities when clicked', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (String(url).includes('/api/stats/year')) {
        return Promise.resolve({ json: async () => minimalYearStats })
      }
      if (String(url).includes('/api/activities')) {
        return Promise.resolve({ json: async () => ({
          activities: [{ id: 'ax', name: 'Test Log Ride', type: 'Ride',
            start_date_local: '2026-06-01T08:00:00', moving_time: 3600, distance: 40000,
            total_elevation_gain: 300, average_watts: null, max_watts: null,
            weighted_average_watts: null, average_heartrate: null, training_load: null,
            rolling_ftp: null, left_right_balance: null }],
          hasMore: false, total: 1,
        }) })
      }
      return Promise.resolve({ json: async () => ({ stats: mockStats }) })
    })
    render(<StatsPage />)
    await screen.findByText('99')  // YearView loaded (minimalYearStats.totalRides)
    fireEvent.click(screen.getByRole('tab', { name: 'Activity Log' }))
    expect(await screen.findByText('Test Log Ride')).toBeInTheDocument()
  })

  it('shows "28 Days" tab with ride count when clicked', async () => {
    mockWithYear()
    render(<StatsPage />)
    await go28d()
    expect(await screen.findByText('342.5')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to confirm new ones fail, existing ones also fail (expected)**

```
npx jest --testPathPattern="__tests__/app/stats/page" --no-coverage
```

Expected: the 3 new tests FAIL because `YearView` and `ActivityLogView` don't exist yet, and the existing tests ALSO fail because the StatsPage hasn't been updated yet. This is correct — both will pass after Step 3.

- [ ] **Step 3: Update `app/stats/page.tsx`**

Replace the entire file with the following. The only changes from the current file are:
1. Add imports for `YearView` and `ActivityLogView`
2. Widen `activeTab` state type from `number` to `'year' | 'log' | '28d' | number`
3. Change default from `0` to `'year'`
4. Add `'year'`, `'log'`, `'28d'` tab entries
5. Update the subtitle text
6. Add `activeTab === 'year'` and `activeTab === 'log'` render branches
7. Change the "28 Days" branch condition from `activeTab === 0` to `activeTab === '28d'`
8. Change the ride branch from `rides[activeTab - 1]` to `rides[activeTab as number]`

```typescript
'use client'
import { useEffect, useState } from 'react'
import type { RidingStats, CrossTrainingGroup, WeightEntry } from '@/types'
import RideStats, { rideStatsFromActivity, StatCell, SectionCard, formatDuration } from '@/components/RideStats'
import { weightAtDate } from '@/lib/weight-helpers'
import AnimatedLogo from '@/components/AnimatedLogo'
import YearView from '@/components/YearView'
import ActivityLogView from '@/components/ActivityLogView'

function formatRideTabLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`
}

function AggregateView({ stats }: { stats: RidingStats }) {
  const rightPct = stats.avg_left_right_balance
  const balance = rightPct !== null
    ? `${(100 - rightPct).toFixed(1)}% L / ${rightPct.toFixed(1)}% R`
    : '—'

  return (
    <div className="space-y-4">
      <SectionCard title="Best Power" accent="bg-orange-400">
        <div className="flex divide-x divide-gray-100">
          <StatCell
            label="1 min"
            value={stats.power_1min !== null ? String(Math.round(stats.power_1min)) : '—'}
            unit={stats.power_1min !== null ? 'w' : undefined}
            valueClass="text-orange-500"
          />
          <StatCell
            label="5 min"
            value={stats.power_5min !== null ? String(Math.round(stats.power_5min)) : '—'}
            unit={stats.power_5min !== null ? 'w' : undefined}
            valueClass="text-orange-500"
          />
          <StatCell
            label="10 min"
            value={stats.power_10min !== null ? String(Math.round(stats.power_10min)) : '—'}
            unit={stats.power_10min !== null ? 'w' : undefined}
            valueClass="text-orange-500"
          />
          <StatCell
            label="20 min"
            value={stats.power_20min !== null ? String(Math.round(stats.power_20min)) : '—'}
            unit={stats.power_20min !== null ? 'w' : undefined}
            valueClass="text-orange-500"
          />
        </div>
      </SectionCard>

      <SectionCard title="Totals" accent="bg-blue-500">
        <div className="flex divide-x divide-gray-100">
          <StatCell
            label="Distance"
            value={(Math.round(stats.total_distance_km * 10) / 10).toFixed(1)}
            unit="km"
            valueClass="text-blue-600"
          />
          <StatCell
            label="Elevation"
            value={String(Math.round(stats.total_elevation_m))}
            unit="m"
            valueClass="text-emerald-600"
          />
          <StatCell
            label="Duration"
            value={formatDuration(stats.total_duration_secs)}
            valueClass="text-violet-600"
          />
        </div>
      </SectionCard>

      {(stats.avg_hr !== null || stats.max_hr !== null) && (
        <SectionCard title="Heart Rate · 28 Days" accent="bg-red-400">
          <div className="flex divide-x divide-gray-100">
            {stats.avg_hr !== null && (
              <StatCell label="Avg HR" value={String(stats.avg_hr)} unit="bpm" valueClass="text-red-500" />
            )}
            {stats.max_hr !== null && (
              <StatCell label="Max HR" value={String(stats.max_hr)} unit="bpm" valueClass="text-red-600" />
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard title="L/R Balance" accent="bg-rose-400">
        <div className="text-center px-2 py-3 sm:px-3 sm:py-4">
          <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-rose-500">{balance}</div>
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">Avg Left / Right</div>
          {rightPct !== null && (
            <div className="text-[11px] text-gray-400 mt-0.5">from {stats.balance_ride_count} ride{stats.balance_ride_count !== 1 ? 's' : ''}</div>
          )}
        </div>
      </SectionCard>
    </div>
  )
}

const ACTIVITY_EMOJI: Record<string, string> = {
  Walk: '🚶', Hike: '🥾', Run: '🏃', VirtualRun: '🏃',
  WeightTraining: '🏋️', Yoga: '🧘', Swim: '🏊',
  Rowing: '🚣', Kayaking: '🛶',
}

function activityEmoji(type: string): string {
  return ACTIVITY_EMOJI[type] ?? '⚡'
}

function CrossTrainingSummary({ groups }: { groups: CrossTrainingGroup[] }) {
  if (!groups.length) return null

  const totalCount = groups.reduce((s, g) => s + g.count, 0)
  const totalSecs = groups.reduce((s, g) => s + g.total_duration_secs, 0)
  const totalDistKm = groups.reduce((s, g) => s + g.total_distance_m, 0) / 1000
  const totalTss = Math.round(groups.reduce((s, g) => s + g.total_tss, 0))

  return (
    <SectionCard title="Other Activity · 28 Days" accent="bg-emerald-500">
      <div className="divide-y divide-gray-100">
        {groups.map(g => (
          <div key={g.type} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="text-base">{activityEmoji(g.type)}</span>
              <div>
                <div className="text-sm font-semibold text-gray-800">{g.type}</div>
                <div className="text-[11px] text-gray-400">
                  {g.count} session{g.count !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-emerald-600">
                {formatDuration(g.total_duration_secs)}
              </div>
              <div className="text-[11px] text-gray-400">
                {g.total_distance_m > 0 && `${(g.total_distance_m / 1000).toFixed(1)} km · `}
                {Math.round(g.total_tss)} TSS
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-400">
        {totalCount} activities · {formatDuration(totalSecs)} total
        {totalDistKm > 0 && ` · ${totalDistKm.toFixed(1)} km`}
        {` · ${totalTss} TSS contributed`}
      </div>
    </SectionCard>
  )
}

export default function StatsPage() {
  const [stats, setStats] = useState<RidingStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'year' | 'log' | '28d' | number>('year')
  const [weightLog, setWeightLog] = useState<WeightEntry[]>([])

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        if (!data.stats) throw new Error('No stats returned')
        setStats(data.stats)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
    fetch('/api/weight-log')
      .then(r => r.json())
      .then(d => setWeightLog(d.entries ?? []))
      .catch(() => {})
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <AnimatedLogo size={56} />
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

  const rides = stats.recent_rides ?? []

  type TabId = 'year' | 'log' | '28d' | number
  const tabs: { id: TabId; label: string }[] = [
    { id: 'year', label: 'This Year' },
    { id: 'log', label: 'Activity Log' },
    { id: '28d', label: '28 Days' },
    ...rides.map((r, i) => ({ id: i as TabId, label: formatRideTabLabel(r.start_date_local) })),
  ]

  const subtitle = activeTab === 'year'
    ? 'All activities this year'
    : activeTab === 'log'
    ? 'All activities'
    : activeTab === '28d'
    ? `Last 28 days · ${stats.ride_count} ride${stats.ride_count !== 1 ? 's' : ''}`
    : formatRideTabLabel((stats.recent_rides ?? [])[activeTab as number]?.start_date_local ?? '')

  return (
    <main className="max-w-xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Stats</h1>
        <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto scrollbar-none" style={{ touchAction: 'pan-x' }}>
        {tabs.map(tab => (
          <button
            key={String(tab.id)}
            role="tab"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-shrink-0 px-4 py-2 text-sm font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'year' ? (
        <YearView />
      ) : activeTab === 'log' ? (
        <ActivityLogView />
      ) : activeTab === '28d' ? (
        <>
          <AggregateView stats={stats} />
          <CrossTrainingSummary groups={stats.cross_training} />
        </>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-500 font-medium truncate">{rides[activeTab as number].name}</p>
          {(() => {
            const ride = rides[activeTab as number]
            const rideStats = rideStatsFromActivity(ride)
            const w = weightAtDate(weightLog, ride.start_date_local.split('T')[0], null)
            if (w) {
              rideStats.avgWkg = rideStats.avgWatts !== null ? parseFloat((rideStats.avgWatts / w).toFixed(2)) : null
              rideStats.npWkg = rideStats.np !== null ? parseFloat((rideStats.np / w).toFixed(2)) : null
            }
            return <RideStats data={rideStats} />
          })()}
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 4: Run all tests**

```
npx jest --testPathPattern="stats|YearView|ActivityLogView|activities" --no-coverage
```

Expected: ALL PASS. Check that the 3 new tests in `page.test.tsx` now pass and none of the existing tests broke.

- [ ] **Step 5: Commit**

```bash
git add app/stats/page.tsx components/YearView.tsx components/ActivityLogView.tsx __tests__/app/stats/page.test.tsx
git commit -m "feat(ui): wire This Year and Activity Log tabs into StatsPage"
```

---

## Final check

- [ ] Run the full test suite to confirm nothing outside this feature broke:

```
npx jest --no-coverage
```

Expected: all existing tests continue to pass alongside the new ones.
