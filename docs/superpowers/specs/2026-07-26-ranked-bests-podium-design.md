# Ranked Bests (Podium) Design

**Date:** 2026-07-26
**Status:** Approved

## Problem

`best_records` (and the ride medals feature built on top of it) only ever tracks the single current champion per (period, category, sub_key, is_indoor) slot. There's no way to see who holds 2nd or 3rd place, either on the Stats → Bests tab or as a badge on the ride that set it. The rider asked to extend both to a real top-3 podium.

## Scope decisions (from brainstorming)

- **Depth: exactly top 3** (gold/silver/bronze), not a configurable N. Simplest to reason about and display.
- **Applies to every category** — biggest climb, longest climb, every power duration, every speed distance, and max speed all get a top-3, not just the sub-keyed ones.
- **Applies to both tiers** — all-time and per-year both go to top-3, consistent with how both tiers are already computed identically today.
- **Ties** are not specially handled — real power/speed data essentially never produces an exact tie; a tie breaks by date (earlier ride wins), which falls out naturally from a stable sort with no extra code.
- **No new backfill mechanism.** The existing "Resync bests" admin action already wipes and recomputes `best_records` from scratch by scanning every `workouts` row, and it already resets the deep-history cursor to `null` so that scan restarts too (see `app/api/admin/resync-bests/route.ts`). Once the reducer is podium-aware, re-running those two existing buttons (already on the Settings page from the original champion-records feature) correctly backfills 2nd/3rd place for the rider's whole history — no new route, no new UI, no new script.
- **Ride medal badges extend to show rank**, not just the Bests tab. Rank 1 keeps today's exact look (🏆 all-time, 🥇 year-best, no visual change). Ranks 2/3 reuse the same tier icon with a rank suffix (`🏆 2`, `🏆 3`, `🥇 2`, `🥇 3`) rather than repurposing 🥈/🥉, which would clash — 🥇 already means "year tier" here, not "1st place in general," so a literal silver/bronze medal emoji would be read as a rank by anyone unfamiliar with this app's specific convention.
- **Card badge stays tier-level, now picking the best rank.** Still max 2 icons on the compact card (one per tier) — a ride holding both all-time #1 (climb) and all-time #3 (power) still shows a single `🏆`, not two. The card shows the *best* (lowest-numbered) rank the ride holds in each tier, collapsed across categories, same as today's presence-only rule.
- **Detail modal:** rank-1 lines are unchanged text ("All-time · Biggest climb"); rank 2/3 append the number ("All-time #2 · Power 5 min").
- **"Don't double-list" rule generalizes, not changes key.** If a ride holds *any* all-time podium spot (1st/2nd/3rd) for a (category, sub_key), it's excluded from that same combo's year list — same exclusion key as today (`category:sub_key`), no rank-awareness needed in the exclusion check itself. This still holds mathematically: a ride in the all-time top-3 for a slot is guaranteed to also be in *its own year's* top-3 for that slot (at most 2 rides are ever faster, so at most 2 could also crowd it out of its own year — meaning it can be no worse than that year's #3, i.e. always present), so the row genuinely exists for both periods and would double-list without this exclusion.
- **Bests tab layout: keep the big #1 tile, expand for 2nd/3rd.** Zero visual change to the current at-a-glance view (same big-number tiles). Tapping a tile reveals 2nd and 3rd place beneath it. Chosen over redesigning every tile as an always-visible 3-row list, which would make the already-dense power/speed grid (up to 11 tiles) noticeably taller and busier.

## Architecture

### Schema migration

New migration, following the exact idiom of `20260721_best_records_is_indoor.sql` (find the old constraint dynamically by column set, not by a guessed name — this repo has no linked Supabase CLI to confirm the real production constraint name ahead of time):

