# Multi-Session Days Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show all sessions on a given day (planned workouts, events, and unplanned ICU rides) in both the dashboard weekly strip and the calendar grid, replacing the current single-item `.find()` logic with `.filter()` throughout.

**Architecture:** Three changes in two pages plus one new component. `ActivityCard` handles unplanned ride display. Dashboard and calendar both switch from `.find()` to `.filter()` per day, then map over the resulting arrays. The calendar also gains a `syncData` state (it already calls `/api/sync` but discards the response). No API or database changes.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS. `ICUSyncData` / `ICUActivity` types from `@/types`.

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Create | `components/ActivityCard.tsx` | New card for unplanned ICU rides |
| Modify | `app/dashboard/page.tsx` | find→filter per day, map over arrays, render ActivityCard |
| Modify | `app/calendar/page.tsx` | Add syncData state, find→filter, remove aspect-square, chip-based cells |

---

### Task 1: ActivityCard component

**Files:**
- Create: `components/ActivityCard.tsx`

Context: The dashboard weekly strip needs a card style for unplanned ICU rides (rides in intervals.icu that don't match any planned workout's `icu_activity_id`). These are visually distinct from `WorkoutCard` — light sky blue, prefixed with ↑.

- [ ] **Step 1: Create `components/ActivityCard.tsx`**

```tsx
'use client'
import type { ICUActivity } from '@/types'

function fmtDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`
  return `${mins}m`
}

interface Props {
  activity: ICUActivity
}

