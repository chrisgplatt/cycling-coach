# Bike & Component Tracking Design

**Date:** 2026-10-04
**Status:** Draft — awaiting review

## Problem

The app has no concept of which bike a ride was done on, or of the components (chain, cassette, tyres, pads…) fitted to it. Intervals.icu activities synced into `ICUActivity` carry no gear field, and nothing in the schema, types or UI refers to bikes. The athlete wants to know when a part needs attention — the motivating example is re-waxing a chain every N km — without tracking the numbers by hand.

## Scope decisions (from brainstorming)

- **Purpose:** both a per-bike mileage log *and* component maintenance reminders. Components belong to bikes; each ride adds usage to the components on its bike.
- **Ride → bike linking:** default bike, with indoor rides (`is_indoor`) automatically assigned to a designated trainer bike, and a manual per-ride override. No dependence on intervals.icu/Garmin gear data (the synced activity type has none).
- **Usage is derived on read** (not stored as counters). Usage for a component or trigger is a date-ranged sum over `workouts`, so re-syncs, backfills, deletions and bike re-assignment stay correct automatically and "installed on" / "waxed on" can be back-dated.
- **Metrics:** distance (km) and moving time (hours). Elevation can be added later by extending the `metric` enum.
- Single-user app: no bike sharing.

## Data model

New migration `supabase/migrations/20261004_bikes_components.sql` — idempotent (`create table if not exists`, `add column if not exists`), RLS policies matching the other user-owned tables, ending with `notify pgrst, 'reload schema';`. Per AGENTS.md it must be run manually against the shared Supabase project before the app version that depends on it ships.

### `bikes`
| Column | Notes |
|--------|-------|
| `id` | uuid pk |
| `user_id` | owner |
| `name` | display name |
| `kind` | `road \| gravel \| mtb \| trainer \| other` |
| `is_default` | exactly one per user (partial unique index where true) |
| `is_indoor_default` | at most one per user (partial unique index where true) — the trainer bike |
| `retired_at` | nullable timestamp; archived bikes are hidden from pickers but keep history |

### `bike_components`
| Column | Notes |
|--------|-------|
| `id` | uuid pk |
| `bike_id` | FK → `bikes`, cascade |
| `name` | e.g. "KMC X11 chain" |
| `category` | `chain \| cassette \| chainring \| tyre \| brake_pads \| cables \| bar_tape \| other` |
| `installed_at` | date; usage lower bound |
| `retired_at` | nullable date; usage upper bound |

### `component_triggers`
| Column | Notes |
|--------|-------|
| `id` | uuid pk |
| `component_id` | FK → `bike_components`, cascade |
| `label` | e.g. "Re-wax", "Replace chain" |
| `kind` | `recurring \| lifetime`. `recurring` counts from `last_done_at` and resets on "Mark done" (re-wax, service). `lifetime` always counts from the component's `installed_at` (wear/replacement limit); it has no "Mark done" and clears only when the component is replaced |
| `metric` | `km \| hours` |
| `interval_value` | numeric > 0 |
| `last_done_at` | date, nullable; only used by `recurring` triggers, treated as the component's `installed_at` when null |
| `heads_up_notified_at` | nullable timestamp; set when the ≥80% heads-up push is sent |
| `due_notified_at` | nullable timestamp; set when the ≥100% due push is sent |

Both notification timestamps are cleared by "Mark done" (recurring triggers). A `lifetime` trigger's are never cleared — replacing the component retires it and its copy starts with both null.

### `workouts`
Add `bike_id uuid references bikes(id) on delete set null` (nullable) plus an index on `(bike_id)`.

## Ride → bike resolution

A pure function `resolveBikeForRide({ isIndoor }, bikes)` in `lib/gear/`:

1. If `isIndoor` and a non-retired bike has `is_indoor_default` → that bike.
2. Else the non-retired `is_default` bike.
3. Else `null`.

It is called where `workouts` rows are created or matched to a ride: `importUnplannedRides` (`lib/intervals/import-rides.ts`) and the planned-workout match path (`lib/sync/match-workouts.ts`). It sets `bike_id` only when currently null, so a manual override is never overwritten by a re-sync. Changing the default bike affects only rides imported afterwards.

**Backfill:** when the athlete creates their first bike, offer "Assign your existing N rides to this bike?" with an optional "from date" bound. Backfill applies the same resolution function to rides with a null `bike_id`.

## Usage and trigger progress (derived on read)

`lib/gear/usage.ts` exposes pure functions over a list of rides `{ date, distance_m, moving_s, bike_id }`:

- `componentUsage(component, rides)` → `{ km, hours }` for rides on the component's bike with `installed_at <= date <= (retired_at ?? ∞)`.
- `triggerProgress(trigger, component, rides)` → `{ used, interval, fraction, status }` summing the trigger's metric from `last_done_at ?? installed_at` for `recurring` triggers, and from `installed_at` for `lifetime` triggers. `status` is `ok` (<80%), `due_soon` (≥80%), `overdue` (≥100%).
- `bikeTotals(bike, rides)` → lifetime km and hours.

API routes load the user's rides once (`workouts` columns needed for distance/time/date/`bike_id`) and call these functions; no per-component queries.

## API

New routes under `app/api/gear/` (auth and error handling matching existing routes):

- `GET /api/gear` → bikes with components, triggers, computed usage and trigger progress.
- `POST/PATCH/DELETE /api/gear/bikes[/id]` — create, edit, set default / trainer, archive.
- `POST/PATCH /api/gear/components[/id]`; `POST /api/gear/components/[id]/replace` — retires the component and creates a fresh one on the same bike with copies of its triggers (`last_done_at` null).
- `POST/PATCH/DELETE /api/gear/triggers[/id]`; `POST /api/gear/triggers/[id]/done` — recurring triggers only (400 for `lifetime`); sets `last_done_at` (default today, optional back-date) and clears `heads_up_notified_at` and `due_notified_at`.
- `POST /api/gear/backfill` — assigns bikes to rides with null `bike_id`.
- `PATCH /api/workouts/[id]/bike` — manual ride override (a dedicated route, so it can't be clobbered by sync-driven workout updates).

## UI (mobile-first, per AGENTS.md)

- **Trigger presets:** adding a component offers category presets, e.g. chain → "Re-wax" (`recurring`, 300 km) + "Replace chain" (`lifetime`, 4,000 km); cassette → "Replace" (`lifetime`); tyres → "Replace" (`lifetime`). Values are editable defaults.
- **`/settings/gear`**, linked from the settings page (sibling of `/settings/usage`; no new NavBar item).
  - Bike list: card per bike with name, default/trainer badge, lifetime km and hours.
  - Bike detail: component list with usage since install; each trigger as a progress bar ("Re-wax: 212 / 300 km"), amber at ≥80%, red when overdue.
  - Actions in bottom sheets (`items-end sm:items-center`, `max-h-[92vh] overflow-y-auto`, ≥44px targets): add bike, add component (category presets), add trigger, Mark done (recurring triggers only; optional back-date), Replace, Set as default / trainer bike, archive.
- **Ride detail:** a "Bike: X" chip with a picker to override the ride's bike.
- **Dashboard:** due-soon/overdue triggers shown via the existing `NotificationBanner` ("Chain re-wax due — 312 / 300 km").

## Reminders

After a sync imports rides, evaluate the triggers on the affected bikes (all kinds: re-wax, service, replacement) with `triggerProgress`. Each trigger sends at most two pushes per cycle via `lib/push.ts`:

- **Heads-up** at ≥80% (`status` `due_soon`) when `heads_up_notified_at` is null, e.g. "Chain re-wax coming up — 245 / 300 km". Sets `heads_up_notified_at`.
- **Due** at ≥100% (`overdue`) when `due_notified_at` is null, e.g. "Chain re-wax due — 312 / 300 km". Sets `due_notified_at`.

The 80% threshold is the same one the progress bar uses for amber, so the UI and the push agree. If a single sync jumps a trigger from below 80% straight past 100%, only the due push is sent and `heads_up_notified_at` is set too, so no stale heads-up follows. Pushes for several triggers from one sync are sent individually (one per trigger). "Mark done" re-arms a recurring trigger for the next cycle.

## Edge cases

- Deleting a bike sets `bike_id` null on its rides (they count towards nothing); archiving via `retired_at` is the preferred, history-preserving path.
- Rides with a null `bike_id` (pre-setup, or no default bike) are simply not counted.
- Deleting the only default bike is blocked; archiving a default bike requires choosing a new default.
- Retired components stop accruing usage but remain visible in history.

## Testing

- Unit: `resolveBikeForRide` (indoor / default / none / retired bikes), usage aggregation (date bounds, retired components, null `bike_id`), trigger progress thresholds, `last_done_at` fallback, `lifetime` triggers ignoring `last_done_at`, and notification selection (heads-up at 80%, due at 100%, skipped heads-up on a jump, no repeats, re-arm on Mark done).
- API route tests for CRUD, replace, mark-done, backfill and the ride override, in the style of `__tests__/api`.
- Sync test: `importUnplannedRides` sets `bike_id` and does not overwrite an existing one.
- `npm run typecheck` before every commit.

## Out of scope

Coach/Claude prompt integration (no change to the training rules in CLAUDE.md), automatic bike detection from intervals.icu/Garmin gear, maintenance cost tracking, sharing bikes between users, elevation as a trigger metric.
