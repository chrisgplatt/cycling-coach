# Completed Ride Speed & Temperature Stats Design

## Goal

Surface speed (average, maximum, elapsed time) and temperature (min, average, max) for completed rides in the shared `RideStats` component, so they appear everywhere ride stats are already shown: the stats/history page, the unlinked-ride detail modal, and the workout detail modal.

## Background

`components/RideStats.tsx` is a single shared component with two adapter functions:
- `rideStatsFromActivity(a: ICUActivity)` — used by `app/stats/page.tsx` and `components/ActivityDetailModal.tsx`, fed by activities fetched live from intervals.icu via `lib/intervals/client.ts`'s `mapActivity()`. Nothing is cached in Supabase for raw activities — the shape is defined entirely by `mapActivity()`.
- `rideStatsFromMetrics(m: ActivityMetrics, durationSecs, tss)` — used by `components/WorkoutDetailModal.tsx`, fed by the persisted `workouts.activity_metrics` JSONB column, computed at sync time by `lib/claude/activity-metrics.ts`'s `extractActivityMetrics()` from the same `ICUActivity` shape.

Both adapters produce a shared `RideStatsData` object that the `RideStats` component renders as a series of `SectionCard`s (Power, Best Power, Ride Totals, Heart Rate, L/R Balance), each hidden when its data is entirely absent, with individual `StatCell`s hidden when a single value is null. This hide-when-null convention is what makes it safe to add fields whose availability is uncertain (temperature, in particular).

Currently `ICUActivity` has no elapsed time, speed, or temperature fields — only `moving_time`, `distance`, `average_watts`, etc. `moving_time` on its own(what "Duration" in Ride Totals currently shows) doesn't distinguish stopped time from riding time.

**Per-project convention** (see project memory on intervals.icu field naming): intervals.icu's API doesn't always use the obvious field name — `average_watts` is actually `icu_average_watts`, for instance. Where this design assumes a raw field name, it must be verified against a live sync during implementation, not assumed from documentation or training data.

## Data Source Decision

Speed and elapsed time are standard Strava-style fields (unprefixed, matching the existing `moving_time`/`distance`/`total_elevation_gain` naming precedent, and this project's lap-level code already uses an unprefixed `elapsed_time` field) — high confidence.

Temperature is genuinely uncertain: it may not be exposed by intervals.icu's API at all, or only partially (e.g. average only, no min/max). The user chose **device-recorded temperature from intervals.icu** (matching how power/HR/speed work) over reusing the existing Open-Meteo-based `ActivityWeather` estimate (which is ambient weather at the ride's GPS/time, not what the rider's device recorded, and only available for outdoor GPS rides). If intervals.icu doesn't expose a given temperature field, that field's raw mapping resolves to `null` and the corresponding `StatCell` (or whole Temperature card, if all three are absent) simply doesn't render — no error, no placeholder text.

## Data Flow

1. **`types/index.ts`** — `ICUActivity` gains 5 new optional fields:
   - `elapsed_time?: number | null` (seconds)
   - `max_speed?: number | null` (m/s, raw from API)
   - `average_temp?: number | null` (°C)
   - `min_temp?: number | null` (°C)
   - `max_temp?: number | null` (°C)

   `ActivityMetrics` gains matching optional fields (Tier 1, alongside `avg_power`/`max_hr` etc.):
   - `elapsed_secs?: number | null`
   - `max_speed_ms?: number | null`
   - `avg_temp_c?: number | null`
   - `min_temp_c?: number | null`
   - `max_temp_c?: number | null`

   Average speed is **not** stored as a raw field on either type — it's derived at display time from `distance` / `moving_time` (already-trusted fields), avoiding any dependency on an unverified `average_speed` API field. This mirrors the existing derived-speed calculation in `lib/weather/activity-weather.ts`.

2. **`lib/intervals/client.ts`** — `mapActivity()` maps the 5 new raw API fields onto `ICUActivity`, defaulting to `null` when absent, following the exact pattern of every other field in that function (`(a.foo ?? null) as number | null`). Both `getActivities()` and `getActivity()` share this mapper, so list and single-activity fetches both pick up the new fields.

3. **`lib/claude/activity-metrics.ts`** — `extractActivityMetrics()` maps the new `ICUActivity` fields onto `ActivityMetrics`'s new fields (straight passthrough, same as `avg_power: act.average_watts ?? null`). `METRICS_VERSION` bumps from 2 to 3 — the existing backfill mechanism (documented in the file's header comment) re-enriches previously-synced `workouts.activity_metrics` rows whose stored version is below the new constant, so historical rides pick up the new stats without a manual migration or backfill script.

