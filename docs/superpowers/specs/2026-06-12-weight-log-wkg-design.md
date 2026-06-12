# Weight Log & W/kg Design

## Goal

Track rider weight over time and surface power-to-weight (w/kg) on the fitness page and in per-ride stats.

## Context

`user_profile.weight_kg` currently holds a single static weight value. It is synced to intervals.icu when updated via the profile API and surfaced in coach prompts, but never shown in the UI. There is no history. This design adds a logged weight history and derives w/kg wherever power data exists.

---

## Data Layer

### New table: `weight_log`

```sql
weight_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  date        date not null,
  weight_kg   numeric(5,2) not null,
  created_at  timestamptz default now(),
  unique (user_id, date)
)
```

Row-level security: users can only read and write their own rows.

### `user_profile.weight_kg` stays as the canonical current weight

It is always kept in sync with the most recent log entry — it is never set directly by the user going forward. The profile API continues to expose it for coach prompts and other consumers without change.

---

## API

### `POST /api/weight-log`

Body: `{ weight_kg: number, date?: string /* YYYY-MM-DD, defaults to today */ }`

Steps:
1. Upsert into `weight_log` (on conflict `(user_id, date)` update `weight_kg`)
2. If this entry is the most recent date for this user: `UPDATE user_profile SET weight_kg = $weight_kg`
3. `client.updateAthleteWeight(weight_kg)` — fire-and-forget, same pattern as the existing profile endpoint

Returns: `{ entry: { id, date, weight_kg } }`

### `DELETE /api/weight-log/:id`

Deletes the entry. If it was the most recent entry, recalculates current weight from the new most-recent entry and syncs `user_profile.weight_kg` (and intervals.icu) accordingly.

### `GET /api/weight-log`

Returns: `{ entries: { id, date, weight_kg }[] }` ordered by `date desc`.

---

## UI: Profile & Schedule tab (`app/plan/page.tsx`)

The existing `<input type="number">` weight field is replaced with a **WeightLogWidget** component:

- Displays current weight (most recent entry) as a pre-filled input
- **"Log weight"** button: saves entry for today (date defaults to today, can be changed)
- Compact entry list below: last 8 entries, each showing date + kg + a delete button
- On save: POST to `/api/weight-log`, optimistically update local list

No other changes to the Profile & Schedule tab.

---

## UI: Fitness page (`app/fitness/page.tsx`)

Two additions below the existing FTP history chart:

### Current w/kg stat

A single prominent figure: `current_ftp / weight_kg` formatted to 2 decimal places (e.g. `4.21 w/kg`). Shown only when both `current_ftp` and `weight_kg` are available.

### Weight trend chart

SVG line chart matching the style of `FTPHistoryChart`:
- X axis: date range of all log entries
- Y axis: weight in kg, auto-scaled with 2 kg padding top and bottom
- Rose/red accent colour (distinct from FTP's orange)
- Dots at each log entry with the value label above
- Hidden if fewer than 2 entries exist

Component: `WeightHistoryChart({ entries: { date: string; weight_kg: number }[] })`

Weight log is fetched in the page's existing `useEffect` alongside FTP predictions.

---

## UI: Ride stats (`RideStats`)

### `RideStatsData` interface additions

```ts
npWkg: number | null
avgWkg: number | null
```

### Weight-at-ride-date lookup

A helper function:

```ts
function weightAtDate(log: { date: string; weight_kg: number }[], rideDate: string, fallback: number | null): number | null {
  const sorted = [...log].sort((a, b) => b.date.localeCompare(a.date))
  const entry = sorted.find(e => e.date <= rideDate)
  return entry ? entry.weight_kg : fallback
}
```

This is called by the **caller** of `rideStatsFromActivity` / `rideStatsFromMetrics` — both the stats page and the workout modal — not inside those functions. The weight log is fetched once and passed in.

### Power card update

The existing Power card gains a w/kg row below Avg W / NP / TSS:

```
Avg W    NP     TSS
[value] [value] [value]

Avg w/kg   NP w/kg
[value]    [value]
```

Shown only when at least one of `avgWkg` / `npWkg` is non-null. Values formatted to 2 decimal places.

### Where weight log is fetched

- **Stats page** (`app/stats/page.tsx`): fetch `/api/weight-log` in the page `useEffect`, pass `weightLog` into `rideStatsFromActivity` calls for recent rides
- **WorkoutDetailModal** (`components/WorkoutDetailModal.tsx`): accept an optional `weightLog` prop; compute w/kg in the `rideStatsFromMetrics` call; the dashboard passes the log down

---

## Types

```ts
// types/index.ts additions
export interface WeightEntry {
  id: string
  date: string       // YYYY-MM-DD
  weight_kg: number
}
```

`RideStatsData` gains `npWkg: number | null` and `avgWkg: number | null`.

---

## Out of scope

- w/kg on MetricsBar / dashboard header
- w/kg trend over time (full time-series combining FTP history and weight log)
- BMI or other derived metrics
- Manual weight entry for past dates beyond backdating via the date picker
