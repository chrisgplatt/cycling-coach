# Plan Progress — Design

**Date:** 2026-06-03
**Status:** Approved (ready for implementation plan)

## Goal

Turn the "My Plan" tab from a near-empty status card into an engaging progress view
of the active plan. Emphasis (from brainstorming): **insight & adherence** and **the
road ahead**, with a light **motivational** touch. Four new modules plus a refreshed
hero, all computed from data we already hold (one small new field for phases).

## Decisions (locked during brainstorming)

1. **Module set:** Plan journey (hero), Consistency strip, Planned-vs-actual load,
   Fitness trend. (Skipped: a "this week" scorecard and "next up" list — the Dashboard
   already owns the day-to-day.)
2. **Timeline + phase roadmap are merged** into one "Plan journey" hero graphic.
3. **Per-week phase = store + heuristic fallback.** New plans: Claude labels each
   week's phase at generation (accurate). Plans with no stored labels (the current
   active plan + legacy): a deterministic heuristic derives phases from the weekly
   load shape. The journey therefore always renders phase bands.
4. **Tab order (top→bottom):** Hero (plan header + journey) · Consistency strip ·
   Planned-vs-actual load · Fitness trend · Plan actions (existing build/delete).

## Data availability (verified)

All inputs are already fetched by `app/plan/page.tsx` (`GET /api/plan` for the plan +
workouts, `POST /api/sync` for `syncData` with `activities[]` and `wellness[]`). No new
API routes are needed. The only new persisted field is per-week phases.

- `Workout`: `date`, `status`, `plan_id`, `duration_minutes`, `type`, `steps`, `tss`,
  `icu_activity_id`.
- `ICUSyncData.activities[]`: `start_date_local`, `training_load` (TSS), `moving_time`, `id`.
- `ICUSyncData.wellness[]`: `id` (YYYY-MM-DD), `ctl`, `atl`, `form` — full history.
- `training_plans`: `created_at`, `plan_weeks`, `phase`, `target_event_name/date`.

## Week model

A plan "week" is a 7-day block counted from the plan start, matching the existing
`weekNumber()` in `app/plan/page.tsx` (so the journey agrees with the "Week X of Y"
counter). Define once and reuse:

- `planStart` = date portion of `plan.created_at`.
- `weekIndexOf(date)` = `floor((date − planStart) / 7 days)` (0-based).
- `totalWeeks` = `plan.plan_weeks` if set, else `floor((lastWorkoutDate − planStart)/7) + 1`.
- `currentWeek` = `clamp(weekIndexOf(today), 0, totalWeeks − 1)`.

## Per-week phases (store + fallback)

### Stored at generation (accurate, new plans)

- `GeneratedPlan` gains `week_phases?: PlanPhase[]` (length = `weeks`).
- `lib/claude/plan.ts`: add to the returned-JSON schema
  `"week_phases": ["base","base","build", … exactly N entries …]` and one prompt line:
  "Also return `week_phases`: an array of exactly `${weeks}` entries, one phase per plan
  week in order, drawn from base|build|peak|taper, consistent with the periodization
  you applied."
- **Migration** `supabase/migrations/20260603_plan_week_phases.sql`:
  `alter table training_plans add column if not exists week_phases jsonb;`
- `app/api/plan/route.ts` POST insert (≈ line 200): add
  `week_phases: plan.week_phases ?? null`. GET already uses `select('*, workouts(*)')`,
  so the field returns automatically once the column exists.
- `app/plan/page.tsx` `loadPlan()`: read `data.week_phases` into state.
- Plan **review/adaptation** (`/api/plan/review`) does not re-insert a plan row; it keeps
  the existing `week_phases`. The fallback covers any drift. (Out of scope to recompute
  stored phases on review.)

### Heuristic fallback (current + legacy plans)

`derivePhases(weeklyPlannedTss: number[], totalWeeks: number): PlanPhase[]` — pure,
deterministic. `resolvePhases(plan, buckets)` returns `plan.week_phases` when present
and length-correct, else `derivePhases(...)`.

Algorithm (yields base→build→peak→taper):
1. `peak = max(tss)`. If `peak === 0` → all `'base'`.
2. **Taper:** from the last week backwards, mark `'taper'` while `tss[i] < 0.8·peak`,
   capped at 2 weeks. If `totalWeeks ≥ 4` and nothing qualified, force the final week to
   `'taper'` (a plan always eases into its end/event).
3. **Peak:** among non-taper weeks, `peakIdx = argmax tss`; mark `'peak'` for `peakIdx`
   and any adjacent non-taper week with `tss ≥ 0.9·peak`, capped at 2 weeks total.
4. **Base/Build:** weeks before the first peak week — first half `'base'`, second half
   `'build'` (`Math.ceil(k/2)` base). `≤ 2` such weeks → all `'base'`. Any non-taper week
   after peak → `'build'`.

The existing hardcoded `Phase: Base` in the hero is replaced by
`resolvePhases(...)[currentWeek]`.

## Computation library

New pure modules (no React, fully unit-tested):

### `lib/plan/progress.ts`

