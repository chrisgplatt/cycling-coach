# Fitness Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the Fitness page to add a Performance Management Chart (CTL/ATL/Form) and Weekly Training Load bar chart, both fetching 16 weeks of data from intervals.icu.

**Architecture:** A new `/api/charts` route fetches wellness and activity data using the existing `IntervalsClient` methods (`getWellness`, `getActivities`), then returns shaped chart data. The Fitness page renders two new SVG chart cards below the existing FTP section, using a shared `normalizeY` helper. No new npm dependencies.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, inline SVG, Jest + React Testing Library.

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `types/index.ts` | Modify | Add `WeeklyTss` and `ChartsData` interfaces |
| `lib/chart-helpers.ts` | Create | `normalizeY()` and `isoWeekStart()` utilities |
| `__tests__/lib/chart-helpers.test.ts` | Create | Unit tests for helpers |
| `app/api/charts/route.ts` | Create | API endpoint: fetch wellness + activities, return ChartsData |
| `app/fitness/page.tsx` | Modify | Add charts fetch, PMCChart and WeeklyTssChart components |
| `__tests__/app/fitness/page.test.tsx` | Create | Component tests for Fitness page charts |

---

## Task 1: Add Types

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Add the new interfaces**

Open `types/index.ts` and append these two interfaces after the `RidingStats` interface (around line 156):

```ts
export interface WeeklyTss {
  weekStart: string  // YYYY-MM-DD (Monday of that ISO week)
  tss: number
}

export interface ChartsData {
  wellness: ICUWellness[]
  weeklyTss: WeeklyTss[]
}
```

- [ ] **Step 2: Verify TypeScript is happy**

Run: `npx tsc --noEmit`
Expected: no errors related to the new types.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add WeeklyTss and ChartsData types"
```

---

## Task 2: Chart Helper Utilities

**Files:**
- Create: `lib/chart-helpers.ts`
- Create: `__tests__/lib/chart-helpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/chart-helpers.test.ts`:

```ts
import { normalizeY, isoWeekStart } from '@/lib/chart-helpers'

describe('normalizeY', () => {
  it('maps min value to svgBottom', () => {
    expect(normalizeY(0, 0, 100, 10, 110)).toBe(110)
  })

  it('maps max value to svgTop', () => {
    expect(normalizeY(100, 0, 100, 10, 110)).toBe(10)
  })

  it('maps midpoint to vertical centre', () => {
    expect(normalizeY(50, 0, 100, 10, 110)).toBe(60)
  })

  it('returns midpoint when min equals max', () => {
    expect(normalizeY(50, 50, 50, 10, 110)).toBe(60)
  })
})

