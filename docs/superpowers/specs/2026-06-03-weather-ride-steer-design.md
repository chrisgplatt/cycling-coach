# Weather-Aware Indoor/Outdoor Ride Steer — Design

**Date:** 2026-06-03
**Status:** Approved (design), pending implementation plan

## Goal

Fold a same-day weather forecast into the morning briefing so the coach can
recommend whether to take today's planned ride **outdoors** or onto the
**indoor trainer**, based on the athlete's location and the planned session
type. Weather is an *additive* signal: any failure (no location set, API
unavailable, malformed data) degrades silently and the briefing generates
exactly as it does today.

## Decisions (locked during brainstorming)

| Question | Decision |
|----------|----------|
| Location source | Manual setting — athlete types a town/city (or postcode), we geocode to lat/long once and store it |
| Indoor-vs-outdoor decision | Claude judges from forecast + planned workout (no fixed thresholds) |
| Weather API | Open-Meteo — free, no API key, metric units |
| UI surfacing | Forecast strip on TodayCard **plus** the steer woven into the coach note |

## Non-Goals (YAGNI)

- Hourly / time-of-day targeting. The app does not store session start times,
  so we use the **daily** forecast summary.
- Multi-day weather outlook for upcoming sessions. Today only.
- Browser geolocation or pulling location from intervals.icu.
- Weather influencing plan generation or weekly review. Briefing only.
- Weather affecting the **readiness verdict** — the verdict stays purely
  physiological (HRV + planned intensity). Weather colours the note prose only.

---

## Architecture

Weather is fetched at briefing-generation time, on the **morning path only**
(not post-ride or post-race), and only when the athlete has a stored location.
The fetched `WeatherSummary` is:

1. passed into the briefing `ctx` so Claude can reason about it,
2. persisted into the existing `daily_briefings` cache row, and
3. returned in the briefing API response so the TodayCard can render the strip.

```
Settings (one-time)          Morning briefing (per day)
─────────────────            ──────────────────────────
type place → geocode         profile has lat/lon?
  → pick match                 │ yes
  → store lat/lon/label        ▼
                             fetchDailyForecast(lat,lon,today,tz)  ──► null on any error
                               │
                               ▼
                             ctx.weather ──► generateMorningBriefing
                               │                   │
                               │                   ▼ Claude: note + (unchanged) verdict
                               ▼
                             persist weather in daily_briefings
                               │
                               ▼
                             API returns { ...briefing, weather }
                               │
                               ▼
                             TodayCard renders <WeatherStrip>
```

---

## Data Model

### Migration A — `user_profile`

```sql
alter table user_profile add column if not exists location_label text;
alter table user_profile add column if not exists latitude double precision;
alter table user_profile add column if not exists longitude double precision;
```

- `location_label` — resolved display name from the geocoder, e.g. `"Bristol, England"`.
- `latitude` / `longitude` — decimal degrees used for the forecast call.

### Migration B — `daily_briefings`

```sql
alter table daily_briefings add column if not exists weather jsonb;
```

Stores the `WeatherSummary` for that day so the strip renders from cache and
Claude's note stays consistent with what the athlete sees. No backfill needed
(null = no weather, renders nothing).

---

## Types (`types/index.ts`)

```ts
export interface WeatherSummary {
  temp_min_c: number
  temp_max_c: number
  precip_prob_pct: number   // daily max precipitation probability (0–100)
  wind_max_kph: number      // daily max sustained wind
  gust_max_kph: number      // daily max wind gust
  weather_code: number      // WMO weather interpretation code
  description: string        // human label derived from weather_code, e.g. "Heavy rain"
}

export interface GeocodeMatch {
  label: string             // e.g. "Bristol, England, United Kingdom"
  latitude: number
  longitude: number
}
```

- Add `weather?: WeatherSummary | null` to `BriefingContext`.
- Add `location_label?: string`, `latitude?: number`, `longitude?: number` to
  `UserProfile`.

---

## Module: `lib/weather/`

### `open-meteo.ts`

