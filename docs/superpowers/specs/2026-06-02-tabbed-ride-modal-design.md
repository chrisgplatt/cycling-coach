# Tabbed Ride/Workout Modal — Design

**Date:** 2026-06-02
**Status:** Approved (ready for implementation plan)

## Goal

When viewing a ride, surface its detail in a tabbed, near-full-height modal:
- **WorkoutDetailModal** (completed workout linked to a ride): tabs **Overview · Stats · Map**.
- **ActivityDetailModal** (unplanned ride): tabs **Stats · Map**.

Reuse existing surfaces: the stats page's per-ride cards for Stats, and `RideMapGraph`
for Map. Planned/unlinked workouts are unchanged (no tabs).

## Decisions (locked during brainstorming)

1. **Container:** a full-height bottom-sheet **modal** (not a route) — `items-end sm:items-center`, `max-h-[92vh]`. Reuses all existing modal action logic in place.
2. **Scope:** both modals get tabs.
3. **Stats tab:** matches the stats page per-ride view (Power / Best Power / Totals / HR / L-R). No time-in-zone/decoupling/climbs in v1.

## Context — what exists

- `components/WorkoutDetailModal.tsx` — centered `max-w-lg` dialog. Already fetches
  `/api/rides/${workout.id}/streams` in a `useEffect` for the planned-vs-actual overlay
  (state `actual`); that response is `{ streams, intervals }`. Has the action footer
  (reschedule, mark-missed, delete, link-event, chat, refresh-ICU) and an in-app
  "View ride map →" `Link` to `/ride/${workout.id}`.
- `components/ActivityDetailModal.tsx` — already a bottom sheet (`items-end sm:items-center`,
  `max-h-[92vh]`). Shows a small stats grid + a `Link` "View ride map →" to
  `/ride/activity/${activity.id}`. Props: `{ activity: ICUActivity; onClose }`.
- `app/stats/page.tsx` — defines local `RideView({ ride: ICUActivity })` (per-ride cards:
  Power [Avg/NP/TSS], Best Power [1/5/10/20], Ride Totals [dist/elev/duration], Heart
  Rate, L/R Balance), plus local helpers `StatCell`, `SectionCard`, `formatDuration`,
  and `AggregateView`. Already uses an underline tab bar for recent rides.
- `components/ride/RideMapGraph.tsx` — standalone, props `{ streams: RideStreams }`:
  Leaflet map (40vh) + cursor-linked chips + `RideGraph` + axis/series toggles. Handles
  no-GPS internally.
- `components/ride/RideDetailView.tsx` — page wrapper: fetches a `fetchUrl`, renders
  `RideMapGraph`. Used by `/ride/[workoutId]` and `/ride/activity/[activityId]`.
- Endpoints: `GET /api/rides/[workoutId]/streams` and
  `GET /api/rides/activity/[activityId]/streams` both return `{ streams }` (the workout
  one also returns `intervals`).
- Types: `ICUActivity` has `average_watts`, `weighted_average_watts` (NP),
  `training_load` (TSS), optional `power_1min/5min/10min/20min`, `distance`,
  `total_elevation_gain`, `moving_time`, `average_heartrate`, `left_right_balance`
  (left %), `name`. `Workout.activity_metrics: ActivityMetrics | null` carries
  `np`, `avg_power`, `max_power`, `avg_hr`, `distance_m`, `elevation_m`, `lr_balance`,
  `best_efforts: Array<{ secs; watts }>`.

## Architecture

### Unit 1 — `components/TabBar.tsx` (new, shared, presentational)

```ts
export interface TabDef { id: string; label: string }
export default function TabBar({ tabs, activeId, onSelect }: {
  tabs: TabDef[]; activeId: string; onSelect: (id: string) => void
}): JSX.Element
```
Renders the underline tab row styled like the stats page tabs (`border-b-2 -mb-px`,
active = `border-blue-500 text-blue-600`). Horizontally scrollable, `touch-action: pan-x`.
44px-tall touch targets.

### Unit 2 — `components/RideStats.tsx` (new; extracted from stats page)

Move `StatCell`, `SectionCard`, and the per-ride card layout here. Export:

```ts
export interface RideStatsData {
  avgWatts: number | null
  np: number | null
  tss: number | null
  best: { p1: number | null; p5: number | null; p10: number | null; p20: number | null }
  distanceM: number | null
  elevationM: number | null
  durationSecs: number
  avgHr: number | null
  lrBalanceLeft: number | null   // left %, e.g. 52.3
}

export function rideStatsFromActivity(a: ICUActivity): RideStatsData
export function rideStatsFromMetrics(
  m: ActivityMetrics, durationSecs: number, tss: number | null,
): RideStatsData
export default function RideStats({ data }: { data: RideStatsData }): JSX.Element
export { StatCell, SectionCard }   // re-exported so the stats page reuses them
```

- `RideStats` renders the same cards as today's `RideView`: **Power** (Avg W / NP / TSS),
  **Best Power** (1/5/10/20 — card hidden when all four are null), **Ride Totals**
  (Distance / Elevation / Duration), **Heart Rate** (hidden when null), **L/R Balance**
  (hidden when null). Same colours/markup as the current `RideView`.
