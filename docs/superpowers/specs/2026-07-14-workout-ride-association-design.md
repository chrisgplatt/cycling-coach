# Workout ↔ Ride Association Design

## Goal

Let the athlete manually unlink a completed ride from the planned workout it was auto-matched to (reverting the workout to planned, spinning the ride off as its own entry), and manually link an unmatched planned workout with an unplanned ride on the same day — both actionable from the existing workout/ride detail modal.

## Background

Sync-time auto-matching (`lib/sync/match-workouts.ts`'s `matchWorkoutsToActivities`) pairs planned workouts with same-day intervals.icu ride activities, setting `icu_activity_id`, `tss`, `actual_duration_minutes`, `status` (`completed`/`needs_review`), and `ftp_at_completion` on the workout row. A ride that isn't matched to any planned workout gets imported as its own standalone `workouts` row via `lib/intervals/import-rides.ts`'s `importUnplannedRides` — same table, `plan_id: null`, `status: 'completed'`, and (notably) the real ride duration lives in `duration_minutes` rather than `actual_duration_minutes` for these rows, since there's no separate "planned" duration to compare against.

This means an unplanned ride and a matched planned workout are both just rows in the same `workouts` table, distinguished only by `plan_id` and which fields are populated. Disassociate and associate are exact inverses of each other, expressed entirely as `workouts` row mutations — no schema changes needed.

Both existing detail views for these already render through the same `components/WorkoutDetailModal.tsx` — an unplanned ride is just a `Workout` with `plan_id: null`, and the modal already branches its content by `workout.status`/`workout.icu_activity_id` (e.g. the existing `hasRide` flag at `components/WorkoutDetailModal.tsx:76`, and the `needs_review` confirm/change-match flow at lines 548–588). The new actions extend this same modal rather than introducing a new one.

## Disassociate

**Trigger:** a "Disassociate ride" button in the modal's action footer (alongside the existing Delete button, `components/WorkoutDetailModal.tsx:687–746`), shown when `workout.plan_id != null && workout.icu_activity_id != null && (workout.status === 'completed' || workout.status === 'needs_review')` — i.e. exactly the existing `hasRide` condition, further restricted to plan-linked workouts (an unplanned ride has `plan_id === null` and never shows this button). Requires an inline confirm step, matching the existing Delete button's confirm pattern (lines 720–745).

**Server-side (new route, `POST /api/workouts/[id]/disassociate`):**

1. Auth check (existing pattern).
2. Fetch the workout row (`plan_id, date, icu_activity_id, status`). Validate `plan_id != null && icu_activity_id != null` — 400 otherwise.
3. Fetch intervals.icu credentials from `user_profile` (existing pattern, e.g. `app/api/workouts/[id]/route.ts:116-119`).
4. Fetch the full activity fresh via `IntervalsClient.getActivity(icu_activity_id)` (`lib/intervals/client.ts`, single-activity endpoint) — the workout row alone doesn't store the activity's `name`/`moving_time`, which the new unplanned row needs.
5. Compute the new row's `ftp_at_completion` the same way `importUnplannedRides` does: `activity.ftp ?? await resolveFallbackFtpForWorkout(supabase, workout.date, null)` (`lib/ftp/resolve-ftp.ts`, `planId: null` since it's unplanned).
6. **Insert first** (safe-failure ordering — see Error Handling below): a new `workouts` row shaped exactly like `importUnplannedRides` produces (`lib/intervals/import-rides.ts:46-59`):
   ```ts
   {
     user_id, plan_id: null, date: workout.date, // reuse the original workout's own date, not a re-derived one
     type: 'endurance', duration_minutes: Math.max(1, Math.round(activity.moving_time / 60)),
     description: activity.name, target_zones: '', status: 'completed',
     icu_activity_id: activity.id, tss: activity.training_load, steps: null,
     ftp_at_completion: <computed in step 5>,
   }
   ```
7. **Then update** the original workout, reverting it to its pre-match state: `{ status: 'planned', icu_activity_id: null, tss: null, actual_duration_minutes: null, ftp_at_completion: null, activity_metrics: null }`. Everything else on the row (`type`, `duration_minutes`, `description`, `target_zones`, `steps`, `name`, `coaching_notes`, `intervals_icu_event_id`) is untouched — the plan's own structure survives disassociation intact.
8. Return `{ ok: true }`.

**Error handling / ordering:** insert-then-update, not update-then-insert or a single transaction (this codebase doesn't use DB transactions for multi-row mutations elsewhere, e.g. `matchWorkoutsToActivities`'s caller). If the insert fails, nothing has changed — safely retryable. If the update fails after a successful insert, the worst case is both rows temporarily showing the ride (recoverable by retrying or manually deleting the duplicate) rather than silently losing the completed ride's record.

## Associate

