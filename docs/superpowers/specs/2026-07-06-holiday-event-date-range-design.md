# Holiday Event Date Range Design

## Goal

Extend the Events tab's "Holiday riding" event type to span a date range (start → end) instead of a single day, so the plan generator blocks the whole holiday, builds volume beforehand, and resumes normally after — instead of only blocking one day of what's actually a multi-day trip. Also let the athlete flag a holiday as "continue training", in which case the days aren't blocked at all — instead the coach seeds in a couple of optional, skippable quality sessions across the window and leaves the rest of the days free.

## Background

This app already has a separate "Unavailability Periods" feature (`UnavailabilityPeriod`, `types/index.ts`) with its own `holiday` type that supports date ranges, ICU sync, and calendar banners — but that system only feeds the coach chat and daily briefing, not plan generation's periodization rules in `lib/claude/plan.ts`, which only ever reads the single-day `TrainingEvent` list. This design extends the `TrainingEvent` `holiday` type specifically, since that's the one driving plan-generation periodization ("Holiday riding" rules in `CLAUDE.md` and `lib/claude/plan.ts`). Unavailability Periods is unaffected and stays as-is.

## Data Model

Add one optional field to `TrainingEvent` (`types/index.ts`):

```ts
export interface TrainingEvent {
  // ...existing fields...
  end_date?: string   // YYYY-MM-DD, inclusive — only used by type: 'holiday'
}
```

`end_date` is optional and only ever set for `type: 'holiday'`. Every other event type continues to be treated as single-day (`end_date` absent → falls back to `date` everywhere).

## Shared Helpers (`lib/events.ts`)

New helpers alongside the existing `estimateEventTss`, used everywhere the codebase currently does a single-date comparison against an event:

```ts
export function eventEndDate(e: Pick<TrainingEvent, 'date' | 'end_date'>): string {
  return e.end_date ?? e.date
}

export function eventCoversDate(e: Pick<TrainingEvent, 'date' | 'end_date'>, dateStr: string): boolean {
  return dateStr >= e.date && dateStr <= eventEndDate(e)
}

export function eventDurationDays(e: Pick<TrainingEvent, 'date' | 'end_date'>): number {
  return Math.round((new Date(eventEndDate(e)).getTime() - new Date(e.date).getTime()) / 86400000) + 1
}
```

String comparison works here because dates are always `YYYY-MM-DD` — the same pattern already used throughout the codebase (e.g. `UnavailabilityPeriod` date handling).

## Blocking Logic

Every place that currently blocks/matches on `e.date` alone becomes range-aware using the helpers above:

- **`lib/claude/schedule.ts`'s `formatPlanCalendar`** — its `events` param gains optional `end_date`; the day-by-day loop marks a day BLOCKED if `eventCoversDate` is true for any event, not just an exact match. (Continue-training holidays get a third status — see Continue-Training Holidays below.)
- **`lib/claude/plan.ts`'s `countPlannedWorkouts`** — `blockedDates` becomes a range check (`events.some(e => eventCoversDate(e, dateStr))`) instead of an exact-match `Set`.
- **`lib/claude/plan.ts`'s EVENTS prompt section** — each holiday line shows the full range (e.g. `2026-08-10 to 2026-08-17 BLOCKED`) instead of a single date.
- **`lib/claude/review.ts`** — its `formatPlanCalendar` call passes `end_date` and `continueTraining` through in its events mapping (currently maps to `{date, name}` only) so review-time calendars are range-aware and continue-training-aware too.

## Periodization & Coaching Prompt Changes

`lib/claude/plan.ts`'s "Holiday riding" periodization rule updates to reference the range:

```
Holiday riding (type: holiday):
  - Every date from the start date to the end date: BLOCKED (athlete is self-directing their riding)
  - 1–2 weeks before the start date: Build aerobic volume; aim for positive or near-zero form going in
  - After the end date: Resume normal schedule
```

