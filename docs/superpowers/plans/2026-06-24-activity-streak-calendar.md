# Activity Streak Calendar & Weekly Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two collapsible sections at the bottom of the ProgressStats dashboard card — a monthly streak calendar showing activity icons and weekly streak status, and a tabbed activity stats panel with this-week totals and a 12-week trailing line chart.

**Architecture:** Extend `ChartsData` with a lightweight `ActivitySummary[]` field (the `/api/charts` route already fetches 365 days of all-type activities — we just keep the fields). Two new display-only components (`StreakCalendar`, `ActivityStatsPanel`) live in `components/`. `ProgressStats` gains two new collapsible rows at its bottom and an `activities?: ActivitySummary[]` prop, threaded from the dashboard via the existing `chartsData` state.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, inline SVG for charts and icons (same pattern as `CtlTrendStrip`).

## Global Constraints

- All components are `'use client'`
- Tailwind only — no new CSS files
- No new external libraries
- ISO week = Mon–Sun throughout; use `isoWeekStart` from `lib/chart-helpers.ts` for Monday-of-week calculation
- Activity type matching is case-insensitive regex: `/ride/i`, `/run/i`, `/walk/i`; everything else = `'Other'`
- Streak week = any ISO week (Mon–Sun) with ≥1 activity; streak = consecutive such weeks walking backwards from today
- Current in-progress week included in streak count if it has ≥1 activity; does not break the streak if empty
- Chart and stats always reflect the current ISO week + 11 prior weeks (12 total)
- Mobile-first: design for 375px width; all touch targets ≥44px tall

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `types/index.ts` | Modify | Add `ActivitySummary` interface; add `activities` field to `ChartsData` |
| `app/api/charts/route.ts` | Modify | Map `ICUActivity[]` → `ActivitySummary[]`; include in response |
| `lib/streak.ts` | Create | Pure functions: `classifyTab`, `computeWeeklyStreak`, `computeStreakActivityCount` |
| `components/StreakCalendar.tsx` | Create | Monthly calendar grid with day icons and weekly streak column |
| `components/ActivityStatsPanel.tsx` | Create | Tab selector + stats row + 12-week SVG line chart |
| `components/ProgressStats.tsx` | Modify | Add `activities` prop; add two collapsible rows at bottom |
| `app/dashboard/page.tsx` | Modify | Pass `chartsData?.activities` to `ProgressStats` |
| `__tests__/lib/streak.test.ts` | Create | Unit tests for streak logic and tab classification |
| `__tests__/components/StreakCalendar.test.tsx` | Create | Component rendering tests |
| `__tests__/components/ActivityStatsPanel.test.tsx` | Create | Component rendering and tab-switching tests |
| `__tests__/components/ProgressStats.test.tsx` | Modify | Add tests for new collapsible rows |
| `__tests__/components/CtlTrendStrip.test.tsx` | Modify | Add `activities: []` to `mockCharts` to satisfy updated type |
| `__tests__/app/fitness/page.test.tsx` | Modify | Add `activities: []` to `mockCharts` to satisfy updated type |

---

### Task 1: Add `ActivitySummary` type and extend `/api/charts`

**Files:**
- Modify: `types/index.ts` (after line 449, inside `ChartsData`)
- Modify: `app/api/charts/route.ts` (add mapping before final response)
- Modify: `__tests__/components/CtlTrendStrip.test.tsx` (add `activities: []` to mockCharts)
- Modify: `__tests__/app/fitness/page.test.tsx` (add `activities: []` to mockCharts)

**Interfaces:**
- Produces: `ActivitySummary` type used by Tasks 2–5; `ChartsData.activities` used by Tasks 3–5

- [ ] **Step 1: Add `ActivitySummary` interface and extend `ChartsData` in `types/index.ts`**

Insert the `ActivitySummary` interface immediately before the `ChartsData` interface (currently at line 444). Then add the `activities` field to `ChartsData`:

```ts
// Add before ChartsData (around line 444):
export interface ActivitySummary {
  date: string           // YYYY-MM-DD
  type: string           // raw intervals.icu type, e.g. "Ride", "Run", "Walk", "WeightTraining"
  distanceM: number | null
  elevationM: number | null
  movingTimeSecs: number
}

export interface ChartsData {
  wellness: ICUWellness[]
  weeklyTss: WeeklyTss[]
  rides: RidePoint[]
  dailyStrain: DailyStrainPoint[]
  activities: ActivitySummary[]   // all-type activities for last 365 days
}
```

- [ ] **Step 2: Map activities in `/api/charts/route.ts`**

In `app/api/charts/route.ts`, after the `rides` array is built (around line where `const rides: RidePoint[] = activities.map(...)`), add:

```ts
const activitySummaries: ActivitySummary[] = activities.map(a => ({
  date: a.start_date_local.slice(0, 10),
  type: a.type,
  distanceM: a.distance ?? null,
  elevationM: a.total_elevation_gain ?? null,
  movingTimeSecs: a.moving_time,
}))
```

Then update the final response object to include it:

```ts
const charts: ChartsData = { wellness, weeklyTss, rides, dailyStrain, activities: activitySummaries }
```

Also add the import at the top of the route file (it imports from `@/types`):
```ts
import type { ChartsData, WeeklyTss, RidePoint, DailyStrainPoint, ActivitySummary } from '@/types'
```

