# Workout Reschedule Design

## Goal

Allow users to move an uncompleted workout to a different day within the same Mon–Sun week, via drag-and-drop on the dashboard or a date picker in the workout popup. Any change requires explicit confirmation before it is committed. Confirmed reschedules update both the database and the corresponding intervals.icu event.

## Architecture

### New dependency

`@dnd-kit/core` (~8 kb gzipped) — touch-friendly drag-and-drop, required for iOS PWA support.

### Files created

| File | Purpose |
|---|---|
| `components/RescheduleConfirmModal.tsx` | Confirmation dialog shown after a dashboard drag-and-drop |

### Files modified

| File | Change |
|---|---|
| `lib/intervals/client.ts` | Extend `updateEvent` to accept optional `date` param; sets `start_date_local` in PUT body |
| `app/api/workouts/[id]/route.ts` | Extend `PATCH` handler to accept `date` field; updates DB row and calls `updateEvent` if an intervals.icu event exists |
| `components/WorkoutDetailModal.tsx` | Add constrained date input for planned workouts; inline confirmation section on date change; new `onReschedule` prop |
| `app/dashboard/page.tsx` | Wrap week section in `DndContext`; day content areas become drop zones; WorkoutCards become draggables; `handleDragEnd` validates week constraint then shows `RescheduleConfirmModal` |
| `app/calendar/page.tsx` | Pass `onReschedule={() => { setSelectedWorkout(null); loadPlan() }}` prop to `WorkoutDetailModal` so confirmed popup reschedules close the modal and reload |

## Component details

### `RescheduleConfirmModal`

Props:
```ts
interface Props {
  workout: Workout
  toDate: string        // YYYY-MM-DD
  onConfirm: () => void // called after successful PATCH
  onCancel: () => void
}
```

Behaviour:
- Displays: `"Move [type] workout from [day, date] to [day, date]?"` — e.g. `"Move threshold workout from Wed 21 May to Fri 23 May?"`
- Calls `PATCH /api/workouts/[id]` with `{ date: toDate }` on Confirm
- While in-flight: both buttons disabled, Confirm shows `"Moving…"`
- On error: inline error text, modal stays open for retry or cancel
- Cancel clears without any API call

### `WorkoutDetailModal` changes

- New prop: `onReschedule?: () => void` — called on successful reschedule so the parent can reload the plan and close the modal
- Date input rendered only when `workout.status === 'planned'`
- `min` = Monday of workout's week, `max` = Sunday of workout's week
- Selecting the same date as the workout's current date is a no-op (no confirmation shown)
- On date change: `pendingDate` state set → inline section revealed: `"Move to [formatted date]?"` + Cancel (grey) + Confirm (blue)
- While PATCH in-flight: both buttons disabled, Confirm shows `"Moving…"`
- On error: inline error text (same pattern as existing delete error)
- Cancel: clears `pendingDate`, input resets to `workout.date`

### Dashboard D&D

- `DndContext` wraps the week list section; `onDragEnd={handleDragEnd}`
- Each day's flex-1 content area is a `<Droppable id={date}>`
- Each `WorkoutCard` for a `planned` workout is wrapped in `<Draggable id={workout.id}>`
- Completed / skipped / needs_review workouts are not draggable
- `DragOverlay` renders a muted clone of the card while dragging, keeping the source slot layout stable
- Drop zones only show a highlight when the dragged workout's week contains the target date (constraint is visually self-evident)

`handleDragEnd` logic:
```
active.id  → workout id → look up workout → compute its Mon–Sun week
over.id    → target date string
guard: over exists, targetDate ≠ workout.date, targetDate within workout's week
→ set pendingReschedule { workout, toDate: targetDate }
```

- `pendingReschedule: { workout: Workout; toDate: string } | null` held in dashboard state
- `RescheduleConfirmModal` rendered when non-null
- On confirm callback: `loadPlan()`, clear `pendingReschedule`
- On cancel: clear `pendingReschedule`

## Data flow

### `PATCH /api/workouts/[id]` — date update

Request body: `{ date: "YYYY-MM-DD" }`

Handler:
1. Validate `date` matches `/^\d{4}-\d{2}-\d{2}$/`
2. `UPDATE workouts SET date = $date WHERE id = $id`
3. If workout has `intervals_icu_event_id`: call `client.updateEvent(eventId, { date })`
4. intervals.icu failure is non-fatal — return `{ ok: true, icu_warning: "..." }` rather than a 500

### `IntervalsClient.updateEvent` — date support

Extend the existing `params: Partial<CreateEventParams>` to include `date?: string`. When set, add `start_date_local: "${date}T08:00:00"` to the PUT body (matching the time used in `createEvent`).

## Week constraint

Computed client-side:

```ts
function getWeekBounds(date: string): { start: string; end: string } {
  const d = new Date(date + 'T00:00:00')
  const day = (d.getDay() + 6) % 7  // 0 = Monday
  const mon = new Date(d)
  mon.setDate(d.getDate() - day)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return {
    start: mon.toISOString().split('T')[0],
    end: sun.toISOString().split('T')[0],
  }
}
```

Used for:
- `min`/`max` on the date input in `WorkoutDetailModal`
- Guard in `handleDragEnd` to reject out-of-week drops
- Drop zone highlight logic (only highlight when target date is in-week)

The server does not enforce same-week — it accepts any valid date string. Client-side constraints cover the intended UX scope.

## Confirmation UX

| Trigger | Confirmation style |
|---|---|
| Dashboard drag-and-drop | `RescheduleConfirmModal` (separate modal) |
| Popup date picker | Inline section within `WorkoutDetailModal` (avoids nested modals) |

Both paths call the same `PATCH /api/workouts/[id]` endpoint.

## Two workouts on one day

Allowed. No conflict resolution needed — the backend accepts multiple workouts on the same date, and the dashboard already renders all workouts for a given day.

## Testing

| Area | Tests |
|---|---|
| `RescheduleConfirmModal` | Renders correct prompt text; Confirm calls PATCH with correct body; loading state disables buttons; error renders inline; Cancel does not call PATCH |
| `WorkoutDetailModal` | Date input absent for non-planned workouts; `min`/`max` match workout's week; pendingDate section appears on change; same-date change is no-op; Confirm calls PATCH; Cancel resets input; error renders inline |
| `PATCH /api/workouts/[id]` | Date field updates DB; calls `updateEvent` when event id exists; returns icu_warning (not 500) on intervals.icu failure |
| `IntervalsClient.updateEvent` | PUT body includes `start_date_local` when date provided; omits it when not provided |
| Dashboard D&D | Not unit-tested (pointer simulation required); covered via `RescheduleConfirmModal` tests |
| `getWeekBounds` | Correct Mon/Sun for mid-week date, Monday, Sunday, week crossing month boundary |