`CLAUDE.md`'s mirrored "Holiday riding" rule gets the same wording update, since it must stay in sync with the prompt per this project's convention (CLAUDE.md's Training Plan & Workout Generation Rules section documents the rules that must be present in prompt context).

**Filtering bug this surfaces:** several places filter "upcoming events" with `e.date >= today`, which incorrectly drops a holiday that has already started but hasn't ended (e.g. day 3 of a 7-day trip — the start date is in the past, so the event falls out of the filter even though it should still be treated as active). These switch to `eventEndDate(e) >= today`:

- `lib/claude/chat.ts`, `lib/claude/session-chat.ts`, `lib/claude/feedback.ts` — "upcoming events" filters and their display lines (each line shows the range when `end_date` is present, e.g. `2026-08-10 to 2026-08-17 (in 3 days, ends in 10 days): Family trip (holiday, priority B)`)
- `app/dashboard/page.tsx`'s `todayEvent` lookup — becomes `events.find(e => eventCoversDate(e, todayStr))` so `TodayCard` correctly shows "Holiday day" on every day of the trip, not just the first
- `app/dashboard/page.tsx`'s `upcomingEvents` filter — becomes range-aware the same way, so an in-progress holiday still shows

No changes needed to "days until it starts" countdown logic (`nearestEvent`/`eventCountdown` in `app/dashboard/page.tsx`, the `diffDays`/countdown text in `app/plan/page.tsx`'s events list) — counting down to the start date is still correct for a holiday. Only the separate "is this event over" check (used to hide Edit/Delete once an event is done) needs to switch to the end date — see Events tab list below.

## UI Changes

### `components/AddEventModal.tsx`

When `type === 'holiday'`, an "End date" field appears directly under "Date" (defaults to the same value as Date when first switching to Holiday, so a single-day holiday is still just one tap away). Validation: end date ≥ start date. Switching away from Holiday to another type clears `end_date`.

### `components/EventDetailModal.tsx`

- Header shows the range (e.g. `10 Aug – 17 Aug`, matching the existing Unavailability Periods list formatting in `app/plan/page.tsx`) instead of a single date when `end_date` is present.
- The "assign completed ride result" section (and the `result_tss`/`result_avg_power`/`result_note` result-card) is hidden entirely for `type === 'holiday'` — that feature no longer applies once a holiday isn't a single measurable ride. Race note/result fields stay untouched for race/sportive/fitness events.
- "Past event" logic (which hides the Edit button) switches from `event.date < today` to `eventEndDate(event) < today` — a holiday is only "done" once its last day has passed.

### Events tab list (`app/plan/page.tsx`)

The events list adopts the same date-range display already used just below it for Unavailability Periods (`10 Aug – 17 Aug · 8 days` when multi-day, plain single date otherwise, via `eventDurationDays`). The countdown text itself (`In 3 days` / `Tomorrow` / `5d ago`) stays keyed on the start date, unchanged. Only the "is this event done" check (which hides Edit/Delete once an event is past) switches from `diffDays < 0` (based on `event.date`) to `eventEndDate(event) < today` — a holiday isn't done until its last day has passed.

### Calendar page (`app/calendar/page.tsx`)

The same red `EventCard` already rendered for single-day events now renders in every day cell the holiday covers: `dayEvents` filtering changes from `e.date === dateStr` to `eventCoversDate(e, dateStr)`. No new banner component — this reuses the existing per-day rendering path exactly as-is.

## ICU Sync

`lib/intervals/client.ts`'s `createTargetEvent`/`updateTargetEvent` gain an optional `end_date` param, sent as `end_date_local` — mirroring the try/fallback pattern already proven in `createUnavailabilityEvent`/`updateUnavailabilityEvent` (if intervals.icu rejects `end_date_local`, retry without it, same as today's single-day behavior). `app/api/events/create/route.ts` and `app/api/events/update/route.ts` pass `end_date` through when present.

## Continue-Training Holidays

A holiday can be flagged so training continues through it instead of stopping entirely: `continue_training?: boolean` on `TrainingEvent` (`types/index.ts`), shown in `AddEventModal.tsx` as a toggle alongside the End date field, only when `type === 'holiday'`.

When set:
- The holiday's dates are **not** BLOCKED for scheduling purposes.
- Plan generation places a small, sparse set of **optional** quality sessions across the window instead of a normal full week — roughly 2 per 7 days (1 threshold + 1 interval/VO2max, matching the existing "max 1 threshold + max 1 VO2max/week" caps in `CLAUDE.md`), scaled sensibly for shorter/longer holidays. Every other day in the window stays free, self-directed riding — no mandatory endurance/recovery filler gets scheduled there.
- These sessions are flagged `optional: true` so skipping one carries no adherence penalty — the weekly review won't read a skipped optional session as reduced adherence.

### Data model

- `types/index.ts`: `TrainingEvent.continue_training?: boolean`
- `Workout.optional: boolean` (new column, default `false`) — same shared workout-entry shape used by `GeneratedPlan.workouts[]` (`lib/claude/plan.ts`, used by fresh generation, extension, and weekly review) and `NewWorkoutProposal` (the plan-chat "add a new session" tool call), so one field addition threads through all three workout-creation paths.
- Migration: `alter table workouts add column if not exists optional boolean not null default false;`

### Where it plugs in

Every place that currently renders an event's "BLOCKED" line for the coaching prompts gets a `continue_training`-aware branch. Rather than duplicate that branch across every prompt-building file, a shared helper handles it:

```ts
// lib/events.ts
export function formatEventBlockLine(e: TrainingEvent, dateLabel: string): string {
  if (e.type === 'holiday' && e.continue_training) {
    return `${dateLabel} — self-directed riding, optional quality sessions only (no mandatory workout): ${e.name}`
  }
  return `${dateLabel} BLOCKED: ${e.name}`
}
```

Used by: `lib/claude/plan.ts` (EVENTS section + `formatPlanCalendar`'s day status), `lib/claude/review.ts` (its own EVENTS line + calendar), `app/api/chat/plan/route.ts` (its EVENTS line), and the "upcoming events" lines in `lib/claude/chat.ts`, `session-chat.ts`, `feedback.ts`.

`formatPlanCalendar`'s day-status logic needs a third branch, since a continue-training holiday day is neither BLOCKED nor a normal capacity-limited training day (if it fell back to normal "train — up to N min" status, the model could read that as license to fill every day with a full mandatory session, defeating the "sparse optional sessions only" intent). Its `events` param becomes `Array<{ date: string; end_date?: string; name: string; continueTraining?: boolean }>`, and the per-day status resolves in this order: any covering event with `continueTraining` → `` `HOLIDAY (continuing to train) — optional quality session only, no mandatory workout: ${name}` ``; else any covering event → `BLOCKED`; else the existing train-capacity/REST logic.

`lib/claude/plan.ts`'s `countPlannedWorkouts` treats `continue_training` holiday days as **not** blocked but also not normal training days — they're excluded from the deterministic day-count/cap logic entirely (the sparse optional sessions are placed by the model's judgement, not the deterministic availability count). `countPlannedWorkouts`'s returned total is a pre-generation estimate already; it will slightly undercount these sessions, which is an accepted simplification, not a bug.

`lib/claude/plan.ts`'s "Holiday riding" periodization rule gains a second branch:

```
Holiday riding (type: holiday):
  - Default: every date from start to end date is BLOCKED (self-directed riding); build volume 1-2 weeks before, resume normal after.
  - If continue_training is set: do NOT block these dates. Instead place roughly 2 optional quality sessions per 7 days of the holiday (1 threshold + 1 interval/VO2max), each with "optional": true. Leave every other day in the window free — no mandatory endurance/recovery session. Do not apply the "build volume before / resume after" adjustment, since training continues through the period.
```

The same instruction (not just an implicit "apply the same constraints as initial plan generation") is added to `lib/claude/review.ts` and `app/api/chat/plan/route.ts`'s system prompts, since each needs to actively know to emit `optional: true` on new workout entries.

### Insertion points

`optional` threads through the three places that insert generated workouts: `app/api/plan/route.ts`, `app/api/plan/extend/route.ts`, `app/api/plan/review/route.ts` (`workoutsToInsert` mapping gains `optional: w.optional ?? false`), and `app/api/workouts/route.ts`'s POST handler (used when a plan-chat proposal's `new_workouts[]` is applied).

### UI

- `components/WorkoutCard.tsx` — an "Optional" badge (dashed border or amber pill, consistent with the existing `WORKOUT_STATUS_CHIP` styling in `lib/workout-colours.ts`) shown when `workout.optional` is true.
- `lib/claude/review.ts`'s skipped-session line already shows `missed_reason`; when the workout is `optional`, the line reads `skipped (optional — holiday, no penalty)` instead, so the review AI doesn't misread it as reduced adherence.

## Global Constraints

- `end_date` and `continue_training` are only ever set for `type: 'holiday'` — the Add/Edit Event form only shows these fields for that type; all other event types remain single-day and always blocked.
- Every date-comparison call site touching `TrainingEvent` must use the `eventEndDate`/`eventCoversDate`/`eventDurationDays` helpers from `lib/events.ts` rather than a fresh inline comparison — this is what fixes the in-progress-holiday filtering bug consistently everywhere.
- Every "BLOCKED" line rendered for a coaching prompt must go through `formatEventBlockLine` rather than a fresh inline string, so the continue-training branch is applied consistently everywhere an event is described to the model.
- Unavailability Periods (`UnavailabilityPeriod`, `AddUnavailabilityModal.tsx`, `/api/unavailability/*`) are out of scope and must not be modified.
- The result-assignment feature (`EventDetailModal.tsx`'s ride-result section, `/api/events/result`) is hidden for `type === 'holiday'` but unchanged for all other event types.
- `continue_training` sessions are always `optional: true`; this design does not add an `optional` toggle anywhere else (e.g. manual workout creation outside the plan-chat flow keeps its existing behavior).

## Testing

- `__tests__/lib/plan-calendar.test.ts` — new cases: an event with `end_date` blocks every day in its range, not just the start date; a `continue_training` holiday does not block its days.
- New `__tests__/lib/events.test.ts` for `eventEndDate`/`eventCoversDate`/`eventDurationDays`/`formatEventBlockLine`.
- `__tests__/lib/claude-plan.test.ts` — update/add cases for the new periodization wording, multi-day BLOCKED lines, and the continue-training branch.
- `__tests__/components/AddEventModal.test.tsx`, `EventDetailModal.test.tsx` — new cases for the End date field, the Continue training toggle, and the hidden result section.
- `__tests__/components/WorkoutCard.test.tsx` — new case for the Optional badge.
- No new tests for the API routes or `chat.ts`/`session-chat.ts`/`feedback.ts` prompt text — consistent with this codebase's existing convention of not testing these directly.
