# Plan History & Close Plan Design

**Date:** 2026-08-03
**Status:** Approved

## Problem

`training_plans` already has an `active`/`archived` `status` column, and a plan already gets archived in two situations today:

1. **Implicitly**, when the athlete builds a new plan — `app/api/plan/route.ts:220-249` flips the current active plan to `archived` and deletes its future intervals.icu calendar events (but not the `workouts` rows) before inserting the new plan.
2. **Explicitly**, via the plan screen's kebab menu. `PlanKebabMenu.tsx`'s red **"Delete plan"** item (wired at `app/plan/page.tsx:779`) opens `ClearWorkoutsModal.tsx`, whose confirm action calls `clearFutureWorkouts()` (`app/plan/page.tsx:621-628`) against `POST /api/workouts/clear-future` (`app/api/workouts/clear-future/route.ts`) — which archives the plan and deletes both the intervals.icu events *and* the `workouts` rows for any `status = 'planned'` workout on/after today. Despite the label, it never hard-deletes the plan row itself.

Neither path records anything about the plan once it's archived. No screen ever reads `status = 'archived'` rows (confirmed by grep — there are no reads of archived plans anywhere in the codebase). So today, closing or replacing a plan silently discards its history.

The athlete wants to see key stats from previous plans once they're done — start date, workouts completed, and per-week rides/hours/TSS/fitness change — and wants an explicit, correctly-named way to close a plan from the kebab menu.

## Scope decisions (from brainstorming)

- **Both archiving paths produce a history snapshot** — the implicit archive-on-replace (building a new plan) and the explicit close action, not just the latter. This matches the athlete's stated scenario: finishing a plan and starting the next one is exactly when they want the history to exist.
- **History lives as a 4th tab** on `/plan` ("History"), alongside My Plan / Profile & Schedule / Events — not a buried section on the My Plan tab.
- **The kebab menu's "Delete plan" item is renamed to "Close plan"** rather than adding a second, similarly-named item. Its behavior (archive + delete future planned workouts) already matches what "closing" a plan means; the label was simply wrong.
- **Stats are snapshotted once at closure time**, frozen into the plan row, rather than recomputed live from intervals.icu on every visit to the History tab. This is immune to future API hiccups or intervals.icu data retention limits, and matches the mental model of a permanent historical record.
- The existing three-phase confirm modal (confirm → closing… → done) is retained, just re-copied for "Close plan" wording.

## Data model

Two new columns on `training_plans` (`supabase/schema.sql:37-50`):

```sql
alter table training_plans add column if not exists closed_at timestamptz;
alter table training_plans add column if not exists archive_summary jsonb;
```

- `closed_at` — when the plan transitioned to `archived`. Kept distinct from `updated_at` (which the existing rename flow already touches, `app/api/plan/route.ts:183-188`) so the History tab has an unambiguous sort/display field.
- `archive_summary` — the frozen snapshot, shaped as:

```ts
interface PlanArchiveSummary {
  startDate: string          // plan's original start date
  closedAt: string           // date the plan was closed (today, for both paths)
  plannedEndDate: string     // startDate + totalWeeksPlanned * 7
  closedEarly: boolean       // closedAt < plannedEndDate
  totalPlannedSessions: number
  totalCompletedSessions: number
  totalHours: number
  totalTss: number
  ctlStart: number | null    // null if intervals.icu was unreachable at closure
  ctlEnd: number | null
  fitnessChange: number | null   // ctlEnd - ctlStart, or null
  weeks: Array<{
    weekIndex: number
    weekStart: string
    plannedSessions: number
    completedSessions: number
    plannedTss: number
    actualTss: number
    hours: number
  }>
}
```

No new table — this follows the existing convention of jsonb columns on `training_plans` for structured, plan-scoped data (`week_phases`, `training_philosophy`).

## Shared archiving logic

New module: **`lib/plan/archive.ts`**

```ts
export async function archivePlan(
  supabase: SupabaseClient,
  client: IntervalsClient | null,   // null when intervals.icu isn't configured
  planId: string,
  closureDate: string,
): Promise<void>
```

Steps:

1. Load the plan row and its `workouts` (`plan_id = planId`, all statuses, all dates) from Supabase.
2. If `client` is provided, fetch `client.getActivities(planStart, closureDate)` and `client.getWellness(planStart, closureDate)` in one call each. On failure, proceed with `activities = []` and `wellness = []` rather than aborting the close.
3. Compute the summary by reusing the existing pure helpers in `lib/plan/progress.ts` unchanged — `buildWeekBuckets`, `consistency`, `planHours` — plus one small addition, a per-week hours helper (`buildWeekBuckets` currently has no per-bucket hours field; `planHours` only totals across the whole plan). This keeps the frozen numbers mathematically identical to what the athlete saw live on the My Plan tab while the plan was active, instead of a parallel/divergent calculation.
4. Derive `ctlStart`/`ctlEnd` from the wellness rows nearest `planStart`/`closureDate` (fall back to `null` if no wellness rows were returned).
5. Delete intervals.icu calendar events (best-effort, per-event try/catch, same pattern as the existing `clear-future`/`reset-future` routes) and then delete the `workouts` rows for any `status = 'planned'` workout with `date >= closureDate`.
6. Update the plan row — `status = 'archived'`, `closed_at = closureDate`, `archive_summary = <computed JSON>` — guarded by `where id = planId and status = 'active'` (a compare-and-swap). If this updates zero rows, the plan was already archived by a concurrent call; `archivePlan` returns an "already archived" result instead of erroring, and the caller treats it the same as "no active plan."