- [ ] **Step 3: Fix existing `mockCharts` objects to satisfy the updated `ChartsData` type**

In `__tests__/components/CtlTrendStrip.test.tsx`, find the `const mockCharts: ChartsData = {` declaration and add `activities: [],` as the last field:

```ts
const mockCharts: ChartsData = {
  wellness: [...],
  weeklyTss: [],
  dailyStrain: [],
  rides: [...],
  activities: [],   // ADD THIS LINE
}
```

Do the same in `__tests__/app/fitness/page.test.tsx`:

```ts
const mockCharts: ChartsData = {
  wellness: [...],
  weeklyTss: [...],
  rides: [],
  dailyStrain: [],
  activities: [],   // ADD THIS LINE
}
```

- [ ] **Step 4: Run the full test suite to confirm no regressions**

```bash
cd "C:\Users\chris\Claude_CP\Cycling Coach\cycling-coach"
npx jest --passWithNoTests
```

Expected: all previously-passing tests still pass (TypeScript type errors in the mocks would show as test failures).

- [ ] **Step 5: Commit**

```bash
git add types/index.ts app/api/charts/route.ts __tests__/components/CtlTrendStrip.test.tsx __tests__/app/fitness/page.test.tsx
git commit -m "feat: add ActivitySummary type and include in /api/charts response"
```

---

### Task 2: Streak logic library (`lib/streak.ts`)

**Files:**
- Create: `lib/streak.ts`
- Create: `__tests__/lib/streak.test.ts`

**Interfaces:**
- Consumes: `ActivitySummary` from `@/types`; `isoWeekStart` from `lib/chart-helpers.ts`
- Produces:
  - `export type ActivityTab = 'Ride' | 'Run' | 'Walk' | 'Other'`
  - `export function classifyTab(type: string): ActivityTab`
  - `export function computeWeeklyStreak(activities: ActivitySummary[], today: string): number`
  - `export function computeStreakActivityCount(activities: ActivitySummary[], today: string): number`

- [ ] **Step 1: Write failing tests in `__tests__/lib/streak.test.ts`**

```ts
/** @jest-environment node */
import { classifyTab, computeWeeklyStreak, computeStreakActivityCount } from '@/lib/streak'
import type { ActivitySummary } from '@/types'

function act(date: string, type = 'Ride', distanceM = 40000): ActivitySummary {
  return { date, type, distanceM, elevationM: 500, movingTimeSecs: 3600 }
}

// Fixed "today" for deterministic tests
const TODAY = '2026-06-24'  // Wednesday

describe('classifyTab', () => {
  it('classifies Ride variants', () => {
    expect(classifyTab('Ride')).toBe('Ride')
    expect(classifyTab('VirtualRide')).toBe('Ride')
    expect(classifyTab('MountainBikeRide')).toBe('Ride')
  })
  it('classifies Run variants', () => {
    expect(classifyTab('Run')).toBe('Run')
    expect(classifyTab('TrailRun')).toBe('Run')
  })
  it('classifies Walk', () => {
    expect(classifyTab('Walk')).toBe('Walk')
  })
  it('returns Other for everything else', () => {
    expect(classifyTab('WeightTraining')).toBe('Other')
    expect(classifyTab('Yoga')).toBe('Other')
    expect(classifyTab('')).toBe('Other')
  })
})

describe('computeWeeklyStreak', () => {
  it('returns 0 for empty activities', () => {
    expect(computeWeeklyStreak([], TODAY)).toBe(0)
  })

  it('returns 1 when only current week has activity', () => {
    // TODAY = 2026-06-24 (Wed); week Mon = 2026-06-22
    const activities = [act('2026-06-22'), act('2026-06-23')]
    expect(computeWeeklyStreak(activities, TODAY)).toBe(1)
  })

  it('counts consecutive complete past weeks + current week', () => {
    // 3 prior complete weeks + current week = 4
    const activities = [
      act('2026-06-01'), // week of May 25 – actually June 1 is Monday, week of Jun 1
      act('2026-06-08'),
      act('2026-06-15'),
      act('2026-06-22'), // current week
    ]
    expect(computeWeeklyStreak(activities, TODAY)).toBe(4)
  })

  it('stops streak at a complete week with no activity', () => {
    // Gap at week of Jun 8: streak resets at Jun 15 onward
    const activities = [
      act('2026-06-01'), // older — should not count
      // Jun 8 week empty — breaks the chain
      act('2026-06-15'),
      act('2026-06-22'), // current week
    ]
    expect(computeWeeklyStreak(activities, TODAY)).toBe(2)
  })

  it('does not break streak if current week has no activity yet', () => {
    // Current week is empty; last 2 complete weeks had activity → streak = 2
    const activities = [act('2026-06-08'), act('2026-06-15')]
    // today = Wed Jun 24; current week (Jun 22-28) has no activity
    expect(computeWeeklyStreak(activities, TODAY)).toBe(2)
  })
})

describe('computeStreakActivityCount', () => {
  it('returns 0 when streak is 0', () => {
    expect(computeStreakActivityCount([], TODAY)).toBe(0)
  })

  it('counts only activities within the streak window', () => {
    const activities = [
      act('2026-05-25'), // outside streak — gap at Jun 1 week
      act('2026-06-08'),
      act('2026-06-09'),
      act('2026-06-15'),
      act('2026-06-22'),
      act('2026-06-23'),
    ]
    // Streak = 3 (Jun 8, Jun 15, Jun 22 weeks); activities in those weeks = 5
    expect(computeStreakActivityCount(activities, TODAY)).toBe(5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/lib/streak.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '@/lib/streak'`

