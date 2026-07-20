# Dashboard Week Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the dashboard's "This week" day-list section navigate to previous/next weeks (unbounded), while every other widget on the page stays anchored to today.

**Architecture:** Add a `selectedWeekStart` state (the Monday of the displayed week, YYYY-MM-DD) to `DashboardPage`, defaulting to the current week. Replace the page's inline week-date computation with `lib/calendar-helpers`'s existing `weekDates()` helper, keyed off this new state. Add Prev/Next/Today controls to the "This week" section heading; when viewing a week other than the current one, the heading title swaps from "This week" to the date range and a "Today" button appears to jump back.

**Tech Stack:** Next.js App Router, TypeScript, React, Jest + Testing Library.

## Global Constraints

- Only `app/dashboard/page.tsx` changes, plus its new test file `__tests__/app/dashboard/page.test.tsx` (this page currently has no test file).
- No other widget on the dashboard (`TodayCard`, `StrainRingStrip`, `MetricsBar`/`HrvStatusChip`/`HrvTrendPanel`/`CtlTrendStrip`, `ProgressStats`) may read or depend on `selectedWeekStart` — they all continue to reflect today exactly as they do now.
- Navigation is unbounded in both directions — no min/max week guard.
- `selectedWeekStart` is transient page state only — no persistence (no URL param, no localStorage). It always initializes to the current week.
- When `selectedWeekStart` resolves to the current week, the heading and subtitle must render byte-for-byte identical to today's existing output ("This week" title, same date-range subtitle, same TSS/duration summary logic) — this is a refactor-safety requirement, not just a feature addition.

---

### Task 1: Add week navigation state, controls, and heading logic to the dashboard

**Files:**
- Modify: `app/dashboard/page.tsx`
- Test: `__tests__/app/dashboard/page.test.tsx` (new file)

**Interfaces:**
- Consumes: `weekDates(dateStr: string): string[]` from `lib/calendar-helpers.ts` (already exists, used by the calendar page); `getWeekBounds(date: string): { start: string; end: string }` from `lib/week-bounds.ts` (already imported in this file); `localDateStr(d: Date): string` from `lib/local-date.ts` (already imported in this file).
- Produces: no new exports — this task only changes `DashboardPage`'s internal state, handlers, and JSX.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/app/dashboard/page.test.tsx` with this exact content:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import DashboardPage from '@/app/dashboard/page'
import { getWeekBounds } from '@/lib/week-bounds'
import { weekDates } from '@/lib/calendar-helpers'
import { localDateStr } from '@/lib/local-date'
import type { Workout } from '@/types'

function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().split('T')[0]
}

function makeWorkout(overrides: Partial<Workout> & Pick<Workout, 'id' | 'date' | 'name'>): Workout {
  return {
    plan_id: 'plan-1', type: 'endurance', duration_minutes: 60, description: '', target_zones: '',
    intervals_icu_event_id: null, status: 'planned', icu_activity_id: null, tss: null,
    ftp_at_completion: null, actual_duration_minutes: null, missed_reason: null, optional: false,
    steps: null, activity_metrics: null, coaching_notes: null, created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const todayStr = localDateStr(new Date())
const currentWeekStart = getWeekBounds(todayStr).start
// Avoid colliding with TodayCard, which independently renders any workout dated
// exactly today — pick a non-today weekday within the current week so this
// fixture only ever shows up in the week list under test.
const currentWeekWorkoutDate = shiftDateStr(currentWeekStart, 1) === todayStr
  ? shiftDateStr(currentWeekStart, 2)
  : shiftDateStr(currentWeekStart, 1)
const lastWeekStart = shiftDateStr(currentWeekStart, -7)
const nextWeekStart = shiftDateStr(currentWeekStart, 7)
const nextWeekDates = weekDates(nextWeekStart)

const lastWeekWorkout = makeWorkout({ id: 'w-last', date: lastWeekStart, name: 'Last week ride' })
const currentWeekWorkout = makeWorkout({ id: 'w-current', date: currentWeekWorkoutDate, name: 'Current week ride' })
const nextWeekWorkout = makeWorkout({ id: 'w-next', date: nextWeekStart, name: 'Next week ride' })

function mockFetch() {
  global.fetch = jest.fn((url: string) => {
    const u = String(url)
    if (u === '/api/sync') {
      return Promise.resolve({ ok: true, json: async () => ({ activities: [], wellness: [], athlete_ftp: null, athlete_weight: null }) })
    }
    if (u === '/api/plan') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          workouts: [lastWeekWorkout, currentWeekWorkout, nextWeekWorkout],
          name: '',
          last_reviewed_week: '9999-W53',
        }),
      })
    }
    if (u === '/api/profile') return Promise.resolve({ ok: true, json: async () => ({}) })
    if (u === '/api/weight-log') return Promise.resolve({ ok: true, json: async () => ({ entries: [] }) })
    if (u.startsWith('/api/wellness')) return Promise.resolve({ ok: true, json: async () => ({ wellness: [] }) })
    if (u === '/api/charts') return Promise.resolve({ ok: true, json: async () => ({ charts: null }) })
    if (u === '/api/weather/week') return Promise.resolve({ ok: true, json: async () => ({ dates: [] }) })
    return Promise.resolve({ ok: false, json: async () => ({}) })
  }) as jest.Mock
}

