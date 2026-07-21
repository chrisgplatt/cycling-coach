# Indoor/Outdoor Bests Split Design

**Date:** 2026-07-21
**Status:** Approved

## Problem

The all-time bests feature (`best_records`, read via `/api/bests`) currently has no concept of indoor vs. outdoor riding. Every ride — a real-world climb and a Zwift session alike — competes for the same climb/power/speed/max-speed records. This is wrong for at least speed and max-speed (a trainer's reported speed reflects game/simulation physics, not real-world pace) and arguably for climbs (a virtual gradient isn't a real ascent), and it means a genuine outdoor personal best can be silently overwritten by an indoor number that isn't comparable.

## Scope decision (from brainstorming)

- **Track both separately, not exclude indoor.** Every category (biggest/longest climb, power bests, speed bests, max speed) gets its own outdoor set and indoor set. Nothing is discarded — an indoor personal best still gets tracked — but the two never compete against each other.
- **UI: a toggle within the existing Bests tab**, next to the period selector, not separate tabs or a combined/badged view.

## Detection

`is_indoor` is derived as `activity.type === 'VirtualRide'` — the exact convention already used elsewhere in this codebase (e.g. `scripts/upload-zwift-activities.ts` sets `type: 'VirtualRide'` for indoor Zwift sessions). No new intervals.icu field is needed; `ICUActivity.type` is already fetched and mapped by `IntervalsClient`.

`is_indoor` is stored as a new field on `ActivityMetrics` itself (not as a new `workouts` table column), computed once inside `extractActivityMetrics` (`lib/claude/activity-metrics.ts`), which already receives the raw `ICUActivity` object with `.type` at the exact point it derives other Tier-1 fields like `max_speed_ms`. Storing it in the metrics JSON (rather than a separate column) means every read path that already consumes `activity_metrics` — resync's `workouts` scan, the incremental merge, the deep-history scan (all three already call or will call `extractActivityMetrics`) — gets `is_indoor` for free with no additional query.

`METRICS_VERSION` bumps from 5 to 6. This makes the already-built "Backfill all-time bests (climbs & speed)" Settings button (wired to `backfillActivityMetrics`, whose predicate already re-enriches any row with `metrics_version < METRICS_VERSION`) automatically re-enrich every historical ride and populate `is_indoor` — no new backfill mechanism is needed.

## Architecture

### `best_records` schema change

Add a new column, folded into the uniqueness key:

```sql
alter table best_records add column if not exists is_indoor boolean not null default false;
alter table best_records drop constraint if exists best_records_user_id_period_category_sub_key_key;
alter table best_records add constraint best_records_user_id_period_category_sub_key_is_indoor_key
  unique (user_id, period, category, sub_key, is_indoor);
```

(Exact constraint name to be confirmed against the original migration when written — Postgres auto-names unique constraints from column order, so the implementer must check the actual generated name from `20260721_best_records.sql` rather than assume it.)

Existing rows get `is_indoor = false` as a placeholder (not a claim of correctness) — the rollout's resync step (below) recomputes every row from scratch once `is_indoor` is actually available in `workouts.activity_metrics`, so the placeholder default is immediately superseded rather than left standing as stale data.

### Write side — same reducer, filtered inputs

`computeAllTimeBests` itself requires no changes — it already documents itself as "generic over whatever subset of rides it's given." Every write path now filters its ride set (or its fetched existing `best_records` rows) to one surface before calling it:

- **Resync** (`app/api/admin/resync-bests/route.ts`): after fetching `workouts` rows, partition them by `activity_metrics.is_indoor` before calling `computeAllTimeBestsByPeriod` — once for the outdoor subset, once for the indoor subset — and flatten/upsert both sets of rows (each tagged with its own `is_indoor`). Rows whose `activity_metrics` predates this feature (no `is_indoor` key at all, i.e. `undefined`) must be treated as outdoor (`false`), the same as the column's own default — this is a transient state that resolves itself once the backfill step (below) re-enriches every ride, not a case that needs special-casing beyond a `?? false`/truthy check.
- **Incremental merge** (`lib/intervals/enrich.ts`): the one new ride's candidate already carries `is_indoor` (from its `activity_metrics`). `fetchBestRecordRows` must be filtered to the SAME `is_indoor` value when fetching existing champions to reconstruct — an outdoor candidate must never see (or be compared against) indoor champions, and vice versa.
- **Deep-history scan** (`lib/intervals/deep-history-bests.ts`): identical shape — the candidate's `is_indoor` (from `extractActivityMetrics`, already called here) determines which surface's existing rows to fetch/merge/write.

### Read side

`/api/bests` changes shape from:
```ts
{ allTime: AllTimeBests; byYear: Record<string, AllTimeBests> }
```
to:
```ts
{
  outdoor: { allTime: AllTimeBests; byYear: Record<string, AllTimeBests> }
  indoor: { allTime: AllTimeBests; byYear: Record<string, AllTimeBests> }
}
```
Still a single fetch — no new round trip, no query params — matching the existing "fetch everything once, filter client-side" pattern the period selector already uses.

### UI

`AllTimeBestsTab.tsx` gains an Outdoor/Indoor toggle rendered next to the existing period-selector pills, same visual style (pill buttons, active state highlighted). Selecting a surface picks `data.outdoor` or `data.indoor`; the existing period logic (`allTime` vs `byYear[period]`) then applies underneath, unchanged.

## Rollout

No new admin buttons are needed — this reuses every control already built:

1. Run the migration (adds `is_indoor` to `best_records`).
2. Click **Backfill all-time bests (climbs & speed)** in Settings — the `METRICS_VERSION` bump makes it re-enrich every ride and populate `is_indoor` on each one's stored `activity_metrics`.
3. Click **Resync all-time bests from current rides** — recomputes `best_records` from scratch, now correctly split into outdoor/indoor.
4. Future **Scan further back in ride history** clicks carry the split forward automatically, since the deep-history scan already calls `extractActivityMetrics`.

## Out of scope

- Any UI distinction beyond the toggle (e.g. showing both side-by-side, or badging individual entries) — rejected in brainstorming in favor of a plain toggle.
- Any change to which activity types are considered "a ride" at all (the existing `/ride/i` filters used by import/deep-history are unaffected) — this only splits rides that already qualify as rides into outdoor/indoor.
- Any change to how climbs/speed/power are *detected* within a ride — only which bucket (outdoor vs indoor) the result is compared and stored under.