- `plannedTss(workout, ftp): number` — target load for a session:
  - With `steps`: `Σ (step.duration_minutes/60) · (step.power_pct_ftp/100)² · 100`.
  - Without `steps`: fallback intensity factor by `WorkoutType`, then
    `(duration_minutes/60) · IF² · 100`. IF table: recovery 0.55, endurance 0.68,
    tempo 0.82, threshold 0.95, vo2max 1.06, anaerobic/sprint 1.10, default 0.70.
    (Map the project's `WorkoutType` union to these; default for anything unlisted.)
- `buildWeekBuckets(workouts, activities, planStart, totalWeeks, ftp): WeekBucket[]`
  where `WeekBucket = { plannedTss, actualTss, plannedSessions, completedSessions }`:
  - `plannedTss` = Σ `plannedTss(w, ftp)` over plan workouts (`plan_id != null`) in the week.
  - `actualTss` = Σ `activity.training_load` over **all** activities whose
    `start_date_local` date falls in the week (planned + unplanned — fatigue is fatigue,
    per CLAUDE.md).
  - `plannedSessions` = count of plan workouts in the week.
  - `completedSessions` = count of those with `status ∈ {completed, needs_review}`.
- `weekState(bucket, weekIdx, currentWeek): 'done'|'partial'|'missed'|'current'|'upcoming'`:
  - `weekIdx === currentWeek` → `'current'`.
  - future week → `'upcoming'`.
  - past week: `completed === planned (>0)` → `'done'`; `completed > 0` → `'partial'`;
    else `'missed'` (or `'upcoming'` if `planned === 0`).
- `consistency(buckets, currentWeek): { hitPct, streak, hours }`:
  - `hitPct` = `round(100 · Σcompleted / Σplanned)` over weeks with `weekIdx ≤ currentWeek`
    and `planned > 0` (0 when no due sessions).
  - `streak` = consecutive past weeks (from `currentWeek − 1` backwards) with
    `planned > 0` and `completed/planned ≥ 0.8`; stop at the first failing/empty week.
  - `hours` = Σ over completed plan workouts of (linked `activity.moving_time/3600` when
    `icu_activity_id` matches an activity, else `duration_minutes/60`), 1 dp.

### `lib/plan/phases.ts`

`PlanPhase` reused from `@/types`. Exports `derivePhases`, `resolvePhases`. Phase band
colours (Tailwind, brand-aligned): base `blue-300`, build `blue-500`, peak `blue-800`,
taper `amber-400`.

## Components

All under `components/plan/`, mobile-first, fed the precomputed buckets/phases (no data
fetching of their own). Reuse `lib/chart-helpers` and the existing SVG sparkline idiom
from the Fitness page.

- **`PlanJourney.tsx`** — the hero graphic: a phase-band row (segments sized by each
  phase's week-span, coloured per `phases.ts`) above a row of `totalWeeks` week blocks
  coloured by `weekState` (done = solid, partial = split fill, missed = light red, current
  = brand with a yellow "you are here" outline, upcoming = faded). Trailing 🏁 event flag.
  Caption: `Wk {n} of {N} · {currentPhase} · {days} days to {event}`. Renders inside the
  existing blue hero card (replacing the static week bar + hardcoded phase line).
- **`ConsistencyStrip.tsx`** — three centred stats: `{hitPct}% sessions hit`,
  `🔥{streak} week streak`, `{hours}h this plan`. Hidden if `Σplanned === 0`.
- **`LoadComparisonChart.tsx`** — grouped SVG bars per week: planned (slate) vs actual
  (brand). Current week's actual rendered partial/lighter. Legend "▥ planned · █ actual".
- **`FitnessTrendChart.tsx`** — SVG: CTL solid + Form dashed over `wellness` filtered to
  `date ≥ planStart`. Caption: `Fitness (CTL) {+Δ} since start · Form {value}`. Hidden /
  "Not enough data yet" when fewer than ~3 wellness points in-window.

## Page integration

`app/plan/page.tsx`, MY PLAN tab (`planName` present): compute `buckets`, `phases`,
`consistency` once from `planWorkouts` + `syncData` + `currentFtp`, then render
`PlanJourney` (in the hero) → `ConsistencyStrip` → `LoadComparisonChart` →
`FitnessTrendChart` → existing Plan-actions card. No-plan state is unchanged.

## States & edge cases

| Condition | Behaviour |
|---|---|
| No active plan | Tab unchanged (existing empty state) |
| Stored `week_phases` present & length matches | Use them; else derive |
| Workout has no `steps` | Planned TSS via fallback IF table |
| `plan_weeks` null | Derive `totalWeeks` from last workout date |
| Plan overdue (today past end) | `currentWeek` clamped to last week |
| Unplanned rides | Count toward actual load; ignored by planned sessions/consistency |
| < 3 wellness points in window | Fitness trend shows "Not enough data yet" |
| `syncData` not yet loaded | Charts render once it arrives (existing async pattern) |

## Out of scope (v1)

- Tapping a journey week to drill into that week (Calendar already does this).
- Editing phases by hand; recomputing stored phases on plan review.
- Surfacing these modules outside the Plan tab (Dashboard, briefing).
- Claude-provided per-week TSS targets (planned load is computed from steps).

## Testing

- `lib/plan/phases.ts`: `derivePhases` produces base→build→peak→taper for a
  ramping-then-taper series; forces a final taper for long plans; `resolvePhases` prefers
  valid stored phases and falls back on length mismatch.
- `lib/plan/progress.ts`: `plannedTss` from steps and from the fallback table;
  `buildWeekBuckets` buckets workouts/activities into the right weeks and sums TSS;
  `weekState` transitions; `consistency` hit %, streak (stops at a sub-0.8 week), hours.
- Components: `PlanJourney` renders `totalWeeks` blocks with phase bands and a single
  "you are here" marker; `ConsistencyStrip` shows %/streak/hours and hides when no
  planned sessions; `LoadComparisonChart` renders a planned+actual pair per week;
  `FitnessTrendChart` renders CTL/Form polylines and the delta, and the empty state.
- `app/plan/page.tsx`: MY PLAN tab renders the four modules when a plan is active.
- Type gate: `npm run typecheck` clean.
