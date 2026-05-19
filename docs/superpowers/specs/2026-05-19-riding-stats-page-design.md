# Riding Stats Page — Design Spec

## Goal

Add a dedicated Stats page showing aggregated riding metrics from the last 28 days: best power at 5/10/20 minutes, total distance, total elevation, total duration, and average L/R balance.

## Architecture

A new vertical slice with minimal impact on existing code:

- `app/stats/page.tsx` — new client page
- `app/api/stats/route.ts` — new API route
- `lib/intervals/client.ts` — extend `getActivities()` to map three new fields
- `types/index.ts` — add fields to `ICUActivity`, add `RidingStats` interface
- Bottom nav component — add Stats tab

---

## Data Layer

### `ICUActivity` additions

Three new optional fields added to the existing interface:

| Field | Type | intervals.icu API field | Notes |
|---|---|---|---|
| `distance` | `number \| null` | `distance` | metres |
| `total_elevation_gain` | `number \| null` | `total_elevation_gain` | metres |
| `left_right_balance` | `number \| null` | `left_right_balance` | left % as float, e.g. `52.3` |

`getActivities()` in `IntervalsClient` maps these three fields alongside existing ones. No existing callers are affected — all three are additive.

### New `RidingStats` interface

```ts
export interface RidingStats {
  ride_count: number
  total_distance_km: number
  total_elevation_m: number
  total_duration_secs: number
  power_5min: number | null
  power_10min: number | null
  power_20min: number | null
  avg_left_right_balance: number | null  // left %, e.g. 52.3
}
```

---

## API Route — `GET /api/stats`

No query parameters. Authenticated.

**Steps:**
1. Auth check → 401 if unauthenticated
2. Fetch `user_profile` (athlete_id, api_key) → 400 if not configured
3. Compute date range: today and 28 days prior (YYYY-MM-DD)
4. Fire `getActivities(oldest, newest)` and `getPowerCurve(oldest, newest)` in parallel
5. Filter activities to `type` matching `/ride/i`
6. Compute aggregates from filtered rides:
   - `ride_count` — count
   - `total_distance_km` — sum of `distance` ÷ 1000
   - `total_elevation_m` — sum of `total_elevation_gain` (nulls treated as 0)
   - `total_duration_secs` — sum of `moving_time`
   - `avg_left_right_balance` — mean of non-null `left_right_balance` values; `null` if none present
7. Look up power curve for target durations using nearest-point search (within ±30 s):
   - `power_5min` — target 300 s
   - `power_10min` — target 600 s
   - `power_20min` — target 1200 s
   - Returns `null` if no point within ±30 s exists
8. Return `{ stats: RidingStats }`

**Error response shape:** `{ error: string }` with appropriate HTTP status.

---

## Stats Page — `app/stats/page.tsx`

Client component. Fetches `/api/stats` on mount.

### States

- **Loading** — spinner centred on page (same style used elsewhere in the app)
- **Error** — error message displayed
- **Loaded** — stats rendered

### Layout (loaded state)

**Header**
- Title: "Stats"
- Subtitle: "Last 28 days"

**Power section** (three cells in a row, MetricsBar style)
- 5 min power — watts, `—` if null
- 10 min power — watts, `—` if null
- 20 min power — watts, `—` if null

**Totals section** (three cells in a row)
- Distance — `X.X km` (one decimal place)
- Elevation — `X m` (rounded to integer)
- Duration — `Xh Ym` format (e.g. `4h 32m`)

**Balance row** (single full-width cell)
- When data present: `52% L / 48% R` (right % = 100 − left %)
- When null: `—`

---

## Navigation

Add a fourth tab to the bottom nav bar:
- Label: "Stats"
- Icon: bar chart (matching icon style of existing tabs)
- Route: `/stats`

Position the tab after Dashboard (second position). The implementer should read the existing nav component to determine the correct slot.

---

## Error Handling

- intervals.icu unavailable: propagate the error string from `IntervalsClient`, display on the stats page
- Missing profile config: show "intervals.icu not configured" message
- Empty rides array (no rides in 28 days): all totals are 0, power values are null — page renders normally with `—` for power and balance

---

## Testing

- Unit test for the nearest-point power curve lookup function (exact match, nearest within tolerance, outside tolerance returns null)
- Unit test for `avg_left_right_balance` computation (all null → null, mix → correct mean)
- Integration test for `GET /api/stats` with mocked `IntervalsClient`: happy path returns correct aggregates, unauthenticated returns 401, unconfigured profile returns 400