**Call sites, both routed through `archivePlan`:**

- **New `POST /api/plan/close`** — the explicit "Close plan" menu action, `closureDate = today`. Replaces `app/api/workouts/clear-future/route.ts` (deleted; its behavior is now `archivePlan`'s step 5–6, invoked from the new route). Returns the same `{ deleted, failed }` shape the frontend already expects from `clearFutureWorkouts()`, so `app/plan/page.tsx:621-628` only needs its fetch URL updated.
- **`app/api/plan/route.ts:220-249`** — the archive-on-replace block is replaced with a single `await archivePlan(supabase, client, activePlan.id, today)` call, so building a new plan now also produces a history entry.

`app/api/workouts/reset-future/route.ts` (the *non*-archiving "Clear future workouts" menu action, for redoing the remainder of a still-active plan) is untouched — it's a genuinely different operation and out of scope here.

## UI

### Kebab menu (`components/PlanKebabMenu.tsx`)

The `onDelete` prop and its "Delete plan" button label (lines 66-71) become "Close plan" — same red styling, same slot in the menu, same handler wiring at `app/plan/page.tsx:779`.

### Confirm modal (`components/ClearWorkoutsModal.tsx`)

Re-copy only, three phases retained:
- **Confirm:** "Close plan?" / "This closes your plan, deletes upcoming planned workouts, and saves its stats to your plan history. Past completed workouts are not affected." / Cancel · "Yes, close"
- **Closing:** unchanged spinner, copy → "Closing plan…"
- **Done:** result message extended to confirm the snapshot, e.g. "Plan closed and saved to history. 3 workouts removed (1 failed to remove from intervals.icu)."

### History tab (`app/plan/page.tsx`)

Fourth entry in the existing tab bar (`app/plan/page.tsx:656`): `['history', 'History']`. New tab-content block, gated the same way as the other three (`data-testid="tab-history"`, `style={{ display: tab === 'history' ? 'block' : 'none' }}`).

Fetches archived plans (`training_plans` where `status = 'archived'`, ordered by `closed_at desc`) via a new `GET /api/plan/history` route, returning `id, name, target_event_name, archive_summary, closed_at`.

**Card** (one per closed plan), `components/plan/PlanHistoryCard.tsx`:
- Name, target event name, date range (`startDate` → `closedAt`)
- "Closed early" badge when `archive_summary.closedEarly`
- Row of stat cells: completed/planned sessions, total hours, total TSS, fitness change (e.g. "CTL +8", or "Fitness data unavailable" when `fitnessChange` is `null`)
- Tapping expands a plain per-week table (week #, date range, rides completed/planned, hours, TSS) — not a reuse of `FitnessTrendChart`/`LoadComparisonChart`, since those are built for an in-progress plan (forecast line, current-week highlight) that doesn't apply to a closed one; a table is also more mobile-friendly for a compact historical record, per this repo's mobile-first convention (`AGENTS.md`).

**Empty state:** plain text ("No closed plans yet — plans you close or replace will show up here.") when the history list is empty; no illustration.

## Error handling & edge cases

- **No completed workouts at all** (plan closed on day one): summary saves with zero counts — not an error state.
- **intervals.icu not configured, or the activities/wellness fetch fails:** archive still completes in full (status flip, row cleanup, and `totalHours`/`totalTss`/session counts, which come from the plan's own `workouts` rows and don't depend on the live fetch); only `ctlStart`/`ctlEnd`/`fitnessChange` are stored as `null`.
- **No active plan when `POST /api/plan/close` is called:** `400 { error: 'No active plan' }`, matching the existing pattern in `app/api/plan/route.ts:182`.
- **Partial intervals.icu event-deletion failures:** already handled today via a per-event try/catch and a `failed` counter in both `clear-future` and `reset-future`; carried forward into `archivePlan` and surfaced in the done-modal message.
- **Concurrent close + build-new-plan:** both paths call `archivePlan`, which targets the row via `where status = 'active'`; a second concurrent call finds no active plan and 400s rather than double-archiving. Not a real-world concern for a single-user PWA, but the shared function makes it safe by construction rather than by convention.

## Testing

- **Unit** (`__tests__/lib`, new `archive.test.ts`): summary math for a full-length plan, an early-closed plan, a zero-completed-workouts plan, and the intervals.icu-unavailable degraded path (nulls for CTL fields, everything else still populated).
- **API** (`__tests__/api`): `POST /api/plan/close` — happy path, no-active-plan 400, partial-deletion-failure counts; `GET /api/plan/history` — ordering and shape; re-test `app/api/plan/route.ts`'s replace flow to confirm it now also writes `archive_summary`/`closed_at`.
- **Component** (`__tests__/components`): `PlanHistoryCard` renders from fixture archived plans (including the "Closed early" badge and the null-fitness-change case), the History tab's empty state, and the expand-to-week-table interaction; `PlanKebabMenu`/`ClearWorkoutsModal` re-copy.
- **Manual/mobile check** (per `AGENTS.md`): drive the actual close flow in the running app at 375px width — confirm modal, done message, and the new History tab — before calling this done.