describe('isoWeekStart', () => {
  it('Monday returns itself', () => {
    // 2026-05-18 is a Monday
    expect(isoWeekStart('2026-05-18')).toBe('2026-05-18')
  })

  it('Sunday rolls back to the previous Monday', () => {
    // 2026-05-17 is a Sunday
    expect(isoWeekStart('2026-05-17')).toBe('2026-05-11')
  })

  it('Saturday rolls back to Monday', () => {
    // 2026-05-23 is a Saturday
    expect(isoWeekStart('2026-05-23')).toBe('2026-05-18')
  })

  it('Wednesday rolls back to Monday', () => {
    // 2026-05-20 is a Wednesday
    expect(isoWeekStart('2026-05-20')).toBe('2026-05-18')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx jest __tests__/lib/chart-helpers.test.ts --no-coverage`
Expected: FAIL — "Cannot find module '@/lib/chart-helpers'"

- [ ] **Step 3: Implement the helpers**

Create `lib/chart-helpers.ts`:

```ts
export function normalizeY(
  value: number,
  min: number,
  max: number,
  svgTop: number,
  svgBottom: number,
): number {
  if (max === min) return (svgTop + svgBottom) / 2
  return svgBottom - ((value - min) / (max - min)) * (svgBottom - svgTop)
}

export function isoWeekStart(dateStr: string): string {
  const d = new Date(dateStr)
  const day = d.getUTCDay() // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx jest __tests__/lib/chart-helpers.test.ts --no-coverage`
Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/chart-helpers.ts __tests__/lib/chart-helpers.test.ts
git commit -m "feat: add normalizeY and isoWeekStart chart helpers"
```

---

## Task 3: API Route

**Files:**
- Create: `app/api/charts/route.ts`

No unit test for the route itself (it requires live Supabase + intervals.icu credentials). Component tests in Task 4 mock `fetch` instead.

- [ ] **Step 1: Create the route**

Create `app/api/charts/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { isoWeekStart } from '@/lib/chart-helpers'
import type { ChartsData, WeeklyTss } from '@/types'

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
  const oldest = new Date(today.getTime() - 112 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]

  const client = new IntervalsClient(
    profile.intervals_icu_athlete_id,
    profile.intervals_icu_api_key,
  )

  try {
    const [wellness, activities] = await Promise.all([
      client.getWellness(oldest, newest),
      client.getActivities(oldest, newest),
    ])

    const rides = activities.filter(a => /ride/i.test(a.type))
    const tssMap = new Map<string, number>()
    for (const ride of rides) {
      const week = isoWeekStart(ride.start_date_local)
      tssMap.set(week, (tssMap.get(week) ?? 0) + (ride.training_load ?? 0))
    }
    const weeklyTss: WeeklyTss[] = Array.from(tssMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, tss]) => ({ weekStart, tss: Math.round(tss) }))

    const charts: ChartsData = { wellness, weeklyTss }
    return NextResponse.json({ charts })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/charts/route.ts
git commit -m "feat: add /api/charts route for PMC and weekly TSS data"
```

---

## Task 4: Fitness Page Overhaul

**Files:**
- Modify: `app/fitness/page.tsx`
- Create: `__tests__/app/fitness/page.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `__tests__/app/fitness/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import FitnessPage from '@/app/fitness/page'
import type { ChartsData } from '@/types'

const mockCharts: ChartsData = {
  wellness: [
    { id: '2026-02-01', ctl: 40, atl: 45, form: -5, hrv: null, resting_hr: null, sleep_secs: null },
    { id: '2026-03-01', ctl: 48, atl: 52, form: -4, hrv: null, resting_hr: null, sleep_secs: null },
    { id: '2026-05-20', ctl: 54, atl: 61, form: -7, hrv: null, resting_hr: null, sleep_secs: null },
  ],
  weeklyTss: [
    { weekStart: '2026-02-02', tss: 280 },
    { weekStart: '2026-02-09', tss: 320 },
    { weekStart: '2026-05-18', tss: 180 },
  ],
}

global.fetch = jest.fn()

describe('FitnessPage charts', () => {
  afterEach(() => jest.clearAllMocks())

  it('shows spinner while charts are loading', () => {
    ;(global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}))
    render(<FitnessPage />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders PMC stat pills after load', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/charts') return Promise.resolve({ json: async () => ({ charts: mockCharts }) })
      return Promise.resolve({ json: async () => [] })
    })
    render(<FitnessPage />)
    expect(await screen.findByText('54')).toBeInTheDocument()  // CTL
    expect(screen.getByText('61')).toBeInTheDocument()          // ATL
    expect(screen.getByText('-7')).toBeInTheDocument()          // Form
    expect(screen.getByText('CTL')).toBeInTheDocument()
    expect(screen.getByText('ATL')).toBeInTheDocument()
    expect(screen.getByText('Form')).toBeInTheDocument()
  })

  it('renders weekly TSS bars (one rect per week)', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/charts') return Promise.resolve({ json: async () => ({ charts: mockCharts }) })
      return Promise.resolve({ json: async () => [] })
    })
    render(<FitnessPage />)
    await screen.findByText('CTL')
    // One SVG rect per week in the TSS chart
    const rects = document.querySelectorAll('svg rect')
    expect(rects.length).toBe(mockCharts.weeklyTss.length)
  })

  it('shows charts error message on fetch failure', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/charts') return Promise.resolve({ json: async () => ({ error: 'intervals.icu not configured' }) })
      return Promise.resolve({ json: async () => [] })
    })
    render(<FitnessPage />)
    expect(await screen.findByText('intervals.icu not configured')).toBeInTheDocument()
  })

  it('shows placeholder when wellness is empty', async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url === '/api/charts') return Promise.resolve({ json: async () => ({ charts: { wellness: [], weeklyTss: [] } }) })
      return Promise.resolve({ json: async () => [] })
    })
    render(<FitnessPage />)
    expect(await screen.findByText('No fitness data yet.')).toBeInTheDocument()
    expect(screen.getByText('No training load data yet.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx jest __tests__/app/fitness/page.test.tsx --no-coverage`
Expected: FAIL — tests can't find CTL/ATL/Form text because the charts don't exist yet.

- [ ] **Step 3: Rewrite the Fitness page**

Replace the entire contents of `app/fitness/page.tsx` with:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { normalizeY, isoWeekStart } from '@/lib/chart-helpers'
import type { FTPPrediction, ChartsData, ICUWellness, WeeklyTss } from '@/types'

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function SectionCard({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-200 flex items-center gap-2 bg-white">
        {accent && <span className={`w-2 h-2 rounded-full ${accent}`} />}
        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.06em]">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function PMCChart({ wellness }: { wellness: ICUWellness[] }) {
  const data = wellness.filter(w => w.ctl !== null || w.atl !== null || w.form !== null)
  if (!data.length) return <p className="text-sm text-gray-400 p-4">No fitness data yet.</p>

  const svgLeft = 30, svgRight = 420, svgTop = 15, svgBottom = 115
  const chartW = svgRight - svgLeft

  const allVals = data.flatMap(w =>
    [w.ctl, w.atl, w.form].filter((v): v is number => v !== null)
  )
  const dataMin = Math.floor(Math.min(...allVals) / 10) * 10 - 5
  const dataMax = Math.ceil(Math.max(...allVals) / 10) * 10 + 5

  const xOf = (i: number) => svgLeft + (i / Math.max(data.length - 1, 1)) * chartW
  const yOf = (v: number) => normalizeY(v, dataMin, dataMax, svgTop, svgBottom)

  const polyline = (key: 'ctl' | 'atl' | 'form') =>
    data
      .map((w, i) => w[key] !== null ? `${xOf(i)},${yOf(w[key] as number)}` : null)
      .filter(Boolean)
      .join(' ')

  const zeroY = yOf(0)
  const today = data[data.length - 1]
  const formColour = (today.form ?? 0) < 0 ? '#f59e0b' : '#10b981'
  const range = dataMax - dataMin
  const ticks = [dataMax, dataMin + range / 2, dataMin].map(v => Math.round(v))
  const tickYs = ticks.map(v => yOf(v))

  const monthLabels: { x: number; label: string }[] = []
  let lastMonth = -1
  data.forEach((w, i) => {
    const m = new Date(w.id).getMonth()
    if (m !== lastMonth) { monthLabels.push({ x: xOf(i), label: MONTHS[m] }); lastMonth = m }
  })

  return (
    <div>
      <div className="flex divide-x divide-gray-100 border-b border-gray-100">
        <div className="flex-1 text-center px-2 py-3">
          <div className="text-2xl font-extrabold text-blue-500">{today.ctl !== null ? Math.round(today.ctl) : '—'}</div>
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">CTL</div>
        </div>
        <div className="flex-1 text-center px-2 py-3">
          <div className="text-2xl font-extrabold text-red-500">{today.atl !== null ? Math.round(today.atl) : '—'}</div>
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">ATL</div>
        </div>
        <div className="flex-1 text-center px-2 py-3">
          <div className="text-2xl font-extrabold" style={{ color: formColour }}>
            {today.form !== null ? Math.round(today.form) : '—'}
          </div>
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.06em] mt-1">Form</div>
        </div>
      </div>
      <svg viewBox={`0 0 ${svgRight + 10} 140`} className="w-full">
        {tickYs.map((y, i) => (
          <g key={i}>
            <line x1={svgLeft} y1={y} x2={svgRight} y2={y} stroke="#f3f4f6" strokeWidth="1"/>
            <text x={svgLeft - 4} y={y + 4} fontSize="9" fill="#d1d5db" textAnchor="end">{ticks[i]}</text>
          </g>
        ))}
        {zeroY >= svgTop && zeroY <= svgBottom && (
          <line x1={svgLeft} y1={zeroY} x2={svgRight} y2={zeroY} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="3,3"/>
        )}
        <polyline points={polyline('ctl')} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round"/>
        <polyline points={polyline('atl')} fill="none" stroke="#ef4444" strokeWidth="2" strokeLinejoin="round" strokeDasharray="5,2"/>
        <polyline points={polyline('form')} fill="none" stroke={formColour} strokeWidth="2" strokeLinejoin="round"/>
        <line x1={svgRight} y1={svgTop} x2={svgRight} y2={svgBottom + 5} stroke="#9ca3af" strokeWidth="1" strokeDasharray="2,2"/>
        <text x={svgRight} y={svgBottom + 15} fontSize="8" fill="#9ca3af" textAnchor="middle">Today</text>
        {monthLabels.map((ml, i) => (
          <text key={i} x={ml.x} y={svgBottom + 25} fontSize="8" fill="#d1d5db" textAnchor="middle">{ml.label}</text>
        ))}
      </svg>
      <div className="flex gap-3 px-3 pb-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2.5px] bg-blue-500 rounded inline-block"/>CTL</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] bg-red-500 rounded inline-block"/>ATL</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded inline-block" style={{ background: formColour }}/>Form</span>
      </div>
    </div>
  )
}

function WeeklyTssChart({ weeklyTss }: { weeklyTss: WeeklyTss[] }) {
  if (!weeklyTss.length) return <p className="text-sm text-gray-400 p-4">No training load data yet.</p>

  const svgLeft = 30, svgRight = 420, svgTop = 10, svgBottom = 95
  const chartW = svgRight - svgLeft
  const n = weeklyTss.length
  const gap = 2
  const barW = Math.max(4, Math.floor(chartW / n) - gap)

  const maxTss = Math.ceil(Math.max(...weeklyTss.map(w => w.tss)) / 100) * 100 || 100
  const avgTss = Math.round(weeklyTss.reduce((s, w) => s + w.tss, 0) / n)

  const xOf = (i: number) => svgLeft + (i / n) * chartW + gap / 2
  const yOf = (tss: number) => normalizeY(tss, 0, maxTss, svgTop, svgBottom)
  const avgY = yOf(avgTss)

  const todayWeekStart = isoWeekStart(new Date().toISOString().split('T')[0])

  const monthLabels: { x: number; label: string }[] = []
  let lastMonth = -1
  weeklyTss.forEach((w, i) => {
    const m = new Date(w.weekStart).getMonth()
    if (m !== lastMonth) { monthLabels.push({ x: xOf(i) + barW / 2, label: MONTHS[m] }); lastMonth = m }
  })

  const ticks = [maxTss, Math.round(maxTss / 2), 0]
  const tickYs = ticks.map(v => yOf(v))

  return (
    <div>
      <svg viewBox={`0 0 ${svgRight + 10} 115`} className="w-full">
        {tickYs.map((y, i) => (
          <g key={i}>
            <line x1={svgLeft} y1={y} x2={svgRight} y2={y} stroke="#f3f4f6" strokeWidth="1"/>
            <text x={svgLeft - 4} y={y + 4} fontSize="9" fill="#d1d5db" textAnchor="end">{ticks[i]}</text>
          </g>
        ))}
        <line x1={svgLeft} y1={avgY} x2={svgRight} y2={avgY} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="3,3"/>
        {weeklyTss.map((w, i) => {
          const x = xOf(i)
          const y = yOf(w.tss)
          return (
            <rect
              key={w.weekStart}
              x={x} y={y} width={barW} height={svgBottom - y}
              rx="2"
              fill={w.weekStart === todayWeekStart ? '#c4b5fd' : '#8b5cf6'}
            />
          )
        })}
        {monthLabels.map((ml, i) => (
          <text key={i} x={ml.x} y={svgBottom + 15} fontSize="8" fill="#d1d5db" textAnchor="middle">{ml.label}</text>
        ))}
      </svg>
      <p className="text-[11px] text-gray-400 px-3 pb-3">Avg {avgTss} TSS/week</p>
    </div>
  )
}

export default function FitnessPage() {
  const [predictions, setPredictions] = useState<FTPPrediction[]>([])
  const [currentFTP, setCurrentFTP] = useState(200)
  const [predicting, setPredicting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRecencyWarning, setShowRecencyWarning] = useState(false)
  const [pendingFTPUpdate, setPendingFTPUpdate] = useState<number | null>(null)
  const [updatingFTP, setUpdatingFTP] = useState(false)
  const [charts, setCharts] = useState<ChartsData | null>(null)
  const [chartsLoading, setChartsLoading] = useState(true)
  const [chartsError, setChartsError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/ftp').then(r => r.json()).then(setPredictions).catch(() => {})
    fetch('/api/profile').then(r => r.json()).then((data) => {
      if (data?.current_ftp) setCurrentFTP(data.current_ftp)
    }).catch(() => {})
    fetch('/api/charts')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setCharts(data.charts)
      })
      .catch((e: Error) => setChartsError(e.message))
      .finally(() => setChartsLoading(false))
  }, [])

  const lastPrediction = predictions[0] ?? null
  const nextPredictionDate = lastPrediction
    ? new Date(new Date(lastPrediction.created_at).getTime() + FOUR_WEEKS_MS)
    : null
  const daysSinceLast = lastPrediction
    ? Math.floor((Date.now() - new Date(lastPrediction.created_at).getTime()) / 86400000)
    : null

  async function runPrediction() {
    setShowRecencyWarning(false)
    setPredicting(true)
    setError(null)
    try {
      const res = await fetch('/api/ftp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentFTP }),
      })
      const json = await res.json()
      if (res.ok) {
        setPredictions(prev => [json, ...prev])
        if (json.predicted_ftp !== currentFTP) setPendingFTPUpdate(json.predicted_ftp)
      } else {
        setError(json?.error ?? `Request failed (${res.status})`)
      }
    } catch {
      setError('Network error — could not reach server')
    } finally {
      setPredicting(false)
    }
  }

  async function updateProfileFTP(newFTP: number) {
    setUpdatingFTP(true)
    try {
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_ftp: newFTP }),
      })
      setCurrentFTP(newFTP)
    } finally {
      setUpdatingFTP(false)
      setPendingFTPUpdate(null)
    }
  }

  function handlePredictClick() {
    if (daysSinceLast !== null && daysSinceLast < 28) {
      setShowRecencyWarning(true)
    } else {
      runPrediction()
    }
  }

  const confidenceBadge = (c: string) => {
    if (c === 'high') return 'bg-emerald-100 text-emerald-700'
    if (c === 'medium') return 'bg-amber-100 text-amber-700'
    return 'bg-red-100 text-red-600'
  }

  return (
    <main className="max-w-xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Fitness</h1>
          <p className="text-sm text-gray-500 mt-0.5">FTP predictions and training trends</p>
          {nextPredictionDate && (
            <p className={`text-xs mt-1 font-medium ${nextPredictionDate > new Date() ? 'text-amber-600' : 'text-emerald-600'}`}>
              {nextPredictionDate > new Date()
                ? `Next prediction: ${nextPredictionDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
                : 'Ready for a new prediction'}
            </p>
          )}
        </div>
        <button
          onClick={handlePredictClick}
          disabled={predicting}
          className="bg-blue-600 text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm shrink-0"
        >
          {predicting ? 'Analysing…' : 'Predict FTP'}
        </button>
      </div>

      {showRecencyWarning && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-800 mb-1">FTP prediction run recently</p>
          <p className="text-sm text-amber-700 mb-3">
            Your last prediction was {daysSinceLast} day{daysSinceLast === 1 ? '' : 's'} ago. For the most accurate results, FTP predictions should be run no more than once every 4 weeks.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowRecencyWarning(false)}
              className="text-sm font-medium text-amber-700 hover:text-amber-900 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={runPrediction}
              className="text-sm font-medium bg-amber-600 text-white px-4 py-1.5 rounded-lg hover:bg-amber-700 transition-colors"
            >
              Run anyway
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">{error}</div>
      )}

      {predictions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
          <p className="text-gray-400 text-sm">No predictions yet.</p>
          <p className="text-gray-400 text-sm mt-1">Click <span className="font-medium text-gray-600">Predict FTP</span> to analyse your ride data.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Prediction history</p>
          {predictions.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="bg-gray-50 border-b border-gray-200 px-5 py-3.5 flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black text-gray-900 tracking-tight">{p.predicted_ftp}</span>
                  <span className="text-base font-semibold text-gray-400">W</span>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ml-1 ${confidenceBadge(p.confidence)}`}>
                    {p.confidence} confidence
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">
                    {new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  {p.confirmed && <p className="text-xs text-emerald-600 font-medium mt-0.5">&#10003; confirmed</p>}
                </div>
              </div>
              <div className="px-5 py-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Coach&apos;s Analysis</p>
                {p.reasoning.includes('•') ? (
                  <ul className="space-y-2">
                    {p.reasoning.split('\n').filter(l => l.trim()).map((line, i) => (
                      <li key={i} className="flex gap-2.5 text-sm text-gray-700 leading-snug">
                        <span className="text-blue-400 mt-0.5 shrink-0">•</span>
                        <span>{line.replace(/^•\s*/, '')}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-700 leading-relaxed">{p.reasoning}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {chartsLoading && (
        <div className="flex items-center justify-center py-10">
          <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
        </div>
      )}

      {!chartsLoading && chartsError && (
        <p className="text-sm text-red-600 px-1">{chartsError}</p>
      )}

      {!chartsLoading && !chartsError && charts && (
        <>
          <SectionCard title="Performance Management" accent="bg-blue-500">
            <PMCChart wellness={charts.wellness} />
          </SectionCard>

          <SectionCard title="Weekly Training Load" accent="bg-violet-500">
            <WeeklyTssChart weeklyTss={charts.weeklyTss} />
          </SectionCard>
        </>
      )}

      {pendingFTPUpdate !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Update profile FTP?</h2>
              <p className="text-sm text-gray-500 mt-1">The prediction differs from your current profile FTP.</p>
            </div>
            <div className="flex items-center justify-center gap-6 py-2">
              <div className="text-center">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Current</p>
                <p className="text-3xl font-black text-gray-400">{currentFTP}<span className="text-base font-semibold ml-0.5">W</span></p>
              </div>
              <span className="text-2xl text-gray-300">→</span>
              <div className="text-center">
                <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider mb-1">Predicted</p>
                <p className="text-3xl font-black text-blue-600">{pendingFTPUpdate}<span className="text-base font-semibold ml-0.5">W</span></p>
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-1">
              <button
                onClick={() => setPendingFTPUpdate(null)}
                disabled={updatingFTP}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Keep current
              </button>
              <button
                onClick={() => updateProfileFTP(pendingFTPUpdate)}
                disabled={updatingFTP}
                className="bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
              >
                {updatingFTP ? 'Updating…' : `Update to ${pendingFTPUpdate}W`}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx jest __tests__/app/fitness/page.test.tsx --no-coverage`
Expected: PASS — 5 tests passing.

- [ ] **Step 5: Run the full test suite**

Run: `npx jest --no-coverage`
Expected: all existing tests still pass, plus the new ones.

- [ ] **Step 6: Commit**

```bash
git add app/fitness/page.tsx __tests__/app/fitness/page.test.tsx
git commit -m "feat: add PMC and weekly TSS charts to Fitness page"
```
