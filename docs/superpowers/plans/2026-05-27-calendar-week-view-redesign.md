# Calendar Week View Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monthly grid calendar with a week-focused list view that clearly shows each individual session on multi-session days.

**Architecture:** Two files change. Pure date helpers go into a new `lib/calendar-helpers.ts` (tested). `app/calendar/page.tsx` is rewritten entirely to render a compact month strip (navigation + dot indicators) above a week detail list (7 day rows with stacked session cards). All existing modals are preserved unchanged.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Jest

---

## File Map

| File | Change |
|---|---|
| `lib/calendar-helpers.ts` | Create: pure date/format helpers |
| `__tests__/lib/calendar-helpers.test.ts` | Create: unit tests for helpers |
| `app/calendar/page.tsx` | Rewrite: new two-section layout |

---

## Task 1 — Calendar helper functions

**Files:**
- Create: `lib/calendar-helpers.ts`
- Create: `__tests__/lib/calendar-helpers.test.ts`

The page needs four pure functions. `getWeekBounds` already exists in `lib/week-bounds.ts` — import and reuse it rather than re-implementing.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/calendar-helpers.test.ts`:

```ts
import {
  calendarMonthDays,
  weekDates,
  formatDuration,
  formatMovingTime,
  toLocalDateStr,
} from '@/lib/calendar-helpers'

describe('calendarMonthDays', () => {
  it('returns null-padded grid for May 2026 (Friday 1st → 4 leading nulls)', () => {
    const grid = calendarMonthDays(2026, 4) // month 4 = May
    expect(grid.slice(0, 4)).toEqual([null, null, null, null])
    expect(grid[4]).toBe('2026-05-01')
    expect(grid[grid.length - 1]).toBe('2026-05-31')
  })

  it('returns no leading nulls for a month starting on Monday', () => {
    // June 2026 starts on Monday
    const grid = calendarMonthDays(2026, 5) // month 5 = June
    expect(grid[0]).toBe('2026-06-01')
  })

  it('returns 6 leading nulls for a month starting on Sunday', () => {
    // March 2026 starts on Sunday
    const grid = calendarMonthDays(2026, 2) // month 2 = March
    expect(grid.slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(grid[6]).toBe('2026-03-01')
  })
})

describe('weekDates', () => {
  it('returns 7 dates Mon–Sun for a mid-week date', () => {
    const dates = weekDates('2026-05-26') // Tuesday
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe('2026-05-25') // Monday
    expect(dates[6]).toBe('2026-05-31') // Sunday
  })

  it('handles a week crossing a month boundary', () => {
    const dates = weekDates('2026-05-31') // Sunday (end of week)
    expect(dates[0]).toBe('2026-05-25')
    expect(dates[6]).toBe('2026-05-31')
  })

  it('handles a Monday as input', () => {
    const dates = weekDates('2026-05-25')
    expect(dates[0]).toBe('2026-05-25')
    expect(dates[6]).toBe('2026-05-31')
  })
})

describe('formatDuration', () => {
  it('returns minutes only when under 60', () => {
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(0)).toBe('0m')
  })

  it('returns hours only when evenly divisible', () => {
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(120)).toBe('2h')
  })

  it('returns hours and minutes for mixed values', () => {
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(135)).toBe('2h 15m')
  })
})

describe('formatMovingTime', () => {
  it('converts seconds to a duration string', () => {
    expect(formatMovingTime(3600)).toBe('1h')
    expect(formatMovingTime(5400)).toBe('1h 30m')
    expect(formatMovingTime(2700)).toBe('45m')
  })
})
```

- [ ] **Step 2: Run tests to confirm they all fail**

```
npx jest __tests__/lib/calendar-helpers.test.ts --no-coverage
```

Expected: all 9 tests fail with "Cannot find module".

- [ ] **Step 3: Implement `lib/calendar-helpers.ts`**

Create `lib/calendar-helpers.ts`:

```ts
import { getWeekBounds } from '@/lib/week-bounds'

// Returns a grid of date strings (YYYY-MM-DD) for a calendar month.
// Cells before the 1st of the month are null (Mon-start grid).
export function calendarMonthDays(year: number, month: number): (string | null)[] {
  const firstDayUTC = new Date(Date.UTC(year, month, 1)).getUTCDay() // 0=Sun
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const leadingNulls = Array<null>(firstDayUTC === 0 ? 6 : firstDayUTC - 1).fill(null)
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  })
  return [...leadingNulls, ...days]
}

