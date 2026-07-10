# FTP At Completion — Design Spec

**Goal:** Every workout row (which in this schema also covers unplanned rides — see Architecture) records the athlete's FTP at the moment it was marked completed, so there's a permanent record of what FTP level was in effect for that session. Already-completed workouts get a best-effort historical backfill.

**Architecture:** There is no separate "rides" concept in this codebase — `lib/intervals/import-rides.ts` inserts unplanned ICU ride activities directly into the `workouts` table (`plan_id: null`, `status: 'completed'`), so a single new column on `workouts` covers both planned sessions and rides.

intervals.icu's own Activity object carries an `icu_ftp` field — the FTP value intervals.icu itself applied to that specific activity's calculations, sourced from intervals.icu's own FTP-history feature (distinct from `icu_rolling_ftp`, which is intervals.icu's algorithmic *estimate* of what FTP should be, already used elsewhere in this codebase's FTP prediction flow). This is a more authoritative, more accurate source than anything reconstructable from our own data, since it reflects intervals.icu's complete FTP history including any manual FTP edits — which our own `ftp_predictions` table cannot see (see "Known limitation" below). So the primary mechanism everywhere a workout gets linked to an ICU activity is: read `icu_ftp` off that activity and stamp it directly.

A fallback only applies when `icu_ftp` is null/missing on the activity (or, for the backfill case, when a completed workout has no linked ICU activity at all): reconstruct the best-known historical value from our own data — the latest confirmed `ftp_predictions` row on or before the workout's date, falling back further to the workout's plan's `baseline_ftp`, falling back to `null` if neither exists.

**Known limitation (unchanged from earlier draft, now secondary since `icu_ftp` covers the common case):** manual FTP edits made through this app that never went through the predict/confirm/apply flow (e.g. directly editing FTP on the plan/goals page) aren't timestamped anywhere in our own data — the fallback reconstruction can't see them. This only matters when `icu_ftp` is also unavailable.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, intervals.icu API — one new nullable column, no new dependencies.

---

## Schema change

New migration `supabase/migrations/20260710_ftp_at_completion.sql`:

```sql
alter table workouts add column if not exists ftp_at_completion integer;
```

