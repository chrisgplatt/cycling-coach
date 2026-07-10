# FTP At Completion — Design Spec

**Goal:** Every workout row (which in this schema also covers unplanned rides — see Architecture) records the athlete's FTP at the moment it was marked completed, so there's a permanent record of what FTP level was in effect for that session. Already-completed workouts get a best-effort historical backfill.

**Architecture:** There is no separate "rides" concept in this codebase — `lib/intervals/import-rides.ts` inserts unplanned ICU ride activities directly into the `workouts` table (`plan_id: null`, `status: 'completed'`), so a single new column on `workouts` covers both planned sessions and rides. Exactly three code paths ever transition a workout's `status` to `'completed'`: the sync-time auto-match in `app/api/sync/route.ts` (raw Supabase `.update()`), the unplanned-ride import in `lib/intervals/import-rides.ts` (raw Supabase `.insert()`), and the manual confirm/select-activity actions in `components/WorkoutDetailModal.tsx`, both of which route through the generic `PATCH /api/workouts/[id]` handler. All three call a new shared helper, `lib/ftp/current-ftp.ts`'s `getCurrentFtp(supabase): Promise<number | null>`, which reads `user_profile.current_ftp`, and stamp its result into a new `ftp_at_completion` column at write time.

Already-completed workouts (created before this feature) get a one-off admin backfill route, following the existing `app/api/workouts/backfill-notes/route.ts` / `backfill-zones/route.ts` pattern: for each completed workout with `ftp_at_completion` still null, look up the latest confirmed `ftp_predictions` row with `created_at`'s date on or before the workout's `date`; if none exists, fall back to that workout's plan's `training_plans.baseline_ftp` (via `plan_id`); if neither exists, leave it null rather than guess.

**Tech Stack:** Next.js App Router, TypeScript, Supabase — one new nullable column, no new dependencies.

---

## Schema change

New migration `supabase/migrations/20260710_ftp_at_completion.sql`:

```sql
alter table workouts add column if not exists ftp_at_completion integer;
```

