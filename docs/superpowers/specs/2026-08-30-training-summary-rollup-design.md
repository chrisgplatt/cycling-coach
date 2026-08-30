# Training Summary Rollup Design

**Date:** 2026-08-30
**Status:** Approved

## Problem

The athlete has now completed several training plans and many weeks of structured training, but there's nowhere in the app that summarises this in one place. Two existing screens cover adjacent ground but neither answers "what have I done over the last 6/12 months?":

- The **History tab** (`/plan`, `PlanHistoryTab.tsx`) lists closed plans as individual cards (`PlanHistoryCard.tsx`), each with its own frozen `archive_summary` (sessions, hours, TSS, CTL start/end — see `docs/superpowers/specs/2026-08-03-plan-history-design.md`). It never rolls these up across plans, and it excludes whatever plan is currently active (only `status = 'archived'` rows are queried, in `app/api/plan/history/route.ts`).
- The **Fitness page** (`/fitness`) has FTP History, CTL/ATL/Form, and Weekly Training Load charts — all time-series views, but nothing that reduces to a single "here's what changed" figure for a chosen window.

## Scope decisions (from brainstorming)

- **Placement:** a rollup summary at the top of the existing History tab (`/plan` → History), above the current list of per-plan cards. Not a new page, not folded into the Fitness page.
- **Time window:** a 6mo / 12mo toggle only (no "all-time" option for now), matching the pill-button range-picker pattern `HrvChart` already uses.
- **"Weeks trained" metric:** counts calendar time covered by a structured plan (active or closed) within the window — not just any week with a ride, and not gated on an adherence threshold.
- **Includes the active plan:** the rollup blends closed-plan totals with the currently active plan's progress-to-date, both clipped to the window, rather than only counting fully closed plans.
- **Rides/sessions:** one combined "rides completed" count — no planned-vs-unplanned split.
- **FTP progress source:** confirmed `ftp_predictions` rows only (the ones actually applied to `user_profile.current_ftp` via `PATCH /api/ftp/[id]/apply`), **not** intervals.icu's per-ride `ftp` field. This was raised explicitly during design (the per-ride field would also catch FTP changes made by directly editing FTP in the Profile & Schedule tab, `app/plan/page.tsx`, which confirmed-predictions-only will miss) and the athlete chose to keep it simple and self-contained to this app's own predict/confirm data, accepting that a manually-edited FTP won't show up in this tile's delta.

## Data model

No schema changes. This feature is read-only aggregation over existing tables/columns:

- `training_plans` — `status`, `created_at` (used as plan start date, per existing convention in `lib/plan/archive.ts`), `plan_weeks`, `closed_at`, `archive_summary` (jsonb, shape: `PlanArchiveSummary`, `types/index.ts:100`)
- `workouts` — for the active plan's live bucket computation
- `ftp_predictions` — `predicted_ftp`, `confirmed`, `created_at`
- `user_profile` — `current_ftp`, `intervals_icu_athlete_id`, `intervals_icu_api_key`

## Aggregation logic

New module: **`lib/plan/summary.ts`**

```ts
export interface TrainingSummary {
  windowMonths: 6 | 12
  windowStart: string          // YYYY-MM-DD
  ridesCompleted: number
  hoursTrained: number
  weeksWithPlan: number
  weeksInWindow: number
  ctlStart: number | null
  ctlEnd: number | null
  fitnessChange: number | null
  ftpStart: number | null
  ftpEnd: number | null
  ftpChange: number | null
  ftpStartIsPartial: boolean   // true when no confirmed prediction exists before windowStart,
                                // so ftpStart falls back to the earliest confirmed prediction found
}

export function buildTrainingSummary(input: {
  windowMonths: 6 | 12
  today: string
  archivedPlans: Array<{ archiveSummary: PlanArchiveSummary | null }>
  activePlan: { planStart: string; totalWeeks: number; buckets: WeekBucket[] } | null
  wellness: ICUWellness[]         // covering [windowStart, today] at minimum
  confirmedPredictions: Array<{ predicted_ftp: number; created_at: string }>
  currentFtp: number | null
}): TrainingSummary
```

Steps:

1. `windowStart = addDaysUtc(today, -windowMonths * 30)` (reuses `lib/plan/forecast.ts:addDaysUtc`; 30-day months is an accepted approximation, consistent with other date-math in this codebase, e.g. `HrvChart`'s range buttons use fixed day counts).
2. For each archived plan with a non-null `archive_summary`, filter its `weeks` array to entries where `weekStart >= windowStart` (weeks are already dated absolutely, from `buildArchiveSummary`, `lib/plan/archive.ts:41-49`).
3. For the active plan (if present), the caller has already run `buildWeekBuckets(workouts, activities, planStart, totalWeeks)` (same helper `app/plan/page.tsx` and `lib/plan/archive.ts` both use) and derived each bucket's `weekStart` via `addDaysUtc(planStart, weekIndex * 7)`; filter those to `weekStart >= windowStart && weekStart <= today`.
4. Sum `completedSessions` → `ridesCompleted`, `hours` → `hoursTrained` across every clipped week from both sources.
5. `weeksWithPlan` = count of clipped weeks (from either source) with `plannedSessions > 0` (a week where the plan actually scheduled something — an empty rest week inside a plan's date range doesn't count as "trained").
6. `weeksInWindow` = `Math.round((daysBetween(windowStart, today)) / 7)`.
7. `ctlStart`/`ctlEnd` — `ctlNearestOnOrBefore` (`lib/plan/archive.ts:7-12`) already takes an arbitrary date, it's just private and unexported today; export it (from `lib/plan/archive.ts` or moved to a shared date-utils module) and call it with `windowStart` and `today`. `fitnessChange = ctlEnd - ctlStart` (rounded to 1dp), `null` if either bound is `null`.
8. `ftpEnd = currentFtp`. `ftpStart` = the `predicted_ftp` of the confirmed prediction with the latest `created_at <= windowStart`; if none exists, fall back to the *earliest* confirmed prediction overall (if any) and set `ftpStartIsPartial = true`; if there are no confirmed predictions at all, both are `null`. `ftpChange = ftpEnd - ftpStart` when both are non-null.

## API route

**`GET /api/plan/summary?months=6|12`** (`app/api/plan/summary/route.ts`)

- Auth via `createSupabaseServerClient()`, same pattern as `app/api/plan/history/route.ts`.
- Validates `months` is exactly `6` or `12` (default `12` if omitted/invalid — matches `HrvChart`'s `defaultRangeDays` fallback convention); `400` on anything else.
- Fetches archived plans (same select as `/api/plan/history`, filtered further in-memory to those with `closed_at >= windowStart` to skip pointless work, though `buildTrainingSummary` also clips at the week level as a safety net).
- Fetches the active plan + its workouts (same query shape as `app/api/plan/route.ts:18-25`).
- If an active plan exists and intervals.icu is configured, fetches activities/wellness for `[planStart, today]` via `IntervalsClient` (constructor: `new IntervalsClient(athleteId, apiKey)`, `lib/intervals/client.ts:159-162`) and computes its buckets with `buildWeekBuckets`.
- Fetches wellness for `[windowStart, today]` regardless of active-plan presence (needed for the CTL tile even when there's no active plan, e.g. an athlete between plans) — reuses the same `IntervalsClient` call when an active plan already required a wider range; otherwise issues its own.
- Fetches confirmed `ftp_predictions` (`.eq('confirmed', true).order('created_at')`).
- Calls `buildTrainingSummary(...)` and returns the result as JSON.
- Any intervals.icu fetch failure degrades gracefully (empty wellness/activities arrays), matching `archivePlan`'s existing try/catch-and-continue behavior — never a 500 for a downstream API hiccup.

## UI

**`components/plan/PlanSummaryRollup.tsx`**, rendered at the top of `PlanHistoryTab.tsx` (above the existing `data-testid="plan-history-list"` block, inside the same tab-content container).

- Local `rangeMonths` state (`6 | 12`), default `12`, with two pill buttons in the header row — visually matching `HrvChart`'s range-button styling (`text-[11px] font-semibold px-2 py-1.5 rounded min-h-[44px]`, active state `bg-violet-100 text-violet-700` or an equivalent accent already used on this page).
- Fetches `/api/plan/summary?months=${rangeMonths}` on mount and on range change.
- Renders a stat-tile grid (reusing the tile visual style from `PlanHistoryCard`'s stat cells / `ProgressStats`' season tiles — label + big number + small delta/sub-label, `grid-cols-2` on mobile widening on larger screens per `AGENTS.md`):
  - **Rides completed** — `ridesCompleted`
  - **Hours trained** — `hoursTrained`
  - **Weeks trained** — `"${weeksWithPlan} / ${weeksInWindow}"`
  - **Fitness built** — `fitnessChange` as `"+N"`/`"−N"`, or "Not available" when `null`
  - **FTP progress** — `ftpChange` as `"+N W"`/`"−N W"`, or "Not available" when `null`; if `ftpStartIsPartial`, append a small "(since your first recorded FTP)" note instead of implying it covers the full window
- Loading state: skeleton block consistent with the rest of the tab's loading treatment.
- No error banner beyond a plain text fallback ("Couldn't load your training summary.") if the fetch itself fails — the route's internal degradation already handles partial-data cases without erroring.

## Error handling & edge cases

- **No plans (active or archived) at all in the window:** all count/sum tiles show `0`; CTL/FTP tiles show "Not available" if there's genuinely no data, or real deltas if wellness/FTP data exists independent of any plan (e.g. an athlete who logged free rides with no structured plan for a while).
- **intervals.icu not connected:** rides/hours/weeks tiles still compute correctly (sourced from `workouts` rows, not intervals.icu); CTL tile shows "Not available".
- **intervals.icu fetch throws:** same as above — degrade, don't error.
- **No confirmed FTP predictions before window start, but some exist after:** `ftpStartIsPartial = true`, tile still renders with the caveat note rather than hiding.
- **No confirmed FTP predictions ever:** FTP tile shows "Not available".
- **Window boundary lands mid-plan:** only that plan's weeks with `weekStart >= windowStart` count, per the clipping in step 2/3 above.
- **`months` query param missing or invalid:** defaults to `12` rather than erroring.

## Testing

- **Unit** (`__tests__/lib/plan-summary.test.ts`): `buildTrainingSummary` — active plan only, closed plan only, multiple plans spanning the window, a plan that started before the window (clipping), no intervals.icu data, no confirmed FTP predictions, FTP predictions all after window start (partial flag), window with zero plans.
- **API** (`__tests__/api/plan-summary.test.ts`): happy path shape, unauthenticated 401, invalid `months` falls back to 12, intervals.icu failure still returns 200 with nulled fitness/FTP fields.
- **Component** (`__tests__/components/PlanSummaryRollup.test.tsx`): renders tiles from a fixture response, toggles between 6mo/12mo (re-fetches with the new `months` value), shows the partial-FTP caveat, shows "Not available" states, loading skeleton.
- **Manual/mobile check** (per `AGENTS.md`): view the History tab at 375px width with real data before calling this done.
