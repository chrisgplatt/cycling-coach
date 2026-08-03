# Batched Plan Generation Design

**Goal:** Stop long training plan generation from crashing, and make it noticeably faster.

## Background

Vercel's runtime error log confirmed the exact failure: `Task timed out after 300 seconds` on `/api/plan`, for a 12-week plan request. `POST /api/plan` currently generates a plan in one Claude call, streaming NDJSON progress events (`total`/`progress`/`done`/`error`) back to the client while `messageStream.finalMessage()` runs server-side. A 12-week plan needs Claude to produce ~50-60+ full workout objects (steps + coaching notes) in one JSON response, and the whole request must finish inside a single serverless invocation's time budget — which it did not.

Separately, the user observed generation taking ~5 minutes for just 20 workouts. `lib/claude/plan.ts`'s `createPlanStream` currently passes no explicit `thinking` parameter to `anthropic.messages.stream`, so per this repo's own `CLAUDE.md` policy ("adaptive thinking on by default... no explicit thinking config needed"), the model runs with uncapped adaptive thinking, drawing from the same 32,000-token budget as the visible output. That's a likely major contributor to the slowness, independent of the timeout.

## Architecture

`POST /api/plan` changes from "generate the whole plan in one call" to "generate one batch of up to 4 weeks per call." The client drives a sequential loop of separate HTTP requests — one per batch — so each batch gets a fresh serverless invocation with its own full time budget. This is the only approach that's actually guaranteed safe regardless of plan length, Claude API latency on a given day, or hosting plan tier: looping batches inside one request would still share a single invocation's time ceiling, which is the exact problem being fixed.

Batching always applies, in fixed 4-week chunks, for every plan regardless of length (a 5-week plan is a 4-week batch + a 1-week batch; a plan of 4 weeks or fewer is a single batch, unchanged from today's single-call behavior in all but plumbing).

## Components

### `computeWeekPhases(totalWeeks: number): PlanPhase[]` — `lib/plan/phases.ts`

A new deterministic function implementing the `CLAUDE.md` phase-duration matrix (4/6/8/10/12/16/20-week anchor rows, each with fixed base/build/peak/taper week counts) directly in code, replacing today's behavior where Claude decides `week_phases` itself from the same table (described to it as prose) after seeing the whole plan length in one shot. This removes the entire class of cross-batch phase inconsistency: with batching, no single Claude call sees the whole plan, so periodization can no longer be a decision Claude makes freely — it must be a fixed input every batch receives identically.

Algorithm: find the nearest anchor row to `totalWeeks` by absolute week distance (ties broken toward the smaller anchor). Let `delta = totalWeeks - anchorWeeks`. Add `delta` to the anchor's base-phase week count (base compresses for shorter plans, extends for longer ones, matching `CLAUDE.md`'s "compress base first" rule); if this would take base below 1 week, clamp base to 1 and move the remaining deficit onto the build-phase count instead. Build (after this adjustment), peak, and taper week counts otherwise come directly from the matched anchor row. Lay weeks out in fixed order: all base weeks, then all build weeks, then all peak weeks, then all taper weeks, for exactly `totalWeeks` entries.

This function is also the sole source of the final merged plan's `week_phases` field — Claude no longer returns `week_phases` in its JSON at all, for any batch.

### `buildPlanBatches(totalWeeks: number, batchSize = 4): Array<{ startWeek: number; weekCount: number }>` — `lib/plan/phases.ts`

Pure helper computing batch boundaries using the same 0-based week-index convention as `WeekBucket.weekIndex` elsewhere in the codebase (`buildWeekBuckets`, `resolvePhases`). E.g. 12 weeks → `[{0,4},{4,4},{8,4}]`; 10 weeks → `[{0,4},{4,4},{8,2}]`.

### Prompt building — `lib/claude/plan.ts`

`buildPrompt` becomes batch-aware. It keeps the shared sections (profile, wellness, recent activities, load calibration, step rules, coaching-notes guidance) but:

- Scopes the "PLAN LENGTH" instruction to just this batch's week window (explicit calendar dates for `batchStartWeek`..`batchStartWeek + batchWeekCount`), while also stating the batch's position in the whole plan (e.g. "This is weeks 5-8 of a 12-week plan — do not taper or treat this as the plan's end unless these are genuinely the plan's final weeks") so a middle batch doesn't wind down early.
- Replaces the old "WEEK PHASES: also return..." instruction with a fixed "PERIODIZATION PHASES FOR THESE WEEKS" section listing this batch's exact slice of `computeWeekPhases(totalWeeks)` (e.g. "Week 5: build, Week 6: build, Week 7: peak, Week 8: taper") as a directive, not a decision Claude makes.
- For `batchIndex > 0`, adds a new "PLAN SO FAR" section summarizing all prior batches' actual planned workouts and per-week TSS totals (reusing the existing weekly-TSS-summary formatting style already used for real ride history), so load progression and de-load timing continue coherently instead of resetting.
- Adjusts the requested JSON schema: batch 0 still returns `rationale`, `target_event_name`, `target_event_date` alongside `workouts`; batches after the first return only `{"workouts": [...]}` — those fields are fixed by batch 0 and never need re-deciding. The plan's top-level `phase` (opening phase label) is no longer asked of Claude at all — it's redundant with `computeWeekPhases(weeks)[0]`, so the client derives it the same way it derives `week_phases`.

