# Ride Highlights Design

**Date:** 2026-07-19
**Status:** Approved

## Problem

After a ride or workout, the app already computes several stream-derived "coaching insight" tiers server-side at sync time (`workouts.activity_metrics`) — including climb detection — but none of it is ever rendered in the UI. It's used exclusively to build prompt text for the AI coach (`formatActivityMetrics`/`formatClimbsBrief` in `lib/claude/activity-metrics.ts`). Riders get no in-app callout of notable moments in a completed ride: long/steep climbs, sustained hard efforts, sprint power, or personal bests. This project surfaces that (and extends it) as a new "Highlights" tab on the existing ride/workout detail modals.

## Scope decisions (from brainstorming)

- **Four highlight types for v1**: climbs, high-power/effort periods, sprints, personal bests.
- **Both detail modals**: `WorkoutDetailModal` (plan-linked workouts) and `ActivityDetailModal` (unlinked activities).
- **Computed and persisted at sync time**, same pattern as climbs — not computed on-demand when the modal opens.
- **Effort-period threshold**: Z4+ (≥91% FTP), sustained.
- **Sprints**: reuse existing per-ride `best_efforts` data (5s/15s), not bespoke spike detection.
- **Personal bests**: rolling 90-day comparison window, not all-time (no new aggregation/caching infrastructure required).
- **Highlights tab layout**: single chronological list, ordered by ride position; only appears when there's at least one highlight (no empty-state UI).
- **Backfill**: retroactively applied to all historical rides via the existing self-healing `metrics_version` mechanism.

## Data model

New types in `types/index.ts`, alongside the existing `ClimbSegment`:

```typescript
export interface EffortPeriod {
  start_km: number
  duration_secs: number
  avg_watts: number
  zone: 'z4' | 'z5' | 'z6'   // zone of avg_watts/ftp, via the existing zoneOf() thresholds
}

export interface RideSprint {
  duration_secs: number   // 5 or 15
  watts: number
}

export interface PersonalBest {
  duration_secs: number   // one of the existing CANONICAL_SECS (5,15,60,300,600,1200,3600)
  watts: number
  window_days: number      // 90, for the UI to label it correctly
}
```

