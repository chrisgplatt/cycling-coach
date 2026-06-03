# Deepen Coaching — Design Spec

**Date:** 2026-06-03
**Status:** Approved (design); pending implementation plan

## Goal

Make the coaching feel responsive and forward-looking by adding three
independent modules that build on existing data:

1. **Coaching log** — a visible "what your feedback changed" trail on the My Plan tab.
2. **Fitness forecast** — project CTL forward to event day, plan vs. current pace.
3. **Readiness verdict** — a traffic-light "go hard / hold back" badge on the daily briefing.

The three modules are independent (different files, different data paths) and can
be built and shipped in sequence. Build order: Coaching log → Fitness forecast →
Readiness verdict.

## Non-Goals

- No new tracking of feedback events (the `session_feedback` table already records everything).
- No change to the adaptation engine (`lib/claude/feedback.ts`) or how adjustments are applied.
- No change to plain-text briefing consumers (email, cron, notification banner) beyond passing the new fields through untouched.
- No second CTL chart — the forecast upgrades the existing fitness trend module in place.

---

## Module 1 — Coaching log (feedback trail)

### What it does

A presentational card on the My Plan tab listing the athlete's recent
feedback → adaptation events, newest first, so they can see the coach responding
over time.

### Data source

The feedback API GET handler (`app/api/feedback/route.ts`) currently **requires**
a `workoutId` query param. Extend it: when `workoutId` is absent, return a recent
list for the signed-in user instead.

- Query `session_feedback` for `user_id = user.id`, `order by created_at desc`, `limit 8`.
- Join each row to its workout (`workout_id`) to obtain the session's `date` and `type`.
  Use a Supabase nested select (`*, workouts(date, type)`) or a follow-up lookup keyed by `workout_id`.
- Rows whose `workout_id` is null (manual feedback with no linked workout) still appear,
  with `session_date = null` / `session_type = null`.
- Response shape:

```ts
// GET /api/feedback  (no workoutId)  -> { entries: CoachingLogEntry[] }
interface CoachingLogEntry {
  id: string
  created_at: string          // when feedback was logged
  session_date: string | null // linked workout date (YYYY-MM-DD)
  session_type: string | null // linked workout type
  feedback_text: string
  summary: string | null      // proposed_adjustment?.summary ?? null
  approved: boolean | null    // adaptation outcome
  had_proposal: boolean       // proposed_adjustment !== null
}
```

The existing `workoutId`-present branch is unchanged.

### Component

`components/plan/CoachingLog.tsx`, purely presentational.

```ts
interface CoachingLogProps { entries: CoachingLogEntry[] }
```

Each entry renders:
- Header line: `{session_date formatted} · {Capitalised session_type}` (or `Manual note` when both null).
- Feedback snippet: `feedback_text`, clamped to ~2 lines.
- Adaptation line: `→ {summary}` when `summary` is present.
- Status chip:
  - `had_proposal && approved === true` → `✓ applied` (emerald)
  - `had_proposal && approved === false` → `✗ dismissed` (slate)
  - `had_proposal && approved === null` → `… pending` (amber)
  - `!had_proposal` → `• logged` (slate, no adaptation line)

Empty state (entries.length === 0): card with heading + muted line
"No feedback logged yet — add notes after a session and your coach's adjustments show up here."

`data-testid="coaching-log"`. Follow the card styling used by the other plan modules
(`bg-white rounded-xl border border-slate-100 shadow-sm p-4`, the `text-[11px] font-bold
uppercase tracking-wider text-slate-500` heading).

### Wiring

In `app/plan/page.tsx`, fetch `/api/feedback` (no param) alongside the existing loads,
store `entries` in state, and render `<CoachingLog entries={entries} />` between
`<FitnessTrendChart />` and the Plan-actions card. Render the card whenever an active
plan is shown (empty state covers no-feedback).

### Tests

- API: GET with no `workoutId` returns recent entries mapped to `CoachingLogEntry`
  shape (summary pulled from `proposed_adjustment`, `had_proposal` derived). GET with
  `workoutId` still returns the single-feedback shape.
- Component: renders one row per entry with the correct status chip per `approved`/`had_proposal`
  combination; shows the empty state for `[]`.

---

## Module 2 — Fitness forecast (CTL projection)

### What it does

