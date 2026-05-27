# Calendar Week View Redesign

## Goal

Replace the monthly grid calendar with a week-focused list view that clearly displays multi-session days — each session visible as an individual card with name, duration, TSS, and status.

## Background

The current calendar (`app/calendar/page.tsx`) renders a 7-column monthly grid with 7px text and 72px minimum cell height. On multi-session days (e.g. a race day with a warm-up ride + race + cool-down), all sessions are crammed into a single tiny cell. Sessions overflow and are unreadable on mobile. The redesign replaces the grid with a two-section week view that solves this completely.

## Architecture

Single-file rewrite of `app/calendar/page.tsx`. All existing modals (`WorkoutDetailModal`, `EventDetailModal`, `AddEventModal`, `FeedbackModal`, `SessionChatModal`) are preserved and their logic is unchanged. The page fetches the same data it currently does: `workouts` from Supabase, `user_profile.events`, and `syncData` (intervals.icu activities).

---

## Section 1: Month Strip (top)

A compact month overview sitting above the week detail. Used for navigation and visual context.

### Layout
- 7-column date grid showing the full current month
- Column headers: M T W T F S S
- Prev/next month arrow buttons flanking the month+year title (e.g. "May 2026")

### Per-date cell
- Day number (10px)
- Up to 3 small coloured dots below the number — one per session/event on that day:
  - Red dot: race or sportive event
  - Blue dot: planned or completed workout
  - Sky dot: unlinked intervals.icu activity
- If more than 3 sessions exist, show 3 dots only (no overflow count needed — detail is in the week view)
- **Today**: number shown inside a blue circle
- **Selected week**: all 7 cells in that week row have a soft blue background band
- Tapping any date sets the selected week to the week containing that date and scrolls the week detail into view

### State
- `displayMonth: Date` — which month the strip shows (independent of selected week)
- `selectedDate: Date` — determines which week the detail shows; defaults to today

---

## Section 2: Week Detail List (below strip)

A scrollable list of 7 day rows for the selected week (Mon–Sun).

### Day row structure

```
[Date col | Sessions col]
```

**Date column** (~48px wide, flex-shrink-0):
- Day abbreviation (MON, TUE…) — 8px, uppercase
- Date number — 18px bold
- Colour: red if any event on that day, blue if today, slate-400 otherwise

**Sessions column** (flex-1):
- If no sessions: faint italic "Rest day" label in slate-400
- If sessions exist: stacked session cards with 4px gap between them

### Session card

One card per session. Three visual types, distinguished by left border colour and background tint:

| Type | Left border | Background | When shown |
|---|---|---|---|
| Event (race/sportive) | `border-red-500` | `bg-red-50` | `TrainingEvent` on this date |
| Planned/completed workout | `border-blue-500` | `bg-blue-50` | `Workout` record |
| Unlinked activity | `border-sky-400` | `bg-sky-50` | intervals.icu activity not linked to a workout |

**Card content:**

Line 1:
- Icon + session name (`🏁 Criterium Race` / `🚴 Threshold Intervals` / `↑ Recovery spin`)
- Status badge (top-right, pill style):
  - `completed ✓` — green background for workouts; shown for events with `icu_activity_id`
  - `planned` — blue, for future planned workouts
  - `skipped` — slate, for skipped workouts
  - `needs review` — amber, for `needs_review` status
  - `activity` — sky, for unlinked intervals.icu imports

Line 2 (smaller, slate-500):
- Duration (e.g. `1h 55m`)
- TSS if available (e.g. `· TSS 145`)
- Avg power if available from completed activity (e.g. `· 285W`)

**Tap behaviour:** opens the existing `WorkoutDetailModal` (for workouts) or `EventDetailModal` (for events). Unlinked activities open `WorkoutDetailModal` with the activity pre-selected (same as current behaviour). No change to modal logic.

### Multi-session days
Sessions stack as separate cards within the same day row. The row grows to accommodate any number of sessions. No truncation, no "+N more".

**Ordering within a day:** events first, then workouts ordered by `created_at`, then unlinked activities.

---

## Section 3: Page Controls

- **"+ Add event"** button (top-right of page header) — opens `AddEventModal` as now
- Week navigation: not a separate control — navigation is via the month strip (tap any date) or swipe gestures if desired (out of scope for v1)
- On mount: `selectedDate` defaults to today; `displayMonth` defaults to the month containing today

---

## Data & State

No new API calls. Reuse the existing fetches:

```ts
// Already fetched in current calendar page
const workouts: Workout[]                      // from Supabase workouts table
const events: TrainingEvent[]                  // from user_profile.events
const syncData: ICUSyncData | null             // from intervals.icu via existing hook/fetch

// Derived
const linkedIds = new Set(workouts.map(w => w.icu_activity_id).filter(Boolean))
const unlinkedActivities = (syncData?.activities ?? [])
  .filter(a => /ride/i.test(a.type) && !linkedIds.has(a.id))
```

State additions:
```ts
const [displayMonth, setDisplayMonth] = useState(() => startOfMonth(new Date()))
const [selectedDate, setSelectedDate] = useState(() => new Date())
```

`selectedDate` determines the week shown: `startOfWeek(selectedDate, { weekStartsOn: 1 })` through `endOfWeek(selectedDate, { weekStartsOn: 1 })`.

---

## Visual Spec

### Month strip dot colours
```
Red:  bg-red-400   (events)
Blue: bg-blue-400  (workouts)
Sky:  bg-sky-400   (unlinked activities)
```

### Selected week band
```
bg-blue-50 applied to each date cell in the selected week row
```

### Session card status badges
```
completed:    bg-green-100 text-green-700
planned:      bg-blue-100 text-blue-700
skipped:      bg-slate-100 text-slate-500
needs review: bg-amber-100 text-amber-700
activity:     bg-sky-100 text-sky-700
```

### Touch targets
All session cards: minimum `py-3` (≥44px effective touch height). Date cells in month strip: minimum 32px × 32px.

---

## What Does NOT Change

- `WorkoutDetailModal` — no changes
- `EventDetailModal` — no changes
- `AddEventModal` — no changes
- `FeedbackModal` — no changes
- `SessionChatModal` — no changes
- All data fetching logic — reused as-is
- Routing — still `/calendar`

---

## Out of Scope

- Swipe gestures for week navigation (can be added later)
- Editing sessions inline (use modals)
- Fitness chart integration on this page (lives on `/fitness`)
