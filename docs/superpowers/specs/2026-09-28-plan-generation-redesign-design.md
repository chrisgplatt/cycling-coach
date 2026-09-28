# Plan generation redesign: deterministic scheduler + parallel fill-in + background jobs

## Problem

Plan generation, weekly review/adaptation, and plan extension all share one architecture: the client opens a `fetch` to a Next.js route, the route streams tokens from Claude back as NDJSON, and the client reads the stream with `res.body.getReader()` for the entire duration. Generation is further split into sequential week-batches (`lib/plan/generate-batches.ts`) purely to stay under the serverless function timeout — each ~6-week batch has measured up to ~155s, and batches cannot run in parallel because each one is given the previous batch's output as context.

This causes three linked problems:

1. **Crashes.** This is a PWA used mainly on iPhone. iOS suspends a standalone PWA's JS/network almost immediately when the screen locks, killing the open fetch. All progress in that request is lost — nothing is persisted until the user reviews and saves the finished plan.
2. **Speed.** A 12-week plan is 2 sequential batches (~5 min); a 20-week plan is 4 (~10 min), all requiring the tab to stay foregrounded continuously.
3. **Token cost.** Every batch re-derives the full periodization structure (phase logic, event taper rules, hard scheduling constraints) from scratch inside one large Claude call, on top of writing the actual sessions.

All three share a root cause: Claude is doing deterministic scheduling work and creative session-writing work in the same large, sequential call. Most of the scheduling logic is already fully specified as rules in `CLAUDE.md` (phase-duration matrix, session-type distribution per phase, de-load cadence, weekly caps, event preparation rules) — it doesn't need to be decided by an LLM, and a previous partial step in this direction already exists: `computeWeekPhases()` (`lib/plan/phases.ts`) deterministically computes the base/build/peak/taper label per week, and `PLAN_MODEL` was already swapped from Opus 5 to Sonnet 5 for generation as a speed trial. What's still inside the Claude prompt today is the *day-by-day session-type calendar* — which day gets threshold vs. endurance vs. recovery, de-load weeks, the event taper windows, and the hard scheduling constraints — all of which is rule-based today only in the sense that it's written into the prompt text and hoped-for, not enforced.

## Goals

- Cut generation/review/extend wall-clock time from minutes to low tens of seconds.
- Make phone-lock (or closing the tab) non-fatal: no work is lost, and the user doesn't have to keep the app foregrounded.
- Reduce token spend by moving periodization reasoning out of the LLM entirely.
- Apply one consistent pattern across all three flows (generate, weekly review/adaptation, extend).

## Non-goals

- Per-session "regenerate just this one workout" UI — the architecture below enables it cheaply later, but it isn't part of this change.
- Offline support — the user still needs connectivity to submit a job and eventually see the result; this only removes the requirement to stay connected *continuously* for the whole generation.
- Changing the review/extend UX beyond swapping their transport — the review modal, extend modal, and the plan-save (`PATCH /api/plan`) flow keep their current shape.

## Architecture: two tiers + background job

### Tier 1 — Deterministic scheduler

New module `lib/plan/scheduler.ts`. Pure function, no LLM, no I/O. Input: athlete profile (`weekly_availability`, `events`, `min/max_sessions_per_week`, `current_ftp`), plan start date, total weeks (or, for review/extend, just the affected date range), and an "emphasis" object (see below). Output: one skeleton entry per calendar day in range:

```ts
type ScheduledDay =
  | { date: string; kind: 'rest' | 'event_blocked' }
  | {
      date: string
      kind: 'session'
      type: 'recovery' | 'endurance' | 'tempo' | 'threshold' | 'intervals' | 'long_ride' | 'test'
      duration_minutes: number
      phase: 'base' | 'build' | 'peak' | 'taper'
      target_tss: number
      optional: boolean
    }
```

The scheduler owns every rule that's already written down as a rule in `CLAUDE.md`, and nothing else:

- Phase per week — reuses `computeWeekPhases()` unchanged.
- Rest days — any day absent from `weekly_availability`; never assigned a session.
- Event blocking and taper windows — the full event-preparation table (race/sportive taper, holiday blocking/`continue_training`, fitness-checkpoint, priority A/B/C rules, the "B/C inside an A taper defers to A" conflict rule).
- Session-type distribution per phase (≥75% Z1–Z2 in base, etc.), the `threshold-heavy`/`simplified` intensity-profile overrides.
- Weekly hard caps: max 1 threshold/week, max 1 VO2max-or-interval/week, min 1 recovery/week, never two hard sessions on consecutive days, back-to-back long rides only in base/build for sportive/gran-fondo goals.
- De-load every 3rd training week (Z1–Z2 only, 40–50% TSS of the preceding week, placed at block-end if phase length doesn't divide evenly into 3).
- Duration ceiling per day from `weekly_availability`, never padded beyond what the session type/phase needs.

This is the part of the design most worth getting right, since it's now real code instead of prompt text that Claude might not follow — see Testing below.

**Emphasis interpretation.** The one genuinely non-deterministic input is the athlete's free-text `goals` and plan notes (e.g. "climbing + weight loss" → blend of sustained Z3–Z4 climbing simulation and maximised Z2 volume). A single short, fast Claude call (`lib/claude/plan-emphasis.ts`, no extended thinking needed — it's a small classification/weighting task) turns that free text into a structured emphasis object the scheduler consumes (e.g. relative weighting across endurance/climbing/speed/weight-loss emphases) plus the plan's narrative `rationale` paragraph for display. This call has no dependency on the schedule itself, so it runs in parallel with the scheduler, and gets a safe deterministic fallback (even weighting, generic rationale) if it errors rather than blocking the job.

### Tier 2 — Parallel session fill-in