Upgrades the existing fitness trend module into a single continuous CTL narrative:
solid **actual** history, then a dashed **plan** projection and a dotted **your-pace**
projection running forward to event day (or plan end when there is no target event).

### Logic — `lib/plan/forecast.ts` (pure)

Impulse-response (Banister) CTL model with the standard 42-day time constant:

```ts
const CTL_TAU = 42

/** Advance CTL one day given that day's TSS. */
function stepCtl(ctl: number, tss: number): number {
  return ctl + (tss - ctl) / CTL_TAU
}

/** Project CTL across a day-by-day TSS sequence, returning one point per day (inclusive of start). */
export function projectCtl(startCtl: number, dailyTss: number[]): number[] {
  const out = [startCtl]
  let ctl = startCtl
  for (const tss of dailyTss) {
    ctl = stepCtl(ctl, tss)
    out.push(ctl)
  }
  return out
}
```

Build the two forward daily-TSS sequences from the remaining weeks of the plan:

```ts
export interface ForecastInput {
  startCtl: number              // latest actual CTL ("today")
  buckets: WeekBucket[]         // from lib/plan/progress.ts
  currentWeek: number           // index of the in-progress week
  daysFromTodayToWeekEnd: number// days left in the current week (1..7)
  daysToEvent: number | null    // calendar days from today to event (or plan end)
  hitPct: number                // adherence %, from consistency()
}

export interface ForecastResult {
  planCtl: number               // projected CTL at horizon, full planned load
  paceCtl: number               // projected CTL at horizon, planned load * hitPct
  planSeries: number[]          // daily CTL, full plan (for the chart)
  paceSeries: number[]          // daily CTL, current pace
  horizonDays: number           // number of projected days
}
```

Construction rules:
- Horizon = `daysToEvent` when set and > 0, else days remaining to the end of the
  last plan week. If the horizon is 0 or negative, return a result with empty series
  and `planCtl = paceCtl = startCtl` (caller treats this as "no projection").
- For the daily CTL walk, distribute each remaining week's `plannedTss` evenly across
  all 7 days of that week: `dailyTss = plannedTss / 7` per day. (Even spreading keeps the
  curve smooth; rest days still receive a share so CTL decay is realistic across the week.)
- The current (in-progress) week contributes only its remaining days
  (`daysFromTodayToWeekEnd`), using that week's `plannedTss / 7` per remaining day.
- Pace sequence = plan sequence scaled by `hitPct / 100`.
- Truncate both sequences to `horizonDays` so they end exactly at the horizon.

### Render — extend the fitness trend module

`components/plan/FitnessTrendChart.tsx` gains an optional `forecast` prop:

```ts
interface FitnessTrendChartProps {
  points: FitnessPoint[]            // existing actual CTL/Form history
  forecast?: ForecastResult | null  // null/absent => current behaviour, no projection
}
```

- Keep the existing actual CTL polyline (solid `#2563eb`) and Form polyline (dashed amber)
  over the historical x-range.
- When `forecast` is present and `horizonDays > 0`, allocate the x-axis so history
  occupies the left portion and the projection the right, joined at "today". Draw:
  - plan projection: dashed `#2563eb`, lighter weight, from today's CTL through `planSeries`.
  - pace projection: dotted `#64748b` (slate) through `paceSeries`.
  - a thin vertical divider / "today" tick at the join.
- Caption when forecasting: `Stick to plan: CTL ~{round(planCtl)}. At current pace: ~{round(paceCtl)}.`
- The `< 3 points` empty state is unchanged. When `forecast` is absent, the component
  behaves exactly as today.

### Wiring

In `app/plan/page.tsx`, inside the existing active-plan computation block, after
`buckets`/`cons`/`currentWeek` are computed:
- `startCtl` = the latest actual CTL value already used for `fitPoints` (last wellness CTL).
- Compute `daysFromTodayToWeekEnd` and `daysToEvent` from `planStart`, `currentWeek`,
  `totalWeeks`, and the event date (already available as `daysToEvent` for the hero).
- Call `buildForecast(...)` (thin wrapper assembling `ForecastInput` and calling the
  pure functions) and pass the result to `<FitnessTrendChart points={fitPoints} forecast={forecast} />`.

### Tests

- `projectCtl`: constant TSS above CTL raises CTL monotonically toward that TSS;
  zero TSS decays CTL toward 0; a known short sequence matches hand-computed values
  within rounding.