```sql
alter table best_records add column if not exists rank integer not null default 1;

-- Drop the old 5-column unique constraint (user_id, period, category, sub_key, is_indoor),
-- found dynamically by column set.
do $$
declare
  old_constraint_name text;
begin
  select c.conname into old_constraint_name
  from pg_constraint c
  where c.conrelid = 'best_records'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname::text order by a.attname)
      from unnest(c.conkey) as k(attnum)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    ) = array['category', 'is_indoor', 'period', 'sub_key', 'user_id']
  limit 1;

  if old_constraint_name is not null then
    execute format('alter table best_records drop constraint %I', old_constraint_name);
  end if;
end $$;

-- Add the new 6-column unique constraint (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'best_records'::regclass
      and conname = 'best_records_user_id_period_category_sub_key_is_indoor_rank_key'
  ) then
    alter table best_records add constraint best_records_user_id_period_category_sub_key_is_indoor_rank_key
      unique (user_id, period, category, sub_key, is_indoor, rank);
  end if;
end $$;

notify pgrst, 'reload schema';
```

Existing rows get `rank = 1` as a placeholder (they *are* the current champion, i.e. correctly rank 1) — superseded once the rider clicks "Resync bests" after deploying, same rollout shape as the is_indoor migration.

### Reducer: `lib/ride/all-time-bests.ts`

`AllTimeBests`'s single-object-or-null fields become arrays of up to 3 ranked entries, sorted best-first. Power/speed stay flat arrays (one entry per (duration-or-distance, rank) pair, each entry carrying both) rather than nesting by duration — simpler to compute, simpler to flatten to DB rows 1:1, and the UI groups by duration/distance at render time (a trivial reduce):

```typescript
export interface RankedEntry {
  rank: 1 | 2 | 3
  workoutId: string | null
  icuActivityId: string
  date: string
}

export interface AllTimeBests {
  biggestClimb: (RankedEntry & { elev_gain_m: number; length_km: number | null })[]
  longestClimb: (RankedEntry & { length_km: number; elev_gain_m: number })[]
  powerBests: (RankedEntry & { secs: number; watts: number })[]
  speedBests: (RankedEntry & { distance_km: number; avg_speed_kmh: number })[]
  maxSpeed: (RankedEntry & { speed_kmh: number; max_speed_ms: number })[]
}
```

A single generic helper replaces the "track one running max" logic:

```typescript
const PODIUM_SIZE = 3

// Inserts candidate into existing (already sorted best-first, length <= 3),
// re-sorts by value descending, keeps only the top 3. Rank (1-3) is assigned
// by final array position when the caller materializes it, not stored here.
function insertRanked<T>(existing: T[], candidate: T, valueOf: (t: T) => number): T[] {
  return [...existing, candidate]
    .sort((a, b) => valueOf(b) - valueOf(a))
    .slice(0, PODIUM_SIZE)
}
```

`computeAllTimeBests` uses `Map<string, T[]>` (keyed by duration/distance for power/speed; a single fixed key for climbs/max-speed) accumulating via `insertRanked`, then flattens each map's values to the final arrays with `rank` assigned by position (index + 1) in the last step.

`computeAllTimeBestsByPeriod` is unchanged — it only wraps `computeAllTimeBests` and has no shape assumptions of its own.

### Write/read side: `lib/ride/best-records.ts`

- `BestRecordRow` gains `rank: number`.
- `reconstructSyntheticRides` needs **no change** — it already maps each row independently into its own synthetic ride (`rows.map(r => ({...}))`), with no assumption that only one row exists per category. Re-running the (now podium-aware) `computeAllTimeBests` over `[...every stored row as a synthetic ride, candidate]` naturally recomputes the correct new top-3.
- `flattenAllTimeBestsToRows` changes from "one row per category" to "one row per (category, sub_key, rank)" — loops each category's array and pushes one row per entry, carrying its `rank`.
- `assembleAllTimeBests` (the read-side inverse) changes from "set the single value" to "push into the array," then sorts each array by `rank` ascending before returning.
- `fetchBestRecordRows`'s `.select(...)` gains `rank`; `upsertBestRecordRows`'s `onConflict` becomes `'user_id,period,category,sub_key,is_indoor,rank'`.
- `mergeCandidateIntoBests` is unchanged — it's a thin wrapper over the two functions above.

### Downstream — no changes needed

- `lib/intervals/enrich.ts` (normal sync merge), `lib/intervals/deep-history-bests.ts` (deep-history scan), and `app/api/admin/resync-bests/route.ts` all call only the shared functions above — none reimplement reducer or row-shaping logic, so all three automatically become podium-aware once `all-time-bests.ts`/`best-records.ts` are updated. Verified by reading each file's imports — no direct dependency on the old single-champion shape.