- [ ] **Step 3: Implement `lib/streak.ts`**

```ts
import { isoWeekStart } from '@/lib/chart-helpers'
import type { ActivitySummary } from '@/types'

export type ActivityTab = 'Ride' | 'Run' | 'Walk' | 'Other'

export function classifyTab(type: string): ActivityTab {
  if (/ride/i.test(type)) return 'Ride'
  if (/run/i.test(type))  return 'Run'
  if (/walk/i.test(type)) return 'Walk'
  return 'Other'
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function weekHasActivity(dates: Set<string>, monday: string, today: string): boolean {
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i)
    if (day > today) break
    if (dates.has(day)) return true
  }
  return false
}

function isWeekComplete(monday: string, today: string): boolean {
  // The week is complete when its Sunday has passed
  return addDays(monday, 6) < today
}

export function computeWeeklyStreak(activities: ActivitySummary[], today: string): number {
  if (!activities.length) return 0
  const dates = new Set(activities.map(a => a.date))
  let streak = 0

  // Start at Monday of the current week
  const currentMonday = isoWeekStart(today)

  // Include current week if it has activity
  if (weekHasActivity(dates, currentMonday, today)) streak++

  // Walk back through complete past weeks
  let monday = addDays(currentMonday, -7)
  while (isWeekComplete(monday, today)) {
    if (!weekHasActivity(dates, monday, today)) break
    streak++
    monday = addDays(monday, -7)
  }

  return streak
}

export function computeStreakActivityCount(activities: ActivitySummary[], today: string): number {
  const streak = computeWeeklyStreak(activities, today)
  if (streak === 0) return 0
  const currentMonday = isoWeekStart(today)
  const streakStart = addDays(currentMonday, -(streak - 1) * 7)
  return activities.filter(a => a.date >= streakStart && a.date <= today).length
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/lib/streak.test.ts --no-coverage
```

Expected: PASS — 12/12 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/streak.ts __tests__/lib/streak.test.ts
git commit -m "feat: add streak logic and activity tab classification helpers"
```

---

### Task 3: `StreakCalendar` component

**Files:**
- Create: `components/StreakCalendar.tsx`
- Create: `__tests__/components/StreakCalendar.test.tsx`

**Interfaces:**
- Consumes: `ActivitySummary` from `@/types`; `computeWeeklyStreak`, `computeStreakActivityCount` from `lib/streak.ts`; `isoWeekStart` from `lib/chart-helpers.ts`
- Produces: `export default function StreakCalendar({ activities, today }: { activities: ActivitySummary[], today: string })`

- [ ] **Step 1: Write failing tests**

```tsx
/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react'
import StreakCalendar from '@/components/StreakCalendar'
import type { ActivitySummary } from '@/types'

function act(date: string, type = 'Ride'): ActivitySummary {
  return { date, type, distanceM: 40000, elevationM: 500, movingTimeSecs: 3600 }
}

const TODAY = '2026-06-24'

const activities = [
  act('2026-06-22'), act('2026-06-23'), // current week (Mon, Tue)
  act('2026-06-15'), act('2026-06-17'), // week of Jun 15
  act('2026-06-08'),                     // week of Jun 8
]