// Returns 7 YYYY-MM-DD strings for Mon–Sun of the week containing dateStr.
export function weekDates(dateStr: string): string[] {
  const { start } = getWeekBounds(dateStr)
  const [y, m, d] = start.split('-').map(Number)
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 1, d + i))
    return date.toISOString().split('T')[0]
  })
}

// Formats a duration in minutes: "45m", "1h", "1h 30m"
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// Formats a moving time in seconds to the same string format.
export function formatMovingTime(seconds: number): string {
  return formatDuration(Math.round(seconds / 60))
}

// Formats a Date object as YYYY-MM-DD using local time.
export function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
```

- [ ] **Step 4: Run tests to confirm they all pass**

```
npx jest __tests__/lib/calendar-helpers.test.ts --no-coverage
```

Expected: 9 tests pass, 0 failures.

- [ ] **Step 5: Commit**

```
git add lib/calendar-helpers.ts __tests__/lib/calendar-helpers.test.ts
git commit -m "feat: add calendar helper functions"
```

---

## Task 2 — Rewrite the calendar page

**Files:**
- Modify: `app/calendar/page.tsx`

This is a complete rewrite. The data fetching and all modal state logic carry over unchanged. Only the rendering is replaced.

- [ ] **Step 1: Replace `app/calendar/page.tsx` with the new implementation**

```tsx
'use client'
import { useEffect, useState } from 'react'
import FeedbackModal from '@/components/FeedbackModal'
import WorkoutDetailModal from '@/components/WorkoutDetailModal'
import SessionChatModal from '@/components/SessionChatModal'
import EventDetailModal from '@/components/EventDetailModal'
import AddEventModal from '@/components/AddEventModal'
import type { Workout, TrainingEvent, SessionFeedback, ICUActivity, ICUSyncData, WorkoutStatus } from '@/types'
import { calendarMonthDays, weekDates, formatDuration, formatMovingTime, toLocalDateStr } from '@/lib/calendar-helpers'

// ─── Constants ───────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

const STATUS_BADGE: Record<WorkoutStatus, { label: string; className: string }> = {
  completed:    { label: 'completed ✓', className: 'bg-green-100 text-green-700' },
  planned:      { label: 'planned',     className: 'bg-blue-100 text-blue-700' },
  skipped:      { label: 'skipped',     className: 'bg-slate-100 text-slate-500' },
  needs_review: { label: 'needs review', className: 'bg-amber-100 text-amber-700' },
}

// ─── Session cards ────────────────────────────────────────────────────────────