**`geocodeLocation(query: string): Promise<GeocodeMatch[]>`**
- Calls `https://geocoding-api.open-meteo.com/v1/search?name=<query>&count=5&language=en&format=json`.
- Maps each result to `{ label, latitude, longitude }`. `label` is composed from
  `name`, `admin1` (region/state), and `country`, joined with `", "`, skipping
  blanks.
- Returns `[]` on network error, non-OK status, or missing/empty `results`.

**`fetchDailyForecast(lat, lon, dateStr, tz): Promise<WeatherSummary | null>`**
- Calls
  `https://api.open-meteo.com/v1/forecast?latitude=<lat>&longitude=<lon>&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,weather_code&timezone=<tz>&start_date=<dateStr>&end_date=<dateStr>`.
- Open-Meteo defaults: temperature °C, wind km/h — no unit params needed.
- Reads index `0` of each `daily` array. Returns a `WeatherSummary` with
  `description` from `describeWeatherCode(weather_code)`.
- Returns `null` on network error, non-OK status, or any missing/non-numeric
  field. (`precipitation_probability_max` can be `null` from Open-Meteo —
  treat as `0`.)

**`describeWeatherCode(code: number): string`**
- Pure mapping of WMO codes to short labels. Coverage:
  - 0 → "Clear"; 1–3 → "Partly cloudy"; 45/48 → "Fog";
  - 51/53/55 → "Drizzle"; 56/57 → "Freezing drizzle";
  - 61 → "Light rain"; 63 → "Rain"; 65 → "Heavy rain";
  - 66/67 → "Freezing rain";
  - 71 → "Light snow"; 73 → "Snow"; 75 → "Heavy snow"; 77 → "Snow grains";
  - 80/81 → "Rain showers"; 82 → "Heavy showers";
  - 85/86 → "Snow showers";
  - 95 → "Thunderstorm"; 96/99 → "Thunderstorm with hail";
  - unknown → "Unknown".

### `format.ts`

**`formatWeatherForPrompt(w: WeatherSummary): string`**
- Returns a single prompt line, e.g.:
  `"Weather today: 8–14°C, 75% chance of rain, wind to 22 km/h gusting 38 km/h (Heavy rain)."`
- Rounds all numbers to whole values.

---

## Briefing Prompt (`lib/claude/briefing.ts`)

### `SYSTEM_MORNING` — add one instruction

Append guidance: when weather information is provided, weigh today's conditions
against the **planned session type** and give a clear indoor (trainer) vs
outdoor steer — e.g. precision threshold/VO2 intervals in strong wind or heavy
rain favour the trainer for execution quality; easy Z2 in light rain is fine
outdoors; genuinely nasty conditions (storm, ice, heavy snow) → trainer or
reschedule. Keep it to one sentence in the note, and only raise it when the
conditions actually change the advice — do not comment on benign weather.

**Explicit constraint in the prompt:** weather must **not** change the readiness
verdict; the verdict reflects physiological readiness only.

### `generateMorningBriefing` — include the weather line

When `ctx.weather` is present, add a `Weather: <formatWeatherForPrompt(...)>`
line to the prompt body. When absent, omit the line entirely (no "no weather"
placeholder).

---

## Route Wiring

Three handlers generate the morning briefing and must be updated identically:

- `app/api/briefing/today/route.ts`
- `app/api/cron/daily-briefing/route.ts`
- `app/api/cron/test/route.ts`

For each:

1. Add `location_label, latitude, longitude` to the `user_profile` select.
2. On the **morning path only** (i.e. not `workoutCompleted` and no race
   result) and when `latitude`/`longitude` are both set:
   `weather = await fetchDailyForecast(lat, lon, today, tz)` wrapped so any
   throw yields `null`.
3. Set `ctx.weather = weather`.
4. Include `weather` in the `daily_briefings` upsert payload.
5. Return `weather` in the JSON response.

**Cached path (`briefing/today` when `refresh !== true`):** add `weather` to the
cached select and include it in the cached response so the strip renders without
regenerating.

---

## Settings UI — Location

A "Location for weather" control in the existing settings form:

- Text input + **Find** button. Find calls a new server route
  `GET /api/profile/geocode?q=<query>` which proxies `geocodeLocation` and
  returns `{ matches: GeocodeMatch[] }`. (Server-side keeps fetch/parse
  consistent and avoids client CORS variance.)
- Renders up to 5 matches as selectable rows. Selecting one stores
  `location_label`, `latitude`, `longitude` via the existing profile save path.
- When a location is already saved, show `location_label` with **Change** and
  **Clear** affordances (Clear nulls all three columns).
- Mobile-first: full-width input, ≥44px touch targets, match rows stack
  vertically.

If the geocoder returns no matches (e.g. a raw UK postcode it can't resolve),
show "No matches — try a nearby town or city name."

---

## UI — Weather Strip

**`components/WeatherStrip.tsx`** (new, presentational):

- Props: `weather: WeatherSummary`.
- Compact non-interactive single row: a weather glyph derived from
  `weather_code`, temp range (`8–14°C`), rain chance (`75% rain`), and gust
  (`gusts 38 km/h`).
- `data-testid="weather-strip"`.
- Mobile-first: wraps gracefully at 320px; no hover dependence.

**`components/TodayCard.tsx`:**

- Read `weather` from the briefing response/cache (alongside the existing
  `verdict`/`headline`/`coach_note` caching).
- Render `<WeatherStrip weather={weather} />` when `weather` is present, near the
  coach note. Render nothing when absent.

---

## Error Handling

Weather is strictly additive and never blocks the briefing:

| Failure | Behaviour |
|---------|-----------|
| No location stored | Skip forecast; `ctx.weather = null`; no strip |
| Geocoder error / no matches (settings) | Show "no matches" message; nothing saved |
| Open-Meteo down / timeout / non-OK | `fetchDailyForecast` returns `null`; briefing proceeds |
| Malformed / missing forecast fields | `fetchDailyForecast` returns `null` |
| `precipitation_probability_max` null | Treated as `0` (still a valid summary) |

No new secrets or environment variables (Open-Meteo is keyless).

---

## Testing

- `__tests__/lib/open-meteo.test.ts`:
  - `fetchDailyForecast` maps a representative Open-Meteo daily JSON to a
    `WeatherSummary`; returns `null` on empty/malformed payloads; treats null
    precip probability as `0`.
  - `geocodeLocation` maps results to `GeocodeMatch[]`, composes `label`
    correctly (skipping blank `admin1`), returns `[]` on empty/error.
  - `describeWeatherCode` returns expected labels across the code ranges and
    "Unknown" for unmapped codes.
  - (Fetch is mocked — no live network calls in tests.)
- `__tests__/lib/weather-format.test.ts`:
  - `formatWeatherForPrompt` renders the expected single line and rounds values.
- Briefing prompt test (extend existing briefing tests):
  - Weather line present in the prompt when `ctx.weather` is set, absent when
    `null`.
  - Readiness verdict is unaffected by weather presence.
- Component test for `WeatherStrip` following existing component-test patterns
  (renders temp range, rain %, gust; `data-testid` present).

---

## File Summary

**Create:**
- `lib/weather/open-meteo.ts`
- `lib/weather/format.ts`
- `app/api/profile/geocode/route.ts`
- `components/WeatherStrip.tsx`
- `supabase/migrations/20260603_weather_location.sql` (user_profile columns)
- `supabase/migrations/20260603_briefing_weather.sql` (daily_briefings column)
- Tests as listed above.

**Modify:**
- `types/index.ts` — `WeatherSummary`, `GeocodeMatch`, `BriefingContext.weather`, `UserProfile` location fields.
- `lib/claude/briefing.ts` — `SYSTEM_MORNING` guidance + weather line in `generateMorningBriefing`.
- `app/api/briefing/today/route.ts` — fetch/persist/return weather (incl. cached path).
- `app/api/cron/daily-briefing/route.ts` — fetch/persist/return weather.
- `app/api/cron/test/route.ts` — fetch/persist/return weather.
- `components/TodayCard.tsx` — render `<WeatherStrip>` from cached/returned weather.
- Settings page/component — location control.
