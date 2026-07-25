# Ride Medals Design

**Date:** 2026-07-25
**Status:** Approved

## Problem

The app has an all-time/per-year "champion records" system (`best_records`, see `2026-07-21-champion-records-bests-design.md`) with its own tab on the Stats page, but nothing connects it back to an individual ride. There's no way to look at a completed ride — on the dashboard, the calendar, or when you tap in for detail — and see that it set a record. The two systems (champion bests, ride views) don't talk to each other at all today.

## Scope decisions (from brainstorming)

- **Two placements, this pass:** the compact workout card (dashboard + calendar) and the ride detail modal (`WorkoutDetailModal`). The full activity log (`ActivityLogView`/`ActivityRow`) is out of scope for now — can be added later by reusing the same lookup.
- **Live-computed, never stored on the ride.** A medal is a *current* fact about `best_records`, not a permanent stamp — if a later ride beats a record, the earlier ride's badge must disappear. Storing a `medals` field on the ride at enrich time would require separately updating every ride that *loses* a record when a new one wins, which nothing today does or is designed to do. Computing live off `best_records` (already the single source of truth, already kept in sync by the existing merge/backfill/resync paths) avoids inventing a second invalidation mechanism.
- **Category granularity, not sub-key granularity.** `best_records` has 5 categories (`biggest_climb`, `longest_climb`, `power`, `speed`, `max_speed`), two of which (`power`, `speed`) are further split by `sub_key` (7 power durations, 4 speed distances). A ride's medal detail groups by category only — breaking both a 5-min and a 20-min power record on the same ride counts as one "power" entry, not two. Caps the maximum detail list at 5 entries per tier.
- **Card badge: tier-level only, not per-category.** The compact card shows at most two icons: 🏆 if the ride holds ≥1 all-time record (any category), 🥇 if it holds ≥1 year-best record not already covered by an all-time one for that same category. No category icons on the card — just "this ride's a big deal, tap in for what."
- **Both tiers are gold; the icon shape (not color) carries the distinction** — 🏆 trophy for all-time, 🥇 medal for year-best. (Earlier iterations considered gold/silver coloring and a custom lettered "AT"/"Y" coin; both were rejected in favor of reusing plain emoji with no new artwork.)
- **Detail modal: full breakdown with category labels.** Since there's room, each held category gets its own line: tier icon + category icon + label, e.g. "🏆 🏔️ All-time · Biggest climb", "🥇 ⚡ 2026 best · Power". Category icons reuse the existing 🏔️/⚡ convention already used for climbs/efforts in `RideHighlightsTab`; 📏 (longest climb), 🚀 (speed), 💥 (max speed) are new for this feature.
- **If a category is already all-time, it's not separately listed as year-best** — an all-time record is trivially also that year's best, so showing both would be redundant. The lookup itself excludes a category from the `year` list whenever it's present in `allTime`.
- **Indoor/outdoor is handled for free.** `best_records` already splits every category by `is_indoor`; a ride only ever appears in its own surface's rows, so no extra filtering logic is needed in the medals lookup — it just reads whatever rows exist.
- **No new endpoint response shape needed for indoor/outdoor** — the medals lookup is built directly from raw `best_records` rows (same shape `fetchBestRecordRows` already returns), not from the nested `AllTimeBestsResponse`/`IndoorOutdoorBestsResponse` the existing `/api/bests` route assembles for the Bests tab. Simpler to build and unit-test in isolation.

## Architecture

### New pure function: `lib/ride/ride-medals.ts`

```typescript
export type MedalTier = 'allTime' | 'year'

export interface MedalEntry {
  category: BestCategory   // reuse the existing type from lib/ride/best-records.ts
  subKey: string            // '' for climbs/max_speed; duration/distance for power/speed
}

export interface RideMedals {
  allTime: MedalEntry[]
  year: MedalEntry[]
}

// Builds a workoutId -> RideMedals lookup from a flat list of best_records rows
// (all periods, both surfaces, for one user). Rows with a null workoutId (deep-
// history champions with no local `workouts` row) are skipped — there's no card
// to attach a badge to. A category present in a ride's `allTime` list is excluded
// from that same ride's `year` list, even if the row exists for both periods.
export function buildMedalsByWorkoutId(rows: BestRecordRow[]): Record<string, RideMedals>
```

