# Multi-Session Days Design

## Goal

Show all sessions on a given day — planned workouts, events, and actual ICU rides — in both the dashboard weekly strip and the calendar grid. Currently both views use `.find()` so only one workout and one event can render per day, and unplanned ICU rides never appear at all.

## Architecture

Two pages are modified — no new API routes. A new `ActivityCard` component handles the unplanned ICU ride display. The calendar page gains a `syncData` state (it already calls `/api/sync` but discards the response). Everywhere `.find()` is replaced with `.filter()` to return arrays, and the render loop maps over all items per day.

**"Unplanned" ICU activity:** an `ICUActivity` where no workout on the same date has a matching `icu_activity_id`. Computed per day at render time — no backend change needed.

## Data Flow

```
syncData.activities (ICUActivity[])
  → filter by date prefix
  → subtract any with id matching a workout.icu_activity_id on that date
  → "unplanned activities" for that day
```

## Components

### New: `components/ActivityCard.tsx`

Renders an unplanned ICU activity in the dashboard weekly strip. Light blue style to distinguish from planned workouts. Shows: activity name, duration (moving_time → h/m), TSS (training_load), NP (weighted_average_watts). Tapping it is a no-op for now (no modal exists for raw ICU activities).

Props:
```ts
interface Props {
  activity: ICUActivity
}
```

Visual: `bg-sky-50 border border-sky-200 rounded-xl px-4 py-3`, with a `↑` prefix on the name to signal "actual ride".

### Modified: `app/dashboard/page.tsx`

**Weekly strip changes (lines ~488–524):**

1. Replace `workouts.find(w => w.date === date)` with `workouts.filter(w => w.date === date)` → `dayWorkouts`
2. Replace `events.find(e => e.date === date)` with `events.filter(e => e.date === date)` → `dayEvents`
3. Compute `unplannedActivities` per day:
   ```ts
   const linkedIds = new Set(dayWorkouts.map(w => w.icu_activity_id).filter(Boolean))
   const unplannedActivities = (syncData?.activities ?? [])
     .filter(a => a.start_date_local.startsWith(date) && /ride/i.test(a.type) && !linkedIds.has(a.id))
   ```
4. In `DroppableDay`, map over `dayWorkouts` (draggable if planned, static if not), then map over `dayEvents`, then map over `unplannedActivities` rendering `<ActivityCard>`.
5. Rest-day text only shows if `dayWorkouts.length === 0 && dayEvents.length === 0 && unplannedActivities.length === 0`.

**Modal click handlers:** `setSelectedWorkout(dayWorkout)` calls now pass the specific workout from the map. `setSelectedEvent(dayEvent)` similarly.

**`todayWorkout` line (~362):** Change to `workouts.find(w => w.date === todayStr)` — this stays as `.find()` since `TodayCard` takes a single workout.

**Weekly TSS summary (~454):** No change needed — already uses `workouts.filter(w => weekDates.includes(w.date))`.

### Modified: `app/calendar/page.tsx`

**Add syncData state:**
```ts
const [syncData, setSyncData] = useState<ICUSyncData | null>(null)
```

**Update the existing `/api/sync` call in `useEffect`:**
```ts
fetch('/api/sync', { method: 'POST' })
  .then(r => r.ok ? r.json() : null)
  .then(data => {
    if (data?.athlete_id) setAthleteId(data.athlete_id)
    if (data) setSyncData(data)
  })
  .catch(() => {})
```

**Import `ICUSyncData` from `@/types`** (add to existing import line).

**Cell rendering changes:**

Remove `aspect-square` from all cell class strings. Replace with `min-h-[72px]`.

Replace per-day logic:
```ts
const workout = workouts.find(w => w.date === ds)
const event = events.find(e => e.date === ds)
```
with:
```ts
const dayWorkouts = workouts.filter(w => w.date === ds)
const dayEvents = events.filter(e => e.date === ds)
const linkedIds = new Set(dayWorkouts.map(w => w.icu_activity_id).filter(Boolean))
const dayActivities = (syncData?.activities ?? [])
  .filter(a => a.start_date_local.startsWith(ds) && /ride/i.test(a.type) && !linkedIds.has(a.id))
const hasAnything = dayWorkouts.length > 0 || dayEvents.length > 0 || dayActivities.length > 0
```

**Unified cell button** — instead of two separate branches (event vs workout), render one `button` per day that opens the first relevant item, or a day-detail sheet (future). For now: the day number is always shown, then chips stack below in order:

1. Event chips (red): `dayEvents.map(e => <EventChip>)`
2. Workout chips (blue/coloured): `dayWorkouts.map(w => <WorkoutChip>)`
3. ICU activity chips (light blue): `dayActivities.map(a => <ActivityChip>)`

Each chip is independently clickable (stopPropagation on the chip, day cell itself is a no-op or opens first item).

**Chip rendering inside cells:**

Event chip:
```tsx
<div
  key={e.date + e.name}
  onClick={ev => { ev.stopPropagation(); openEvent(e) }}
  className="bg-red-100 text-red-700 rounded-sm px-0.5 py-px text-[7px] font-semibold truncate cursor-pointer"
>
  🏁 {e.name}
</div>
```

Workout chip:
```tsx
<div
  key={w.id}
  onClick={ev => { ev.stopPropagation(); setSelectedWorkout(w) }}
  className="bg-blue-100 text-blue-700 rounded-sm px-0.5 py-px text-[7px] truncate cursor-pointer capitalize"
>
  {w.type} {w.duration_minutes}m
  {w.status === 'completed' && ' ✓'}
  {w.status === 'skipped' && ' –'}
</div>
```

ICU activity chip:
```tsx
<div
  key={a.id}
  className="bg-sky-100 text-sky-700 rounded-sm px-0.5 py-px text-[7px] truncate"
>
  ↑ {Math.round(a.moving_time / 60)}m
  {a.training_load ? ` · ${a.training_load}TSS` : ''}
</div>
```

**Day cell outer element:** replace the two-branch `button` with a single `div` (non-interactive wrapper) so the individual chips handle their own clicks. Day number styling unchanged. Days with no content keep their plain number with `text-gray-300`.

## Error Handling

- `syncData` may be null (sync not yet complete or failed) — all `.filter()` calls guard with `?? []`, so cells degrade gracefully to showing only planned workouts and events.
- Calendar uses `openEvent()` which fetches activities on demand — no change.

## Visual Conventions

| Item | Dashboard card | Calendar chip |
|------|---------------|---------------|
| Planned workout | white border `WorkoutCard` | blue-100 chip |
| Event | coloured border (EVENT_COLOURS) | red-100 chip |
| Unplanned ICU ride | sky-50 border `ActivityCard` | sky-100 chip |

## Out of Scope

- Tapping an ICU activity chip in the calendar does nothing (no detail modal for raw activities yet)
- Multi-event days are rare — rendering all is correct but no special layout treatment
- The TodayCard still shows only the first planned workout for today
- Drag-and-drop on the dashboard only applies to planned workouts (unchanged)
