# Ride Map + Synced Graph (and stream-derived coaching) — Design

**Date:** 2026-05-31
**Status:** Approved for planning

## Summary

Add a completed-ride visualisation — a full-screen route **map** with a **scrubbable multi-series graph** (power, HR, elevation) where a single cursor links the two: dragging the graph slides a marker along the route and updates a readout. The same intervals.icu **streams** that power the view are also mined, once at sync, for four short coaching insights stored alongside the existing `activity_metrics`.

Two consumers, one data source (intervals.icu activity streams), wired differently:

- **Visual view** — raw streams fetched **on demand** when a ride is opened, downsampled server-side, rendered, cached for the session. Nothing large is persisted.
- **Coach** — four **derived summaries** computed once at sync and stored in the existing `activity_metrics` JSONB blob, so they reach all four coaching surfaces with no new prompt plumbing.

This mirrors the established `activity_metrics` pattern: persist the small derived stuff, fetch the big raw stuff on demand.

## Decisions (locked)

| Decision | Choice |
|----------|--------|
| Purpose | Both a personal visual view **and** richer coach data |
| Coach insights | Aerobic decoupling/fade, climb efforts, time-in-zone, planned-vs-actual shape |
| Data architecture | Split: on-demand raw streams for the view; tiny derived summaries persisted at sync for the coach |
| Mobile layout | Map on top, scrubbable graph below (Layout A — the intervals.icu arrangement) |
| Map rendering | Leaflet + OpenStreetMap raster tiles (free, no API key) |
| Graph rendering | Custom lightweight SVG component, no new charting dependency |
| View placement | Dedicated full-screen page `app/ride/[workoutId]`, reached from the completed-ride modal |
| Default X axis | Distance (toggle to time) |

## Architecture & data flow

**Visual view:**
```
completed-ride modal → "View ride map →" → /ride/[workoutId]
  → GET /api/rides/[workoutId]/streams
      → look up workout → icu_activity_id
      → IntervalsClient.getActivityStreams(activityId)
      → downsample to ~600 points server-side
      → return { time, distance, latlng, power, hr, altitude, cadence?, velocity? }
  → RideMapGraph renders map (Leaflet) + graph (SVG), cursor-synced
```

**Coach:**
```
sync → backfillActivityMetrics (existing self-healing backfill)
  → enrichActivity(client, activity, ftp, plannedSteps)
      → existing: power curve + detected laps
      → NEW: getActivityStreams(activityId)
      → extractStreamInsights(streams, ftp, plannedSteps)
      → merge { decoupling_pct, climbs, time_in_zone, shape } into ActivityMetrics
  → store in workouts.activity_metrics
  → formatters surface it to dossier / chat / briefing / feedback
```

## Component 1 — Visual ride view

### Route
`app/ride/[workoutId]/page.tsx` — full-screen client page. Browser back/swipe dismisses it (preferred over an overlay for a PWA). The completed-ride detail modal (`components/WorkoutDetailModal.tsx`) gains a **"View ride map →"** button, shown only when `workout.icu_activity_id` is present and status is `completed`/`needs_review`.

### Data endpoint
`GET /api/rides/[workoutId]/streams`:
1. Authenticate user (`createSupabaseServerClient`, RLS-enforced).
2. Look up the workout by id; read `icu_activity_id`. 404 if missing or not owned.
3. Fetch the athlete's intervals.icu credentials (same path the sync/stats routes use).
4. `IntervalsClient.getActivityStreams(activityId)`.
5. **Downsample to ~600 points server-side** (even stride over the sample arrays, preserving index alignment across channels) so the payload is tens of KB.
6. Return `RideStreams`. Absent channels return `null` arrays/fields.