`BestRecordRow.detail.workoutId` is already `r.id` (the local `workouts.id`) whenever a ride went through the normal enrich/backfill/resync path — see the existing `flattenAllTimeBestsToRows`. Only deep-history-scan-only champions (never locally imported) have `workoutId: null`.

### New route: `GET /api/rides/medals`

Auth, then `select('period, category, sub_key, value, detail, is_indoor').eq('user_id', user.id)` from `best_records` (same query `/api/bests` already runs, minus the `AllTimeBests` reassembly), pass the rows through `buildMedalsByWorkoutId`, return the map as JSON. Small payload — `best_records` tops out around (years of history + 1) × 2 surfaces × ~13 category/sub-key rows, so on the order of a hundred rows even after years of use.

### New component: `components/RideMedals.tsx`

```typescript
export function RideMedalIcons({ medals }: { medals: RideMedals | null | undefined }): JSX.Element | null
// Renders 🏆 if medals.allTime.length > 0, 🥇 if medals.year.length > 0. Null if
// medals is null/undefined or both lists are empty. Used in WorkoutCard.

export function RideMedalList({ medals }: { medals: RideMedals | null | undefined }): JSX.Element | null
// Renders one line per entry across both tiers (allTime first), each with tier
// icon + category icon + human label. Null if nothing to show. Used in
// WorkoutDetailModal.
```

Category icon/label map (`CATEGORY_ICON`, `CATEGORY_LABEL`) lives in this file: `biggest_climb` → 🏔️ "Biggest climb", `longest_climb` → 📏 "Longest climb", `power` → ⚡ "Power", `speed` → 🚀 "Speed", `max_speed` → 💥 "Max speed".

### Wiring into existing components

- `components/WorkoutCard.tsx`: new optional prop `medals?: RideMedals | null`, rendered via `<RideMedalIcons medals={medals} />` next to the existing status chip, when `workout.status === 'completed' || workout.status === 'needs_review'` — matching the same predicate `backfillActivityMetrics` (`lib/intervals/enrich.ts`) uses to decide which rides get merged into `best_records` in the first place, so a "needs review" ride that already set a record isn't silently excluded from showing it.
- `components/WorkoutDetailModal.tsx`: new optional prop `medals?: RideMedals | null`, rendered via `<RideMedalList medals={medals} />` in the overview section.
- `app/dashboard/page.tsx`, `app/calendar/page.tsx`: one new `fetch('/api/rides/medals')` on load, stored as `medalsByWorkout: Record<string, RideMedals>` state, passed as `medals={medalsByWorkout[w.id] ?? null}` to every `WorkoutCard` and to `WorkoutDetailModal` for the selected workout — same pattern already used for `weatherByActivity`.

## Files to change

| File | Change |
|---|---|
| `lib/ride/ride-medals.ts` (new) | `buildMedalsByWorkoutId()`, `MedalEntry`/`RideMedals` types |
| `app/api/rides/medals/route.ts` (new) | Auth + fetch `best_records` + call the pure function |
| `components/RideMedals.tsx` (new) | `RideMedalIcons` (card), `RideMedalList` (modal), category icon/label maps |
| `components/WorkoutCard.tsx` | New `medals` prop, render `RideMedalIcons` |
| `components/WorkoutDetailModal.tsx` | New `medals` prop, render `RideMedalList` |
| `app/dashboard/page.tsx` | Fetch `/api/rides/medals`, thread `medals` prop through to cards + modal |
| `app/calendar/page.tsx` | Same wiring as dashboard |
| Tests | `buildMedalsByWorkoutId`: null-workoutId rows skipped, category dedup between tiers, multiple categories on one ride, empty input; `/api/rides/medals` route: auth, happy path; `RideMedals.tsx`: icon presence/absence, list rendering, label correctness; `WorkoutCard`/`WorkoutDetailModal`: medals prop renders/omits correctly |

## Out of scope

- Activity log (`ActivityLogView`/`ActivityRow`/`ActivityDetailModal`) — deferred; the same `/api/rides/medals` lookup can be reused there later with no changes to this design.
- Any change to how `best_records` itself is computed or maintained — this feature is read-only against that table.
- A one-time "you just got a medal!" toast/celebration at the moment of completion — the badge is a persistent, always-current indicator on the ride, not a one-off notification.
- Showing the underlying record value (e.g. the actual watts/km) in the medal badge/list itself — the ride's own stats already show its power/climb numbers elsewhere in the modal, and the full value is already visible on the Stats → Bests tab.