- `rideStatsFromActivity`: direct field copy; `best` from `a.power_1min/5min/10min/20min`.
- `rideStatsFromMetrics`: `avgWatts=m.avg_power`, `np=m.np`, `tss` (arg),
  `best` looked up from `m.best_efforts` by `secs` (60→p1, 300→p5, 600→p10, 1200→p20;
  missing → null), `distanceM=m.distance_m`, `elevationM=m.elevation_m`, `avgHr=m.avg_hr`,
  `lrBalanceLeft=m.lr_balance`, `durationSecs` (arg).
- The stats page's `RideView` is replaced by `<RideStats data={rideStatsFromActivity(ride)} />`
  (it loses the `ride.name` line — that name now lives in the stats-page tab header
  already; keep the name line by leaving the existing `<p>` in the stats page around the
  component). `AggregateView` stays in the stats page, importing `StatCell`/`SectionCard`
  from `RideStats`.

### Unit 3 — `components/WorkoutDetailModal.tsx` (modify)

- Convert the container from a centered `max-w-lg` dialog to a bottom sheet:
  `fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4`; inner
  `w-full max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col`.
- Compute `hasRide = (status === 'completed' || status === 'needs_review') && !!icu_activity_id`.
- New state `const [tab, setTab] = useState<'overview' | 'stats' | 'map'>('overview')`.
- When `hasRide`, render `<TabBar>` (Overview/Stats/Map) below the header. When not,
  no tab bar; body is the Overview content as today.
- Body (scroll area) renders by `tab`:
  - `overview` → today's body (description, overlay, collapsible feedback, needs_review
    box, etc.). **Remove** the in-app "View ride map →" `Link` (the Map tab replaces it);
    keep the external "View completed activity in intervals.icu →" link.
  - `stats` → `workout.activity_metrics`
    ? `<RideStats data={rideStatsFromMetrics(activity_metrics, duration_minutes*60, tss)} />`
    : a muted "Ride stats not available yet." note.
  - `map` → the streams already fetched for the overlay: `streams ? <RideMapGraph streams={streams} /> : <loading/erro note>`. To make the streams reusable, store the
    fetched `streams` in state alongside `actual` (the overlay effect already fetches it;
    keep the `PlannedActual` build AND keep `streams` for the Map tab).
- Footer (actions) stays visible on all tabs (it is workout-level, not ride-level).

### Unit 4 — `components/ActivityDetailModal.tsx` (modify)

- Keep the bottom-sheet container; add `flex flex-col` and a tab bar.
- New state `const [tab, setTab] = useState<'stats' | 'map'>('stats')` and
  `const [streams, setStreams] = useState<RideStreams | null>(null)` + a load flag.
- `<TabBar>` with Stats/Map.
- `stats` → `<RideStats data={rideStatsFromActivity(activity)} />`.
- `map` → lazy-fetch `/api/rides/activity/${activity.id}/streams` on first switch to the
  Map tab (or on open); `streams ? <RideMapGraph .../> : <loading/error note>`.
- Remove the "View ride map →" link (replaced by the Map tab).

## Data flow

```
WorkoutDetailModal (hasRide)
  overview → existing body (overlay uses `actual`)
  stats    → rideStatsFromMetrics(workout.activity_metrics, …) → RideStats
  map      → streams (already fetched for overlay) → RideMapGraph

ActivityDetailModal
  stats → rideStatsFromActivity(activity) → RideStats
  map   → fetch /api/rides/activity/[id]/streams → RideMapGraph
```

## States & edge cases

| Condition | Behaviour |
|---|---|
| Planned / unlinked workout | No tab bar; Overview body only (unchanged) |
| Completed+linked, `activity_metrics` null | Stats tab shows "Ride stats not available yet." |
| Streams loading | Map tab shows "Loading ride…"; other tabs unaffected |
| Streams error / no power | `RideMapGraph` handles internally (no-GPS note, etc.) |
| Activity modal, Map tab not yet opened | Streams not fetched until the tab is selected (lazy) |
| Switching tabs | Cheap; no refetch (workout streams already in state; activity streams fetched once and cached in state) |

## Out of scope (v1)

- Replacing the standalone `/ride/[id]` and `/ride/activity/[id]` pages — they stay for
  deep links. `RideDetailView` is unchanged.
- Time-in-zone / decoupling / climbs on the Stats tab.
- Moving workout actions out of the footer.

## Testing

- `RideStats`:
  - `rideStatsFromActivity` maps fields incl. best-power; null best-power fields → card hidden.
  - `rideStatsFromMetrics` maps `best_efforts` by secs (60/300/600/1200), `avg_power`→avgWatts,
    `lr_balance`→lrBalanceLeft; missing efforts → null.
  - Renders Power/Totals always; hides Best Power / HR / L-R when their data is null.
- `TabBar`: renders a button per tab; clicking calls `onSelect`; active styling on `activeId`.
- `WorkoutDetailModal`:
  - planned/unlinked → no tab bar (e.g. query for a "Stats"/"Map" tab returns nothing).
  - completed+linked → three tabs; switching to Stats with null `activity_metrics` shows the
    "not available yet" note; Stats with metrics renders `RideStats`.
  - the in-app "View ride map" link is gone.
- `ActivityDetailModal`: two tabs; Stats renders `RideStats` from the activity; Map fetches
  the activity streams endpoint and renders `RideMapGraph` once loaded.
- Stats page still renders a recent-ride tab via the shared `RideStats` (smoke test that the
  page imports and shows ride power/duration as before).
- Type gate: `npm run typecheck` clean.