describe('StreakCalendar', () => {
  it('renders 7 day-of-week column headers', () => {
    render(<StreakCalendar activities={activities} today={TODAY} />)
    expect(screen.getByText('M')).toBeInTheDocument()
    expect(screen.getByText('T')).toBeInTheDocument()  // Tue
    expect(screen.getByText('S')).toBeInTheDocument()  // Sat or Sun
  })

  it('renders activity days with filled-circle class', () => {
    render(<StreakCalendar activities={activities} today={TODAY} />)
    // Activity on Jun 22 — the circle has a specific class
    const circles = document.querySelectorAll('[data-testid="activity-circle"]')
    expect(circles.length).toBeGreaterThan(0)
  })

  it('renders streak and activity count in header', () => {
    render(<StreakCalendar activities={activities} today={TODAY} />)
    // Streak = 3 weeks (Jun 8, 15, 22)
    expect(screen.getByText(/3 Weeks/)).toBeInTheDocument()
    expect(screen.getByText(/5 Activities/)).toBeInTheDocument()
  })

  it('shows flame icon in current week right column when streak > 0', () => {
    render(<StreakCalendar activities={activities} today={TODAY} />)
    expect(screen.getByTestId('week-flame')).toBeInTheDocument()
  })

  it('shows checkmark in past complete weeks with activity', () => {
    render(<StreakCalendar activities={activities} today={TODAY} />)
    const checks = screen.getAllByTestId('week-check')
    expect(checks.length).toBeGreaterThan(0)
  })

  it('navigates to previous month on left arrow click', () => {
    render(<StreakCalendar activities={activities} today={TODAY} />)
    expect(screen.getByText('June 2026')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Previous month'))
    expect(screen.getByText('May 2026')).toBeInTheDocument()
  })

  it('renders without crash when activities is empty', () => {
    const { container } = render(<StreakCalendar activities={[]} today={TODAY} />)
    expect(container.firstChild).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/components/StreakCalendar.test.tsx --no-coverage
```

Expected: FAIL — `Cannot find module '@/components/StreakCalendar'`

- [ ] **Step 3: Implement `components/StreakCalendar.tsx`**

```tsx
'use client'
import { useState } from 'react'
import type { ActivitySummary } from '@/types'
import { isoWeekStart } from '@/lib/chart-helpers'
import { computeWeeklyStreak, computeStreakActivityCount } from '@/lib/streak'

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW_LABELS = ['M','T','W','T','F','S','S']

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function getMonthGrid(year: number, month: number): string[][] {
  // month is 1-indexed
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const dow = firstDay.getUTCDay()
  const daysFromMon = dow === 0 ? 6 : dow - 1
  const gridStart = new Date(firstDay)
  gridStart.setUTCDate(gridStart.getUTCDate() - daysFromMon)

  const rows: string[][] = []
  const cursor = new Date(gridStart)
  for (let row = 0; row < 6; row++) {
    const week: string[] = []
    for (let col = 0; col < 7; col++) {
      week.push(cursor.toISOString().slice(0, 10))
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    const hasMonthDay = week.some(d => {
      const dt = new Date(d + 'T00:00:00Z')
      return dt.getUTCMonth() + 1 === month && dt.getUTCFullYear() === year
    })
    if (hasMonthDay) rows.push(week)
    else if (rows.length > 0) break
  }
  return rows
}

function SportIcon({ type }: { type: string }) {
  if (/ride/i.test(type)) {
    return (
      <svg viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.3" className="w-3.5 h-3.5">
        <circle cx="4" cy="11" r="2.8"/>
        <circle cx="12" cy="11" r="2.8"/>
        <path d="M4 11 L8 5.5 L12 11"/>
        <path d="M8 5.5 L10.5 5.5"/>
        <circle cx="7.5" cy="8.2" r="1.2" fill="white" stroke="none"/>
      </svg>
    )
  }
  if (/run|walk/i.test(type)) {
    return (
      <svg viewBox="0 0 16 16" fill="white" className="w-3.5 h-3.5">
        <circle cx="10" cy="2.5" r="1.5"/>
        <path d="M6.5 5.5 L9 3.5 L11.5 5 L10 8.5 L13 12 L11.5 13 L8.5 10 L7 12 L4.5 11 L7 8 Z"/>
      </svg>
    )
  }
  if (/weight|strength|gym/i.test(type)) {
    return (
      <svg viewBox="0 0 16 16" fill="white" className="w-3.5 h-3.5">
        <rect x="1" y="5.5" width="2.5" height="5" rx="0.8"/>
        <rect x="12.5" y="5.5" width="2.5" height="5" rx="0.8"/>
        <rect x="3.5" y="6.8" width="9" height="2.4" rx="0.5"/>
      </svg>
    )
  }
  return <span className="block w-2 h-2 rounded-full bg-white"/>
}

interface Props {
  activities: ActivitySummary[]
  today: string  // YYYY-MM-DD
}

export default function StreakCalendar({ activities, today }: Props) {
  const [todayYear, todayMonth] = today.split('-').map(Number)
  const [viewYear, setViewYear] = useState(todayYear)
  const [viewMonth, setViewMonth] = useState(todayMonth)

  const dateSet = new Set(activities.map(a => a.date))
  const multiSet = new Map<string, number>()
  for (const a of activities) {
    multiSet.set(a.date, (multiSet.get(a.date) ?? 0) + 1)
  }

  // Primary type per day (first activity's type)
  const typeByDate = new Map<string, string>()
  for (const a of [...activities].reverse()) {
    typeByDate.set(a.date, a.type)
  }

  const streakWeeks = computeWeeklyStreak(activities, today)
  const streakActivities = computeStreakActivityCount(activities, today)

  const rows = getMonthGrid(viewYear, viewMonth)

  function prevMonth() {
    if (viewMonth === 1) { setViewYear(y => y - 1); setViewMonth(12) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 12) { setViewYear(y => y + 1); setViewMonth(1) }
    else setViewMonth(m => m + 1)
  }

  function WeekStatus({ monday }: { monday: string }) {
    const sunday = addDays(monday, 6)
    const isCurrentWeek = monday === isoWeekStart(today)
    const isComplete = sunday < today

    const hasActivity = (() => {
      for (let i = 0; i < 7; i++) {
        const d = addDays(monday, i)
        if (d > today) break
        if (dateSet.has(d)) return true
      }
      return false
    })()

    if (isCurrentWeek && hasActivity && streakWeeks > 0) {
      return (
        <div data-testid="week-flame" className="flex items-center gap-0.5">
          <span className="text-orange-500 text-sm leading-none">🔥</span>
          <span className="text-[10px] font-bold text-orange-500">{streakWeeks}</span>
        </div>
      )
    }
    if (isComplete && hasActivity) {
      return (
        <div data-testid="week-check" className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center">
          <svg viewBox="0 0 10 10" className="w-3 h-3">
            <path d="M2 5 L4 7.5 L8 3" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )
    }
    return <div className="w-5 h-5 rounded-full border border-gray-200"/>
  }

  return (
    <div className="px-4 py-3">
      {/* Month nav + stats */}
      <div className="flex items-center justify-between mb-1">
        <button
          aria-label="Previous month"
          onClick={prevMonth}
          className="p-1 text-gray-400 hover:text-gray-600"
        >
          ‹
        </button>
        <span className="text-[13px] font-semibold text-gray-700">
          {MONTH_NAMES[viewMonth - 1]} {viewYear}
        </span>
        <button
          aria-label="Next month"
          onClick={nextMonth}
          className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
          disabled={viewYear > todayYear || (viewYear === todayYear && viewMonth >= todayMonth)}
        >
          ›
        </button>
      </div>

      {streakWeeks > 0 && (
        <p className="text-[11px] text-gray-500 text-center mb-2">
          {streakWeeks} {streakWeeks === 1 ? 'Week' : 'Weeks'} · {streakActivities} {streakActivities === 1 ? 'Activity' : 'Activities'}
        </p>
      )}

      {/* Day-of-week headers */}
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_1fr_28px] gap-x-1 mb-1">
        {DOW_LABELS.map((l, i) => (
          <div key={i} className="text-center text-[10px] font-semibold text-gray-400">{l}</div>
        ))}
        <div/> {/* spacer for week-status column */}
      </div>

      {/* Calendar rows */}
      {rows.map((week, ri) => {
        const inMonth = (d: string) => {
          const dt = new Date(d + 'T00:00:00Z')
          return dt.getUTCMonth() + 1 === viewMonth && dt.getUTCFullYear() === viewYear
        }
        const monday = week[0]
        const dayNum = (d: string) => Number(d.split('-')[2])

        return (
          <div key={ri} className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_1fr_28px] gap-x-1 mb-1 items-center">
            {week.map((day) => {
              const hasAct = dateSet.has(day)
              const isToday = day === today
              const isFuture = day > today
              const isIn = inMonth(day)

              if (!isIn) {
                return (
                  <div key={day} className="flex items-center justify-center h-7">
                    <span className="text-[10px] text-gray-200">{dayNum(day)}</span>
                  </div>
                )
              }

              if (hasAct) {
                return (
                  <div key={day} className="flex flex-col items-center">
                    <div
                      data-testid="activity-circle"
                      className="w-7 h-7 rounded-full bg-gray-900 flex items-center justify-center"
                    >
                      <SportIcon type={typeByDate.get(day) ?? ''} />
                    </div>
                    {(multiSet.get(day) ?? 0) > 1 && (
                      <div className="w-1 h-1 rounded-full bg-gray-400 mt-0.5"/>
                    )}
                  </div>
                )
              }

              if (isFuture) {
                return (
                  <div key={day} className="flex items-center justify-center h-7">
                    <span className="text-[10px] text-gray-300">{dayNum(day)}</span>
                  </div>
                )
              }

              // Past day with no activity
              return (
                <div key={day} className="flex items-center justify-center h-7">
                  {isToday ? (
                    <div className="w-7 h-7 rounded-full ring-1 ring-gray-400 flex items-center justify-center">
                      <span className="text-[10px] font-semibold text-gray-700">{dayNum(day)}</span>
                    </div>
                  ) : (
                    <span className="text-[10px] text-gray-400">{dayNum(day)}</span>
                  )}
                </div>
              )
            })}
            <div className="flex items-center justify-center">
              <WeekStatus monday={monday} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/components/StreakCalendar.test.tsx --no-coverage
```

Expected: PASS — 7/7 tests passing

- [ ] **Step 5: Commit**

```bash
git add components/StreakCalendar.tsx __tests__/components/StreakCalendar.test.tsx
git commit -m "feat: add StreakCalendar component with monthly grid and weekly streak status"
```

---

### Task 4: `ActivityStatsPanel` component

**Files:**
- Create: `components/ActivityStatsPanel.tsx`
- Create: `__tests__/components/ActivityStatsPanel.test.tsx`

**Interfaces:**
- Consumes: `ActivitySummary` from `@/types`; `classifyTab`, `ActivityTab` from `lib/streak.ts`; `isoWeekStart` from `lib/chart-helpers.ts`
- Produces: `export default function ActivityStatsPanel({ activities, today }: { activities: ActivitySummary[], today: string })`

- [ ] **Step 1: Write failing tests**

```tsx
/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react'
import ActivityStatsPanel from '@/components/ActivityStatsPanel'
import type { ActivitySummary } from '@/types'

function act(date: string, type: string, distanceM = 40000, elevationM = 500, movingTimeSecs = 7200): ActivitySummary {
  return { date, type, distanceM, elevationM, movingTimeSecs }
}

const TODAY = '2026-06-24'  // Wednesday, week starts Jun 22

// This week (Jun 22–24)
const activities: ActivitySummary[] = [
  act('2026-06-22', 'Ride', 41000, 786, 7440),  // 41 km, 786m, 2h 4m
  act('2026-06-23', 'Run',  8000,  50,  2400),
  act('2026-06-22', 'WeightTraining', null, null, 3600),
]

describe('ActivityStatsPanel', () => {
  it('renders four activity tabs', () => {
    render(<ActivityStatsPanel activities={activities} today={TODAY} />)
    expect(screen.getByRole('button', { name: /Ride/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Walk/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Other/i })).toBeInTheDocument()
  })

  it('shows distance, time, elevation for Ride tab', async () => {
    render(<ActivityStatsPanel activities={activities} today={TODAY} />)
    fireEvent.click(screen.getByRole('button', { name: /Ride/i }))
    expect(screen.getByText('41.0 km')).toBeInTheDocument()
    expect(screen.getByText('786 m')).toBeInTheDocument()
  })

  it('shows Sessions count and no elevation for Other tab', () => {
    render(<ActivityStatsPanel activities={activities} today={TODAY} />)
    fireEvent.click(screen.getByRole('button', { name: /Other/i }))
    expect(screen.getByText('1 session')).toBeInTheDocument()
    expect(screen.queryByText(/elevation/i)).not.toBeInTheDocument()
  })

  it('renders an SVG chart', () => {
    render(<ActivityStatsPanel activities={activities} today={TODAY} />)
    expect(document.querySelector('svg[data-testid="activity-chart"]')).toBeInTheDocument()
  })

  it('renders without crash when activities is empty', () => {
    const { container } = render(<ActivityStatsPanel activities={[]} today={TODAY} />)
    expect(container.firstChild).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/components/ActivityStatsPanel.test.tsx --no-coverage
```

Expected: FAIL — `Cannot find module '@/components/ActivityStatsPanel'`

- [ ] **Step 3: Implement `components/ActivityStatsPanel.tsx`**

```tsx
'use client'
import { useState } from 'react'
import type { ActivitySummary } from '@/types'
import { classifyTab, type ActivityTab } from '@/lib/streak'
import { isoWeekStart } from '@/lib/chart-helpers'

const TABS: ActivityTab[] = ['Ride', 'Run', 'Walk', 'Other']
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const TAB_ICONS: Record<ActivityTab, string> = {
  Ride: '🚲',
  Run: '👟',
  Walk: '🚶',
  Other: '●',
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function fmtTime(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

interface WeekBucket {
  weekStart: string
  distanceKm: number
  elevationM: number
  timeSecs: number
  sessions: number
}

function buildBuckets(activities: ActivitySummary[], tab: ActivityTab, today: string): WeekBucket[] {
  const monday = isoWeekStart(today)
  return Array.from({ length: 12 }, (_, i) => {
    const weekStart = addDays(monday, -(11 - i) * 7)
    const weekEnd = addDays(weekStart, 6)
    const week = activities.filter(a =>
      a.date >= weekStart && a.date <= weekEnd && a.date <= today && classifyTab(a.type) === tab
    )
    return {
      weekStart,
      distanceKm: week.reduce((s, a) => s + (a.distanceM ?? 0), 0) / 1000,
      elevationM: Math.round(week.reduce((s, a) => s + (a.elevationM ?? 0), 0)),
      timeSecs: week.reduce((s, a) => s + a.movingTimeSecs, 0),
      sessions: week.length,
    }
  })
}

const W = 320, H = 70
const PAD_T = 8, PAD_B = 18, PAD_L = 4, PAD_R = 4
const CW = W - PAD_L - PAD_R
const CH = H - PAD_T - PAD_B

interface Props {
  activities: ActivitySummary[]
  today: string  // YYYY-MM-DD
}

export default function ActivityStatsPanel({ activities, today }: Props) {
  const defaultTab = TABS.find(tab =>
    activities.some(a => {
      const monday = isoWeekStart(today)
      return classifyTab(a.type) === tab && a.date >= addDays(monday, -11 * 7)
    })
  ) ?? 'Ride'

  const [tab, setTab] = useState<ActivityTab>(defaultTab)

  const monday = isoWeekStart(today)
  const thisWeek = activities.filter(a =>
    classifyTab(a.type) === tab && a.date >= monday && a.date <= today
  )
  const thisWeekKm   = thisWeek.reduce((s, a) => s + (a.distanceM ?? 0), 0) / 1000
  const thisWeekElev = Math.round(thisWeek.reduce((s, a) => s + (a.elevationM ?? 0), 0))
  const thisWeekSecs = thisWeek.reduce((s, a) => s + a.movingTimeSecs, 0)
  const thisWeekSessions = thisWeek.length

  const buckets = buildBuckets(activities, tab, today)
  const vals = buckets.map(b => tab === 'Other' ? b.sessions : b.distanceKm)
  const maxVal = Math.max(...vals, 1)

  const xOf = (i: number) => PAD_L + (i / 11) * CW
  const yOf = (v: number) => normalizeY(v, 0, maxVal, PAD_T, PAD_T + CH)

  // SVG area fill
  const areaD = vals
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(' ')
    + ` L${xOf(11).toFixed(1)},${(PAD_T + CH).toFixed(1)} L${xOf(0).toFixed(1)},${(PAD_T + CH).toFixed(1)} Z`

  // SVG line
  const lineD = vals
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(' ')

  // x-axis month labels
  const xLabels = buckets.map((b, i) => {
    if (i === 0) return MONTHS[new Date(b.weekStart + 'T00:00:00Z').getUTCMonth()]
    const prev = new Date(buckets[i - 1].weekStart + 'T00:00:00Z').getUTCMonth()
    const cur  = new Date(b.weekStart + 'T00:00:00Z').getUTCMonth()
    return cur !== prev ? MONTHS[cur] : null
  })

  return (
    <div className="px-4 py-3">
      {/* Tab row */}
      <div className="flex gap-2 mb-3 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            role="button"
            aria-label={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold border shrink-0 ${
              tab === t
                ? 'border-orange-400 text-orange-500 bg-orange-50'
                : 'border-gray-200 text-gray-500 bg-white'
            }`}
          >
            <span>{TAB_ICONS[t]}</span>
            <span>{t}</span>
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div className={`grid gap-2 mb-3 ${tab === 'Other' ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {tab === 'Other' ? (
          <>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Sessions</div>
              <div className="text-base font-bold text-gray-900">
                {thisWeekSessions === 1 ? '1 session' : `${thisWeekSessions} sessions`}
              </div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Time</div>
              <div className="text-base font-bold text-gray-900">{thisWeekSecs > 0 ? fmtTime(thisWeekSecs) : '—'}</div>
            </div>
          </>
        ) : (
          <>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Distance</div>
              <div className="text-base font-bold text-gray-900">{thisWeekKm > 0 ? `${thisWeekKm.toFixed(1)} km` : '—'}</div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Time</div>
              <div className="text-base font-bold text-gray-900">{thisWeekSecs > 0 ? fmtTime(thisWeekSecs) : '—'}</div>
            </div>
            <div className="text-center">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Elevation</div>
              <div className="text-base font-bold text-gray-900">{thisWeekElev > 0 ? `${thisWeekElev} m` : '—'}</div>
            </div>
          </>
        )}
      </div>

      {/* Line chart */}
      <div className="relative w-full">
        <svg
          data-testid="activity-chart"
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: 70 }}
        >
          {/* Area fill */}
          <path d={areaD} fill="rgb(255 237 213)" opacity="0.8"/>

          {/* Line */}
          <path d={lineD} fill="none" stroke="#f97316" strokeWidth="1.5"/>

          {/* Dots */}
          {vals.map((v, i) => {
            const isCurrentWeek = i === 11
            return isCurrentWeek ? (
              <g key={i}>
                <line
                  x1={xOf(i).toFixed(1)} y1={PAD_T}
                  x2={xOf(i).toFixed(1)} y2={PAD_T + CH}
                  stroke="#f97316" strokeWidth="1" strokeDasharray="2 2"
                />
                <circle cx={xOf(i)} cy={yOf(v)} r="4" fill="#f97316"/>
              </g>
            ) : (
              <circle key={i} cx={xOf(i)} cy={yOf(v)} r="3" fill="white" stroke="#f97316" strokeWidth="1.2"/>
            )
          })}

          {/* x-axis month labels */}
          {xLabels.map((label, i) =>
            label ? (
              <text
                key={i}
                x={xOf(i)}
                y={H - 4}
                textAnchor="middle"
                fontSize="9"
                fill="#9ca3af"
              >
                {label}
              </text>
            ) : null
          )}
        </svg>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/components/ActivityStatsPanel.test.tsx --no-coverage
```

Expected: PASS — 5/5 tests passing

- [ ] **Step 5: Commit**

```bash
git add components/ActivityStatsPanel.tsx __tests__/components/ActivityStatsPanel.test.tsx
git commit -m "feat: add ActivityStatsPanel with tabbed weekly stats and 12-week line chart"
```

---

### Task 5: Wire collapsibles into `ProgressStats` and thread `activities` from dashboard

**Files:**
- Modify: `components/ProgressStats.tsx`
- Modify: `app/dashboard/page.tsx`
- Modify: `__tests__/components/ProgressStats.test.tsx`

**Interfaces:**
- Consumes: `StreakCalendar` from `components/StreakCalendar.tsx`; `ActivityStatsPanel` from `components/ActivityStatsPanel.tsx`; `computeWeeklyStreak`, `classifyTab` from `lib/streak.ts`; `isoWeekStart` from `lib/chart-helpers.ts`; `localDateStr` from `lib/local-date.ts`; `ActivitySummary` from `@/types`

- [ ] **Step 1: Add two new tests to `__tests__/components/ProgressStats.test.tsx`**

Add these tests at the end of the existing `describe('ProgressStats')` block:

```tsx
it('renders streak collapsible row when activities provided with streak > 0', async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
  const activities = [
    { date: '2026-06-22', type: 'Ride', distanceM: 40000, elevationM: 500, movingTimeSecs: 7200 },
  ]
  render(<ProgressStats syncVersion={0} activities={activities} />)
  await screen.findByText('245W')
  // Streak header row should be present (contains "Streak")
  expect(screen.getByText(/Streak/)).toBeInTheDocument()
})

it('renders activity stats collapsible row when activities provided', async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => briefData })
  const activities = [
    { date: '2026-06-22', type: 'Ride', distanceM: 40000, elevationM: 500, movingTimeSecs: 7200 },
  ]
  render(<ProgressStats syncVersion={0} activities={activities} />)
  await screen.findByText('245W')
  expect(screen.getByText(/Activity/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
npx jest __tests__/components/ProgressStats.test.tsx --no-coverage
```

Expected: FAIL — the new tests fail because `ProgressStats` doesn't accept `activities` prop yet.

- [ ] **Step 3: Update `components/ProgressStats.tsx`**

**3a.** Add imports at the top of the file:

```tsx
import StreakCalendar from '@/components/StreakCalendar'
import ActivityStatsPanel from '@/components/ActivityStatsPanel'
import { computeWeeklyStreak, classifyTab, type ActivityTab } from '@/lib/streak'
import { isoWeekStart } from '@/lib/chart-helpers'
import { localDateStr } from '@/lib/local-date'
import type { ActivitySummary } from '@/types'
```

**3b.** Add `activities` to the `Props` interface:

```ts
interface Props {
  syncVersion: number
  weeklyProgress?: WeeklyProgress | null
  eventCountdown?: EventCountdown | null
  upcomingEvents?: TrainingEvent[]
  upcomingTests?: Workout[]
  weeksRemainingInPlan?: number | null
  form?: number | null
  activities?: ActivitySummary[]   // ADD THIS
}
```

**3c.** Add `activities` to the destructured function params:

```tsx
export default function ProgressStats({ syncVersion, weeklyProgress, eventCountdown, upcomingEvents, upcomingTests, weeksRemainingInPlan, form, activities }: Props) {
```

**3d.** Add two `useState` hooks after the existing state declarations:

```tsx
const [streakOpen, setStreakOpen] = useState(false)
const [activityOpen, setActivityOpen] = useState(false)
```

**3e.** Update the early-return null check to also gate on activities:

Replace:
```tsx
if (!hasSeasonStats && !hasWeek && !eventCountdown && !upcomingEvents?.length && !upcomingTests?.length) return null
```

With:
```tsx
if (!hasSeasonStats && !hasWeek && !eventCountdown && !upcomingEvents?.length && !upcomingTests?.length && !activities?.length) return null
```

**3f.** Compute streak and activity summary values (add before the `return` statement):

```tsx
const todayStr = localDateStr(new Date())
const streakWeeks = activities?.length ? computeWeeklyStreak(activities, todayStr) : 0

const activityHeaderSummary = (() => {
  if (!activities?.length) return null
  const monday = isoWeekStart(todayStr)
  const TABS: ActivityTab[] = ['Ride', 'Run', 'Walk', 'Other']
  const defaultTab = TABS.find(tab =>
    activities.some(a => {
      const d = new Date(monday + 'T00:00:00Z')
      d.setUTCDate(d.getUTCDate() - 11 * 7)
      return classifyTab(a.type) === tab && a.date >= d.toISOString().slice(0, 10)
    })
  ) ?? 'Ride'
  const thisWeek = activities.filter(a =>
    classifyTab(a.type) === defaultTab && a.date >= monday && a.date <= todayStr
  )
  if (defaultTab === 'Other') {
    const secs = thisWeek.reduce((s, a) => s + a.movingTimeSecs, 0)
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60)
    const t = h > 0 ? `${h}h ${m}m` : `${m}m`
    return thisWeek.length > 0 ? `${thisWeek.length} sessions · ${t}` : null
  }
  const km = thisWeek.reduce((s, a) => s + (a.distanceM ?? 0), 0) / 1000
  const secs = thisWeek.reduce((s, a) => s + a.movingTimeSecs, 0)
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60)
  const t = h > 0 ? `${h}h ${m}m` : `${m}m`
  return km > 0 ? `${km.toFixed(1)} km · ${t}` : null
})()
```

**3g.** Add the two collapsible rows at the end of the returned `<div>` — inside the outer white card div, after the `{hasWeek && ...}` block (after line 167 in the original file, before the final closing `</div>`):

```tsx
{activities && activities.length > 0 && (
  <>
    {/* Streak collapsible */}
    <div className="border-t border-gray-100">
      <button
        onClick={() => setStreakOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 min-h-[44px]"
      >
        <span className="text-[12px] font-semibold text-gray-700">
          🔥 Streak{streakWeeks > 0 ? ` · ${streakWeeks} wks` : ''}
        </span>
        <svg
          viewBox="0 0 10 6"
          className={`w-3 h-3 text-gray-400 transition-transform ${streakOpen ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="1.5"
        >
          <path d="M1 1 L5 5 L9 1"/>
        </svg>
      </button>
      {streakOpen && <StreakCalendar activities={activities} today={todayStr} />}
    </div>

    {/* Activity stats collapsible */}
    <div className="border-t border-gray-100">
      <button
        onClick={() => setActivityOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 min-h-[44px]"
      >
        <span className="text-[12px] font-semibold text-gray-700">
          Activity{activityHeaderSummary ? ` · ${activityHeaderSummary}` : ''}
        </span>
        <svg
          viewBox="0 0 10 6"
          className={`w-3 h-3 text-gray-400 transition-transform ${activityOpen ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="1.5"
        >
          <path d="M1 1 L5 5 L9 1"/>
        </svg>
      </button>
      {activityOpen && <ActivityStatsPanel activities={activities} today={todayStr} />}
    </div>
  </>
)}
```

- [ ] **Step 4: Update `app/dashboard/page.tsx` to pass `activities` to `ProgressStats`**

Find the `<ProgressStats` call site (around line 633). Add `activities={chartsData?.activities}`:

```tsx
<ProgressStats
  syncVersion={syncVersion}
  weeklyProgress={weeklyProgress}
  eventCountdown={eventCountdown}
  upcomingEvents={upcomingEvents}
  upcomingTests={upcomingTests}
  weeksRemainingInPlan={weeksRemainingInPlan}
  form={form}
  activities={chartsData?.activities}
/>
```

- [ ] **Step 5: Run all tests**

```bash
npx jest --passWithNoTests
```

Expected: all tests pass. If any ProgressStats mock calls fail due to missing props, they will be caught here — add `activities={undefined}` to the failing `render(...)` calls (the prop is optional so this should not be needed).

- [ ] **Step 6: Commit**

```bash
git add components/ProgressStats.tsx app/dashboard/page.tsx __tests__/components/ProgressStats.test.tsx
git commit -m "feat: wire streak calendar and activity stats collapsibles into ProgressStats"
```
