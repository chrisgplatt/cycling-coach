# Champion-Records Storage & Deep-History Bests Design

**Date:** 2026-07-21
**Status:** Approved

## Problem

The all-time bests feature currently aggregates live from `workouts.activity_metrics` on every request. This only ever covers rides that have been imported as `workouts` rows — and the only mechanism that imports historical rides caps out at ~13 weeks back. As a result, bests only reflect the last few months of riding, not the years of history that actually exist in the user's intervals.icu account. Naively fixing this by importing full historical ride rows into `workouts` would duplicate a large amount of data that already lives in intervals.icu, just to support a handful of "best" numbers.

## Scope decisions (from brainstorming)

- **Replace, don't layer.** The live `workouts`-scan aggregation is replaced entirely by a small, incrementally-maintained "champion records" table — the single source of truth for bests going forward. There is exactly one aggregation mechanism, not two to keep in sync.
- **Storage stays tiny regardless of history depth.** Only the current best ("champion") per category per period is stored — never per-ride data. Total row count is roughly (years of history) × (~13 categories), so even a decade of riding is only ~130 rows.
- **History depth is unbounded** — the new deep-history job keeps going back until intervals.icu stops returning data, or the user decides to stop. There's no way to definitively detect "the true start of history" (a quiet year looks the same as the actual beginning), so this is a judgment call left to the user, not something the system claims to know for certain.
- **Chunked and resumable**, mirroring every other backfill button already in this app: each click processes a bounded batch and remembers where it left off via a stored cursor, rather than restarting or requiring one long-running request.
- **Links go to intervals.icu, not an in-app modal.** Every ride that ever contributes to a best always has an intervals.icu activity ID, whether or not it also has a local `workouts` row — so the external link (`https://intervals.icu/activities/{icu_activity_id}`, the exact pattern already used in `WorkoutDetailModal`/`EventDetailModal`) always works. The richer in-app option (opening the ride's own detail view when it happens to exist locally) is deferred — it would require new "fetch a workout by ID" plumbing that doesn't exist anywhere in the app yet, and isn't needed for the external link to work universally.

## Architecture

### New table: `best_records`

A generic key-value "champion" store — one row per (period, category, sub-key) combination:

```sql
create table best_records (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  period text not null,          -- 'all' or a 4-digit year, e.g. '2024'
  category text not null,        -- 'biggest_climb' | 'longest_climb' | 'power' | 'speed' | 'max_speed'
  sub_key text,                  -- e.g. '300' (secs) for power, '10' (km) for speed; null for climbs/max_speed
  value numeric not null,        -- the comparable metric (elev_gain_m / length_km / watts / speed_kmh)
  detail jsonb not null,         -- date, icu_activity_id, workoutId (if any), and category-specific fields
  updated_at timestamptz default now(),
  unique(user_id, period, category, sub_key)
);
```

### Read side

`/api/bests` no longer scans `workouts`. It selects the rows for the requested period(s) from `best_records` and reassembles them into the existing `AllTimeBests`/`AllTimeBestsResponse` shape. The UI (`AllTimeBestsTab.tsx`) is unaffected — same response shape in, same rendering out — plus one small addition: each `detail` now carries `icuActivityId`, so every rendered entry gets a "View on intervals.icu →" link.

### Write side — all three paths reuse the existing, already-tested reducer

`computeAllTimeBests()` (already shipped, reviewed, and merged) stays almost entirely as-is. Rather than writing new comparison logic, every write path reconstructs the currently-stored champions as small "synthetic rides" from their stored `detail`, appends the one new/candidate ride, and feeds `[synthetic champions..., new ride]` back through the same function — its output becomes the new stored champions. The reducer never needs to see more than a handful of rows at a time.

**1. One-time seed.** Runs `computeAllTimeBestsByPeriod()` once over the currently-enriched `workouts` rows — exactly the computation the feature already performs today — and persists its output into `best_records` instead of returning it live.

**2. Incremental update going forward.** Whenever a ride's `activity_metrics` is (re)computed — via normal sync enrichment or the existing metrics-version backfill — that ride's candidates are merged into `best_records` using the synthetic-champions-plus-one-ride reduction above.

**3. New deep-history batch job.** The only genuinely new mechanism:
- A stored cursor (a date), defaulting to the oldest ride currently in `workouts`, so it never wastes calls re-covering ground normal sync/import already handles.
- Each click: one `getActivities` call spanning a wide window up to the cursor, sorted newest-first, taking the next 25 rides older than the cursor (mirroring this app's existing `BACKFILL_LIMIT` convention).
- For each of those rides: fetch streams + that day's power curve (the same two calls `enrichActivity` already makes elsewhere) — no FTP or profile context needed, since none of the bests-relevant detections require it. Run the existing `detectClimbs`/`detectSpeedBests`/best-effort-sampling logic purely in memory. **The ride itself is never written anywhere** — not to `workouts`, not to any new table — only the merged champion values are persisted.
- Advances the cursor to the oldest processed ride's date and reports progress. Fewer than 25 (or zero) results prompts a "looks like you may have reached the start of your history — stop here, or click again to check further back" message, rather than a definitive claim.
- A new button on the Settings page, matching the existing backfill buttons' style and behavior exactly.

## Files to change

| File | Change |
|---|---|
| `supabase/migrations/` | New migration — `best_records` table, plus a new `deep_history_bests_cursor date` column on `user_profile` (a single-row-per-user settings table already holding other per-user singleton state, e.g. FTP/weight/timezone) for the deep-history job's cursor |
| `lib/ride/best-records.ts` (new) | Synthetic-ride reconstruction from stored `detail`; merge-one-ride-into-champions helper (wraps `computeAllTimeBests`); read/write helpers for the table |
| `lib/ride/all-time-bests.ts` | `AllTimeBests` entry shapes gain `icuActivityId`; `computeAllTimeBests`/`computeAllTimeBestsByPeriod` otherwise unchanged — reused, not rewritten |
| `app/api/bests/route.ts` | Rewritten to read from `best_records` instead of scanning `workouts` |
| `app/api/admin/backfill-bests-seed/route.ts` (new, one-time) | Runs the seed migration |
| `lib/intervals/enrich.ts` | Hook: after computing/updating a ride's `activity_metrics`, also merge its candidates into `best_records` |
| `lib/intervals/deep-history-bests.ts` (new) | The cursor-based, chunked deep-history scan |
| `app/api/admin/backfill-deep-history-bests/route.ts` (new) | Route triggering one chunk of the deep-history scan |
| `components/DailyBriefingCard.tsx`, `app/settings/page.tsx` | New button for the deep-history job, matching the existing backfill buttons' pattern |
| `components/AllTimeBestsTab.tsx` | Add the "View on intervals.icu →" link per entry |
| Tests | Cover: synthetic-ride reconstruction round-trips correctly; merge-one-ride-into-champions correctly keeps the higher value and correctly seeds a category with no prior champion; the seed migration matches `computeAllTimeBestsByPeriod`'s existing output; the deep-history job's cursor advances correctly and never processes the same ride twice in one run; the new route's auth/config checks; the new button's presence/behavior; the intervals.icu link renders with the correct URL |

## Out of scope

- The in-app click-through modal (opening a local `workouts` row's own detail view from a Bests entry) — deferred, same as in the original design; the external intervals.icu link covers every entry regardless.
- Definitive "reached the true start of history" detection — the user decides when to stop running the deep-history job.
- Any change to the existing normal sync depth (6 weeks) or the existing `import-rides` mechanism (~13 weeks) — both continue exactly as today; the deep-history job is additive and purely for bests purposes, never writing `workouts` rows.
