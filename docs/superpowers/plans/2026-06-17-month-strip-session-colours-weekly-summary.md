# MonthStrip Session Colours & Weekly Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session-type dot colouring and a left-side weekly TSS/hours summary to the compact MonthStrip calendar grid at the top of the calendar page.

**Architecture:** Two pure helper functions (`getDayWorkoutColor`, `getWeeklySummary`) are added to `lib/calendar-helpers.ts` and tested in isolation. The MonthStrip in `app/calendar/page.tsx` is restructured from a flat `grid-cols-7` into explicit week rows, each prepended with a summary column that calls those helpers.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, Jest + React Testing Library.

---

## File map

| File | Change |
|---|---|
| `lib/calendar-helpers.ts` | Add `WeeklySummary` interface, `getDayWorkoutColor`, `getWeeklySummary` |
| `__tests__/lib/calendar-helpers.test.ts` | Add 7 new tests for the two helpers |
| `app/calendar/page.tsx` | Restructure `MonthStrip` render: chunked week rows + summary column + type-coloured dots |

---

## Task 1: Calendar helper functions + tests

**Files:**
- Modify: `lib/calendar-helpers.ts`
- Modify: `__tests__/lib/calendar-helpers.test.ts`

---

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/lib/calendar-helpers.test.ts`:

```ts
import {
  calendarMonthDays,
  weekDates,
  formatDuration,
  formatMovingTime,
  toLocalDateStr,
  weekdayName,
  labelDate,
  weekStartsAround,
  weekStartsAfter,
  getDayWorkoutColor,
  getWeeklySummary,
} from '@/lib/calendar-helpers'
import type { Workout } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function w(overrides: Partial<Workout>): Workout {
  return {
    id: '1', plan_id: null, date: '2026-06-16', type: 'endurance',
    duration_minutes: 60, description: '', target_zones: '',
    intervals_icu_event_id: null, status: 'planned', icu_activity_id: null,
    tss: 50, missed_reason: null, steps: null, activity_metrics: null,
    coaching_notes: null, created_at: '2026-06-16T00:00:00Z',
    ...overrides,
  }
}

// ─── getDayWorkoutColor ────────────────────────────────────────────────────────

describe('getDayWorkoutColor', () => {
  it('returns null when no workouts on that date', () => {
    expect(getDayWorkoutColor('2026-06-16', [])).toBeNull()
    expect(getDayWorkoutColor('2026-06-16', [w({ date: '2026-06-17' })])).toBeNull()
  })

  it('returns bg-blue-500 for a single endurance workout', () => {
    expect(getDayWorkoutColor('2026-06-16', [w({ date: '2026-06-16', type: 'endurance' })])).toBe('bg-blue-500')
  })

  it('returns bg-red-500 when threshold and recovery are on the same day (threshold wins)', () => {
    const workouts = [
      w({ date: '2026-06-16', type: 'recovery' }),
      w({ date: '2026-06-16', type: 'threshold' }),
    ]
    expect(getDayWorkoutColor('2026-06-16', workouts)).toBe('bg-red-500')
  })

  it('returns bg-orange-500 when intervals, threshold, and endurance are on the same day (intervals wins)', () => {
    const workouts = [
      w({ date: '2026-06-16', type: 'endurance' }),
      w({ date: '2026-06-16', type: 'threshold' }),
      w({ date: '2026-06-16', type: 'intervals' }),
    ]
    expect(getDayWorkoutColor('2026-06-16', workouts)).toBe('bg-orange-500')
  })
})

// ─── getWeeklySummary ──────────────────────────────────────────────────────────