Nullable, no default — `null` means "not recorded" (not completed yet, or predates this feature and wasn't backfillable). Per this repo's established convention (`AGENTS.md`'s "Database migrations" section), this must be run manually against the shared Supabase project before/alongside deploying the app version that depends on it.

## `ICUActivity` gains `ftp`

`types/index.ts`'s `ICUActivity` interface gains:

```ts
ftp: number | null   // the FTP intervals.icu applied to this activity's calculations (its own FTP history) — NOT the same as rolling_ftp, which is intervals.icu's algorithmic estimate
```

`lib/intervals/client.ts`'s private `mapActivity(a)` (used by both `getActivities` and the single-activity `getActivity`) gains:

```ts
ftp: (a.icu_ftp ?? null) as number | null,
```

## Fallback resolver: `lib/ftp/resolve-ftp.ts`

Pure function, no I/O, fully unit-testable in isolation:

```ts
export interface FtpAnchor { createdAt: string; predictedFtp: number }

export function resolveFallbackFtp(
  date: string,                      // workout's date, YYYY-MM-DD
  confirmedPredictions: FtpAnchor[], // any order
  planBaselineFtp: number | null,
): number | null {
  const applicable = confirmedPredictions
    .filter(p => p.createdAt.slice(0, 10) <= date)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (applicable.length > 0) return applicable[0].predictedFtp
  return planBaselineFtp
}
```

Plus a small DB-aware wrapper used by callers that need to invoke this for one workout without already having anchors/baseline in hand:

```ts
export async function resolveFallbackFtpForWorkout(
  supabase: SupabaseClient,
  date: string,
  planId: string | null,
): Promise<number | null> {
  const { data: predictions } = await supabase
    .from('ftp_predictions')
    .select('created_at, predicted_ftp')
    .eq('confirmed', true)
  const anchors: FtpAnchor[] = (predictions ?? []).map(p => ({ createdAt: p.created_at, predictedFtp: p.predicted_ftp }))

  let planBaselineFtp: number | null = null
  if (planId) {
    const { data: plan } = await supabase.from('training_plans').select('baseline_ftp').eq('id', planId).maybeSingle()
    planBaselineFtp = plan?.baseline_ftp ?? null
  }

  return resolveFallbackFtp(date, anchors, planBaselineFtp)
}
```

This wrapper is only exercised on the rare "no `icu_ftp` on the activity" path, so its extra queries are not a concern for the common case.

## Forward-going stamping (3 call sites)

**`lib/sync/match-workouts.ts`**: `matchWorkoutsToActivities` already has the full matched `ICUActivity` object in scope when building each `WorkoutMatch`. It gains a new field on that return type, read directly (no DB access, still a pure function):

```ts
export interface WorkoutMatch {
  id: string
  icu_activity_id: string
  tss: number | null
  actual_duration_minutes: number
  status: 'completed' | 'needs_review'
  ftp_at_completion: number | null   // from the matched activity's `ftp` field
  date: string                       // pass-through from the matched PendingWorkout — the route needs it for the fallback resolver
  plan_id: string | null             // pass-through from the matched PendingWorkout — same reason
}
```

`PendingWorkout` gains `plan_id: string | null` so `matchWorkoutsToActivities` has it available to copy through (`date` is already on `PendingWorkout`).

**`app/api/sync/route.ts`** (`app/api/sync/route.ts:149-164`): the `pending` query (`app/api/sync/route.ts:143-147`) additionally selects `plan_id`. The match-update loop includes `ftp_at_completion: m.ftp_at_completion` directly, resolving the fallback only for the (expected-rare) matches where it's null: `m.ftp_at_completion ?? await resolveFallbackFtpForWorkout(supabase, m.date, m.plan_id)`.

**`lib/intervals/import-rides.ts`** (`lib/intervals/import-rides.ts:8-47`): each inserted row's `ftp_at_completion` is `a.ftp` from the matched activity directly. Since unplanned rides always have `plan_id: null`, a null `a.ftp` falls back to `resolveFallbackFtp(date, anchors, null)` — i.e., only the confirmed-predictions timeline applies, never a plan baseline (there is no plan). To avoid an anchors-fetch on every call when it's not needed, only fetch confirmed predictions once, lazily, the first time a ride in the batch actually needs the fallback.

**`app/api/workouts/[id]/route.ts`** PATCH (`app/api/workouts/[id]/route.ts:41-183`) and `components/WorkoutDetailModal.tsx`: the two client call sites already have (or can easily get) the full `ICUActivity` object for the workout being completed:
- `selectActivity(act)` already sends `{ icu_activity_id: act.id, tss: act.training_load, status: 'completed' }` — gains `ftp_at_completion: act.ftp`.
- `confirmMatch()` already has `matchedActivity` in scope (`components/WorkoutDetailModal.tsx:170`) — gains `ftp_at_completion: matchedActivity?.ftp ?? null` in its PATCH body.

This follows the same trust pattern the route already uses for `tss: act.training_load` in `selectActivity` — client-supplied activity data is already trusted here, so passing `ftp_at_completion` through the same way is consistent, not a new trust boundary.

Server-side, the PATCH handler: when `body.status === 'completed'`, sets `update.ftp_at_completion = body.ftp_at_completion ?? await resolveFallbackFtpForWorkout(supabase, existingWorkout.date, existingWorkout.plan_id)` — the fallback only runs when the client didn't supply a non-null value. This requires fetching the workout's `date`/`plan_id` when `body.status === 'completed'` (a small new `select('date, plan_id').eq('id', id).maybeSingle()`, only when needed — not on every PATCH call).

If the fallback resolver itself also comes back `null` (no confirmed predictions and no plan/baseline), `ftp_at_completion` is written as `null` — recording a workout as done must never fail because of this side-detail.

## Backfill: `app/api/workouts/backfill-ftp/route.ts` (new)

Admin-gated POST route, following the exact pattern of `app/api/workouts/backfill-notes/route.ts`: checks `user_profile.is_admin`, returns 403 if not set.

1. Fetch every completed workout missing `ftp_at_completion` (`status = 'completed' and ftp_at_completion is null`), selecting `id, date, plan_id, icu_activity_id`.
2. For the ones with an `icu_activity_id`, fetch the underlying activities from intervals.icu in bulk: `client.getActivities(oldest, newest)` spanning the min/max dates among them (a one-off admin action, so a single wide-range fetch is acceptable), and build a `Map<icu_activity_id, ICUActivity>`.
3. For each workout: if its `icu_activity_id` maps to an activity with a non-null `ftp`, use that. Otherwise (no linked activity, or the activity's `ftp` is null), fall back to `resolveFallbackFtp(date, anchors, planBaselineFtp)` — anchors (confirmed `ftp_predictions`) fetched once up front and reused across the whole batch; plan baseline_ftp values fetched once per distinct `plan_id` present in the batch (not per workout) and cached in a `Map`.
4. Leave `ftp_at_completion` null (no-op) when neither source yields a value.

Returns `{ total, updated, skipped, failed }` matching the existing backfill routes' response shape (`skipped` = left null because no source had a value; `failed` = a DB write error).

One-off route, run manually once after the migration lands — not a recurring job, matching `backfill-notes`/`backfill-zones`.

## UI: `components/WorkoutDetailModal.tsx`

New chip added to the existing badge row (`components/WorkoutDetailModal.tsx:340-348`, immediately after the TSS chip), shown only when `workout.status === 'completed' && workout.ftp_at_completion !== null`:

```tsx
{workout.status === 'completed' && workout.ftp_at_completion !== null && (
  <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
    {workout.ftp_at_completion}W FTP
  </span>
)}
```

Matches the existing TSS chip's exact styling. `ftp_at_completion: number | null` is added to the `Workout` type (`types/index.ts`).

## Error handling

- A null `ftp_at_completion` (from every source failing) never blocks a completion write — the workout still gets marked completed.
- The backfill route's per-workout writes are independent — one failing update doesn't stop the batch; it's counted in `failed`.
- intervals.icu API failures during the backfill's bulk activity fetch fail the whole route with an error response (matching how every other route in this codebase treats an `IntervalsClient` call failure) — there's no partial-batch recovery for that one network call, only for the per-row DB writes afterward.
- No change to any existing error paths in `app/api/sync/route.ts`, `import-rides.ts`, or the PATCH handler — this is additive data only.

## Testing

- `lib/ftp/resolve-ftp.ts`: unit tests for the pure `resolveFallbackFtp` (picks the latest applicable prediction; falls back to plan baseline when none apply; returns null when neither exists) and the DB-aware wrapper (mocked supabase).
- `lib/sync/match-workouts.ts`: existing `__tests__/lib/match-workouts.test.ts` extended so fixture activities carry `ftp`, asserting it passes through to `WorkoutMatch.ftp_at_completion`.
- `app/api/sync/route.ts`: currently has no test coverage at all (confirmed — no existing test file). Out of scope to build full first-time coverage for this large multi-dependency route; this task's own correctness is covered via the already-tested `matchWorkoutsToActivities` and `resolveFallbackFtp`.
- `lib/intervals/import-rides.ts`: currently untested — a new first test file covers the core insert behavior including `ftp_at_completion` (both the direct-from-activity and fallback paths).
- `app/api/workouts/[id]/route.ts`: currently untested — a new, narrowly-scoped test file covers exactly the new code path: a `{status: 'completed', ftp_at_completion: N}` PATCH writes that value; a `{status: 'completed'}` PATCH with no `ftp_at_completion` triggers the fallback resolver; a PATCH not touching status doesn't fetch the workout's date/plan_id at all.
- `app/api/workouts/backfill-ftp/route.ts`: new test file covering — a workout backfilled from its linked activity's `ftp`; a workout whose activity has null `ftp` falling back to a confirmed prediction; a workout with neither an activity value nor a prediction falling back to plan `baseline_ftp`; a workout with none of the three staying null (counted in `skipped`); non-admin gets 403.
- `components/WorkoutDetailModal.tsx`: new test asserting the FTP chip renders for a completed workout with `ftp_at_completion` set, and does not render when null or when the workout isn't completed; existing/new tests confirming `confirmMatch()`/`selectActivity()` include `ftp_at_completion` in their PATCH bodies.

## Out of scope

- No UI for re-running the backfill from the app (one-off admin POST, invoked directly — same as existing backfill routes).
- No changes to how `current_ftp` itself is computed, stored, or applied.
- No attempt to make the fallback resolver aware of un-timestamped manual FTP edits (see "Known limitation" above) — this is an accepted gap, and matters only on the rare path where intervals.icu's own `ftp` is also unavailable.