**Trigger:** two new symmetric entry points in the modal, both rendered as an inline expandable picker section in the modal body (matching the existing "Link to event" pattern at `components/WorkoutDetailModal.tsx:630-672`, not the footer):

- On an unmatched planned workout (`workout.plan_id != null && !workout.icu_activity_id && workout.status === 'planned'`): a **"Link to a ride"** button/section, listing same-day unplanned rides (`workoutsOnDate` filtered to `plan_id == null`).
- On an unplanned ride (`workout.plan_id == null`): a **"Link to a workout"** button/section, listing same-day unmatched planned workouts (`workoutsOnDate` filtered to `plan_id != null && !icu_activity_id && status === 'planned'`).

Both buttons are hidden entirely (not shown disabled) when there are zero same-day candidates. Each candidate in the list shows enough to distinguish it — an unplanned ride candidate shows `description` (the ride's activity name), duration, and TSS; an unmatched workout candidate shows `name ?? type`, duration, and target zones. Clicking a candidate associates immediately, no extra confirm step — matching the existing `selectActivity` precedent in the `needs_review` flow (`components/WorkoutDetailModal.tsx:194-214`), which also links immediately on click.

**New prop on `WorkoutDetailModal`:** `workoutsOnDate?: Workout[]` — all other `workouts` rows sharing the same `date` as the open workout (both call sites, `app/calendar/page.tsx:862-894` and `app/dashboard/page.tsx:837-880`, already hold the full loaded `workouts` array in state and can filter it: `workouts.filter(w => w.date === selectedWorkout.date && w.id !== selectedWorkout.id)`). No new callback prop needed — both actions reuse the existing `onStatusChange` callback (already means "something changed, refetch and close" for the modal's other mutations).

**Server-side (new route, `POST /api/workouts/associate`):**

1. Auth check.
2. Body: `{ plannedWorkoutId: string, unplannedWorkoutId: string }`.
3. Fetch both rows. Validate: `plannedWorkout.plan_id != null && !plannedWorkout.icu_activity_id && plannedWorkout.status === 'planned'`; `unplannedWorkout.plan_id == null && !!unplannedWorkout.icu_activity_id`; `plannedWorkout.date === unplannedWorkout.date`. 400 with a clear message if any check fails (RLS already scopes both fetches to the authenticated user, so no explicit ownership check needed beyond the existing `.eq()` pattern).
4. **Update the planned workout first:** `{ status: 'completed', icu_activity_id: unplannedWorkout.icu_activity_id, tss: unplannedWorkout.tss, actual_duration_minutes: unplannedWorkout.duration_minutes, ftp_at_completion: unplannedWorkout.ftp_at_completion }`. Note the field mapping: the unplanned row's `duration_minutes` (where it stores the real ride duration) becomes the planned workout's `actual_duration_minutes` — the planned workout's own `duration_minutes` (its original target) is untouched.
5. **Then delete** the unplanned workout row (now fully represented by the planned workout).
6. Return `{ ok: true }`.

**Error handling / ordering:** update-then-delete (the reverse of disassociate's ordering, same principle). If the update fails, nothing has changed. If the delete fails after a successful update, the worst case is a duplicate-looking leftover row (recoverable), not the ride's data disappearing.

## Global Constraints

- No schema changes — both actions are pure `workouts` row mutations using fields that already exist.
- Disassociate requires exactly one intervals.icu API call (`getActivity`); associate requires none (all needed data already lives on the two existing rows).
- The reverted planned workout's own plan structure (`type`, `duration_minutes`, `description`, `target_zones`, `steps`, `name`, `coaching_notes`) is never touched by disassociate — only match-derived fields are cleared.
- The associated planned workout's own plan structure is likewise never touched by associate — only match-derived fields are set, copied from the unplanned row.
- Both new routes follow insert/update-then-delete/update-then-nothing-destructive-first ordering, so a failure partway through never silently loses the completed ride's data.
- `workoutsOnDate` candidate lists are same-day only, per an explicit design decision — no date-range widening or cross-day search.

## Testing

- `POST /api/workouts/[id]/disassociate`: validates the 400 case (workout not actually matched); on success, asserts the new unplanned row's exact field shape and the original workout's fields are correctly cleared/preserved. Mock `IntervalsClient.getActivity` and Supabase, following this codebase's established API-route test-mocking conventions (e.g. `__tests__/api/profile.test.ts`).
- `POST /api/workouts/associate`: validates each of the three precondition checks (400 cases) independently; on success, asserts the planned workout's fields and that the unplanned row was deleted.
- `components/WorkoutDetailModal.tsx`: this component currently has no dedicated test file (consistent with the rest of this app's large interactive modal/page components) — verification for the UI wiring (button visibility conditions, picker rendering, empty-candidate-list hiding) is manual, following the same convention already used for prior UI-only changes in this app.