`ActivityMetrics` (types/index.ts:524-552) gains three new nullable fields, following the exact convention of the existing Tier-4 fields (`climbs`, `time_in_zone`, `shape` — each independently null when it can't be computed):

```typescript
effort_periods: EffortPeriod[] | null
sprints: RideSprint[] | null
personal_bests: PersonalBest[] | null
```

## Detection algorithms

All added to `lib/claude/activity-metrics.ts`, in the "Stream-derived insights" section alongside `detectClimbs`/`computeTimeInZone`.

**Climbs** — reused as-is. `detectClimbs` is unchanged; zero new code.

**Effort periods** — new `detectEffortPeriods(power, time, ftp)`, mirroring `detectClimbs`'s contiguous-run grouping technique but operating on power instead of altitude:
- First computes a 30-second centred rolling average of the power stream. Raw per-second power is too noisy for direct threshold classification — a single second of soft-pedalling mid-interval would fragment one hard block into several tiny ones. 30s smoothing matches the same convention Normalized Power itself is built on.
- Classifies each (smoothed) sample as "in effort" when `zoneOf(smoothed / ftp)` is `'z4'`, `'z5'`, or `'z6'` — reusing the existing `zoneOf()` classifier in the same file directly, rather than introducing a second, independently-tuned threshold constant that could drift out of sync with it (the CLAUDE.md doc states the Z4 boundary as "91%," but `zoneOf`'s actual code boundary is `> 0.90`, a known pre-existing 1%-ish documentation/code discrepancy noted during research — reusing `zoneOf()` means this detector always matches whatever the app's real zone boundaries are, wherever that ambiguity eventually gets resolved).
- Groups contiguous "in effort" runs; keeps ones lasting ≥180s (matching `detectClimbs`'s own `MIN_SECS`, for consistency between the two detectors).
- Emits `{ start_km, duration_secs, avg_watts, zone }` per qualifying run, where `zone` is `zoneOf(avg_watts / ftp)` (same classifier, applied to the run's average instead of each sample).
- Returns `null` when `power`, `time`, or `ftp` is unavailable — same degrade-gracefully pattern as `computeTimeInZone`.
- Called from `extractStreamInsights`, which already receives `ftp` and the full stream — no new inputs needed at that call site.

**Sprints** — no new stream algorithm. `extractActivityMetrics` (where `best_efforts` is already computed from the day's power curve) additionally picks out the 5s and 15s entries and maps them to `RideSprint[]`. These two durations were chosen because `RideStats`/`rideStatsFromMetrics` already surfaces 1/5/10/20-minute bests elsewhere in the Stats tab — 5s/15s are the two canonical durations currently shown nowhere in the UI, so this is new information, not a duplicate stat. `best_efforts` carries no timestamp, so sprint entries have no ride position (reflected in the unified list ordering below).

**Personal bests** — new `detectPersonalBests(rideBestEfforts, ninetyDayCurve)`, a pure comparison function. For each of the ride's `best_efforts` entries, find the nearest point in `ninetyDayCurve` at that duration (reusing the existing `sampleBest`-style nearest-point lookup already used to build `best_efforts` itself); if the ride's watts at that duration equal the curve's max at that duration, it's a PB (the curve necessarily includes this ride's own data, since the window ends on the ride's date, so equality means this ride currently holds the best in the window). Only qualifying durations are emitted — same "only emit if it clears the bar" convention as climbs.

## Where it's computed

`extractStreamInsights` (called from `enrichActivity`) gains `effort_periods` in its return tuple, alongside `climbs`/`time_in_zone`/`shape` — no new I/O, same inputs.

Sprints are derived inline in `extractActivityMetrics` — no new I/O.

Personal bests require one new network call per ride. `enrichActivity` (`lib/intervals/enrich.ts`) currently fetches `[curve, intervals, streams]` in parallel for the ride's single day. It gains a 4th parallel call:

```typescript
client.getPowerCurve(dateMinus90Days, date).catch(() => null)
```

matching the exact pattern already proven in `app/api/ftp/route.ts` (91-day window for FTP estimation). The result feeds `detectPersonalBests`; a failure leaves `personal_bests: null`, same graceful-degradation contract as every other tier.

**Cost tradeoff**: this adds one intervals.icu API call per ride enriched. For routine syncs (a handful of new rides/day) this is negligible. For the one-time `?deep=1` backfill sweep (up to 25 rides per run, per `BACKFILL_LIMIT`), it's 25 extra range-fetches per run — heavier than today's backfill, but bounded, capped, and resumable, matching the existing "one-time admin operation" shape already established for that sweep. No shared-curve caching is being built to optimize this; it's an accepted one-time cost.

## Backfill

No new infrastructure. `METRICS_VERSION` (`lib/claude/activity-metrics.ts`, currently `3`) bumps to `4`. The existing `backfillActivityMetrics` predicate (`metrics_version < METRICS_VERSION`) already re-enriches every row below the new version — 25 at a time on routine syncs, or in one sweep via the existing `/api/sync?deep=1` deep-backfill flag. This is the same mechanism that originally rolled out climbs/distributions; nothing new needs to be built for "backfill everything."

## API surface

**`WorkoutDetailModal`**: zero new fetches. `workout.activity_metrics` is already a prop passed down from the parent list/calendar fetch; the three new fields ride along automatically.

**`ActivityDetailModal`**: new route `app/api/rides/activity/[activityId]/highlights/route.ts`, a near-verbatim copy of the existing `app/api/rides/activity/[activityId]/distributions/route.ts` — same auth check (`supabase.auth.getUser()`), same lookup of the linked `workouts` row by `icu_activity_id`, returning:

```typescript
{ climbs, effort_periods, sprints, personal_bests }
```

pulled off that row's `activity_metrics`, each defaulting to `null` when absent. Fetched eagerly in a `useEffect` on mount, matching the existing distributions fetch's timing (not gated on tab selection).

## Unified ordering and rendering

New pure helper, `lib/ride-highlights.ts`:

```typescript
export type RideHighlightKind = 'climb' | 'effort' | 'sprint' | 'personal_best'

export interface RideHighlight {
  kind: RideHighlightKind
  start_km: number | null   // null for sprint/personal_best — no location data
  data: ClimbSegment | EffortPeriod | RideSprint | PersonalBest
}

export function buildHighlightList(metrics: {
  climbs: ClimbSegment[] | null
  effort_periods: EffortPeriod[] | null
  sprints: RideSprint[] | null
  personal_bests: PersonalBest[] | null
}): RideHighlight[]
```

Climbs and effort periods are merged into one list and sorted by `start_km` ascending — they're interleaved chronologically, and deliberately **not deduplicated** when they overlap (e.g. a hard effort partway up a climb produces both a climb card and an effort card; each is a genuinely distinct lens on the same stretch of the ride, not a redundant repeat). Sprints, then personal bests, are appended after — grouped at the tail rather than forced into arbitrary ride-position slots, since neither carries a `start_km`.

## UI

**Tab visibility**: `WorkoutDetailModal` computes `buildHighlightList(workout.activity_metrics)` synchronously during render and adds a `'highlights'` entry to its tab-switch union (`'overview' | 'stats' | 'map' | 'feedback'` → `+ 'highlights'`) and to the conditionally-built `tabs` array, only when the list is non-empty — same conditional-tab pattern already used for `hasRide`-gated Stats/Map. `ActivityDetailModal` does the same, but its list depends on the async `/highlights` fetch resolving first, so the tab appears a moment after the modal opens rather than being present immediately — a minor, accepted asymmetry (the existing `/distributions` fetch has the same characteristic today, and nothing currently depends on Stats being gated on it).

**New component**, `components/RideHighlightsTab.tsx`, taking `{ highlights: RideHighlight[] }` and rendering one card per entry:

- Climb: 🏔️ "km `{start_km}` · `{mm}`min · `{elev_gain_m}`m gain · `{avg_watts}`W avg · VAM `{vam}`"
- Effort: ⚡ "km `{start_km}` · `{mm}`min in `{ZONE label}` · `{avg_watts}`W avg"
- Sprint: 🏁 "`{duration_secs}`s · `{watts}`W"
- Personal best: 🏆 "`{duration label, e.g. '1min'}` power: `{watts}`W (`{window_days}`-day best)"

Single chronological list, matching the approved mockup. Mobile-first per project conventions (AGENTS.md): simple stacked cards, no fixed-width grid, 44px+ touch targets if any card becomes interactive (v1 cards are display-only, no tap action).

## Files to change

| File | Change |
|---|---|
| `types/index.ts` | Add `EffortPeriod`, `RideSprint`, `PersonalBest`; add `effort_periods`/`sprints`/`personal_bests` to `ActivityMetrics` |
| `lib/claude/activity-metrics.ts` | Add `detectEffortPeriods`, sprint extraction in `extractActivityMetrics`, `detectPersonalBests`; bump `METRICS_VERSION` to 4; wire new fields into `extractStreamInsights` |
| `lib/intervals/enrich.ts` | `enrichActivity` fetches a 90-day power curve alongside the existing day/intervals/streams calls; passes it into the new personal-bests detection |
| `lib/intervals/client.ts` | No change — `getPowerCurve` already supports arbitrary date ranges |
| `lib/ride-highlights.ts` | **New** — `buildHighlightList`, pure ordering/merging helper |
| `components/RideHighlightsTab.tsx` | **New** — renders the unified highlight list |
| `app/api/rides/activity/[activityId]/highlights/route.ts` | **New** — mirrors the existing `/distributions` route |
| `components/WorkoutDetailModal.tsx` | Add `'highlights'` tab, conditional on `buildHighlightList(...)` being non-empty |
| `components/ActivityDetailModal.tsx` | Add `'highlights'` tab + fetch, same conditional pattern |
| `__tests__/lib/activity-metrics.test.ts` | New tests for `detectEffortPeriods`, sprint extraction, `detectPersonalBests` |
| `__tests__/lib/ride-highlights.test.ts` | New tests for `buildHighlightList` ordering/merging |
| `__tests__/components/WorkoutDetailModal.test.tsx` | Update to cover the new tab's conditional visibility |
| `__tests__/components/ActivityDetailModal.test.tsx` | Update to cover the new tab + fetch |
| `__tests__/support/factories.ts` | Extend `makeActivityMetrics` with the three new fields (default null) |

## Out of scope

- **Live/in-progress highlight detection** — this is post-ride only, computed at sync time like every other Tier-4 insight. No real-time "you're in a climb right now" feature.
- **All-time personal bests** — deliberately scoped to a rolling 90-day window to avoid building new all-time aggregation/caching infrastructure. A future project could extend this if 90 days proves too narrow in practice.
- **Deduplicating overlapping climb/effort highlights** — both are shown even when they describe the same stretch of road; considered a feature (two lenses), not a bug, per the design above.
- **Highlight-level interactivity** (tap to jump to that point on the map, share a highlight, etc.) — v1 cards are display-only.
- **Bespoke sprint/spike detection with ride-position data** — v1 reuses `best_efforts`, which has no timestamp. A future iteration could add real spike detection if riders want to know *where* a sprint happened, not just *how hard*.
