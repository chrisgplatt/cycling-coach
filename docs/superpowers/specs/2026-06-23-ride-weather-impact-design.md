# Ride Weather Impact Analysis — Design Spec

## Overview

After each completed ride, compute a myWindsock-style weather impact analysis using the ride's GPS track and open-meteo's free historical weather archive. Results are cached in Supabase and surfaced on workout cards, the ride detail modal, and the daily coach briefing.

---

## Goals

- Show headwind %, tailwind %, crosswind %, air speed, and estimated weather impact % for every completed GPS ride
- Surface a compact chip on completed workout cards (dashboard + calendar)
- Show a full breakdown panel in the ride detail modal
- Feed conditions into the coach briefing when referencing a recent ride's performance

---

## Data Pipeline

### 1. GPS Track

`IntervalsClient.getActivityMap(activityId)` returns `{ latlngs: [number, number][] | null }` — per-sample `[lat, lng]` pairs. The first point is used as the weather fetch location. If `latlngs` is null (indoor ride, no GPS) the pipeline returns `null` and the UI hides the weather panel.

### 2. Historical Weather (open-meteo)

Free archive API — no key required.

```
GET https://archive-api.open-meteo.com/v1/archive
  ?latitude={lat}
  &longitude={lng}
  &start_date={YYYY-MM-DD}
  &end_date={YYYY-MM-DD}
  &hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_sum
  &wind_speed_unit=kmh
  &timezone=auto
```

Returns hourly arrays. We pick the hour index that best overlaps the ride window using `start_date_local` from the activity. We use the single best-fit hour (not a weighted average across hours) — sufficient precision for rides under 4 hours.

### 3. Headwind Analysis

For each consecutive `[lat, lng]` pair in the GPS track:

- Compute **bearing** (direction of travel, 0–360°) using the haversine bearing formula:
  ```
  θ = atan2(sin(Δλ)·cos(φ2), cos(φ1)·sin(φ2) − sin(φ1)·cos(φ2)·cos(Δλ))
  bearing = (θ * 180/π + 360) % 360
  ```
- Wind direction from open-meteo is meteorological (where wind comes **from**).
- Angle between travel bearing and wind source direction:
  - `diff = |bearing − windDir|` normalised to 0–180°
  - **Headwind**: diff ≤ 45°
  - **Tailwind**: diff ≥ 135°
  - **Crosswind**: 45° < diff < 135°
- Segment **distance** (metres) is computed via the haversine distance formula.
- Final percentages are weighted by segment distance, not segment count.

### 4. Weather Impact %

Cycling aerodynamic drag power scales with air speed cubed. For each segment:

```
windComponent = windSpeedKph × cos(diff in radians)   // positive = headwind
v_air = segmentSpeedKph + windComponent
impact_pct = ((v_air³ / v_ground³) − 1) × 100
```

Overall `weather_impact_pct` is the distance-weighted mean across all segments. Positive = harder than still air (headwind penalty), negative = easier (tailwind benefit).

`segmentSpeedKph` is derived from the GPS track timing. If per-sample timestamps are unavailable from `getActivityMap`, use `activity.moving_time / distance` as a uniform speed estimate.

### 5. Stored Metrics

| Field | Description |
|---|---|
| `headwind_pct` | % of ride distance into headwind (diff ≤ 45°) |
| `tailwind_pct` | % into tailwind (diff ≥ 135°) |
| `crosswind_pct` | remainder |
| `air_speed_kph` | distance-weighted mean effective air speed |
| `weather_impact_pct` | estimated % power cost vs still air (+ = harder) |
| `temp_min_c` | min hourly temp across ride window |
| `temp_max_c` | max hourly temp across ride window |
| `precip_mm` | total precipitation for the ride hour |
| `wind_avg_kph` | mean wind speed for the ride hour |
| `wind_dir_deg` | dominant wind direction (degrees, meteorological) |

---

## Storage

New Supabase table `activity_weather`. Historical weather never changes, so rows are write-once; no cache invalidation needed.

```sql
CREATE TABLE activity_weather (
  activity_id        text        PRIMARY KEY,
  user_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  computed_at        timestamptz NOT NULL DEFAULT now(),
  temp_min_c         float,
  temp_max_c         float,
  precip_mm          float,
  wind_avg_kph       float,
  wind_dir_deg       float,
  headwind_pct       float,
  tailwind_pct       float,
  crosswind_pct      float,
  air_speed_kph      float,
  weather_impact_pct float
);

ALTER TABLE activity_weather ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rows" ON activity_weather
  FOR ALL USING (user_id = auth.uid());
```

`activity_id` is the intervals.icu activity ID (text), matching `ICUActivity.id`.

