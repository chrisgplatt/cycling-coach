# Event Result Assignment Design

## Goal

Allow athletes to assign a completed ride to a training event (race, sportive, etc.), view race metrics on the event card, add a result note, and have that data feed into coach adaptation.

## Architecture

Extend the existing `TrainingEvent` JSONB fields on `user_profile.events` with five optional result fields — no new table or migration required. A dedicated API endpoint handles assignment. Two UI entry points (event chip → modal; workout detail → event picker) both write to the same endpoint. Event results surface as a new section in the weekly review and plan chat prompts.

## Tech Stack

- Next.js App Router API routes
- Supabase (JSONB update on `user_profile.events`)
- React state + existing modal patterns (bottom-sheet, mobile-first)
- Existing `IntervalsClient` activity data (no new ICU API calls)

---

## Data Model

Five optional fields added to `TrainingEvent` in `types/index.ts`:

```ts
icu_activity_id?: string          // linked intervals.icu activity ID
result_tss?: number               // TSS from the activity
result_duration_minutes?: number  // actual ride duration
result_avg_power?: number         // normalised power (weighted_average_watts)
result_note?: string              // athlete race reflection / coach notes
```

No database migration needed — events are stored as JSONB in `user_profile.events` and the new fields are additive optional properties.

---

## API

### `PATCH /api/events/result`

Assign, update note, or remove a result from an event.

**Request body — assign or update:**
```json
{
  "event_name": "Cheltenham RR",
  "event_date": "2026-05-24",
  "icu_activity_id": "12345678",
  "result_tss": 187,
  "result_duration_minutes": 192,
  "result_avg_power": 218,
  "result_note": "Felt strong in the first half but blew up on the final climb."
}
```

**Request body — remove:**
```json
{
  "event_name": "Cheltenham RR",
  "event_date": "2026-05-24",
  "remove": true
}
```

**Behaviour:**
1. Auth check
2. Fetch `user_profile` (id + events)
3. Find event by `name + date` — 404 if not found
4. If `remove`: clear all five result fields; else merge provided fields onto event
5. Write updated events array back to `user_profile`
6. Return `{ event: updatedEvent }`

---

## Components

### New: `components/EventDetailModal.tsx`

Props:
```ts
interface Props {
  event: TrainingEvent
  activitiesOnDate: ICUActivity[]   // rides on that day, passed from parent
  onClose: () => void
  onResultSaved: (updated: TrainingEvent) => void
}
```

**No-result state:**
- Header: event name, date chip, type/priority badges, race type if present
- Body: start time, estimated duration/distance if set
- Activity picker: list of `activitiesOnDate` filtered to rides. Each row shows activity name, duration, TSS. If one ride → single "Assign this ride" button. If multiple → radio-style list then "Assign". If none → "No rides found for this date."
- Result note textarea (optional, can be filled before or after assign)
- Footer: Cancel

**Result-assigned state:**
- Same header
- Result card: TSS, duration (h:mm), normalised power, "View in intervals.icu →" link
- Result note textarea (inline editable; auto-saves on blur via PATCH)
- Footer: "Change ride" (reopens picker), "Remove result", Close

**Saving flow:**
- On assign: call `PATCH /api/events/result` with all result fields populated from the selected `ICUActivity`
- On note update: debounced PATCH with just `result_note`
- On remove: PATCH with `{ remove: true }`, reset to no-result state
- `onResultSaved(updatedEvent)` called after each successful save so parent can update local state

### Modified: `components/WorkoutDetailModal.tsx`

For `status === 'completed'` or `status === 'needs_review'` workouts and unplanned rides:

- Add "Link to event" button in the footer (alongside "Log feedback", "Chat")
- Tapping opens an inline event picker: a compact scrollable list of events within ±7 days of `workout.date`
- Each row: event name, date, priority badge. Already-linked events are greyed out.
- Selecting an event calls `PATCH /api/events/result` with `icu_activity_id = workout.icu_activity_id` and metrics from the workout row
- On success: show "Linked to [Event Name]" confirmation, call `onResultSaved` if provided