New module `lib/claude/session-fill.ts`. For each `session` entry the scheduler produced, a small independent call takes just that day's `type`/`duration_minutes`/`phase`/`target_tss`/zone watts (derived from FTP) plus athlete context (recent activity summary, dossier, coaching-notes guidance) and returns `description`, `steps[]`, `coaching_notes`, matching today's `GeneratedPlan['workouts'][number]` shape exactly. No fill-in call depends on another's output, so all of them run concurrently (`Promise.all`, batched a handful of sessions per call — e.g. one call per calendar week of sessions rather than one per single day — to cut round-trip overhead while keeping batches independent; exact chunk size is an implementation-time tuning call based on measured latency). Because the hard reasoning already happened in Tier 1, these prompts are far smaller and need no scheduling instructions at all — just "write this one session."

### Delivery — background job, not a held-open stream

New table `plan_generation_jobs` (migration below). `POST /api/plan`, `POST /api/plan/review`, and `POST /api/plan/extend` all change shape: validate the request, insert a `pending` job row, kick off the actual work with `waitUntil()` (from `@vercel/functions`) so it keeps running after the response is sent, and return `{ job_id }` immediately instead of a stream. A new `GET /api/plan/jobs/[id]` returns the job's current `status`/`progress`/`result`/`error`, scoped to the authenticated user.

The client (`lib/plan/generate-batches.ts`, renamed to reflect the new job-submit-and-poll role, and the equivalent review/extend call sites) submits the job, then polls the status endpoint on an interval while the tab is foregrounded, plus once immediately on `visibilitychange` back to visible (so resuming from a lock updates instantly instead of waiting for the next tick). Because job state lives in Supabase, a poll that never happens because the phone was locked simply means the next poll — whenever it happens — reads whatever state the server-side job has already reached. Nothing is lost, and nothing needs to restart. On job completion, a push notification fires via the existing `lib/push.ts` `sendPush()` to the user's stored subscription (respecting `notifications_enabled`), so the user can find out even with the app fully closed.

The `onTotal`/`onProgress` callback shape the UI already consumes stays the same, so `app/plan/page.tsx`'s progress display needs minimal changes — the progress source just becomes polled job state instead of a live stream.

Once a job reaches `done`, its `result` is a `GeneratedPlan` in exactly today's shape, so `PATCH /api/plan` (save + upload to intervals.icu) is untouched by this change.

### Reuse across generate / review / extend

- **Generate**: Tier 1 schedules the whole plan length; Tier 2 fills every session.
- **Review/adaptation**: Tier 1 recomputes the skeleton for *remaining* weeks only, applying the load-calibration table (missed sessions → reduce, unplanned rides → note fatigue and reduce, good form + positive feedback → increase ≤10%, etc.) against actual vs. planned TSS pulled from intervals.icu — the same kind of rule table as periodization, just keyed off actuals instead of a fixed matrix. The emphasis-equivalent call here weighs the athlete's subjective note against the objective wellness/TSS data per the "wellness vs. metrics conflict" rule. Tier 2 regenerates session content only for days that actually changed, not the whole remaining plan.
- **Extend**: Tier 1 computes the skeleton for only the *new* weeks appended (reusing `computeWeekPhases` for the new total length); Tier 2 fills only those new days. Existing weeks are untouched.

## Data model

```sql
-- plan_generation_jobs migration
create table if not exists plan_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('generate', 'review', 'extend')),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  request jsonb not null,
  progress jsonb not null default '{"total": 0, "completed": 0, "failed_days": []}',
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table plan_generation_jobs enable row level security;
create policy "own data" on plan_generation_jobs
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Per the project's migration rules, this must be run against the shared Supabase project (SQL editor, or `supabase db push` if linked) before or alongside deploying the code that depends on it, followed by `notify pgrst, 'reload schema';`.

## Error handling

- **Tier 1 failures**: the scheduler itself is pure deterministic code, so it can't fail in the network sense — only produce a wrong schedule, which is what the unit tests below guard against. The one LLM call in Tier 1 (emphasis interpretation) gets a safe deterministic fallback on error rather than failing the job.
- **Tier 2 failures**: isolated per session/chunk. One retry, then a safe fallback session (plain Z2 steady-state, matching the assigned duration, with a minimal warm-up/main/cool-down structure) so the job still completes instead of today's all-or-nothing batch abort. The fallback is flagged on the workout (`generated_fallback: true`) so a future "regenerate this session" affordance has something to key off, even though building that UI is out of scope here.
- **Job-level failure** (e.g. can't load profile/dossier at all): job status becomes `error` with a message; the client surfaces it the same way a failed batch does today.

## Testing

- `lib/plan/scheduler.test.ts`: unit tests over the full rule set — phase-duration matrix at anchor and interpolated lengths, de-load placement (including block-end compression when phase length doesn't divide by 3 evenly), event blocking and every event-type's taper/prep window, the A-event-taper-overrides-B/C rule, weekly hard caps, no-two-hard-days-consecutive, back-to-back long rides restricted to base/build sportive goals, `threshold-heavy`/`simplified` intensity-profile overrides. This rule set currently exists only as prompt text Claude might not follow — this is the first time it becomes independently verifiable.
- `lib/claude/session-fill.test.ts`: fixture-based tests per session type asserting steps sum exactly to `duration_minutes`, step count stays practical (3–8, more allowed for interval sessions), `power_pct_ftp` values match the zone table for the assigned type.
- Job orchestration integration test with a mocked Anthropic client: status transitions (`pending`→`running`→`done`/`error`), partial Tier-2 failure triggering retry-then-fallback without failing the whole job, and progress updates landing incrementally.
- Existing tests for `ExtendPlanModal`, dashboard, and the plan-save path should need no changes, since the `GeneratedPlan` shape produced by a completed job is unchanged from today's.
