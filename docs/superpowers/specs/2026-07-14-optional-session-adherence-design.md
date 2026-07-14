# Optional Session Adherence Design

## Goal

Optional workouts (`workouts.optional === true`, used for sparse continue-training-holiday sessions) currently count in both "Sessions" totals shown on the dashboard even when they're still pending or were skipped — contradicting the field's own documented intent (`types/index.ts:108`: "skipping carries no adherence penalty"). Change both Sessions counts so an optional workout is only included in the total once it's done.

## Background

Four separate places compute a "sessions completed vs planned" ratio:

1. **Season-level adherence** — `computeProgressMetrics`'s `adherence` field (`lib/progress/metrics.ts:92-99`), fed by `planWorkouts` fetched in `lib/progress/brief-generator.ts:49-53` via `select('status, date').eq('plan_id', plan.id)`. Rendered by `components/ProgressStats.tsx`.
2. **Weekly progress** — `weeklyProgress.sessionsTotal`/`sessionsCompleted` (`app/dashboard/page.tsx:486-492`), derived from `weekWorkoutsWP = workouts.filter(w => weekDates.includes(w.date))`. Rendered by `components/ProgressStats.tsx`.
3. **Plan-page "sessions hit %"** — `consistency()`'s `hitPct` (`lib/plan/progress.ts:84-106`), fed by `WeekBucket.plannedSessions`/`completedSessions` as built in `buildWeekBuckets` (`lib/plan/progress.ts:46-73`). Rendered by `components/plan/ConsistencyStrip.tsx` via `app/plan/page.tsx`. Also feeds `weekState`'s `'done'`/`'partial'`/`'missed'` classification (`lib/plan/progress.ts:75-82`) and the plan page's own streak.
4. **Weekly Review Banner** — `lastWeekStats.completed`/`total` (`app/dashboard/page.tsx:229-233`), a raw filter over last week's workouts, rendered by `components/WeeklyReviewBanner.tsx:20` as "X of Y workouts completed last week."

None of the four currently reads `optional`, so an optional workout is counted in every total the moment it's scheduled, and drags each ratio down if it's never done — exactly what the field comment says shouldn't happen. (Sites 3 and 4 were found during two rounds of final whole-branch review of this feature — the user chose to extend the fix to both rather than leave any screen inconsistent with the others.)

## Rule

For optional workouts: include in the total only when "done" — `status === 'completed'` or `status === 'needs_review'` (a needs_review workout already has a matched ride; it just needs confirmation, so it counts as done for this purpose). A `planned` or `skipped` optional workout is excluded entirely: not counted in the total, not counted as missed.

For non-optional workouts: unchanged. Always counted in the total; only literal `status === 'completed'` counts toward the numerator.

Concretely, per workout `w`:
- **Counted in total** when `!w.optional || w.status === 'completed' || w.status === 'needs_review'`
- **Counted in the numerator** when `w.status === 'completed' || (w.optional && w.status === 'needs_review')`

(The second clause only adds optional+needs_review to the numerator — a non-optional needs_review workout still does not count as completed, matching today's behavior.)

## Out of scope

- **Streak** (`lib/progress/metrics.ts:101-121`) — has no "total" to affect; an optional workout not being completed already doesn't help or hurt the streak's weekly numerator. No change needed.
- **Weekly planned TSS/time** (`weeklyProgress.tssPlanned`, `timePlannedMins`, both derived from the unfiltered `weekWorkoutsWP`) — these track actual planned training load, not session counting. Changing them wasn't requested and would silently shrink the planned-TSS number whenever an optional ride is still pending.
- **`weeklyProgress.sessionsCompleted`'s underlying `completedWP`** stays as-is for every other stat it feeds (`tssActual`, `distanceKm`, `elevationM`, `timeActualMins`) — only the `sessionsCompleted` count itself gets the optional+needs_review numerator rule above; the other stats keep using the existing "literal completed" filter.
- **`lib/plan/progress.ts`'s `plannedTss`/`WeekBucket.plannedTss`** — same load-vs-count distinction as above: `buildWeekBuckets` keeps adding every workout's `plannedTss` unconditionally; only `plannedSessions`/`completedSessions` (the counts `hitPct`, `weekState`, and the plan-page streak derive from) apply the countable/numerator rule.
- **`lib/plan/progress.ts`'s local `isDone` helper and `planHours`** — `isDone` (`status === 'completed' || status === 'needs_review'`, no optional check) is a separate, pre-existing "done" definition used only by `planHours` (hours trained across the plan — a load metric, not a session count). Left untouched; not unified with `isSessionCompleted` as part of this feature.

## Implementation sketch

- `lib/progress/metrics.ts`: in `computeProgressMetrics`, add `optional: boolean` to the `PlanWorkout` interface. Replace the adherence block's `pastAndToday`/`completed`/`total` derivation with the countable/numerator logic above.
- `lib/progress/brief-generator.ts`: add `optional` to the `planWorkouts` select (`select('status, date, optional')`) and to the inline `Array<{ status: WorkoutStatus; date: string }>` type annotation.
- `app/dashboard/page.tsx`: compute `sessionsTotal`/`sessionsCompleted` from the countable/numerator logic above applied to `weekWorkoutsWP`, without changing `weekWorkoutsWP` itself (so `tssPlanned`/`timePlannedMins` and `completedWP`'s other consumers are untouched).
- `lib/plan/progress.ts`: in `buildWeekBuckets`'s per-workout loop, keep `buckets[i].plannedTss += plannedTss(w)` unconditional, but only increment `plannedSessions` (and, inside that, `completedSessions`) when the workout passes the countable/numerator logic above. `weekState` and `consistency` need no direct changes — both already derive purely from `plannedSessions`/`completedSessions`, so they inherit the fix automatically.
- `app/dashboard/page.tsx`: apply the same countable/numerator logic to `lastWeekStats.completed`/`total` (currently a raw `status === 'completed'` filter over last week's workouts) — reusing the `isSessionCountable`/`isSessionCompleted` import already added for `weeklyProgress`, no new import needed.

## Testing

- `__tests__/lib/progress-metrics.test.ts`: extend the existing adherence test coverage with cases for an optional workout that's `planned` (excluded from total), `skipped` (excluded from total), `needs_review` (counted in both total and numerator), and `completed` (counted in both, unchanged), alongside a mix with non-optional workouts to confirm those are unaffected.
- `app/dashboard/page.tsx`'s `weeklyProgress` and `lastWeekStats` calculations have no dedicated test file — consistent with this codebase's established convention for large interactive page components (no automated test; verified via typecheck + manual reasoning about the derivation).
- `__tests__/lib/plan-progress.test.ts`: extend `buildWeekBuckets`'s test coverage with a pending optional workout (excluded from `plannedSessions`/`completedSessions`, but its `plannedTss` still counted) and a completed optional workout (counted in both, same as non-optional).