function WorkoutCard({ workout, onClick }: { workout: Workout; onClick: () => void }) {
  const badge = STATUS_BADGE[workout.status]
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-blue-50 border-l-4 border-blue-500 rounded-md px-3 py-2.5 active:opacity-70 transition-opacity"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-blue-800 capitalize truncate">🚴 {workout.type}</span>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${badge.className}`}>
          {badge.label}
        </span>
      </div>
      <div className="flex gap-3 mt-0.5 text-xs text-slate-500">
        <span>{formatDuration(workout.duration_minutes)}</span>
        {workout.tss != null && <span>TSS {Math.round(workout.tss)}</span>}
      </div>
    </button>
  )
}

function EventCard({ event, onClick }: { event: TrainingEvent; onClick: () => void }) {
  const hasResult = event.icu_activity_id != null
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-red-50 border-l-4 border-red-500 rounded-md px-3 py-2.5 active:opacity-70 transition-opacity"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-red-700 truncate">🏁 {event.name}</span>
        {hasResult && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 bg-green-100 text-green-700">
            completed ✓
          </span>
        )}
      </div>
      <div className="flex gap-3 mt-0.5 text-xs text-slate-500">
        {event.result_duration_minutes != null
          ? <span>{formatDuration(event.result_duration_minutes)}</span>
          : event.duration_minutes != null
            ? <span>{formatDuration(event.duration_minutes)}</span>
            : null}
        {event.result_tss != null && <span>TSS {event.result_tss}</span>}
        {event.result_avg_power != null && <span>{event.result_avg_power}W</span>}
      </div>
    </button>
  )
}

function ActivityCard({ activity }: { activity: ICUActivity }) {
  return (
    <div className="bg-sky-50 border-l-4 border-sky-400 rounded-md px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-sky-700 truncate">↑ {activity.name || 'Ride'}</span>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 bg-sky-100 text-sky-700">
          activity
        </span>
      </div>
      <div className="flex gap-3 mt-0.5 text-xs text-slate-500">
        <span>{formatMovingTime(activity.moving_time)}</span>
        {activity.training_load != null && <span>TSS {Math.round(activity.training_load)}</span>}
        {activity.weighted_average_watts != null && <span>{Math.round(activity.weighted_average_watts)}W</span>}
      </div>
    </div>
  )
}

// ─── Month strip ─────────────────────────────────────────────────────────────

interface MonthStripProps {
  displayYear: number
  displayMonth: number
  selectedDateStr: string
  workouts: Workout[]
  events: TrainingEvent[]
  unlinkedActivities: ICUActivity[]
  todayStr: string
  onDateClick: (dateStr: string) => void
  onPrevMonth: () => void
  onNextMonth: () => void
}

function MonthStrip({
  displayYear, displayMonth, selectedDateStr,
  workouts, events, unlinkedActivities, todayStr,
  onDateClick, onPrevMonth, onNextMonth,
}: MonthStripProps) {
  const cells = calendarMonthDays(displayYear, displayMonth)
  const selectedWeek = weekDates(selectedDateStr)
  const selectedWeekSet = new Set(selectedWeek)

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-2">
        <button onClick={onPrevMonth} className="p-1 text-slate-400 hover:text-slate-700 text-lg leading-none">‹</button>
        <span className="text-sm font-semibold text-slate-700">{MONTHS[displayMonth]} {displayYear}</span>
        <button onClick={onNextMonth} className="p-1 text-slate-400 hover:text-slate-700 text-lg leading-none">›</button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 text-center mb-1">
        {['M','T','W','T','F','S','S'].map((d, i) => (
          <div key={i} className="text-[9px] text-slate-400 font-medium">{d}</div>
        ))}
      </div>

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
            <div
              key={dateStr}
              onClick={() => onDateClick(dateStr)}
              className={`flex flex-col items-center py-0.5 cursor-pointer rounded-sm ${inSelectedWeek ? 'bg-blue-50' : ''}`}
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
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Week detail ─────────────────────────────────────────────────────────────

interface WeekDetailProps {
  selectedDateStr: string
  workouts: Workout[]
  events: TrainingEvent[]
  unlinkedActivities: ICUActivity[]
  todayStr: string
  onWorkoutClick: (w: Workout) => void
  onEventClick: (e: TrainingEvent) => void
}

function WeekDetail({
  selectedDateStr, workouts, events, unlinkedActivities, todayStr,
  onWorkoutClick, onEventClick,
}: WeekDetailProps) {
  const dates = weekDates(selectedDateStr)
  return (
    <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
      {dates.map((dateStr, i) => {
        const dayWorkouts = workouts.filter(w => w.date === dateStr)
        const dayEvents = events.filter(e => e.date === dateStr)
        const dayActivities = unlinkedActivities.filter(a => a.start_date_local.startsWith(dateStr))
        const hasEvent = dayEvents.length > 0
        const isToday = dateStr === todayStr
        const isEmpty = !dayWorkouts.length && !dayEvents.length && !dayActivities.length
        const dayNum = parseInt(dateStr.split('-')[2], 10)
        return (
          <div key={dateStr} className="flex gap-3 px-3 py-2.5 items-start">
            {/* Date column */}
            <div className="w-10 flex-shrink-0 text-center pt-0.5">
              <div className={`text-[10px] font-semibold uppercase
                ${hasEvent ? 'text-red-500' : isToday ? 'text-blue-500' : 'text-slate-400'}`}>
                {DAY_NAMES[i]}
              </div>
              <div className={`text-lg font-bold leading-tight
                ${hasEvent ? 'text-red-600' : isToday ? 'text-blue-600' : 'text-slate-500'}`}>
                {dayNum}
              </div>
            </div>
            {/* Sessions column */}
            <div className="flex-1 flex flex-col gap-1.5 min-w-0 py-0.5">
              {isEmpty && <p className="text-sm text-slate-300 italic py-1.5">Rest day</p>}
              {dayEvents.map(e => (
                <EventCard key={`${e.date}-${e.name}`} event={e} onClick={() => onEventClick(e)} />
              ))}
              {dayWorkouts.map(w => (
                <WorkoutCard key={w.id} workout={w} onClick={() => onWorkoutClick(w)} />
              ))}
              {dayActivities.map(a => (
                <ActivityCard key={a.id} activity={a} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const todayStr = toLocalDateStr(new Date())

  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [planName, setPlanName] = useState('')
  const [athleteId, setAthleteId] = useState('')
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null)
  const [feedbackWorkout, setFeedbackWorkout] = useState<Workout | null>(null)
  const [initialFeedback, setInitialFeedback] = useState<SessionFeedback | null>(null)
  const [chatWorkout, setChatWorkout] = useState<Workout | null>(null)
  const [events, setEvents] = useState<TrainingEvent[]>([])
  const [selectedEvent, setSelectedEvent] = useState<TrainingEvent | null>(null)
  const [eventActivities, setEventActivities] = useState<ICUActivity[]>([])
  const [eventActivitiesLoading, setEventActivitiesLoading] = useState(false)
  const [editingEvent, setEditingEvent] = useState<TrainingEvent | null>(null)
  const [syncData, setSyncData] = useState<ICUSyncData | null>(null)
  const [selectedDateStr, setSelectedDateStr] = useState(todayStr)
  const [displayYear, setDisplayYear] = useState(() => new Date().getFullYear())
  const [displayMonth, setDisplayMonth] = useState(() => new Date().getMonth())

  function loadPlan() {
    fetch('/api/plan').then(r => r.json()).then(plan => {
      setWorkouts(plan?.workouts ?? [])
      setPlanName(plan?.name ?? '')
    }).catch(() => {})
  }

  useEffect(() => {
    loadPlan()
    fetch('/api/sync', { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.athlete_id) setAthleteId(data.athlete_id)
        if (data) setSyncData(data)
      })
      .catch(() => {})
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.events) setEvents(data.events) })
      .catch(() => {})
  }, [])

  function prevMonth() {
    if (displayMonth === 0) { setDisplayMonth(11); setDisplayYear(y => y - 1) }
    else setDisplayMonth(m => m - 1)
  }
  function nextMonth() {
    if (displayMonth === 11) { setDisplayMonth(0); setDisplayYear(y => y + 1) }
    else setDisplayMonth(m => m + 1)
  }

  async function openEvent(event: TrainingEvent) {
    setSelectedEvent(event)
    setEventActivities([])
    setEventActivitiesLoading(true)
    try {
      const res = await fetch(`/api/activities?date=${event.date}`)
      const data = res.ok ? await res.json() : { activities: [] }
      setEventActivities(data.activities ?? [])
    } catch {
      setEventActivities([])
    } finally {
      setEventActivitiesLoading(false)
    }
  }

  async function updateEvent(original: TrainingEvent, updated: Omit<TrainingEvent, '_key'>) {
    const res = await fetch('/api/events/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ original_name: original.name, original_date: original.date, ...updated }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'Failed to update event')
    setEvents(prev => prev.map(e => e.name === original.name && e.date === original.date ? data.event : e))
  }

  const linkedIds = new Set<string>([
    ...workouts.map(w => w.icu_activity_id).filter((id): id is string => id != null),
    ...events.map(e => e.icu_activity_id).filter((id): id is string => id != null),
  ])
  const unlinkedActivities = (syncData?.activities ?? []).filter(
    a => /ride/i.test(a.type) && !linkedIds.has(a.id)
  )

  return (
    <div className="max-w-lg mx-auto space-y-4 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-800">Calendar</h1>
          {planName && <p className="text-sm text-gray-500">{planName}</p>}
        </div>
        {selectedDateStr !== todayStr && (
          <button
            onClick={() => {
              setSelectedDateStr(todayStr)
              setDisplayMonth(new Date().getMonth())
              setDisplayYear(new Date().getFullYear())
            }}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 rounded-md px-2.5 py-1 transition-colors"
          >
            Today
          </button>
        )}
      </div>

      {/* Month strip */}
      <MonthStrip
        displayYear={displayYear}
        displayMonth={displayMonth}
        selectedDateStr={selectedDateStr}
        workouts={workouts}
        events={events}
        unlinkedActivities={unlinkedActivities}
        todayStr={todayStr}
        onDateClick={(ds) => setSelectedDateStr(ds)}
        onPrevMonth={prevMonth}
        onNextMonth={nextMonth}
      />

      {/* Week detail */}
      <WeekDetail
        selectedDateStr={selectedDateStr}
        workouts={workouts}
        events={events}
        unlinkedActivities={unlinkedActivities}
        todayStr={todayStr}
        onWorkoutClick={(w) => setSelectedWorkout(w)}
        onEventClick={openEvent}
      />

      {/* Modals — all unchanged from original */}
      {selectedWorkout && (
        <WorkoutDetailModal
          workout={selectedWorkout}
          athleteId={athleteId}
          onClose={() => setSelectedWorkout(null)}
          onFeedback={(existingFeedback) => {
            setInitialFeedback(existingFeedback ?? null)
            setFeedbackWorkout(selectedWorkout)
            setSelectedWorkout(null)
          }}
          onChat={() => {
            setChatWorkout(selectedWorkout)
            setSelectedWorkout(null)
          }}
          onStatusChange={() => { setSelectedWorkout(null); loadPlan() }}
          onDelete={() => { setSelectedWorkout(null); loadPlan() }}
          onReschedule={() => { setSelectedWorkout(null); loadPlan() }}
          nearbyEvents={events.filter(e => {
            if (!selectedWorkout) return false
            const diff = Math.abs(
              Math.floor(new Date(e.date + 'T00:00:00Z').getTime() / 86400000) -
              Math.floor(new Date(selectedWorkout.date + 'T00:00:00Z').getTime() / 86400000)
            )
            return diff <= 7
          })}
          onEventLinked={(updated) => {
            setEvents(prev => prev.map(e => e.name === updated.name && e.date === updated.date ? updated : e))
          }}
        />
      )}

      {feedbackWorkout && (
        <FeedbackModal
          workout={feedbackWorkout}
          initialFeedback={initialFeedback ?? undefined}
          onClose={() => { setFeedbackWorkout(null); setInitialFeedback(null) }}
        />
      )}

      {chatWorkout && (
        <SessionChatModal
          workout={chatWorkout}
          wellness={null}
          onClose={() => setChatWorkout(null)}
          onWorkoutUpdated={updated => {
            setWorkouts(prev => prev.map(w => w.id === updated.id ? updated : w))
            setChatWorkout(null)
          }}
        />
      )}

      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          activitiesOnDate={eventActivities}
          activitiesLoading={eventActivitiesLoading}
          onClose={() => { setSelectedEvent(null); setEventActivities([]) }}
          onResultSaved={(updated) => {
            setEvents(prev => prev.map(e => e.name === updated.name && e.date === updated.date ? updated : e))
            setSelectedEvent(updated)
          }}
          onEdit={() => {
            setEditingEvent(selectedEvent)
            setSelectedEvent(null)
            setEventActivities([])
          }}
        />
      )}

      {editingEvent && (
        <AddEventModal
          initialEvent={editingEvent}
          onConfirm={async (updated) => { await updateEvent(editingEvent, updated); setEditingEvent(null) }}
          onClose={() => setEditingEvent(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Run the full test suite to confirm no regressions**

```
npx jest --no-coverage
```

Expected: all existing tests pass plus the new calendar-helpers tests.

- [ ] **Step 3: Verify visually in the browser**

Start the dev server (`npm run dev`), open `http://localhost:3000/calendar`, and check:

1. Month strip shows the current month with M-T-W-T-F-S-S headers
2. Today's date has a filled blue circle
3. Current week cells have a blue-50 background band
4. Days with workouts show a blue dot; days with events show a red dot
5. Clicking a date in the strip updates the week detail below
6. Prev/next arrows on the strip change the displayed month without losing the selected week
7. "Today" button appears only when the selected date is not today; clicking it resets to the current week and month
8. Week detail shows 7 rows (Mon–Sun) for the selected week
9. Rest days show italic "Rest day" label
10. Multi-session days (e.g. 26 May) show each session as a separate card — race in red, workout in blue, unlinked activity in sky
11. Each session card shows name, duration, TSS/power where available, and a status badge
12. Tapping a workout card opens `WorkoutDetailModal`
13. Tapping a race/event card opens `EventDetailModal`
14. All existing modal flows (feedback, chat, edit event) still work

- [ ] **Step 4: Commit**

```
git add app/calendar/page.tsx
git commit -m "feat: redesign calendar as week list view with month strip"
```