---

## API

### `GET /api/weather/activity/[activityId]`

Auth-gated. Returns `ActivityWeather | null`.

1. Check `activity_weather` table — return row immediately if found
2. Cache miss: call `fetchActivityWeather(activityId, userId, client)`
3. If GPS unavailable: return `null` (no error — UI hides panel silently)

Response shape:

```ts
interface ActivityWeather {
  activity_id:        string
  temp_min_c:         number
  temp_max_c:         number
  precip_mm:          number
  wind_avg_kph:       number
  wind_dir_deg:       number
  headwind_pct:       number
  tailwind_pct:       number
  crosswind_pct:      number
  air_speed_kph:      number
  weather_impact_pct: number
}
```

### Background pre-warm during sync

After `/api/sync` completes, a fire-and-forget pass (using `waitUntil` or un-awaited Promise) finds up to 5 recently-completed rides with no `activity_weather` row and calls `fetchActivityWeather` for each. Sync response is not delayed.

---

## Core Library: `lib/weather/activity-weather.ts`

Exports:

```ts
// Orchestrates GPS fetch + open-meteo + computation + DB write
export async function fetchActivityWeather(
  activityId: string,
  userId: string,
  client: IntervalsClient,
  supabase: SupabaseClient,
): Promise<ActivityWeather | null>

// Pure computation — no I/O, unit-testable
export function computeHeadwindAnalysis(params: {
  latlngs: [number, number][]
  windDirDeg: number
  windSpeedKph: number
  avgSpeedKph: number  // fallback when per-sample timing unavailable
}): {
  headwind_pct: number
  tailwind_pct: number
  crosswind_pct: number
  air_speed_kph: number
  weather_impact_pct: number
}
```

---

## UI Integration

### Completed workout cards (dashboard + calendar)

`WorkoutCard` receives an optional `weather?: ActivityWeather` prop. When present and the workout status is `completed`, a compact chip renders below the session title:

```
💨 38% headwind · 27° · +1.4% harder
```

- Impact coloured: `text-red-500` (net penalty > 1%), `text-emerald-600` (net benefit < −1%), `text-slate-500` (neutral ±1%)
- Chip hidden when `weather` is null (no GPS or not yet computed)
- Parent pages (`app/dashboard/page.tsx`, `app/calendar/page.tsx`) fetch weather for completed activities in the current view window and pass it down

### Ride detail modal — Wind panel

New collapsible "Wind" section in the completed ride modal, between the intervals summary and the coach note. Rendered by a new `ActivityWeatherPanel` component.

Layout:
1. **Headline**: `+1.4% harder than still air` (or `−0.8% easier`)
2. **Three-segment bar**: headwind (red) | crosswind (amber) | tailwind (green), percentage labels on each segment
3. **Conditions row**: temp range · precip · wind arrow + speed
4. **Air speed**: `Air speed 22.4 km/h · Ground speed 20.2 km/h`

Fetched via `GET /api/weather/activity/[activityId]` when modal opens. Skeleton placeholder on first fetch; instant on repeat opens.

### Coach briefing

In `lib/claude/briefing.ts`, when `todayWorkout?.status === 'completed'` or a ride was completed yesterday, `fetchActivityWeather` is called and the result is injected into the Claude prompt:

```
Yesterday's conditions: 38% headwind (avg 18 km/h from SW), 27°C, net +1.4% harder than still air.
```

New prompt rule added to the briefing system prompt:

> When ride weather data is present, reference it when explaining why power or speed may have differed from expectations. A headwind-dominated ride with a power close to FTP is a stronger performance than the raw numbers suggest.

---

## New Files

| Path | Purpose |
|---|---|
| `lib/weather/activity-weather.ts` | Core pipeline: fetch, compute, store |
| `app/api/weather/activity/[activityId]/route.ts` | REST endpoint |
| `components/ActivityWeatherPanel.tsx` | Full breakdown UI for modal |

## Modified Files

| Path | Change |
|---|---|
| `types/index.ts` | Add `ActivityWeather` interface |
| `components/WorkoutCard.tsx` | Add optional `weather` prop + compact chip |
| `app/dashboard/page.tsx` | Fetch weather for completed rides in view; pass to cards |
| `app/calendar/page.tsx` | Same |
| `app/api/sync/route.ts` | Fire-and-forget background pre-warm |
| `lib/claude/briefing.ts` | Inject weather conditions + new prompt rule |

---

## Out of Scope

- Strava description posting (myWindsock does this; we show it in-app only)
- Per-segment wind map visualisation
- Forecast wind impact for future rides (separate feature)
- Non-cycling activity types (runs, swims)
