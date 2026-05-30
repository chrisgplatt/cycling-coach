# Enriched Completed-Ride Detail for Coaching Prompts — Design

**Date:** 2026-05-30
**Status:** Approved (design)

## Problem

Every coaching prompt reasons from load-level summaries of completed rides — TSS, and at
best average/normalised power — never from the *texture* of a ride. The coach cannot speak
to terrain, intensity distribution, best efforts, or whether the athlete actually hit the
targets in a structured session. Critically, the richer data **already arrives on every
sync** from intervals.icu (NP, avg/max power, avg HR, distance, elevation, L/R balance) and
is then **discarded** — only `tss` is persisted to the `workouts` row.

## Goal

Let the coach analyse *how* a ride went, not just how much load it cost, across all four
coaching surfaces: the nightly dossier synthesis, the general coach chat, the post-ride
briefing, and the feedback (adapt-upcoming-workouts) analysis.

## Scope

Three tiers of detail, all in scope:

- **Tier 1 (cheap):** NP, avg power, max power, avg HR, distance, elevation gain, L/R
  balance. Already in the sync payload — stop discarding it.
- **Tier 2 (one extra ICU call/ride):** power curve / best efforts (5s, 15s, 1min, 5min,
  20min, 60min).
- **Tier 3 (one extra ICU call/ride):** detected intervals (laps) for planned-vs-actual
  execution analysis.

## Architecture

**Persist enriched detail at sync; surface it from the DB.** Mirrors exactly how `tss`
already works. No live intervals.icu calls in any prompt path — the nightly dossier and the
interactive chat both just read a column.

Rejected alternatives:
- *Fetch live in each prompt builder* — chat would fire an ICU call per ride per message
  (latency + rate limits), chat's prompt builder has no ICU credentials wired, and fetch
  logic would be duplicated across four surfaces.
- *Wide scalar columns, no curve/interval storage* — a fat migration that still can't give
  the dossier or chat any execution detail.

**Planned-vs-actual without alignment code.** Rather than write brittle logic to align
planned `steps` against ICU's detected laps, store the actual intervals and present planned
steps + actual intervals side by side in the prompt; let Claude do the comparison. We fetch
and format; the model aligns. More robust to messy real-world laps, and removes an entire
fuzzy-matching codebase.

## Data Shape & Storage

One new column: `workouts.activity_metrics jsonb`
(migration `supabase/migrations/20260530_activity_metrics.sql`):

```sql
alter table workouts add column if not exists activity_metrics jsonb;
```

Sits 1:1 next to the existing `icu_activity_id`/`tss` on the same row — no new table, no
joins for prompt builders.

The typed blob (defined once in `lib/claude/activity-metrics.ts`):

```ts
export interface ActivityMetrics {
  // Tier 1 — already in the sync payload, currently discarded
  np: number | null            // weighted_average_watts
  avg_power: number | null
  max_power: number | null
  avg_hr: number | null
  distance_m: number | null
  elevation_m: number | null   // total_elevation_gain
  lr_balance: number | null    // left %
  // Tier 2 — one extra ICU call per ride
  best_efforts: Array<{ secs: number; watts: number }> | null  // 5s/15s/1m/5m/20m/60m
  // Tier 3 — one extra ICU call per ride
  intervals: Array<{
    label: string | null
    duration_secs: number
    avg_watts: number | null
    avg_hr: number | null
  }> | null
  synced_at: string
}
```

**Write path** — in `app/api/sync/route.ts`, where it already matches pending workouts and
imports unplanned rides (both are *new* activities, so we never refetch): for each newly
attached activity, build the Tier-1 scalars from the `ICUActivity` already in hand, then make
the two per-activity calls (power curve + intervals), and write the whole blob into
`activity_metrics` alongside the existing `tss`/`status` update. The two extra calls degrade
gracefully — `best_efforts`/`intervals` fall to `null`, Tier-1 still lands.

## Backfill (self-healing, in sync)

Newly synced rides get enriched going forward, but the dossier's 90-day window and the
recent-rides chat block stay thin until history fills in. A **self-healing backfill pass**
runs as part of every sync, after the normal match/import:

1. Query completed/`needs_review` workouts in the last 90 days that have a non-null
   `icu_activity_id` but a null `activity_metrics`, ordered most-recent first.
2. Take up to **25 per run** (the cap bounds ICU calls — ~3 per ride — so a single sync never
   fires more than ~75 backfill calls).
3. For each: `getActivity` (Tier-1 scalars, since older rides fall outside the windowed
   list), `getActivityPowerCurve`, `getActivityIntervals`; write `activity_metrics` via
   `extractActivityMetrics`. Same graceful per-tier degradation as the forward path.

This needs no UI and no separate trigger: history fills in over the next few syncs and the
pass stays self-correcting forever — any ride that ever ends up missing `activity_metrics`
(e.g. a sync that failed mid-way) is repaired on a later sync. A per-ride failure is logged
and skipped, not fatal to the sync.

## intervals.icu Client