### `IntervalsClient.getActivityStreams(activityId)`
New method hitting the intervals.icu streams endpoint (`/activity/{id}/streams`; **exact path/shape verified as task #1**). intervals.icu returns a list of `{ type, data }` channels; normalise into:
```ts
interface RideStreams {
  time: number[]            // seconds from start
  distance: number[]        // metres
  latlng: [number, number][] | null   // null for indoor rides
  power: number[] | null
  hr: number[] | null
  altitude: number[] | null
  cadence: number[] | null
  velocity: number[] | null // m/s
}
```
Missing channels → `null`. Malformed response → throw (the route turns it into a friendly error).

### Components
- **`RideMapGraph`** (parent, client) — owns the single shared state `cursorIndex: number`. Renders the readout chip (time, distance, power, HR, elevation, + cadence/speed when shown) for the sample at `cursorIndex`.
- **`RouteMap`** — Leaflet map: draws the `latlng` polyline and a marker at `cursorIndex`. Must be dynamically imported client-side (`dynamic(() => …, { ssr: false })`) because Leaflet touches `window`.
- **`RideGraph`** — SVG: power/HR/elevation polylines on a shared X axis (distance default, time toggle), crosshair at `cursorIndex`. Pointer and touch drag set `cursorIndex` via an x→index mapping.

### Series
Power, HR, elevation shown by default. Cadence and speed available as **toggle chips**, shown only when that channel exists.

### Edge cases
- **Indoor / no GPS** (`latlng === null`): graph renders normally; map area shows a "No GPS recorded" placeholder.
- **No power** (HR-only ride): hide the power line; render the rest.
- **Stream fetch fails**: friendly error with a Retry button; the page still opens.
- **Workout with no `icu_activity_id`**: the "View ride map" button is not shown.

### Mobile
Map fixed height on top (~40% viewport), graph below, readout chip overlaid on the graph. Touch targets ≥44px. Tested mentally at 375px. Marker stays at last cursor position when the finger lifts.

## Component 2 — Stream-derived coaching insights

### New `ActivityMetrics` fields (all nullable)
```ts
decoupling_pct: number | null            // aerobic decoupling, % (positive = faded)
climbs: ClimbSegment[] | null
time_in_zone: { z1: number; z2: number; z3: number; z4: number; z5: number; z6: number } | null  // seconds
shape: Array<{ label: string; planned_w: number; actual_w: number }> | null  // structured rides only
```
```ts
interface ClimbSegment {
  start_km: number
  duration_secs: number
  elev_gain_m: number
  avg_watts: number | null
  vam: number            // vertical ascent metres / hour
}
```

### `extractStreamInsights(streams, ftp, plannedSteps)` — pure, in `lib/claude/activity-metrics.ts`
- **Decoupling:** split the ride into first/second half by time; ratio = avg(power)/avg(HR) per half; `decoupling_pct = (firstRatio − secondRatio) / firstRatio × 100`. Null if power or HR absent.
- **Time-in-zone:** bucket each power sample into Z1–Z6 by FTP boundaries (the project's existing zone definitions); sum the per-sample dt. Null if power absent.
- **Climbs:** detect sustained positive-gradient segments from `altitude`+`distance` (gradient over a minimum sustained duration threshold); per climb compute duration, elevation gain, avg power, VAM. Null if altitude absent or no climbs found.
- **Shape:** structured rides only (`plannedSteps` present). Walk the planned steps as consecutive time windows from ride start; for each, average the actual power over that window → `{ label, planned_w, actual_w }`. Null otherwise.

Pure and deterministic — unit-tested with synthetic streams, no network.

### FTP caveat
Zones use the athlete's **current** FTP at sync time; historical rides bucket against today's FTP. Acceptable for coaching context; documented in a code comment.

### Formatting (terse — protects the token budget)
- Extend `formatActivityMetrics` to append a compact insight line, e.g.:
  `decoupling 6.2% · Z2 68% Z3 22% Z4 8% · 2 climbs: 8min@268W, 12min@255W`
- The full per-step `shape` renders only in **single-ride** surfaces (feedback, briefing) via a dedicated formatter — **not** in the 90-day dossier list (which we recently had to fix for truncation).

### Surfaces
No new prompt wiring. The four surfaces already consume the `activity-metrics.ts` formatters: dossier synthesis, coach chat, post-ride briefing, feedback analysis. Enriching the formatter output enriches all four.

## Sync wiring

- `enrichActivity(client, activity, ftp, plannedSteps)` — new `ftp` and `plannedSteps` params; fetches streams; calls `extractStreamInsights`; merges into the returned `ActivityMetrics`.
- `backfillActivityMetrics` — add `steps` to its workout select; fetch `user_profile.current_ftp` once; pass both down per ride. Keep the existing `.is('activity_metrics', null)` idempotency filter.

### One-time deploy step
Because the idempotency filter skips already-enriched rows, after deploy run once so the next sync recomputes with streams:
```sql
update workouts set activity_metrics = null where activity_metrics is not null;
```

## Dependencies
- Add **`leaflet`** (+ `@types/leaflet`). Its CSS and default marker assets must be wired for Next 16 (import CSS; configure marker icon paths or use a divIcon).
- No charting dependency — graph is custom SVG.

## Testing
- **Pure functions (primary TDD target):** `extractStreamInsights` — decoupling, zone buckets, climb detection, planned-vs-actual alignment — with synthetic streams. Formatters — compact-line output and the single-ride shape formatter.
- **`getActivityStreams` normaliser:** against a captured sample intervals.icu payload (channels present, channels absent).
- **Graph math:** downsample (even stride, index alignment) and pointer-x→index mapping.
- **API route:** auth, 404 on missing activity, happy path shape.
- All new tests are additive; the known pre-existing failing suites are untouched.

## Risks
1. **Streams endpoint** — exact path and response shape are the one external unknown. **Verify against the live API as the first task** before building on the assumed shape. (An endpoint-path assumption bit this codebase before.)
2. **Leaflet + Next 16 SSR** — Leaflet requires `window`; the map component must be client-only via `dynamic(..., { ssr: false })`, with CSS and marker assets handled. Verified in the build.
3. **Indoor rides without GPS** are common (structured trainer sessions) — the map-absent path must be a first-class case, not an afterthought.

## Out of scope
- Persisting raw streams / offline ride viewing (rejected Approach 2).
- Live/in-progress ride view — completed rides only.
- Segment matching or social/leaderboard features.