The event list is fetched from `/api/profile` (already available in parent pages) — no new endpoint needed.

### Modified: Dashboard (`app/dashboard/page.tsx`)

- Event chips become `<button>` elements; clicking sets `selectedEvent` state
- Pass `syncData.activities.filter(a => a.start_date_local.startsWith(event.date))` as `activitiesOnDate` to `EventDetailModal`
- Show a small indicator on event chips: filled green circle when `event.icu_activity_id` is set, empty ring otherwise
- `onResultSaved`: update the `events` array in local state so the chip indicator updates immediately

### Modified: Calendar (`app/calendar/page.tsx`)

- Event chips become `<button>` elements; clicking sets `selectedEvent` state
- Calendar doesn't currently store full activity data — when `EventDetailModal` opens, fetch activities for that date via a `GET /api/activities?date=YYYY-MM-DD` endpoint (new, lightweight)
- Same indicator dot on calendar event cells

### New: `GET /api/activities`

Simple endpoint: fetches activities from intervals.icu for a given date range.

Query params: `date=YYYY-MM-DD` (single day) or `start=YYYY-MM-DD&end=YYYY-MM-DD`

Returns `ICUActivity[]` filtered to rides. Used by the calendar's `EventDetailModal` when full sync data isn't in memory.

---

## Coach Integration

### Weekly review (`lib/claude/review.ts`)

Add a `formatEventResults` function:

```ts
function formatEventResults(events: TrainingEvent[], since: string): string {
  const results = events.filter(e => e.icu_activity_id && e.date >= since)
  if (!results.length) return ''
  return '\nEVENT RESULTS (last 14 days):\n' + results.map(e => {
    const raceType = e.race_type ? ` — ${e.race_type.replace('_', ' ')}` : ''
    const metrics = [
      e.result_tss != null ? `TSS ${e.result_tss}` : null,
      e.result_duration_minutes != null ? `${Math.floor(e.result_duration_minutes/60)}h${e.result_duration_minutes%60 > 0 ? String(e.result_duration_minutes%60).padStart(2,'0')+'min' : ''}` : null,
      e.result_avg_power != null ? `NP ${e.result_avg_power}W` : null,
    ].filter(Boolean).join(', ')
    const note = e.result_note ? `\n  Athlete note: "${e.result_note}"` : ''
    return `- ${e.date}: ${e.name} | ${e.type}${raceType} | Priority ${e.priority}${metrics ? ` | ${metrics}` : ''}${note}`
  }).join('\n')
}
```

Called in `buildReviewPrompt` with `profile.events` and `fourteenDaysAgo`.

### Plan chat (`app/api/chat/plan/route.ts`)

Add the same event results block to `buildSystemPrompt`, filtered to events in the past 30 days that have a result assigned. Placed after the "CURRENT FITNESS" section.

---

## Error Handling

- No rides on event date: show "No rides recorded for this date" with a note that syncing may help
- PATCH fails: show inline error, keep modal open, don't clear local state
- Activity data unavailable in calendar: show spinner while fetching, error state if fetch fails

---

## Files Changed

| File | Change |
|------|--------|
| `types/index.ts` | Add 5 result fields to `TrainingEvent` |
| `app/api/events/result/route.ts` | New — PATCH assign/update/remove |
| `app/api/activities/route.ts` | New — GET activities by date for calendar |
| `components/EventDetailModal.tsx` | New — event card with assignment UI |
| `components/WorkoutDetailModal.tsx` | Add "Link to event" footer button + picker |
| `app/dashboard/page.tsx` | Clickable event chips, EventDetailModal, indicator dots |
| `app/calendar/page.tsx` | Clickable event chips, EventDetailModal, indicator dots |
| `lib/claude/review.ts` | Add `formatEventResults`, include in prompt |
| `app/api/chat/plan/route.ts` | Add event results section to system prompt |