### Ride medals: `lib/ride/ride-medals.ts`

- `MedalEntry` gains `rank: 1 | 2 | 3`.
- `buildMedalsByWorkoutId` reads `r.rank` off each row into the pushed entry. The exclusion check (a (category, sub_key) already in `allTime` is skipped from `year`) keeps its current key — `category:sub_key`, not rank-specific — per the "generalizes, not changes" scope decision above.

### Display: `components/RideMedals.tsx`

- `RideMedalIcons` (card): picks the best (numerically lowest) `rank` across all entries in each tier's list, renders the tier icon alone for rank 1, or with a trailing rank number for 2/3 (e.g. `🏆 2`).
- `RideMedalList` (detail modal): each row's label gets `#{rank}` appended after the tier label when `rank > 1` — e.g. `All-time #2 · Power 5 min` vs. today's unchanged `All-time · Biggest climb` for rank 1.

### Display: `components/AllTimeBestsTab.tsx`

- `BestCell` (currently one big number + caption + link) becomes stateful: renders the rank-1 entry exactly as today, plus a tap target that expands to show rank 2 and 3 beneath it (same big-number style, smaller) once the array has more than one entry. Categories/durations with fewer than 3 recorded rides simply show what exists — no placeholder rows for missing ranks.
- `AllTimeBests`'s API response shape change (arrays instead of nullable singles) is the only breaking change `app/api/bests/route.ts` needs to pass through — the route itself has no reducer logic of its own, so no route changes beyond the type update.

## Files to change

| File | Change |
|---|---|
| `supabase/migrations/` | New migration — `rank` column + updated unique constraint (see above) |
| `lib/ride/all-time-bests.ts` | `AllTimeBests` fields become ranked arrays; `insertRanked` helper; `computeAllTimeBests` rewritten around it; `computeAllTimeBestsByPeriod` unchanged |
| `lib/ride/best-records.ts` | `BestRecordRow.rank`; `flattenAllTimeBestsToRows` and `assembleAllTimeBests` updated for per-rank rows; `fetchBestRecordRows`/`upsertBestRecordRows` column list and conflict target updated; `reconstructSyntheticRides`/`mergeCandidateIntoBests` unchanged |
| `lib/ride/ride-medals.ts` | `MedalEntry.rank`; `buildMedalsByWorkoutId` carries `rank` through; exclusion-key logic unchanged |
| `components/RideMedals.tsx` | `RideMedalIcons` picks best rank per tier for the card; `RideMedalList` appends `#{rank}` for 2nd/3rd |
| `components/AllTimeBestsTab.tsx` | `BestCell` (or a new component) gains expand-for-2nd/3rd behavior; consumes the new array-shaped `AllTimeBests` |
| `app/api/bests/route.ts` | Type-level pass-through only — no logic change, `AllTimeBests`'s shape change flows through automatically |
| Tests | `insertRanked`/`computeAllTimeBests`: top-3 ordering, 4th place dropped, ties broken by date, categories with <3 entries; `flattenAllTimeBestsToRows`/`assembleAllTimeBests`: round-trip through all 3 ranks; `buildMedalsByWorkoutId`: rank carried through, exclusion still keyed on category+sub_key regardless of rank; `RideMedals.tsx`: rank-1 unchanged text, rank 2/3 suffix, card picks best rank across categories; `AllTimeBestsTab`: expand reveals 2nd/3rd, collapse behavior, fewer-than-3 entries don't show placeholders |

## Out of scope

- Configurable podium depth (top-N beyond 3) — fixed at 3 for this pass.
- Any change to indoor/outdoor surface handling — already orthogonal, continues to work unchanged since each surface's rows are entirely independent.
- A dedicated "leaderboard" view beyond the existing Bests tab expand-in-place — no new page or route.
- Historical "who held 2nd/3rd at any point in time" — only the *current* top-3 is tracked, same "champions only go up, resync is the correction path" limitation the original champion-records design already accepted for rank 1.