Nullable, no default — `null` means "not recorded" (either not completed yet, or predates this feature and wasn't backfillable). Per this repo's established convention (see `AGENTS.md`'s "Database migrations" section), this must be run manually against the shared Supabase project before/alongside deploying the app version that depends on it.

## Shared helper: `lib/ftp/current-ftp.ts`

```ts
export async function getCurrentFtp(supabase: SupabaseClient): Promise<number | null> {
  const { data } = await supabase.from('user_profile').select('current_ftp').maybeSingle()
  return data?.current_ftp ?? null
}
```

RLS already scopes `user_profile` to the authenticated user (`user_id = auth.uid()`), same as every other single-row profile fetch in this codebase (e.g. `app/api/profile/route.ts`) — no explicit user filter needed.

## Forward-going stamping (3 call sites)

**`app/api/sync/route.ts`** (`app/api/sync/route.ts:149-164`): the `matches.map(m => supabase.from('workouts').update({...}).eq('id', m.id))` block gains `ftp_at_completion: currentFtp` in the update payload, where `currentFtp` is fetched once via `getCurrentFtp(supabase)` before the loop (not per-match — one profile fetch covers the whole sync run, since FTP doesn't change mid-request).

**`lib/intervals/import-rides.ts`** (`lib/intervals/import-rides.ts:8-47`): `importUnplannedRides` fetches `currentFtp` via `getCurrentFtp(supabase)` once, and each inserted row (`toInsert`, currently built with `status: 'completed' as const`) gains `ftp_at_completion: currentFtp`.

**`app/api/workouts/[id]/route.ts`** PATCH (`app/api/workouts/[id]/route.ts:41-183`): when `body.status === 'completed'` (the two call sites in `WorkoutDetailModal.tsx` — `confirmMatch()` and `selectActivity()` — both pass this), the handler additionally sets `update.ftp_at_completion` via `getCurrentFtp(supabase)`. Only fetched when the status is actually transitioning to completed — not on every PATCH call, to avoid an extra query on unrelated edits (date moves, step edits, etc.).

If `getCurrentFtp` returns `null` (no profile row, which shouldn't happen for an authenticated user but is defensively possible), `ftp_at_completion` is written as `null` rather than blocking the completion — recording a workout as done must never fail because of this side-detail.

## Backfill: `app/api/workouts/backfill-ftp/route.ts` (new)

Admin-gated POST route, following the exact pattern of `app/api/workouts/backfill-notes/route.ts`: checks `user_profile.is_admin`, returns 403 if not set.

Algorithm, per workout needing backfill (`status = 'completed' and ftp_at_completion is null`):

1. Fetch all confirmed `ftp_predictions` rows once up front (`confirmed = true`, ordered by `created_at` ascending) — reused across every workout in the batch, not re-queried per row.
2. For a given workout's `date`, find the latest confirmed prediction whose `created_at`'s date is `<= workout.date`. If found, use its `predicted_ftp`.
3. Otherwise, if the workout has a `plan_id`, look up that plan's `baseline_ftp` (`training_plans.baseline_ftp`) and use it if non-null.
4. Otherwise, leave `ftp_at_completion` null (no update needed for that row — it already is null).

Returns `{ total, updated, skipped, failed }` matching the existing backfill routes' response shape (`skipped` = workouts left null because no historical anchor was found; `failed` = a DB write error).

This is a one-off route, run manually once after the migration lands — not a recurring job, matching how `backfill-notes`/`backfill-zones` are used in this codebase.

## UI: `components/WorkoutDetailModal.tsx`

New chip added to the existing badge row (`components/WorkoutDetailModal.tsx:340-348`, immediately after the TSS chip), shown only when `workout.status === 'completed' && workout.ftp_at_completion !== null`:

```tsx
{workout.status === 'completed' && workout.ftp_at_completion !== null && (
  <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
    {workout.ftp_at_completion}W FTP
  </span>
)}
```

Matches the existing TSS chip's exact styling for visual consistency. `ftp_at_completion` is added to the `Workout` type (`types/index.ts`) as `number | null`.

## Error handling

- `getCurrentFtp` returning `null` never blocks a completion write (see above) — the workout still gets marked completed, just without an FTP stamp.
- The backfill route's per-workout writes are independent — one failing update doesn't stop the batch; it's counted in `failed` and the route continues.
- No change to any existing error paths in `app/api/sync/route.ts`, `import-rides.ts`, or the PATCH handler — this is additive data only.

## Testing

- `lib/ftp/current-ftp.ts`: unit test for `getCurrentFtp` — returns the profile's FTP, returns `null` when no profile row exists.
- `app/api/sync/route.ts`: existing sync tests extended to assert `ftp_at_completion` is included in the match-update payload.
- `lib/intervals/import-rides.ts`: existing import-rides tests extended to assert inserted rows include `ftp_at_completion`.
- `app/api/workouts/[id]/route.ts`: new test asserting a `status: 'completed'` PATCH includes `ftp_at_completion` in the update, and that a PATCH not touching status does not trigger the extra profile fetch.
- `app/api/workouts/backfill-ftp/route.ts`: new test file covering — a workout backfilled from a confirmed prediction before its date; a workout with no earlier prediction but a plan (falls back to `baseline_ftp`); a workout with neither (stays null, counted in `skipped`); non-admin gets 403.
- `components/WorkoutDetailModal.tsx`: new test asserting the FTP chip renders for a completed workout with `ftp_at_completion` set, and does not render when null or when the workout isn't completed.

## Out of scope

- No UI for re-running the backfill from the app (it's a one-off admin POST, invoked directly — same as the existing backfill routes have no UI trigger either).
- No attempt to reconstruct FTP history from anything other than confirmed `ftp_predictions` and plan `baseline_ftp` — manual profile edits that never went through the predict/confirm/apply flow (e.g. directly editing FTP on the plan/goals page) are not timestamped anywhere and cannot be recovered.
- No changes to how `current_ftp` itself is computed, stored, or applied — this feature only reads it at the moments already described.
