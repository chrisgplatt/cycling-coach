# All-Time Bests Design

**Date:** 2026-07-20
**Status:** Approved

## Problem

Ride highlights (climbs, efforts, sprints, personal bests) are computed and stored per-ride only, buried inside each workout's `activity_metrics` JSON. Even the existing "personal best" detection only checks a rolling 90-day window anchored to each ride's own date — it's never a true all-time record, and nothing aggregates or ranks across a rider's full history. There's no way to see "my biggest climb ever," "my fastest 10km," or "how does today's effort compare to my all-time best" anywhere in the app.

## Scope decisions (from brainstorming)

- Categories covered: biggest climb (elevation gain), longest climb (distance), power bests at the existing canonical durations (5s/15s/1m/5m/10m/20m/1h), fastest speed over fixed distance splits (1/5/10/20km), and all-time max speed.
- Longest climb is measured by **distance in km**, not duration — more intuitive cycling terminology, and the app doesn't currently record a climb's actual length.
- Speed splits are **1km, 5km, 10km, 20km** — a spread from short punchy efforts to longer sustained-speed stretches.
- Max speed is a **separate metric** from the distance splits: the single highest instantaneous speed ever recorded (e.g. on a fast descent), not a sustained average. The app already captures this per-ride from intervals.icu's own activity summary, so no new stream processing is needed for this one.
- Climbs also capture a **simplified GPS path** (not just start/end points) — laying groundwork for a *future* feature that would match "the same climb" across different rides. Endpoint-only capture was considered but rejected: the climb-detection algorithm's grade-window boundary can shift slightly between attempts at the same physical hill, so a full (downsampled) path gives a much more robust fingerprint for that future matching work than two bare coordinates would. **This design only captures the data — actually matching/clustering climbs across rides, and any click-through UI to revisit a specific past effort, are explicitly deferred to a future pass**, to be revisited later.
- The view lives as a **new tab on the existing Stats page** (alongside "This Year"/"Activity Log"/"28 Days"), not a standalone page — keeps all performance-comparison content in one place.
- Historical backfill uses the app's **existing generic mechanism**: bumping `METRICS_VERSION` and letting the already-built `?deep=1` sync sweep (in `lib/intervals/enrich.ts`) reprocess every past ride that lacks the new fields. No new admin route needed.
- Bests entries show their date as plain text in v1 — no click-through to reopen the source ride (that would require fetching the full ride object just for this tab). Confirmed as an explicit, intentional deferral to revisit later, not an oversight.

## Architecture

### New per-ride fields (require backfill)

Two new capabilities don't exist in any form today and need new detection logic at sync time:

**`ClimbSegment` gains two fields** (`types/index.ts`):
```ts
export interface ClimbSegment {
  start_km: number
  duration_secs: number
  elev_gain_m: number
  avg_watts: number | null
  vam: number
  length_km: number                    // NEW — climb's actual distance covered
  path: [number, number][] | null      // NEW — simplified polyline (max 12 points), null for indoor/no-GPS rides
}
```
`detectClimbs()` (`lib/claude/activity-metrics.ts`) gains a `latlng: [number, number][] | null` parameter alongside its existing `altitude`/`distance`/`power`/`time` args. For each detected climb it already knows the start/end sample indices — `length_km` is `(distance[end] - distance[start]) / 1000`, and `path` is `latlng[start..end]` downsampled to a maximum of 12 points via a new small helper, `downsamplePoints<T>(points: T[], maxPoints: number): T[]`, added alongside the existing `downsampleStreams` in `lib/intervals/streams.ts` (same stride-based approach, generalized to a single array instead of a whole multi-channel `RideStreams` object). `path[0]`/`path[path.length - 1]` serve as the climb's start/end coordinates — no separate endpoint fields needed. Both new fields are `null`/absent gracefully for indoor rides (`latlng` is already `null` there).

**New `ActivityMetrics` field for speed splits:**
```ts
export interface SpeedBest {
  distance_km: number      // 1, 5, 10, or 20
  avg_speed_kmh: number
  start_km: number         // where along the ride this split began
  duration_secs: number
}
```
A new `detectSpeedBests()` function (same file, same style as `detectClimbs`) takes each target distance and, for each, finds the fastest (minimum-duration) contiguous stretch of the ride covering exactly that distance — a two-pointer sweep over the monotonic `distance`/`time` streams, mirroring `detectClimbs`'s existing forward-window technique. A split is skipped entirely if the ride's total distance doesn't reach that target. Added to `ActivityMetrics` as `speed_bests: SpeedBest[] | null`.

Both additions are wired into `extractStreamInsights()` and roll into a single `METRICS_VERSION` bump (`lib/claude/activity-metrics.ts`) — the existing backfill pipeline (`backfillActivityMetrics` in `lib/intervals/enrich.ts`, triggered via `/api/sync?deep=1`) automatically reprocesses every historical ride whose `metrics_version` is behind, exactly as it has for every prior metrics addition. No new admin route or UI is needed for this.