**New method** (`lib/intervals/client.ts`): `getActivityIntervals(activityId)` →
`GET /athlete/{id}/activities/{activityId}/intervals`, mapping ICU's detected laps (likely
`icu_intervals[]` with `label`, `elapsed_time`, `average_watts`, `average_heartrate` — exact
field names validated against a real response during implementation) to our
`{ label, duration_secs, avg_watts, avg_hr }[]`. Returns `[]` on any shape mismatch rather
than throwing, so a flaky/unknown response never breaks a sync.

**New method** `getActivity(activityId)` → `GET /athlete/{id}/activities/{activityId}`,
returning a single `ICUActivity` (Tier-1 scalars). Needed by the backfill, where a historical
ride may fall outside the normal date-windowed `getActivities` list. Reuses the same field
mapping as `getActivities`.

`getActivityPowerCurve(activityId)` already exists; reuse it for Tier 2.

## Metrics Module

`lib/claude/activity-metrics.ts` — dependency-free (like `lib/claude/zones.ts`), so prompt
builders don't pull in the ICU or Anthropic clients. Three pure functions:

- `extractActivityMetrics(act, curve, intervals): ActivityMetrics` — assembles the blob;
  samples the raw power curve down to the six canonical durations (nearest available point
  for each).
- `formatActivityMetrics(m): string` — compact one-block summary for prompts, e.g.
  `NP 248W · avg 231W · max 612W · 84m climb · HR 152 · 20min best 264W`. Omits null fields.
- `formatRideExecution(plannedSteps, m): string` — lays planned `steps` and actual
  `intervals` side by side as plain text for Claude to compare; returns `''` when either side
  is missing (unstructured ride, or no detected intervals).

Every surface uses the same formatters, so the coach sees consistent phrasing everywhere.

## Per-Surface Wiring

All four read `activity_metrics` (and `steps`) from the DB and run them through the shared
formatters. How much each gets is driven by token budget.

**Dossier synthesis** (`synthesize-dossier.ts` + `dossier.ts`) — add `activity_metrics,
steps` to the 90-day `select`. Each completed-session line gains the `formatActivityMetrics`
summary. **Deliberate budget call:** the dossier covers ~40+ rides, so it gets enriched
*scalars* per ride but **not** full interval-by-interval breakdowns — dumping 40 rides' lap
tables would blow the prompt and drown the signal. Full planned-vs-actual execution is
reserved for the three single-ride surfaces below.

**General coach chat** (`chat.ts` + `/api/chat`) — new "Recent rides (last 5 completed)"
block: each with its `formatActivityMetrics` summary, plus `formatRideExecution` for any
structured session. The route fetches the last 5 completed workouts with
`activity_metrics`/`steps` and passes them to `buildChatSystemPrompt`. Enables "how did
Tuesday's intervals go?" to get a real answer.

**Post-ride briefing** (`briefing.ts`) — today's ride is already in context as
`CompletedRideData`; extend that type with the enriched fields, add elevation to the existing
`rideDataString`, and append one `formatRideExecution` line so the note can say "you faded on
the last two reps" rather than only commenting on TSS.

**Feedback analysis** (`feedback.ts`) — `analyseFeedback` already has the planned workout
(hence `steps`); pass the matched activity's `intervals` so the prompt carries a
`formatRideExecution` block, letting adaptations account for how well the targets were hit,
not just aggregate TSS/power.

## Phasing

1. **Migration + storage** — add the column, extend sync to write Tier-1 scalars.
2. **Metrics module + formatters** — `extractActivityMetrics`, `formatActivityMetrics`, pure
   and fully unit-tested.
3. **Tier 2 + 3 fetch** — `getActivityIntervals`, `getActivity`, power-curve sampling, wired
   into the sync write path; `formatRideExecution`.
4. **Backfill pass** — self-healing, capped-per-run enrichment of historical rides in sync.
5. **Surface wiring** — dossier, then chat, then briefing, then feedback (each independently
   testable).

If Tier 3 proves flaky against the real ICU API, phases 1–2 and Tier-1 surfacing still ship
and stand alone — the `null` degradation means nothing downstream breaks.

## Testing

- Pure unit tests for `extractActivityMetrics` (sampling picks nearest durations, nulls
  propagate), `formatActivityMetrics` (omits nulls, formats the summary line),
  `formatRideExecution` (side-by-side layout; returns `''` when either side missing).
- `getActivityIntervals` mapping test with a mock ICU payload, plus the
  malformed-payload-returns-`[]` case.
- Backfill pass test: selects only completed rides with `icu_activity_id` set and
  `activity_metrics` null, respects the 25-per-run cap, and a per-ride fetch failure is
  skipped without aborting the rest.
- One assertion per surface that the enriched block reaches the prompt (extend the existing
  `chat-prompt`, dossier, briefing, feedback tests).
- `npm run build` as the type-check gate; full Jest run against the known 6-failing-suite
  baseline to confirm no regressions.

## Out of Scope

- Backfilling rides older than 90 days (the dossier window is 90 days; older history is never
  read by any surface).
- Any UI display of the enriched metrics — this design is prompt-side only.
- Forcing full per-ride interval breakdowns into the dossier (token-budget decision above).
