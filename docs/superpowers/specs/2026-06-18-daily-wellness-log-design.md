# Daily Wellness Log Design

## Goal

Allow the athlete to optionally log how they're feeling on any day — independently of a completed ride — so the coach can factor subjective wellness into its advice.

## Scope

- New `daily_wellness` table (one row per user per date)
- `GET /api/wellness` and `POST /api/wellness` API routes
- `WellnessCard` component added to each day row in `WeekDetail`
- `WellnessSheet` bottom sheet for entering / editing a day's readings
- `DailyWellness` type in `types/index.ts`
- Wellness data surfaced in existing coach prompts (briefing + adaptation)
- New coaching rules in `CLAUDE.md` governing how coach responds to wellness signals

No changes to `MonthStrip`, `session_feedback`, or any other existing tables.

## Data Model

### `daily_wellness` table

```sql
create table daily_wellness (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  energy smallint,        -- 1–5 (1 = exhausted, 5 = excellent)
  leg_freshness smallint, -- 1–5 (1 = heavy/dead, 5 = fresh)
  mood smallint,          -- 1–5 (1 = low/unmotivated, 5 = great)
  stress smallint,        -- 1–5 (1 = very stressed, 5 = relaxed)
  sleep_quality smallint, -- 1–5 (1 = terrible, 5 = excellent)
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, date)
);

alter table daily_wellness enable row level security;
create policy "users manage own wellness"
  on daily_wellness for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

All five scale columns are nullable — the athlete can save a partial entry. Upsert on `(user_id, date)` so re-logging a day overwrites rather than duplicates.

### `DailyWellness` type (`types/index.ts`)

```ts
export interface DailyWellness {
  id: string
  user_id: string
  date: string           // YYYY-MM-DD
  energy: number | null
  leg_freshness: number | null
  mood: number | null
  stress: number | null
  sleep_quality: number | null
  created_at: string
  updated_at: string
}
```

## API

### `GET /api/wellness?from=YYYY-MM-DD&to=YYYY-MM-DD`

Returns all `daily_wellness` rows for the authenticated user within the date range (inclusive). Used by the calendar page on load and after a save.

Response: `{ wellness: DailyWellness[] }`

### `POST /api/wellness`

Upserts a single day's wellness entry.

Request body:
```ts
{
  date: string           // YYYY-MM-DD
  energy?: number        // 1–5
  leg_freshness?: number
  mood?: number
  stress?: number
  sleep_quality?: number
}
```

Response: `{ wellness: DailyWellness }`

Uses Supabase upsert with `onConflict: 'user_id,date'` and sets `updated_at = now()`.

## UI Components

### `WellnessCard` (`components/WellnessCard.tsx`)

Compact card rendered at the bottom of each day's sessions column in `WeekDetail`.

**Unlogged state:** dashed border, emoji placeholder, "Tap to log wellness" label, chevron.

**Logged state:** solid border, coloured emoji reflecting overall reading, dot-scale summary for each metric (`Energy ●●●●○`), chevron to re-open and edit.

**Rest day:** smaller `+ wellness` button inline with the "Rest day" italic text — less prominent since there's no session context.

Tapping any state opens `WellnessSheet` for that date.

### `WellnessSheet` (`components/WellnessSheet.tsx`)

Bottom sheet (`items-end sm:items-center`, `max-h-[92vh] overflow-y-auto`).

Shows:
- Date heading + "How are you feeling?" subtitle
- Five scale rows (Energy, Leg freshness, Mood, Stress, Sleep quality)
- Each row: label + five 44px tap targets labelled 1–5, colour-coded red (1) → amber (3) → green (5); selected value is highlighted with a bold border
- Save button (disabled until at least one value selected)
- If editing an existing entry, pre-populates the current values

On save: calls `POST /api/wellness`, closes sheet, parent refreshes `dailyWellness` state.

### `WeekDetail` changes

- New props: `dailyWellness: DailyWellness[]` and `onWellnessSaved: (w: DailyWellness) => void`
- Each day row passes the matching `DailyWellness | undefined` to `WellnessCard`
- After `WellnessSheet` saves, calls `onWellnessSaved` to update parent state without a full page reload

### Calendar page changes

- Fetches `GET /api/wellness` for the displayed month range on load (alongside workouts/events)
- Passes `dailyWellness` and `onWellnessSaved` down through `ContinuousWeeks` → `WeekDetail` (both components get the same two new props)
- `onWellnessSaved` upserts the saved entry into the `dailyWellness` state slice by date

## Coach Integration

### Data format for prompts

A `formatWellnessForPrompt(wellness: DailyWellness[])` helper in `lib/claude/wellness-prompt.ts` formats the last N days as a compact block:

```
Athlete wellness (last 3 days):
  2026-06-17: Energy 4, Legs 3, Mood 4, Stress 2, Sleep 4
  2026-06-16: Energy 3, Legs 2, Mood 3, Stress 3, Sleep 3
  2026-06-15: Energy 5, Legs 4, Mood 5, Stress 1, Sleep 5
(1 = lowest, 5 = highest; Stress is inverted — 1 = very stressed, 5 = relaxed)
```

If no wellness data exists for a date it is omitted from the block. If no data at all, the block is omitted.

### Prompts updated

- **`lib/claude/briefing.ts`** — last 3 days of wellness appended to athlete state section
- **`lib/claude/review.ts`** — last 7 days of wellness appended to athlete state section
- **`/api/chat/route.ts`** and **`/api/chat/session/route.ts`** — last 7 days appended alongside existing HRV/form context

### `CLAUDE.md` coaching rules (new section)

```
## Daily Wellness

When wellness readings are provided, the coach must actively factor them into advice:

- Low energy (1–2): treat as a fatigue signal. Steer toward easing or rescheduling
  hard sessions, given the same weight as suppressed HRV.
- Low leg freshness (1–2): warn about accumulated muscular fatigue. Suggest swapping
  threshold or interval sessions for Z2 or rest.
- Low stress score (1–2, meaning high real-world stress): reduce training load.
  Prioritise recovery over hitting planned TSS targets.
- Low sleep quality (1–2): treat similarly to suppressed HRV — ease or reschedule
  today's session.
- Consistently low readings (2+ consecutive days on any metric): flag as a pattern
  and recommend a recovery week or load reduction.
- When wellness conflicts with objective metrics (e.g. HRV looks fine but athlete
  reports low energy/legs), weight the subjective report at least equally — do not
  dismiss it.
- When wellness is strongly positive (energy 5, legs 4–5, mood 5) heading into a key
  session, green-light it explicitly.
```

## Tests

- `GET /api/wellness` returns rows for the date range, empty array if none
- `POST /api/wellness` creates a new row; calling again for the same date updates it
- `WellnessCard` renders unlogged state when no wellness passed; renders dot summary when logged
- `WellnessSheet` Save button disabled until at least one value selected; calls POST on save
- `formatWellnessForPrompt` omits days with no data; omits block entirely if no data