describe('DashboardPage week navigation', () => {
  beforeEach(() => {
    localStorage.clear()
    mockFetch()
  })

  it('shows the current week by default, with the "This week" heading', async () => {
    render(<DashboardPage />)
    expect(await screen.findByText('Current week ride')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'This week' })).toBeInTheDocument()
    expect(screen.queryByText('Last week ride')).not.toBeInTheDocument()
    expect(screen.queryByText('Next week ride')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument()
  })

  it('clicking Next shows next week and swaps the heading to the date range', async () => {
    render(<DashboardPage />)
    await screen.findByText('Current week ride')

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))

    expect(await screen.findByText('Next week ride')).toBeInTheDocument()
    expect(screen.queryByText('Current week ride')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'This week' })).not.toBeInTheDocument()
    const expectedRange = `${nextWeekDates[0].slice(8)} – ${nextWeekDates[6].slice(8)} ${new Date(nextWeekDates[0]).toLocaleString('en-GB', { month: 'long' })}`
    expect(screen.getByRole('heading', { level: 2, name: expectedRange })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument()
  })

  it('clicking Previous shows last week', async () => {
    render(<DashboardPage />)
    await screen.findByText('Current week ride')

    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))

    expect(await screen.findByText('Last week ride')).toBeInTheDocument()
    expect(screen.queryByText('Current week ride')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument()
  })

  it('clicking Today returns to the current week', async () => {
    render(<DashboardPage />)
    await screen.findByText('Current week ride')
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await screen.findByText('Next week ride')

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))

    expect(await screen.findByText('Current week ride')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'This week' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument()
  })

  it('navigating to a different week does not change the weekly progress stats above the day list', async () => {
    // currentWeekWorkout is 'planned' and not optional, so isSessionCountable/
    // isSessionCompleted classify it as 1 countable session, 0 completed —
    // ProgressStats renders this as a "0/1" Sessions tile. That tile's source
    // (weeklyProgress) must stay pinned to *today's* week regardless of which
    // week the day-list below is currently showing.
    render(<DashboardPage />)
    expect(await screen.findByText('0/1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await screen.findByText('Next week ride')

    expect(screen.getByText('0/1')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/app/dashboard/page.test.tsx`
Expected: all five tests FAIL. There is no "Next week"/"Previous week"/"Today" button yet, so `screen.getByRole('button', { name: ... })` throws "Unable to find an accessible element" for each test that clicks one. The first test may also fail or pass by coincidence depending on which workouts happen to render today — that's fine, the meaningful RED signal is the four tests that reference the not-yet-existent buttons.

- [ ] **Step 3: Implement week navigation**

In `app/dashboard/page.tsx`:

Add one import, alongside the other `lib` imports near the top of the file (after the existing `import { getWeekBounds } from '@/lib/week-bounds'` line):

```typescript
import { weekDates as computeWeekDates } from '@/lib/calendar-helpers'
```

Add new state, alongside the other `useState` declarations (after the existing `const [weatherByActivity, setWeatherByActivity] = useState<Map<string, ActivityWeather>>(new Map())` line):

```typescript
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => getWeekBounds(localDateStr(new Date())).start)
```

Replace the inline week-date computation (currently):

```typescript
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const today = new Date()
  const dayOfWeek = (today.getDay() + 6) % 7  // 0=Mon … 6=Sun (Sunday was 0, causing off-by-one)
  const weekDates = days.map((_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - dayOfWeek + i)
    return localDateStr(d)
  })
```

with:

```typescript
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const weekDates = computeWeekDates(selectedWeekStart)
  const isCurrentWeek = selectedWeekStart === getWeekBounds(localDateStr(new Date())).start
  const weekRangeLabel = `${weekDates[0].slice(8)} – ${weekDates[6].slice(8)} ${new Date(weekDates[0]).toLocaleString('en-GB', { month: 'long' })}`

  function shiftWeek(deltaDays: number) {
    const [y, m, d] = selectedWeekStart.split('-').map(Number)
    const next = new Date(Date.UTC(y, m - 1, d + deltaDays))
    setSelectedWeekStart(next.toISOString().split('T')[0])
  }

  function jumpToCurrentWeek() {
    setSelectedWeekStart(getWeekBounds(localDateStr(new Date())).start)
  }
```

(`today`/`dayOfWeek` were only used for this computation — confirmed via `grep -n "\bdayOfWeek\b\|\btoday\b" app/dashboard/page.tsx` that no other code in the file references this component-scope `today`/`dayOfWeek` pair; other `today`/`todayStr` variables elsewhere in the file are separately declared in different scopes and are untouched.)

**Important — do not let `ProgressStats` drift with navigation.** `weekDates` (now selectable) is also read further down the file to build `weekWorkoutsWP`, which feeds `weeklyProgress` — the input to `<ProgressStats>` (the "Sessions"/"TSS"/"Time"/etc. tiles). That must keep reflecting *today's* week regardless of which week the day-list is currently showing (see Global Constraints). Find this block (currently right after the `todayWellness`/`recentWellness`/`form` lines, before the `handleWellnessSaved` function):

```typescript
  const weekWorkoutsWP = workouts.filter(w => weekDates.includes(w.date))
  const completedWP = weekWorkoutsWP.filter(w => w.status === 'completed')
  const countableSessionsWP = weekWorkoutsWP.filter(isSessionCountable)
  const linkedActivityIds = new Set(weekWorkoutsWP.map(w => w.icu_activity_id).filter((id): id is string => id != null))
  const recentCtl = [...(syncData?.wellness ?? [])].sort((a, b) => b.id.localeCompare(a.id)).find(w => w.ctl != null)?.ctl ?? null
  const weeklyProgress: WeeklyProgress | null = weekWorkoutsWP.length > 0 ? {
    sessionsCompleted: countableSessionsWP.filter(isSessionCompleted).length,
    sessionsTotal: countableSessionsWP.length,
    tssActual: Math.round(completedWP.filter(w => w.tss !== null).reduce((s, w) => s + (w.tss ?? 0), 0)),
    tssPlanned: weekWorkoutsWP.reduce((s, w) => s + estimateTss(w.type, w.duration_minutes), 0),
    distanceKm: Math.round(completedWP.reduce((s, w) => s + ((w.activity_metrics?.distance_m ?? 0) / 1000), 0) * 10) / 10,
    elevationM: Math.round(completedWP.reduce((s, w) => s + (w.activity_metrics?.elevation_m ?? 0), 0)),
    timePlannedMins: weekWorkoutsWP.reduce((s, w) => s + w.duration_minutes, 0),
    timeActualMins: completedWP.reduce((s, w) => s + (w.actual_duration_minutes ?? w.duration_minutes), 0),
    fitnessCtl: recentCtl !== null ? Math.round(recentCtl) : null,
    otherActivitiesCount: (syncData?.activities ?? [])
      .filter(a => weekDates.some(d => a.start_date_local.startsWith(d)) && !linkedActivityIds.has(a.id))
      .length,
  } : null
```

Change the two `weekDates` reads in this block (only these two — every other line in the block is unaffected) to a new, always-today-anchored array. Add the array definition on the line directly above this block:

```typescript
  const todayWeekDates = computeWeekDates(getWeekBounds(todayStr).start)
  const weekWorkoutsWP = workouts.filter(w => todayWeekDates.includes(w.date))
```

and further down in the same block:

```typescript
    otherActivitiesCount: (syncData?.activities ?? [])
      .filter(a => todayWeekDates.some(d => a.start_date_local.startsWith(d)) && !linkedActivityIds.has(a.id))
      .length,
```

Every other line in this block keeps reading `weekWorkoutsWP`/`completedWP`/`countableSessionsWP` as before — those are already derived from `todayWeekDates` now via `weekWorkoutsWP`, so they don't need individual edits. `todayStr` is already defined earlier in the file (`const todayStr = localDateStr(new Date())`), so no new date computation is needed beyond this one line.

**Also required — `loadPlan()` currently discards every other week's data before navigation ever gets a chance to show it.** `loadPlan()` (inside the same file, unrelated to the block above) does:

```typescript
    if (plan.workouts) {
      const today = localDateStr(new Date())
      const { start: weekStart, end: weekEnd } = getWeekBounds(today)
      setWorkouts(plan.workouts.filter((w: Workout) => w.date >= weekStart && w.date <= weekEnd))
      setFuturePlanWorkouts(plan.workouts.filter((w: Workout) => w.date >= today && w.status === 'planned'))
```

This filters `workouts` state down to *only the current calendar week* at fetch time — before any of this task's navigation logic runs — so `workouts` never contains any other week's data for the day-list to render, no matter what `selectedWeekStart` is. `/api/plan`'s GET handler (`app/api/plan/route.ts`) does not filter by date at all — `plan.workouts` already contains the full active plan's workout list (confirmed by reading the route: it merges `plan.workouts` from the `training_plans`/`workouts` join with any unplanned completed rides, with no date bound). So the client-side filter above is discarding data that was already fetched, not saving a network round-trip.

Fix: stop discarding it. Replace those three lines with:

```typescript
    if (plan.workouts) {
      const today = localDateStr(new Date())
      setWorkouts(plan.workouts)
      setFuturePlanWorkouts(plan.workouts.filter((w: Workout) => w.date >= today && w.status === 'planned'))
```

(`weekStart`/`weekEnd`/`getWeekBounds(today)` were only used for the removed filter — confirmed via `grep -n "weekStart\|weekEnd" app/dashboard/page.tsx` that neither name is referenced anywhere else in the file, so no other line needs updating. `today` itself is still used by the very next line, `setFuturePlanWorkouts`, so it stays.)

**Consequence to handle: the weather-by-activity effect must not blow up in scope.** With `workouts` now holding the whole plan instead of just the current week, this existing effect (unchanged until now) would start fetching weather for every completed workout in the entire plan's history on every load, instead of just the ~7 currently visible ones:

```typescript
  useEffect(() => {
    const completedIds = workouts
      .filter(w => w.status === 'completed' && w.icu_activity_id)
      .map(w => w.icu_activity_id!)

    if (!completedIds.length) return

    let cancelled = false
    Promise.all(
      completedIds.map(id =>
        fetch(`/api/weather/activity/${id}`)
          .then(r => r.ok ? r.json() : null)
          .then((d: ActivityWeather | null) => d ? [id, d] as const : null)
          .catch(() => null)
      )
    ).then(results => {
      if (cancelled) return
      const map = new Map<string, ActivityWeather>()
      for (const r of results) { if (r) map.set(r[0], r[1]) }
      setWeatherByActivity(map)
    })

    return () => { cancelled = true }
  }, [workouts])
```

Scope it to only the currently *displayed* week (`selectedWeekStart`), so it keeps fetching weather only for what's actually rendered, and refetches when navigation changes which week that is:

```typescript
  useEffect(() => {
    const visibleWeekDates = computeWeekDates(selectedWeekStart)
    const completedIds = workouts
      .filter(w => w.status === 'completed' && w.icu_activity_id && visibleWeekDates.includes(w.date))
      .map(w => w.icu_activity_id!)

    if (!completedIds.length) return

    let cancelled = false
    Promise.all(
      completedIds.map(id =>
        fetch(`/api/weather/activity/${id}`)
          .then(r => r.ok ? r.json() : null)
          .then((d: ActivityWeather | null) => d ? [id, d] as const : null)
          .catch(() => null)
      )
    ).then(results => {
      if (cancelled) return
      const map = new Map<string, ActivityWeather>()
      for (const r of results) { if (r) map.set(r[0], r[1]) }
      setWeatherByActivity(map)
    })

    return () => { cancelled = true }
  }, [workouts, selectedWeekStart])
```

Note the dependency array uses `selectedWeekStart` (a stable primitive string), **not** `weekDates` (a plain array recomputed fresh every render, with no memoization) — depending on `weekDates` directly would make the effect's dependency identity change on every render for any reason, re-triggering `setWeatherByActivity(map)` each time, which itself causes a re-render, which recomputes `weekDates` again, forming an infinite render loop. Computing `visibleWeekDates` freshly inside the effect body from `selectedWeekStart` avoids this entirely while still reacting correctly to week navigation.

Replace the section heading block (currently):

```typescript
      <div>
        <div className="flex items-baseline justify-between mb-0.5">
          <h2 className="text-lg font-bold tracking-tight text-gray-900">This week</h2>
          {(() => {
            const weekWorkouts = workouts.filter(w => weekDates.includes(w.date))
            if (!weekWorkouts.length) return null
            const plannedTss = weekWorkouts.reduce((sum, w) => sum + estimateTss(w.type, w.duration_minutes), 0)
            const actualTss = weekWorkouts
              .filter(w => w.status === 'completed' && w.tss !== null)
              .reduce((sum, w) => sum + (w.tss ?? 0), 0)
            const plannedMins = weekWorkouts.reduce((sum, w) => sum + w.duration_minutes, 0)
            const completedMins = weekWorkouts
              .filter(w => w.status === 'completed')
              .reduce((sum, w) => sum + w.duration_minutes, 0)
            const hasCompleted = weekWorkouts.some(w => w.status === 'completed')
            const fmt = (m: number) => `${Math.round(m / 60 * 10) / 10}h`
            return hasCompleted ? (
              <span className="text-sm text-gray-400">
                <span className="font-semibold text-gray-600">~{plannedTss} → {actualTss}</span>{' TSS · '}
                <span className="font-semibold text-gray-600">{fmt(completedMins)}/{fmt(plannedMins)}</span>
              </span>
            ) : (
              <span className="text-sm text-gray-400">
                <span className="font-semibold text-gray-600">~{plannedTss}</span>{' TSS · '}
                <span className="font-semibold text-gray-600">{fmt(plannedMins)}</span>
              </span>
            )
          })()}
        </div>
        <p className="text-sm text-gray-400 mb-4">
          {weekDates[0].slice(8)} – {weekDates[6].slice(8)} {new Date(weekDates[0]).toLocaleString('en-GB', { month: 'long' })}
        </p>
```

with:

```typescript
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <h2 className="text-lg font-bold tracking-tight text-gray-900">
            {isCurrentWeek ? 'This week' : weekRangeLabel}
          </h2>
          <div className="flex items-center gap-3">
            {(() => {
              const weekWorkouts = workouts.filter(w => weekDates.includes(w.date))
              if (!weekWorkouts.length) return null
              const plannedTss = weekWorkouts.reduce((sum, w) => sum + estimateTss(w.type, w.duration_minutes), 0)
              const actualTss = weekWorkouts
                .filter(w => w.status === 'completed' && w.tss !== null)
                .reduce((sum, w) => sum + (w.tss ?? 0), 0)
              const plannedMins = weekWorkouts.reduce((sum, w) => sum + w.duration_minutes, 0)
              const completedMins = weekWorkouts
                .filter(w => w.status === 'completed')
                .reduce((sum, w) => sum + w.duration_minutes, 0)
              const hasCompleted = weekWorkouts.some(w => w.status === 'completed')
              const fmt = (m: number) => `${Math.round(m / 60 * 10) / 10}h`
              return hasCompleted ? (
                <span className="text-sm text-gray-400">
                  <span className="font-semibold text-gray-600">~{plannedTss} → {actualTss}</span>{' TSS · '}
                  <span className="font-semibold text-gray-600">{fmt(completedMins)}/{fmt(plannedMins)}</span>
                </span>
              ) : (
                <span className="text-sm text-gray-400">
                  <span className="font-semibold text-gray-600">~{plannedTss}</span>{' TSS · '}
                  <span className="font-semibold text-gray-600">{fmt(plannedMins)}</span>
                </span>
              )
            })()}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => shiftWeek(-7)}
                aria-label="Previous week"
                className="p-2 text-gray-400 hover:text-gray-700 text-lg leading-none min-h-[44px]"
              >
                ‹
              </button>
              <button
                onClick={() => shiftWeek(7)}
                aria-label="Next week"
                className="p-2 text-gray-400 hover:text-gray-700 text-lg leading-none min-h-[44px]"
              >
                ›
              </button>
              {!isCurrentWeek && (
                <button
                  onClick={jumpToCurrentWeek}
                  aria-label="Today"
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700 px-2 min-h-[44px] inline-flex items-center"
                >
                  Today
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          {weekRangeLabel}
        </p>
```

No other lines change — everything below this block (the `DndContext`/`weekDates.map(...)` day-list render) already reads from the `weekDates` array and needs no edits; it will render whichever week `selectedWeekStart` currently points to.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/app/dashboard/page.test.tsx`
Expected: all five tests PASS.

Then run the full suite and typecheck to confirm no regressions elsewhere:

Run: `npm run test:ci`
Expected: all suites pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.tsx __tests__/app/dashboard/page.test.tsx
git commit -m "feat: add previous/next week navigation to the dashboard"
```
