# HRV Monitoring & HRV-Guided Training — Design

**Date:** 2026-06-01
**Status:** Approved (design)
**Scope:** Phase 1 (monitoring foundation) + Phase 2 (HRV-guided training, advisory). Phase 3 (actively improving HRV as a separate track) is explicitly deferred to a later cycle.

---

## 1. Problem

HRV is one of the strongest day-to-day signals of accumulated stress, fatigue, and readiness, and it already flows into the app from intervals.icu (overnight wearable readings, most nights). But today it is wasted:

- It is shown only as a **single latest number** — a violet "HRV" tile in `MetricsBar` and a one-line "HRV X ms" note in the dashboard readiness summary.
- The fitness page charts CTL/ATL/form but **not** HRV. There is no trend, no baseline, no rolling average.
- Every AI prompt (plan, review, briefing, interview, chat) receives the same bare current value. The coach sees today's number but has no concept of the athlete's *own normal range* or whether it is trending down.

A bare HRV number is close to meaningless without the athlete's personal baseline. This design gives HRV a personal baseline, a daily status, a trend view, and a voice in the coaching — then lets that status advise (never dictate) the day's training.

## 2. Goals

1. **Monitor (Phase 1):** Surface HRV properly — a personal rolling baseline, a daily status (Suppressed / Balanced / Elevated), and a trend chart — so the athlete can see when they are drifting.
2. **Teach the coach (Phase 1):** Feed baseline + status + trend into every AI prompt so coaching reasons about the athlete's normal, not a bare figure.
3. **Guide training (Phase 2):** Use the daily status to *advise* on the day's session (ease/reschedule when suppressed, green-light when well-recovered). Suggestion-first — never silently rewrite the plan.

**Non-goals (this cycle):**
- Actively *improving* HRV via protocols/interventions (Phase 3, separate track).
- One-tap or automatic plan mutation from HRV (explicitly rejected — advisory only).
- New persistent storage of wellness data (see §4).

## 3. Current state (grounding)

- **Source:** `IntervalsClient.getWellness(start, end)` (`lib/intervals/client.ts`) returns a daily `ICUWellness[]` (`hrv`, `resting_hr`, `sleep_secs`, `ctl`, `atl`, `form`). Pulled fresh per sync (~42 days) and cached in `localStorage`. **Not persisted in our DB.**
- **Charts:** `/api/charts/route.ts` already serves `ChartsData { wellness, weeklyTss }` to the fitness page.
- **Display:** `components/MetricsBar.tsx` renders the bare HRV tile (with a `stale` flag); `app/dashboard/page.tsx` `getReadinessSummary` emits the "HRV X ms" note; `app/fitness/page.tsx` `PMCChart` charts CTL/ATL/form only.
- **AI context:** `lib/claude/briefing.ts` `buildLoadString` formats `HRV: X ms`. Other prompt builders (`plan.ts`, `review.ts`, `interview.ts`, `chat.ts`, `session-chat.ts`) build their own `fitnessSection` with the bare value.
- **Type:** `ICUWellness` in `types/index.ts` (`id` = `YYYY-MM-DD`).

## 4. Data supply

