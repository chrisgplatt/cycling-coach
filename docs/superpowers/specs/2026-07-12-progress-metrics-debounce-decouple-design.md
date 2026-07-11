# Decouple Progress Metrics From the AI-Brief Debounce Design

## Goal

Make the dashboard Progress section's numeric stats (Rides, CTL, FTP delta, weight delta, adherence, streak) refresh on every sync, instead of sitting frozen for up to 4 hours behind a debounce that exists only to limit Claude API calls for the AI-written coaching paragraph.

## Background

`maybeGenerateProgressBrief` (`lib/progress/brief-generator.ts`) is called on every `/api/sync` and is responsible for two genuinely different things that currently share one all-or-nothing gate:

1. **Numeric stats** (`computeProgressMetrics(...)`, stored as `progress_briefs.metrics_snapshot`) — cheap to compute from data already fetched during sync (wellness, weight log, plan workouts) plus one intervals.icu activities fetch when a plan is active (the fix from `docs/superpowers/plans/2026-07-11-progress-rides-count-since-plan-start.md`). This is what feeds the dashboard's Progress tiles, including "Rides."
2. **AI-written text** (`generateProgressBrief(...)`, stored as `progress_briefs.content`) — a Claude API call, genuinely worth rate-limiting.

Both are currently gated by the same `DEBOUNCE_HOURS = 4` check at the top of the function: if a brief was generated within the last 4 hours, the function returns immediately, and *neither* the numeric stats *nor* the text update — regardless of how many times the athlete syncs in between. This was surfaced directly: an athlete did a ride, synced afterward, and the dashboard's "Rides" tile still showed yesterday's count, because a brief had already been generated earlier that same morning.

## Fix

Split `maybeGenerateProgressBrief` into two independently-gated writes to the same `progress_briefs` row:

- **Metrics update — always runs.** Every call computes `metrics` and writes `{ metrics_snapshot: metrics }` via `upsert(..., { onConflict: 'user_id' })`, with no debounce check, whenever a brief row already exists for the user.
- **Content update — still debounced.** The existing 4-hour check gates only the `generateProgressBrief` Claude call and the write of `{ content, generated_at }`.

**Why the metrics-only write only runs when a row already exists:** `progress_briefs.content` is `text not null` in the schema (`supabase/migrations/20260613_progress_brief.sql:9`), so a metrics-only upsert could violate that constraint on the very first insert for a brand-new user (no `content` value to give it). Postgres/PostgREST upsert only *replaces the columns present in the payload* on an `UPDATE` conflict — it leaves `content` untouched on an existing row, which is exactly what's needed. So: for a user with no `progress_briefs` row yet, the metrics-only write is skipped, and the function falls through to the (undebounced, since `existing` is falsy) content-generation path, which writes `content`, `metrics_snapshot`, and `generated_at` together in one upsert — same as it creates a first-ever row today. No schema migration is required, and no placeholder/empty-string values are ever written.

`generated_at` keeps its current meaning unchanged: it's the AI text's timestamp specifically, already displayed to the user as "Updated X ago" next to the coach's written note on the Plan page (`app/plan/page.tsx:802`). It must **not** be touched by the metrics-only write, or that timestamp would misrepresent how old the text actually is.

### Updated `lib/progress/brief-generator.ts` flow

1. Fetch `existing` (just `generated_at`), `plan`, and `weightLog` together in one `Promise.all` (unchanged data, existing debounce-check fetch merged into the same batch instead of running before it).
2. Resolve `planWorkouts` and `ridesActivities` exactly as today (unchanged from the previous fix — `client.getActivities(planStartDate, todayStr)` when a plan is active, else `syncData.activities`).
3. Compute `metrics` via `computeProgressMetrics(...)` — unchanged call, unchanged function.
4. If `existing` is truthy, upsert `{ user_id, metrics_snapshot: metrics }` — unconditionally, no debounce check.
5. If `existing?.generated_at` is within `DEBOUNCE_HOURS`, return (same as today, just relocated below step 4 instead of at the very top).
6. Call `generateProgressBrief(...)`; if it returns `null`, return (same as today).
7. Upsert `{ user_id, content, metrics_snapshot: metrics, generated_at: now }` — same as today, with `metrics_snapshot` included so the row is fully consistent regardless of which path wrote it last.

## Trade-off: intervals.icu API call frequency

Because metrics now compute on every sync (not just once per debounce window), the plan-scoped `client.getActivities(planStartDate, todayStr)` call added in the prior fix now runs on every sync where a plan is active, rather than at most once every 4 hours. For a personal-use app synced a handful of times a day, this is a trivial increase in call volume, and it's the direct cost of the fix's actual goal (fresh numeric stats on every sync). No additional guarding is introduced for this — it's an accepted, explicit trade-off, not an oversight.

## Testing

`__tests__/lib/brief-generator.test.ts` (already exists from the prior fix) gains new test cases:

- With an existing `progress_briefs` row and the debounce window still active (`generated_at` recent), the metrics-only upsert still fires (`metrics_snapshot` updated) even though content generation is skipped (`generateProgressBrief` not called, no `content`/`generated_at` write).
- With an existing row and the debounce window active, an updated `syncData`/plan-scoped fetch that changes `totalRides` is reflected in the metrics-only upsert's payload — proving the stat is genuinely live, not just structurally wired.
- With no existing row (first-ever brief) and metrics sparse enough that `generateProgressBrief` returns `null`, no upsert happens at all — same no-row-created behavior as today.
- With no existing row and metrics sufficient for content generation to succeed, the single resulting upsert contains `content`, `metrics_snapshot`, and `generated_at` together (unchanged from today's first-brief behavior).
- The two existing tests from the prior fix (plan-scoped fetch called with the right range; no-plan fallback uses `syncData.activities`) continue to pass, adjusted only as needed for the reordered fetch/upsert sequence.

No test changes are needed in `app/api/progress-brief/route.ts` or its consumers (`components/ProgressStats.tsx`, `app/plan/page.tsx`) — they read whatever's in the row and were already written to handle a row existing with a `content` that may be older than `metrics_snapshot`; this fix only changes how often each field updates, not the read-side contract.

## Global Constraints

- `generated_at` continues to represent only the AI text's freshness; the metrics-only write path never sets or touches it.
- No database migration — the existing `content not null` constraint is respected by only ever creating a new row through the content-generation path, never through the metrics-only path.
- `computeProgressMetrics` (`lib/progress/metrics.ts`) is unchanged — this fix is entirely about write cadence in `brief-generator.ts`, not the metrics calculation itself.
- The debounce behavior for the AI text (`DEBOUNCE_HOURS = 4`, gating `generateProgressBrief` and the `content`/`generated_at` write) is otherwise unchanged.
