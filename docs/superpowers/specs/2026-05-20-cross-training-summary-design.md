# Cross-Training Summary — Design Spec

## Goal

Add a grouped summary card at the bottom of the Stats page showing non-ride activities (walks, runs, strength, yoga, etc.) that contributed to wellness figures over the last 28 days.

## Architecture

Three changes, no new API routes and no new API calls:

1. **New type** in `types/index.ts` — `CrossTrainingGroup`.
2. **Stats API update** — `/api/stats` already fetches all activities; extend it to group non-ride activities and include them in the response.
3. **Stats page update** — add a `CrossTrainingSummary` card component below the existing content.

## New Type (`types/index.ts`)

```ts
export interface CrossTrainingGroup {
  type: string              // e.g. "Walk", "Run", "WeightTraining"
  count: number             // number of activities of this type
  total_duration_secs: number
  total_tss: number         // sum of training_load (0 if all null)
}
```

Add `cross_training: CrossTrainingGroup[]` to the existing `RidingStats` interface.

## API Route (`app/api/stats/route.ts`)

No new network calls. The route already fetches all activities via `client.getActivities(oldest, newest)`.

After computing ride stats, also:

1. Filter non-rides: `activities.filter(a => !/ride/i.test(a.type))`.
2. Group by `a.type` — accumulate `count`, `total_duration_secs` (sum of `moving_time`), and `total_tss` (sum of `training_load ?? 0`).
3. Sort groups by `total_tss` descending.
4. Include as `cross_training` in the returned `RidingStats`.

## Stats Page (`app/stats/page.tsx`)

### New component: `CrossTrainingSummary`

Props: `{ groups: CrossTrainingGroup[] }`. Returns `null` if `groups.length === 0`.

Renders a `SectionCard` (reusing the existing component) with:
- Green accent dot (`bg-emerald-500`), title `"Other Activity · 28 Days"`.
- One row per group — left side: emoji + type name + session count; right side: formatted duration + TSS.
- Footer row: total activity count, total duration, total TSS across all groups.

### Emoji lookup

Small object inside the component file:

```ts
const EMOJI: Record<string, string> = {
  Walk: '🚶', Hike: '🥾', Run: '🏃', VirtualRun: '🏃',
  WeightTraining: '🏋️', Yoga: '🧘', Swim: '🏊',
  Rowing: '🚣', Kayaking: '🛶',
}
function activityEmoji(type: string): string {
  return EMOJI[type] ?? '⚡'
}
```

### Duration formatting

Reuse the existing `formatDuration(secs)` helper already in `app/stats/page.tsx`.

### Placement

`CrossTrainingSummary` renders inside the `activeTab === 0` branch (28-day aggregate view), after all existing section cards.

## What Is Not Changing

- Ride stats, power bests, totals, L/R balance — untouched.
- Individual ride tabs — untouched.
- `IntervalsClient` — no changes.
- No new npm dependencies.

## Testing

- Unit test: grouping helper (inline or extracted) correctly aggregates count, duration, TSS, and sorts by TSS descending.
- Unit test: `activityEmoji` returns correct emoji for known types and `⚡` for unknown.
- Component test: `CrossTrainingSummary` renders nothing when `groups` is empty.
- Component test: renders one row per group with correct label, duration, and TSS.
- Component test: footer shows summed totals.
- API integration: `cross_training` array present in stats response when non-ride activities exist.