- **Widen the wellness fetch to ~12 months** via the existing `/api/charts` flow (not the global `sync()`, so we don't also drag down 12 months of activities). intervals.icu keeps the full history; a year of wellness is ~365 compact rows in a single API call.
- **No new storage.** The pure baseline module recomputes from the fetched array. Persistence/caching is reconsidered only if a later phase needs *multi-year* history or hits a performance wall.
- **Baseline window stays a rolling 60 days**, decoupled from how much history we fetch and display. The "normal range" must reflect the athlete's *current* fitness and life-stress state; averaging a year (or more) into the band would let a genuinely suppressed week read as "normal" against an outdated athlete. We hold/show ~12 months but always compute the band from the last 60 days ending today.

## 5. Architecture

### 5.1 Keystone — `lib/hrv/baseline.ts` (pure, dependency-free, unit-tested)

A single pure function turns HRV history into a baseline and a status. No React, no DOM, no Anthropic/Supabase imports — so it runs identically on the client (for UI) and the server (for AI prompts), and is unit-testable in a node jest env.

```ts
export type HrvStatusLabel = 'suppressed' | 'balanced' | 'elevated' | 'building' | 'no_data'
export type HrvTrend = 'rising' | 'stable' | 'falling'

export interface HrvStatus {
  label: HrvStatusLabel
  sufficient: boolean        // false when too few readings (→ 'building' or 'no_data')
  daysOfData: number         // count of non-null HRV readings in the 60-day window
  today: number | null       // most recent raw reading (ms)
  sevenDayAvg: number | null // 7-day rolling average (ms)
  baselineMean: number | null// 60-day baseline mean (ms)
  lowerBound: number | null  // baseline mean − 1 SD (ms)
  upperBound: number | null  // baseline mean + 1 SD (ms)
  trend: HrvTrend            // direction of the 7-day average over recent days
  baselineDrift: HrvTrend    // direction of the 60-day baseline mean itself (seeds Phase 3)
}

export function computeHrvBaseline(
  wellness: ICUWellness[],
  opts?: { asOf?: string }   // defaults to the latest date present; injectable for tests
): HrvStatus
```

**Method (standard sports-science practice):**
- Work internally on **ln(rMSSD)** because HRV is right-skewed; convert all reported bounds/means back to **ms** for display.
- **Baseline:** mean and SD of the daily HRV over the **last 60 days ending `asOf`** (nulls filtered).
- **Normal range:** `baselineMean ± 1 SD` (≈ 2 of 3 days fall inside naturally).
- **Today's signal:** **7-day rolling average** (smooths single-night noise); `today` also retained for reference.
- **Status (of the 7-day average vs the band):**
  - below `lowerBound` → `suppressed`
  - within band → `balanced`
  - above `upperBound` → `elevated`
- **Sufficiency guard:** require **≥ 14 non-null readings** in the 60-day window. Below that → `building` (with whatever partial stats exist) and never a suppressed/elevated claim. Zero readings → `no_data`.
- **Trend:** direction of the 7-day average over the trailing ~7–14 days; `baselineDrift` is the slope of the 60-day mean (cheap now, used by Phase 3 later).

### 5.2 Prompt formatter — `formatHrvForPrompt(status: HrvStatus): string`

Lives alongside the HRV module (e.g. `lib/hrv/format.ts` or exported from `baseline.ts`; dependency-free). Produces a single line for AI prompts, e.g.:

- balanced: `HRV: 51ms 7-day avg, within your 47–55ms baseline (BALANCED, stable)`
- suppressed: `HRV: 44ms 7-day avg vs 51ms baseline (SUPPRESSED, falling)`
- building: `HRV: baseline still building (only N readings) — interpret with caution`
- no_data: `HRV: no recent data`

### 5.3 UI — Dashboard chip + Fitness-page chart

**Dashboard chip** (upgrade the existing HRV surface in `MetricsBar` / dashboard readiness):
- Colour-coded status (`● Suppressed` / `● Balanced` / `● Elevated`), the 7-day average vs baseline (e.g. "44ms 7-day · base 51ms"), and a trend arrow.
- When **suppressed**, the chip carries a short advisory steer ("ease today" / "consider rescheduling").
- `building` / `no_data` render neutrally (no false status, no steer).
- Mobile-first: ≥44px touch targets, fits ≥320px width.

**Fitness page** (`app/fitness/page.tsx`) — new HRV section beneath the existing PMC chart:
- **Status card:** status label (coloured), 7-day avg vs baseline, trend arrow, one plain-language interpretation line.
- **Trend chart:** daily HRV (faint dots), **7-day average** (bold line), **baseline ±1 SD band** (shaded), today-marker; range selector (3 / 6 / 12 months). Built in the same charting style as `PMCChart` for consistency.
- Degrades to "building baseline" / "No HRV data" states gracefully.

### 5.4 Phase 2 — advisory guidance (suggestion-first, no plan mutation)

Two advisory surfaces, both informed by the same `HrvStatus`:

1. **Morning briefing** (`lib/claude/briefing.ts`):
   - `buildLoadString` uses `formatHrvForPrompt` (replacing the bare `HRV: X ms`).
   - The morning prompt additionally receives today's HRV status alongside today's planned session (the briefing already knows `todayWorkout`/`todayWorkouts`).
   - `SYSTEM_MORNING` gains guidance: when **Suppressed**, steer toward easing or rescheduling today's session; when **Elevated / well-recovered** before a hard day, green-light it; when **Balanced**, proceed as planned. Surface only when genuinely relevant (consistent with the existing "don't force a pattern" instruction).
   - Requires the briefing route (`/api/briefing/today`, `/api/cron/daily-briefing`) to fetch ~12 months of wellness and compute `HrvStatus` server-side, threaded into `BriefingContext`.

2. **Dashboard chip:** the suppressed-day steer described in §5.3.

### 5.5 Coach context everywhere (Phase 1 completion)

Wire `formatHrvForPrompt` into the athlete-state section of the other prompt builders that currently emit a bare HRV value: `lib/claude/plan.ts`, `review.ts`, `interview.ts`, `chat.ts`, `session-chat.ts`. Each needs the wellness history available to compute `HrvStatus` (the routes already fetch wellness; widen to the needed window where required). Update `CLAUDE.md` "Athlete State" so the documented HRV line reflects baseline + status + trend rather than a bare value.

## 6. Error handling & edge cases

- **Insufficient/sparse data:** sufficiency guard → `building`; UI shows "building baseline", prompts say "baseline still building". Never a false Suppressed/Elevated.
- **Nulls / missing nights:** filtered; 7-day average uses available days. No HRV at all → `no_data`; chip/section show "No HRV data" and prompts fall back to bare/absent HRV. **Existing flows never break.**
- **Single-spike noise:** operating on the 7-day average + band dampens one-off spikes, avoiding misreading a parasympathetic-saturation outlier as great recovery.
- **Isolated failure:** the 12-month wellness fetch is its own call; on failure the HRV view shows empty/error and the rest of the app is unaffected.

## 7. Testing

- **`lib/hrv/baseline.ts`** — node-env unit tests against synthetic `ICUWellness[]` series:
  - stable series → `balanced`
  - declining 7-day average below band → `suppressed`
  - rising above band → `elevated`
  - < 14 readings → `building` (no false status)
  - all-null / empty → `no_data`
  - correct ms round-tripping through the ln transform; bounds ordering (`lower < mean < upper`)
- **`formatHrvForPrompt`** — one test per status label producing the expected line shape.
- **UI/chart** — kept thin over the tested core; light render checks only.

## 8. File-level impact (for the implementation plan)

- **Create:** `lib/hrv/baseline.ts` (+ `format.ts` if split), `__tests__/lib/hrv-baseline.test.ts`.
- **Modify (data):** `lib/intervals/client.ts` (wellness window helper if needed) and/or `app/api/charts/route.ts` (widen wellness fetch to ~12 months).
- **Modify (UI):** `components/MetricsBar.tsx` (status chip), `app/dashboard/page.tsx` (chip + suppressed steer wiring), `app/fitness/page.tsx` (HRV status card + trend chart).
- **Modify (AI):** `lib/claude/briefing.ts`, `app/api/briefing/today/route.ts`, `app/api/cron/daily-briefing/route.ts`, plus athlete-state sections in `plan.ts`, `review.ts`, `interview.ts`, `chat.ts`, `session-chat.ts`; `types/index.ts` (`BriefingContext` gains HRV status fields); `CLAUDE.md` (Athlete State update).

## 9. Deferred (Phase 3 — separate track)

Actively *improving* HRV: month-over-month baseline tracking (already partly seeded by `baselineDrift`), coaching guidance on the real levers (aerobic-base share, sleep, alcohol, stress, breathing), and progress display — kept separate from the cycling training plan, as the athlete requested.