`createPlanStream` adds an explicit `thinking: { type: 'enabled', budget_tokens: 4000 }` to the `anthropic.messages.stream` call (verified against the installed `@anthropic-ai/sdk` types: `ThinkingConfigParam` is `ThinkingConfigEnabled | ThinkingConfigDisabled | ThinkingConfigAdaptive`, with `enabled` requiring `budget_tokens >= 1024`). This explicitly overrides `CLAUDE.md`'s "adaptive by default" policy for this one call site — the task is now fully rule-specified per batch, so it shouldn't need open-ended reasoning depth, and a fixed budget should cut generation latency substantially.

### `POST /api/plan` — `app/api/plan/route.ts`

Request body gains four fields on top of the existing `syncData`/`startDate`/`notes`/`training_philosophy`:

```
totalWeeks: number       // whole plan length (already sent today as `weeks`, renamed for clarity)
batchIndex: number       // 0-based
batchStartWeek: number   // 0-based week offset of this batch within the whole plan
batchWeekCount: number   // weeks in this batch (4, except possibly the last batch)
priorWorkouts?: GeneratedWorkout[]   // all workouts generated by earlier batches; omitted/empty for batchIndex 0
```

The response stream keeps its existing NDJSON shape (`total`/`progress`/`done`/`error`) unchanged. `total` continues to report the whole plan's estimated workout count (via the existing `countPlannedWorkouts`, called with the full `totalWeeks`/`startDate`) — sent identically by every batch, since it doesn't change; the client only needs to read it once. `progress` reports this batch's own running count of workouts found so far in its own response.

### Client loop — `app/plan/page.tsx`

`startPlanGeneration` computes `buildPlanBatches(weeks)` and calls `POST /api/plan` once per batch, sequentially (awaiting each fully before starting the next). It tracks:

- `completedBeforeThisBatch`: total workouts confirmed from prior batches' `done` events, so the visible progress bar shows `completedBeforeThisBatch + <this batch's progress>` cumulatively across the whole loop instead of resetting to 0 each batch.
- `allWorkouts`: concatenation of every batch's `done.plan.workouts`, in order (already date-ordered since batches are sequential by week).
- `head`: `{ rationale, target_event_name, target_event_date }` captured from batch 0's `done` event only.

If any batch's request fails — non-OK response, an `error` NDJSON event, or a thrown network error — the loop stops immediately, `saveError` is set to a message identifying which weeks failed (e.g. "Plan generation failed while building weeks 5-8 — please try again."), and `setGeneratedPlan` is never called. This preserves the existing all-or-nothing approval flow exactly: there is no partial-plan state anywhere else in the app (approval modal, history, PATCH/insert) that needs to change, because a partial batch failure never produces a `GeneratedPlan` object at all.

Once every batch succeeds, the client assembles the final `GeneratedPlan` exactly as today's shape: `{ ...head, phase: computeWeekPhases(weeks)[0], week_phases: computeWeekPhases(weeks), workouts: allWorkouts }`, and opens `PlanApprovalModal` as it already does. No changes are needed to `PlanApprovalModal`, the `PATCH /api/plan` approval/save path, or anything downstream — they already operate on this same `GeneratedPlan` shape.

## Error Handling

- Any batch failing aborts the whole generation (no partial plans), per the design decision above.
- The empty-workouts validation already added to `parsePlanText` (previous fix) continues to apply per batch, catching a batch that returns valid JSON with zero workouts.
- Existing per-request error paths (missing profile, no events configured, Claude API errors) are unchanged — they're evaluated once, before the batch loop starts, exactly as today.

## Testing

- `computeWeekPhases`: unit tests against each `CLAUDE.md` anchor row (4/6/8/10/12/16/20) directly, plus at least one interpolated length (e.g. 13 weeks extending 12's base by one week) and one short-plan case exercising the base-clamp-to-1/borrow-from-build path.
- `buildPlanBatches`: exact multiples of 4, and a non-exact length producing a shorter final batch.
- `lib/claude/plan.ts` prompt building: batch 0's prompt omits "PLAN SO FAR"; batch >0's prompt includes it with the correct prior workouts/TSS; every batch's prompt includes the correct phase slice; `thinking` is passed to `anthropic.messages.stream` with the fixed budget.
- `app/api/plan/route.ts` POST: batch-scoped requests produce the right prompt inputs and NDJSON events; `total` reflects the whole plan regardless of `batchIndex`.
- `app/plan/page.tsx` client: a 3-batch mock sequence where the second batch fails — asserts the loop stops, `saveError` is shown, `setGeneratedPlan` is never called, and no third batch request is made.
