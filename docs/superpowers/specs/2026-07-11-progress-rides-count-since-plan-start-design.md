# Progress "Rides Since Start" Count Fix Design

## Goal

Fix the dashboard Progress section's "Rides" tile so it actually counts every ride since the active plan's start date, for plans of any length — not just the trailing 6 weeks.

## Background

The dashboard's Progress section shows a "Rides" tile (`components/ProgressStats.tsx:174-176`), sub-labelled "since start" whenever a plan is active. Its value comes from `computeProgressMetrics`'s `totalRides` field (`lib/progress/metrics.ts:124-136`), which filters an `activities` array by `/ride/i.test(a.type)` and a date `>=` baseline — the active plan's `created_at` date when a plan exists, or 42 days back otherwise.

The bug: the `activities` array that reaches this calculation is always `syncData.activities`, produced once per sync by `client.sync(6)` (`app/api/sync/route.ts:121`), which fetches a fixed rolling 6-week (42-day) window from intervals.icu via `getActivities(oldest, newest)`. There is no other, longer-lived store of activity history anywhere in this app — every sync re-fetches from intervals.icu fresh. So whenever an active plan has been running for longer than 6 weeks (routine — this app's own periodization rules support 8/10/12/16/20-week plans), rides from before the trailing 6-week window are physically absent from `syncData.activities` and can never be counted, regardless of what the baseline date says. The tile still labels itself "since start," but the number silently only reflects the last ~6 weeks once a plan runs past that point.

This does **not** affect whether unplanned rides are counted — `syncData.activities` is intervals.icu's actual completed-activity history (`/athlete/{id}/activities`), not filtered by whether a ride happens to be matched to a coach-generated planned workout in this app's database. The bug is purely about the time window, not about which rides within that window are included.

## Fix

Give `maybeGenerateProgressBrief` (`lib/progress/brief-generator.ts`) access to the already-authenticated `IntervalsClient` instance, and have it fetch a plan-scoped activities window itself whenever a plan is active, instead of relying on the fixed 6-week `syncData.activities`.

### `app/api/sync/route.ts`

The `POST` handler already constructs `client = new IntervalsClient(...)` near its start and later calls:

```ts
await maybeGenerateProgressBrief(supabase, user.id, syncData, {
  current_ftp: profile.current_ftp,
  weight_kg: profile.weight_kg,
  goals: profile.goals ?? '',
  min_sessions_per_week: profile.min_sessions_per_week ?? 3,
})
```

This call gains `client` as a new argument:

```ts
await maybeGenerateProgressBrief(supabase, user.id, syncData, {
  current_ftp: profile.current_ftp,
  weight_kg: profile.weight_kg,
  goals: profile.goals ?? '',
  min_sessions_per_week: profile.min_sessions_per_week ?? 3,
}, client)
```

### `lib/progress/brief-generator.ts`

`maybeGenerateProgressBrief`'s signature gains a `client: IntervalsClient` parameter (import `IntervalsClient` from `@/lib/intervals/client`).

Today, the function already fetches `plan` (`training_plans` row) before calling `computeProgressMetrics`, and always passes `syncData.activities` as the `activities` argument. That changes to: when `plan` exists, fetch `client.getActivities(planStartDate, todayStr)` — where `planStartDate = plan.created_at.split('T')[0]` and `todayStr = new Date().toISOString().split('T')[0]` (this file has no existing today-date variable to reuse; both are computed fresh, matching the `YYYY-MM-DD` form `getActivities` expects, same as `client.sync()`'s own `oldest`/`newest` construction in `lib/intervals/client.ts`) — and pass that result to `computeProgressMetrics` instead of `syncData.activities`. When `plan` is `null`, behavior is unchanged: `syncData.activities` is used directly (the existing 42-day fallback in `computeProgressMetrics` is already correct in that case, since it's well within any single sync's window).

`computeProgressMetrics` itself (`lib/progress/metrics.ts`) requires **no changes** — it already accepts whatever `activities` array it's given and filters/dates it the same way regardless of the array's origin.

This fetch always runs when a plan is active (no conditional "is the plan older than 6 weeks" check) — simpler than comparing against an assumed window width, and cheap: `maybeGenerateProgressBrief` already debounces to once every 4 hours (`DEBOUNCE_HOURS`), so this is at most one extra intervals.icu API call every 4 hours, not per sync. For a brand-new plan the fetched range is just as small as it needs to be.

### Error handling

No new error handling is introduced. The entire `maybeGenerateProgressBrief` call in `app/api/sync/route.ts` is already wrapped in a non-fatal `try/catch` ("brief generation failure must not block sync"). If the new fetch throws, the function throws the same way any other failure in this path already does today — the brief simply doesn't update this cycle, and the existing debounce means it retries on a later sync once the failure clears.

## Testing

`maybeGenerateProgressBrief` currently has no test coverage at all. Because `client` becomes an injected parameter rather than something the function constructs internally, it's directly testable with a plain mock object — no `jest.mock('@/lib/intervals/client', ...)` module mocking needed. New test file `__tests__/lib/brief-generator.test.ts` covers:

- With an active plan, `client.getActivities` is called with the plan's `created_at` date (as `YYYY-MM-DD`) and today's date, and the `metrics_snapshot.totalRides` written to `progress_briefs` reflects rides returned by that call (including one dated before the would-be 6-week window, to prove the fetched — not the passed-in `syncData.activities` — array drives the count).
- With no active plan, `client.getActivities` is never called, and `metrics_snapshot.totalRides` is computed from `syncData.activities` exactly as before (unchanged behavior).
- The existing 4-hour debounce behavior (skip generation if `generated_at` is recent) is untouched by this change and doesn't need new coverage.

`lib/progress/metrics.ts` and its existing test file (`__tests__/lib/progress-metrics.test.ts`) are unchanged — the pure filtering logic isn't part of this bug.

## Global Constraints

- `syncData.activities` (the 6-week sync window) continues to drive every other dashboard consumer unchanged (last-ride display, today's activity load, unplanned-ride matching, "other activities this week" count, etc.) — this fix touches only the progress-brief's rides calculation, nothing else.
- The no-plan fallback (42 days back, using `syncData.activities` directly) is unchanged.
- No new persistent storage of activity history is introduced — the fix is a second, precisely-scoped live fetch, not a cache or database table.