describe('getWeeklySummary', () => {
  const DATES = ['2026-06-16', '2026-06-17', '2026-06-18']

  it('returns actual TSS and minutes from completed/needs_review; ignores planned', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'completed', tss: 80, duration_minutes: 60 }),
      w({ date: '2026-06-17', status: 'needs_review', tss: 40, duration_minutes: 30 }),
      w({ date: '2026-06-18', status: 'planned', tss: 50, duration_minutes: 45 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result.actualTss).toBe(120)
    expect(result.actualMins).toBe(90)
    expect(result.plannedTss).toBe(50)
    expect(result.plannedMins).toBe(45)
  })

  it('returns planned values when no completed workouts exist', () => {
    const workouts = [
      w({ date: '2026-06-16', status: 'planned', tss: 60, duration_minutes: 50 }),
      w({ date: '2026-06-17', status: 'planned', tss: 40, duration_minutes: 35 }),
    ]
    const result = getWeeklySummary(DATES, workouts)
    expect(result.actualTss).toBe(0)
    expect(result.actualMins).toBe(0)
    expect(result.plannedTss).toBe(100)
    expect(result.plannedMins).toBe(85)
  })

  it('returns zeros for both buckets when week has no workouts', () => {
    const result = getWeeklySummary(DATES, [])
    expect(result).toEqual({ actualTss: 0, actualMins: 0, plannedTss: 0, plannedMins: 0 })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npx jest __tests__/lib/calendar-helpers.test.ts --no-coverage
```

Expected: FAIL — `getDayWorkoutColor` and `getWeeklySummary` not found.

---

- [ ] **Step 3: Add `Workout` import to `lib/calendar-helpers.ts`**

At the top of `lib/calendar-helpers.ts`, add after the existing import:

```ts
import type { Workout } from '@/types'
```

The file now starts:
```ts
import { getWeekBounds } from '@/lib/week-bounds'
import type { Workout } from '@/types'
```

---

- [ ] **Step 4: Add `getDayWorkoutColor` to `lib/calendar-helpers.ts`**

Append to the bottom of `lib/calendar-helpers.ts`:

```ts
const TYPE_PRIORITY: Record<string, number> = {
  intervals: 4, threshold: 3, endurance: 2, recovery: 1,
}
const TYPE_COLOR: Record<string, string> = {
  intervals: 'bg-orange-500', threshold: 'bg-red-500',
  endurance: 'bg-blue-500',   recovery:  'bg-emerald-500',
}

// Returns the Tailwind background class for the hardest workout type on dateStr,
// or null if no workouts fall on that date.
export function getDayWorkoutColor(dateStr: string, workouts: Workout[]): string | null {
  const dayWorkouts = workouts.filter(w => w.date === dateStr)
  if (!dayWorkouts.length) return null
  const hardest = dayWorkouts.reduce((best, curr) =>
    (TYPE_PRIORITY[curr.type] ?? 0) > (TYPE_PRIORITY[best.type] ?? 0) ? curr : best
  )
  return TYPE_COLOR[hardest.type] ?? null
}
```

---

- [ ] **Step 5: Add `WeeklySummary` interface and `getWeeklySummary` to `lib/calendar-helpers.ts`**

Append directly after `getDayWorkoutColor`:

```ts
export interface WeeklySummary {
  actualTss: number
  actualMins: number
  plannedTss: number
  plannedMins: number
}

// Splits workouts in `dates` into actual (completed/needs_review) and planned
// buckets and returns their TSS and duration sums.
export function getWeeklySummary(dates: string[], workouts: Workout[]): WeeklySummary {
  const week = workouts.filter(w => dates.includes(w.date))
  const actual = week.filter(w => w.status === 'completed' || w.status === 'needs_review')
  const planned = week.filter(w => w.status === 'planned')
  return {
    actualTss:  actual.reduce((sum, w)  => sum + (w.tss ?? 0), 0),
    actualMins: actual.reduce((sum, w)  => sum + w.duration_minutes, 0),
    plannedTss:  planned.reduce((sum, w) => sum + (w.tss ?? 0), 0),
    plannedMins: planned.reduce((sum, w) => sum + w.duration_minutes, 0),
  }
}
```

---

- [ ] **Step 6: Run tests to confirm they pass**

```
npx jest __tests__/lib/calendar-helpers.test.ts --no-coverage
```

Expected: all tests pass (existing + 7 new).

---

- [ ] **Step 7: Run full suite**

```
npx jest --no-coverage
```

Expected: all tests pass.

---

- [ ] **Step 8: Commit**

```
git add lib/calendar-helpers.ts __tests__/lib/calendar-helpers.test.ts
git commit -m "feat: add getDayWorkoutColor and getWeeklySummary helpers"
```

---

## Task 2: Restructure MonthStrip to use helpers

**Files:**
- Modify: `app/calendar/page.tsx` (MonthStrip component only, lines ~110–182)

The MonthStrip currently renders a flat `grid-cols-7`. This task restructures it into explicit week rows so a summary column can sit on the left of each row.

---

- [ ] **Step 1: Add the new helpers to the `calendar-helpers` import**

In `app/calendar/page.tsx`, find the existing import (line 25):

```ts
import { calendarMonthDays, weekDates, formatDuration, toLocalDateStr, weekStartsAround, weekStartsAfter } from '@/lib/calendar-helpers'
```

Replace with:

```ts
import { calendarMonthDays, weekDates, formatDuration, toLocalDateStr, weekStartsAround, weekStartsAfter, getDayWorkoutColor, getWeeklySummary } from '@/lib/calendar-helpers'
```

---

- [ ] **Step 2: Chunk `cells` into week rows inside MonthStrip**

Inside the `MonthStrip` function body, after the line:

```ts
const selectedWeekSet = new Set(selectedWeek)
```

Add:

```ts
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }
```

---

- [ ] **Step 3: Replace the day-of-week header block**

Find:

```tsx
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 text-center mb-1">
        {['M','T','W','T','F','S','S'].map((d, i) => (
          <div key={i} className="text-[9px] text-slate-400 font-medium">{d}</div>
        ))}
      </div>
```

Replace with:

```tsx
      {/* Day-of-week headers — blank left cell keeps columns aligned with summary */}
      <div className="flex mb-1">
        <div className="w-10 shrink-0" />
        <div className="grid grid-cols-7 flex-1 text-center">
          {['M','T','W','T','F','S','S'].map((d, i) => (
            <div key={i} className="text-[9px] text-slate-400 font-medium">{d}</div>
          ))}
        </div>
      </div>
```

---

- [ ] **Step 4: Replace the flat date-cell block with week rows**

Find and replace the entire date cells block:

```tsx
      {/* Date cells */}
      <div className="grid grid-cols-7">
        {cells.map((dateStr, i) => {
          if (!dateStr) return <div key={`b${i}`} />
          const inSelectedWeek = selectedWeekSet.has(dateStr)
          const isToday = dateStr === todayStr
          const dots: string[] = []
          if (events.some(e => e.date === dateStr)) dots.push('bg-red-400')
          if (workouts.some(w => w.date === dateStr)) dots.push('bg-blue-400')
          if (unlinkedActivities.some(a => a.start_date_local.startsWith(dateStr))) dots.push('bg-sky-400')
          return (
            <button
              key={dateStr}
              onClick={() => onDateClick(dateStr)}
              aria-label={dateStr}
              className={`flex flex-col items-center justify-center min-h-[44px] w-full cursor-pointer rounded-sm ${inSelectedWeek ? 'bg-blue-50' : ''}`}
            >
              <span className={`text-[11px] w-6 h-6 flex items-center justify-center leading-none rounded-full
                ${isToday ? 'bg-blue-500 text-white font-bold' : 'text-slate-600'}`}>
                {parseInt(dateStr.split('-')[2], 10)}
              </span>
              <div className="flex gap-0.5 mt-0.5 h-1.5 items-center">
                {dots.slice(0, 3).map((color, j) => (
                  <div key={j} className={`w-1 h-1 rounded-full ${color}`} />
                ))}
              </div>
            </button>
          )
        })}
      </div>
```

Replace with:

```tsx
      {/* Week rows: [summary column] + [7 day cells] */}
      {weeks.map((weekCells, weekIndex) => {
        const weekDateStrs = weekCells.filter((d): d is string => d !== null)
        const summary = getWeeklySummary(weekDateStrs, workouts)
        const hasActual = summary.actualTss > 0 || summary.actualMins > 0
        const hasPlanned = summary.plannedTss > 0 || summary.plannedMins > 0
        const showTss = hasActual ? summary.actualTss : summary.plannedTss
        const showMins = hasActual ? summary.actualMins : summary.plannedMins
        const dim = !hasActual && hasPlanned
        return (
          <div key={weekIndex} className="flex">
            {/* Weekly summary: actual = slate-600, planned = slate-300 */}
            <div className="w-10 shrink-0 flex flex-col justify-center items-end pr-1.5">
              {(showTss > 0 || showMins > 0) && (
                <>
                  {showTss > 0 && (
                    <span className={`text-[9px] leading-tight ${dim ? 'text-slate-300' : 'text-slate-600'}`}>
                      {Math.round(showTss)}
                    </span>
                  )}
                  {showMins > 0 && (
                    <span className={`text-[9px] leading-tight ${dim ? 'text-slate-300' : 'text-slate-500'}`}>
                      {formatDuration(showMins)}
                    </span>
                  )}
                </>
              )}
            </div>
            {/* Day cells */}
            <div className="grid grid-cols-7 flex-1">
              {weekCells.map((dateStr, i) => {
                if (!dateStr) return <div key={`b${weekIndex}-${i}`} />
                const inSelectedWeek = selectedWeekSet.has(dateStr)
                const isToday = dateStr === todayStr
                const workoutColor = getDayWorkoutColor(dateStr, workouts)
                const dots: string[] = []
                if (events.some(e => e.date === dateStr)) dots.push('bg-red-400')
                if (workoutColor) dots.push(workoutColor)
                if (unlinkedActivities.some(a => a.start_date_local.startsWith(dateStr))) dots.push('bg-sky-400')
                return (
                  <button
                    key={dateStr}
                    onClick={() => onDateClick(dateStr)}
                    aria-label={dateStr}
                    className={`flex flex-col items-center justify-center min-h-[44px] w-full cursor-pointer rounded-sm ${inSelectedWeek ? 'bg-blue-50' : ''}`}
                  >
                    <span className={`text-[11px] w-6 h-6 flex items-center justify-center leading-none rounded-full
                      ${isToday ? 'bg-blue-500 text-white font-bold' : 'text-slate-600'}`}>
                      {parseInt(dateStr.split('-')[2], 10)}
                    </span>
                    <div className="flex gap-0.5 mt-0.5 h-1.5 items-center">
                      {dots.slice(0, 3).map((color, j) => (
                        <div key={j} className={`w-1 h-1 rounded-full ${color}`} />
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
```

---

- [ ] **Step 5: Run full test suite**

```
npx jest --no-coverage
```

Expected: all tests pass.

---

- [ ] **Step 6: Run TypeScript check**

```
npx tsc --noEmit
```

Expected: no errors.

---

- [ ] **Step 7: Commit**

```
git add app/calendar/page.tsx
git commit -m "feat: add session type colours and weekly TSS/hours to MonthStrip"
```