4. **`components/RideStats.tsx`**:
   - `RideStatsData` gains: `avgSpeedKph: number | null`, `maxSpeedKph: number | null`, `elapsedSecs: number | null`, `avgTempC: number | null`, `minTempC: number | null`, `maxTempC: number | null`.
   - `rideStatsFromActivity(a)`: `avgSpeedKph` computed as `(a.distance / 1000) / (a.moving_time / 3600)` when `a.distance != null && a.moving_time > 0`, else `null`. `maxSpeedKph` is `a.max_speed * 3.6` when present, else `null`. `elapsedSecs`, `avgTempC`, `minTempC`, `maxTempC` are direct passthroughs (`?? null`).
   - `rideStatsFromMetrics(m, durationSecs, tss)`: same derivation, using `m.distance_m` / `durationSecs` for average speed, and `m.max_speed_ms`, `m.elapsed_secs`, `m.avg_temp_c`, `m.min_temp_c`, `m.max_temp_c` for the rest.
   - **Ride Totals card**: existing row (Distance, Elevation, Duration) is unchanged. A new second row is added below it (bordered, same pattern as the Power card's optional w/kg row) containing a single "Elapsed" `StatCell`, shown only when `elapsedSecs !== null`, formatted with the existing `formatHrsMins`.
   - **New "Speed" card**: a `SectionCard` placed after Ride Totals, containing "Avg Speed" and "Max Speed" `StatCell`s (km/h, 1 decimal place, matching `ActivityWeatherPanel`'s existing speed formatting convention). The whole card is omitted when both `avgSpeedKph` and `maxSpeedKph` are null.
   - **New "Temperature" card**: a `SectionCard` placed after the Heart Rate card, containing "Min Temp", "Avg Temp", "Max Temp" `StatCell`s (°C, rounded to nearest whole number, matching `ActivityWeatherPanel`'s existing temperature formatting convention: `Math.round(...)`). Each `StatCell` is shown only when its own value is non-null; the whole card is omitted when all three are null.

## Error Handling

No new error paths — every new value follows the existing "null in, hidden in the UI" convention already used throughout `RideStats.tsx` for HR, L/R balance, and Best Power. No new API calls, no new database columns, no new loading states. Mapping a field that turns out not to exist in the live API response is a silent no-op (the field stays `null`, forever, for every ride), not a crash — acceptable given the explicit uncertainty flagged above, and easy to spot during manual verification.

## Testing

- `__tests__/lib/intervals.test.ts`: extend the existing `getActivities returns ICUActivity array` pattern (mock a raw activity fixture through `mockFetch`, call `client.getActivities()`, assert on the mapped result) with cases for the 5 new fields present, and a case confirming they default to `null` when absent from the raw response.
- `__tests__/lib/activity-metrics.test.ts`: extend `extractActivityMetrics` test coverage with the 5 new `ActivityMetrics` fields, and assert `METRICS_VERSION` is 3.
- `__tests__/components/RideStats.test.tsx`: extend both adapter tests (`rideStatsFromActivity`, `rideStatsFromMetrics`) with the new derived/passthrough fields, including the average-speed derivation math. Extend the render tests: the Speed and Temperature cards appear when data is present, and are absent (individually and as whole cards) when data is null — following the existing "hides X card when data is absent" test pattern in that file.
- No dedicated test file exists for `app/stats/page.tsx`, `ActivityDetailModal.tsx`, or `WorkoutDetailModal.tsx` (established codebase convention for large interactive components) — verified via typecheck + the `RideStats` test suite + manual reasoning, consistent with prior features in this codebase.

## Out of Scope

- Reusing or changing `ActivityWeather` / `ActivityWeatherPanel` — that pipeline stays as-is, serving its existing wind-analysis purpose. This design is entirely additive to `RideStats`.
- Any new Supabase migration — `activity_metrics` is a JSONB column; adding sub-fields needs no schema change, only the version-bump backfill already built into the sync pipeline.
- Imperial units (mph, °F) — the app is metric-only throughout (kph, °C, km); no toggle exists or is being added.