- `buildForecast`: `paceCtl <= planCtl` whenever `hitPct < 100`; horizon 0 returns the
  no-projection result; series length equals `horizonDays`.
- Component: with a `forecast` prop it renders the two extra polylines and the
  "Stick to plan" caption; without it, behaviour is unchanged (two polylines only).

---

## Module 3 — Readiness verdict (briefing badge)

### What it does

The morning briefing returns a structured verdict the dashboard renders as a
coloured traffic-light badge above the existing prose. The model decides the verdict
from HRV trend + today's planned intensity, so badge and prose never disagree.

### Contract — `lib/claude/briefing.ts`

Only the **morning** path gains structure. Post-ride and post-race are unaffected.

```ts
export type ReadinessVerdict = 'green' | 'amber' | 'red'

export interface BriefingResult {
  coach_note: string
  verdict: ReadinessVerdict | null   // null for post-ride / post-race
  headline: string | null            // <= 4 words, e.g. "Go hard", "Ease if flat"; null when verdict null
}

export async function generateBriefing(ctx: BriefingContext): Promise<BriefingResult>
```

- `generateMorningBriefing` switches its model call to request JSON:
  `{ "verdict": "green|amber|red", "headline": "<=4 words", "note": "<prose, 2-3 sentences>" }`.
  Parse defensively: on any parse failure, fall back to `{ verdict: null, headline: null,
  note: <raw text or default> }` so the briefing never hard-fails.
- Verdict guidance added to `SYSTEM_MORNING`: green = recovered/balanced and a hard day
  is on → go; amber = mixed signals (e.g. suppressed HRV but a key session) → proceed
  with caution / judge by feel; red = clearly suppressed/fatigued or pre-rest → ease or
  reschedule. On a rest day or pure Z1 day, verdict reflects recovery state (green when
  fresh, amber/red advice is about not adding load).
- `generatePostRideNote` / `generatePostRaceNote` return `{ coach_note, verdict: null,
  headline: null }`.

### Storage — `daily_briefings`

Add two nullable columns via a migration `supabase/migrations/20260603_briefing_verdict.sql`:

```sql
alter table daily_briefings add column if not exists verdict text;
alter table daily_briefings add column if not exists headline text;
```

`app/api/briefing/today/route.ts`:
- Cached read select adds `verdict, headline`; cached response returns them.
- After generation, destructure `{ coach_note, verdict, headline }` from `generateBriefing(ctx)`,
  upsert all three, and include `verdict, headline` in the fresh response.

### UI — `ReadinessBadge`

`components/ReadinessBadge.tsx`, presentational:

```ts
interface ReadinessBadgeProps { verdict: ReadinessVerdict; headline: string }
```

- Colour map: green → emerald, amber → amber, red → red (bg tint + dot + label).
- Renders `{dot} {VERDICT word} · {HEADLINE uppercased}`.
- Rendered in `TodayCard` (and/or dashboard briefing block) above the coach note,
  only when `verdict` is non-null. Touch-target / mobile styling per AGENTS.md.
- Other briefing consumers (email `lib/email.ts`, cron, `NotificationBanner`) keep
  reading `coach_note` only — no change.

### Tests

- `generateBriefing` (morning, mocked client returning JSON): returns parsed
  `verdict`/`headline`/`coach_note`; malformed JSON falls back to `verdict: null`
  with the note preserved.
- Post-ride / post-race paths return `verdict: null`, `headline: null`.
- API route: fresh response includes `verdict`/`headline`; cached path returns the
  stored values.
- Component: renders the correct colour and label per verdict.

---

## Testing strategy (all modules)

- Pure logic (`lib/plan/forecast.ts`, briefing parsing) covered by unit tests; this is
  the real correctness gate.
- Components tested with React Testing Library for presence/branching, not pixels.
- `npm run typecheck` (`tsc --noEmit`) is the type gate (Jest uses SWC and skips types).
- Migration applied manually to the live DB after merge (Module 3 only).

## Migration checklist

- `supabase/migrations/20260603_briefing_verdict.sql` — **must** be applied to the live
  DB before Module 3 ships: the briefing route upserts `verdict`/`headline`, so the
  columns must exist or the write errors. The dashboard tolerates a missing/null verdict
  (badge simply hidden), but the column write does not.