### Categories needing no new fields (pure aggregation)

Three categories already have everything they need in existing `activity_metrics` data, with no backfill required at all:
- **Biggest climb** — max `climbs[].elev_gain_m` across all rides.
- **Power bests** — max watts per duration across all rides' `best_efforts` arrays.
- **Max speed** — max `max_speed_ms` across all rides (already populated from intervals.icu's activity summary since this field was first added).

### Aggregation layer

A new pure module, `lib/ride/all-time-bests.ts` (mirrors `lib/ride-highlights.ts`'s per-ride view-model pattern, but aggregates across rides):

```ts
export interface AllTimeBests {
  biggestClimb: { workoutId: string; date: string; elev_gain_m: number; length_km: number } | null
  longestClimb: { workoutId: string; date: string; length_km: number; elev_gain_m: number } | null
  powerBests: Array<{ secs: number; watts: number; workoutId: string; date: string }>
  speedBests: Array<{ distance_km: number; avg_speed_kmh: number; workoutId: string; date: string }>
  maxSpeed: { workoutId: string; date: string; speed_kmh: number } | null
}

export function computeAllTimeBests(
  rides: Array<{ id: string; date: string; activity_metrics: ActivityMetrics | null }>
): AllTimeBests
```
A single pass over all rides tracks running maxima per category, remembering which ride each came from.

### API

A new `app/api/bests/route.ts` GET route: auth-checked (same pattern as other routes), queries `workouts` for the current user (`status in (completed, needs_review)`, `activity_metrics is not null`, no date bound — full history, matching the app's realistic scale of ~150-300 rides/year for a single athlete), runs `computeAllTimeBests()`, returns JSON. Computed live per request with no caching table, consistent with how `/api/charts` and `/api/stats` already work at this data volume.

### UI

A new tab (`'bests'`) added to the existing tab bar in `app/stats/page.tsx`, alongside `'year'`/`'log'`/`'28d'`. Following the same lazy-mount-per-tab pattern already used there (`ActivityLogView` only mounts and fetches when its tab is active) — a new self-contained `AllTimeBestsTab` component does its own `useEffect` fetch of `/api/bests` on mount.

Layout reuses the existing `SectionCard`/`StatCell` primitives from `components/RideStats.tsx` (same visual language as the current 28-day "Best Power" card):
- **Biggest Climb** — elevation gain (big number, "m") + caption "length_km km · date"
- **Longest Climb** — length (big number, "km") + caption "elev_gain_m m gain · date"
- **Power Bests** — a row of cells per canonical duration, watts + date caption (all-time version of the existing 28-day card's layout)
- **Speed Bests** — a row of cells per distance split, km/h + date caption
- **Max Speed** — single stat, km/h + date caption

Sections with no data (e.g. no climbs ever detected) are hidden, matching the existing "hide if absent" convention already used on this page (`hasBest`/`hasSpeed` in `RideStats.tsx`).

## Files to change

| File | Change |
|---|---|
| `types/index.ts` | Add `length_km`/`path` to `ClimbSegment`; add new `SpeedBest` interface; add `speed_bests` to `ActivityMetrics` |
| `lib/claude/activity-metrics.ts` | `detectClimbs()` gains `latlng` param + `length_km`/`path` computation; new `detectSpeedBests()`; wire both into `extractStreamInsights()`; bump `METRICS_VERSION` |
| `lib/intervals/streams.ts` | New `downsamplePoints<T>()` generic helper |
| `lib/ride/all-time-bests.ts` | New — `AllTimeBests` type + `computeAllTimeBests()` pure aggregator |
| `app/api/bests/route.ts` | New — GET route returning `AllTimeBests` for the current user |
| `components/AllTimeBestsTab.tsx` | New — self-fetching tab content component |
| `app/stats/page.tsx` | Add `'bests'` tab to the tab bar and render branch |
| Tests | Cover: `detectClimbs`'s new `length_km`/`path` output (including the no-GPS/indoor-ride null case); `detectSpeedBests` (including the "ride too short for this split" skip case); `computeAllTimeBests`'s aggregation across multiple rides; the new tab's rendering (data present / absent-section-hidden / fully-empty states) |

## Out of scope

- **Matching/clustering the same physical climb across different rides** — this design only captures the geographic fingerprint (`path`) needed for that; the matching algorithm itself (proximity/shape comparison, tolerance thresholds) is a distinct future feature, explicitly deferred.
- **Click-through from a bests entry to reopen its source ride** — deferred by explicit choice, to be revisited in a future pass. Entries show date as plain text only in this version.
- Any change to the existing per-ride Highlights tab, the 90-day personal-bests detection, or the 28-day rolling "Best Power" card on the Stats page — all three continue to work exactly as they do today, unaffected by this addition.
- Any new admin UI for triggering the backfill — the existing `?deep=1` sync mechanism already covers it.