export default function ActivityCard({ activity }: Props) {
  return (
    <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-sky-500 text-sm font-bold">↑</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-sky-900 truncate">{activity.name}</div>
          <div className="text-xs text-sky-700 mt-0.5 flex gap-2 flex-wrap">
            <span>{fmtDuration(activity.moving_time)}</span>
            {activity.training_load != null && <span>{activity.training_load} TSS</span>}
            {activity.weighted_average_watts != null && <span>{Math.round(activity.weighted_average_watts)}W NP</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors related to `ActivityCard.tsx`

- [ ] **Step 3: Commit**

```bash
git add components/ActivityCard.tsx
git commit -m "feat: add ActivityCard for unplanned ICU rides"
```

---

### Task 2: Dashboard — multi-session weekly strip

**Files:**
- Modify: `app/dashboard/page.tsx`

Context: The weekly strip (lines ~488–524) currently does `workouts.find(w => w.date === date)` and `events.find(e => e.date === date)`, so only one item of each type shows per day. Replace with `.filter()` and map over all items. Unplanned ICU rides (activities with no matching `icu_activity_id` in any of that day's workouts) are shown with `ActivityCard`.

`todayWorkout` at line ~362 (`workouts.find(w => w.date === todayStr)`) stays as `.find()` — `TodayCard` takes a single workout, not an array.

`events.find(e => e.date === todayStr)` in the `TodayCard` render (~line 425) also stays — same reason.

- [ ] **Step 1: Add ActivityCard import**

In `app/dashboard/page.tsx`, add to the imports block (after the existing component imports):

```ts
import ActivityCard from '@/components/ActivityCard'
```

- [ ] **Step 2: Replace the weekly strip day-mapping block**

Find this block (starts around line 488):
```tsx
{weekDates.map((date, i) => {
  const dayWorkout = workouts.find(w => w.date === date)
  const dayEvent = events.find(e => e.date === date)
  const isToday = date === localDateStr(new Date())
  return (
    <div key={date} className="flex gap-4 items-start">
      <div className="w-10 text-center pt-3">
        <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{days[i]}</div>
        <div className={`text-xl font-extrabold tracking-tight mt-0.5 ${isToday ? 'text-blue-600' : 'text-gray-500'}`}>{date.slice(8)}</div>
      </div>
      <DroppableDay date={date}>
        {dayWorkout && dayWorkout.status === 'planned' ? (
          <DraggableWorkoutCard workout={dayWorkout} onClick={() => setSelectedWorkout(dayWorkout)} />
        ) : dayWorkout ? (
          <WorkoutCard workout={dayWorkout} onClick={() => setSelectedWorkout(dayWorkout)} />
        ) : null}
        {dayEvent && (
          <button
            onClick={() => setSelectedEvent(dayEvent)}
            className={`w-full text-left rounded-xl border-l-4 border border-gray-200 bg-white shadow-sm px-4 py-3 hover:brightness-95 transition-all ${EVENT_COLOURS[dayEvent.priority]}`}
          >
            <div className="flex items-center gap-2">
              <span>🏁</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{dayEvent.name}</div>
                <div className="text-xs capitalize opacity-75">{dayEvent.type} · {dayEvent.priority} priority</div>
              </div>
              {dayEvent.icu_activity_id && (
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" title="Result recorded" />
              )}
            </div>
          </button>
        )}
        {!dayWorkout && !dayEvent && (
          <div className="text-sm text-gray-300 italic py-3.5 pl-1">Rest day</div>
        )}
      </DroppableDay>
    </div>
  )
})}
```

Replace with:
```tsx
{weekDates.map((date, i) => {
  const dayWorkouts = workouts.filter(w => w.date === date)
  const dayEvents = events.filter(e => e.date === date)
  const linkedIds = new Set(dayWorkouts.map(w => w.icu_activity_id).filter(Boolean))
  const unplannedActivities = (syncData?.activities ?? [])
    .filter(a => a.start_date_local.startsWith(date) && /ride/i.test(a.type) && !linkedIds.has(a.id))
  const isEmpty = dayWorkouts.length === 0 && dayEvents.length === 0 && unplannedActivities.length === 0
  const isToday = date === localDateStr(new Date())
  return (
    <div key={date} className="flex gap-4 items-start">
      <div className="w-10 text-center pt-3">
        <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{days[i]}</div>
        <div className={`text-xl font-extrabold tracking-tight mt-0.5 ${isToday ? 'text-blue-600' : 'text-gray-500'}`}>{date.slice(8)}</div>
      </div>
      <DroppableDay date={date}>
        {dayWorkouts.map(w => w.status === 'planned' ? (
          <DraggableWorkoutCard key={w.id} workout={w} onClick={() => setSelectedWorkout(w)} />
        ) : (
          <WorkoutCard key={w.id} workout={w} onClick={() => setSelectedWorkout(w)} />
        ))}
        {dayEvents.map(e => (
          <button
            key={e.date + e.name}
            onClick={() => setSelectedEvent(e)}
            className={`w-full text-left rounded-xl border-l-4 border border-gray-200 bg-white shadow-sm px-4 py-3 hover:brightness-95 transition-all ${EVENT_COLOURS[e.priority]}`}
          >
            <div className="flex items-center gap-2">
              <span>🏁</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{e.name}</div>
                <div className="text-xs capitalize opacity-75">{e.type} · {e.priority} priority</div>
              </div>
              {e.icu_activity_id && (
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" title="Result recorded" />
              )}
            </div>
          </button>
        ))}
        {unplannedActivities.map(a => (
          <ActivityCard key={a.id} activity={a} />
        ))}
        {isEmpty && (
          <div className="text-sm text-gray-300 italic py-3.5 pl-1">Rest day</div>
        )}
      </DroppableDay>
    </div>
  )
})}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual check — open the app and inspect the dashboard**

Start dev server: `npm run dev`

Navigate to the dashboard. Check:
- A day with one planned workout still shows one card (no regression)
- A rest day still shows "Rest day"
- 26 May (or any race day) shows the event card and any unplanned rides from syncData below it
- Drag-and-drop still works for planned workouts

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: show all sessions per day in dashboard weekly strip"
```

---

### Task 3: Calendar — syncData state + multi-session cells

**Files:**
- Modify: `app/calendar/page.tsx`

Context: The calendar calls `/api/sync` on mount but discards all the response except `athlete_id`. We need to store the full `ICUSyncData` so we can display unplanned ICU rides per cell. The cell rendering is also completely rewritten: `aspect-square` is removed, cells grow to fit content, and items stack as chips inside each cell rather than the cell itself becoming the clickable target.

The existing `openEvent()` function and `eventActivities` state (used by `EventDetailModal`) are unchanged.

- [ ] **Step 1: Add ICUSyncData to the types import**

Find in `app/calendar/page.tsx` (line ~8):
```ts
import type { Workout, TrainingEvent, SessionFeedback, ICUActivity } from '@/types'
```

Replace with:
```ts
import type { Workout, TrainingEvent, SessionFeedback, ICUActivity, ICUSyncData } from '@/types'
```

- [ ] **Step 2: Add syncData state**

Find the state declarations block (after `const [editingEvent, setEditingEvent] = useState...`, around line 54). Add:

```ts
const [syncData, setSyncData] = useState<ICUSyncData | null>(null)
```

- [ ] **Step 3: Update the sync useEffect to store syncData**

Find in `useEffect` (lines ~89–99):
```ts
fetch('/api/sync', { method: 'POST' })
  .then(r => r.ok ? r.json() : null)
  .then(data => { if (data?.athlete_id) setAthleteId(data.athlete_id) })
  .catch(() => {})
```

Replace with:
```ts
fetch('/api/sync', { method: 'POST' })
  .then(r => r.ok ? r.json() : null)
  .then(data => {
    if (data?.athlete_id) setAthleteId(data.athlete_id)
    if (data) setSyncData(data)
  })
  .catch(() => {})
```

- [ ] **Step 4: Replace the cell rendering block**

Find the entire `days.map(day => { ... })` block inside `<div className="grid grid-cols-7 gap-0.5">` (lines ~142–205). Replace it with:

```tsx
{days.map(day => {
  const ds = dateStr(day)
  const dayWorkouts = workouts.filter(w => w.date === ds)
  const dayEvents = events.filter(e => e.date === ds)
  const linkedIds = new Set(dayWorkouts.map(w => w.icu_activity_id).filter(Boolean))
  const dayActivities = (syncData?.activities ?? [])
    .filter(a => a.start_date_local.startsWith(ds) && /ride/i.test(a.type) && !linkedIds.has(a.id))
  const hasAnything = dayWorkouts.length > 0 || dayEvents.length > 0 || dayActivities.length > 0
  const hasEvent = dayEvents.length > 0

  return (
    <div
      key={day}
      className={`min-h-[72px] flex flex-col rounded-lg text-sm p-1 gap-0.5
        ${hasEvent
          ? `border-2 ${EVENT_COLOURS[dayEvents[0].priority]}`
          : hasAnything
            ? 'bg-white border border-gray-200'
            : 'text-gray-300'
        }
      `}
    >
      <span className={`text-[10px] font-semibold self-start px-0.5 leading-tight
        ${hasEvent ? '' : hasAnything ? 'text-gray-500' : 'text-gray-300'}`}
      >
        {day}
      </span>
      {dayEvents.map(e => (
        <div
          key={e.date + e.name}
          onClick={() => openEvent(e)}
          className="bg-red-100 text-red-700 rounded-sm px-0.5 py-px text-[7px] font-semibold truncate cursor-pointer leading-tight"
        >
          🏁 {e.name}
        </div>
      ))}
      {dayWorkouts.map(w => (
        <div
          key={w.id}
          onClick={() => setSelectedWorkout(w)}
          className="bg-blue-100 text-blue-700 rounded-sm px-0.5 py-px text-[7px] truncate cursor-pointer capitalize leading-tight"
        >
          {w.type} {w.duration_minutes}m{w.status === 'completed' ? ' ✓' : w.status === 'skipped' ? ' –' : ''}
        </div>
      ))}
      {dayActivities.map(a => (
        <div
          key={a.id}
          className="bg-sky-100 text-sky-700 rounded-sm px-0.5 py-px text-[7px] truncate leading-tight"
        >
          ↑ {Math.round(a.moving_time / 60)}m{a.training_load != null ? ` · ${a.training_load}TSS` : ''}
        </div>
      ))}
    </div>
  )
})}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Manual check — open the calendar**

Navigate to `/calendar`. Check:
- Month grid renders without the fixed-square constraint — cells grow with content
- Days with one workout show a single blue chip
- Days with an event show the event chip (red) inside a coloured border cell
- 26 May (or any multi-session day) shows all chips stacked: event → workouts → ICU rides
- Tapping a workout chip opens `WorkoutDetailModal`
- Tapping an event chip opens `EventDetailModal`
- Empty days show just the day number in grey
- Month navigation (◀ ▶) still works

- [ ] **Step 7: Commit**

```bash
git add app/calendar/page.tsx
git commit -m "feat: show all sessions per day in calendar grid"
```
