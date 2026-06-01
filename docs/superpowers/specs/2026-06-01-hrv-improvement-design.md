# HRV Improvement (Phase 3) — Design

**Date:** 2026-06-01
**Status:** Approved (design)
**Scope:** Phase 3 of the HRV feature — actively *improving* HRV: long-horizon baseline tracking, honest lever insight, and an always-on coaching focus card. A separate track from the cycling training plan.

Builds on:
- `docs/superpowers/specs/2026-06-01-hrv-monitoring-design.md` (Phase 1 + 2, shipped)
- `lib/hrv/baseline.ts` — `computeHrvBaseline(wellness, { asOf })` → `HrvStatus` (60-day band, 7-day signal, status, trend, and `baselineDrift`, which seeds this phase)

---

## 1. Problem

Phase 1/2 tell the athlete where their HRV is *today* relative to their own baseline, and let it advise the day's session. They do not help the athlete *raise* their baseline over time. Phase 3 answers three questions, all from automatically-measured data (no manual logging):

1. **Is my baseline actually rising over months?** (progress tracking)
2. **What's actually moving my HRV?** (lever insight)
3. **What should I focus on right now to improve it?** (coaching program — an always-on focus card)

It stays a separate track from workout generation: it speaks to lifestyle/training-composition levers, never rewrites the plan.

## 2. Goals & non-goals

**Goals:**
- A long-horizon baseline trend (the rolling 60-day baseline over ~12 months) with a headline delta.
- Honest associations between daily HRV and the **actionable, measurable** levers: **sleep**, **training load/ramp**, **intensity distribution**.
- An always-on **focus card**: the single lever most worth working on now (strongest helpful association × biggest gap from a healthy target), with a short AI coaching line and progress toward the target.

**Non-goals (this phase):**
- Manual habit/lifestyle logging (alcohol, mood, breathing) — explicitly excluded by the athlete. The coach may *mention* such factors as general advice, but progress and correlation use only measured signals.
- Any change to cycling-plan generation. Phase 3 is advisory and separate.
- Causation claims. Everything is presented as *association*.

## 3. Levers (data reality)

| Lever | Source | Actionable? | Role |
|-------|--------|-------------|------|
| **Sleep** | `ICUWellness.sleep_secs` | yes | Primary focus candidate |
| **Training load / ramp** | activity `training_load` (daily/weekly TSS, acute:chronic ratio) | yes | Focus candidate |
| **Intensity distribution** | per-ride IF = `weighted_average_watts ÷ ftp` → share of easy vs hard rides | yes | Focus candidate (aerobic-base proxy; avoids needing time-in-zone) |
| **Resting HR** | `ICUWellness.resting_hr` | no | Context/validation only — a mirror of recovery, not a lever |

Excluded (no measured data without logging): alcohol, stress, mood, breathing.

## 4. Architecture

### 4.1 Data supply — `/api/hrv/improvement` (new route)

Phase 1 widened `/api/charts` wellness to ~365 days but kept activities at 112 days. Phase 3 needs ~12 months of *both*. Rather than bloat charts, add an isolated endpoint:

- Auth + profile-creds pattern identical to `/api/hrv` (Phase 1).
- Fetch ~365 days of wellness **and** ~365 days of activities; read `ftp` from `user_profile.current_ftp`.
- Run the pure engine (§4.2), then resolve the cached coaching note (§4.4).
- Return `{ improvement, coachNote }`. On intervals.icu failure → error status; the Phase 3 UI block shows an error/empty state and the rest of the fitness page is unaffected.

### 4.2 Pure engine — `lib/hrv/improvement.ts`

Dependency-free (no React/DOM/Anthropic/Supabase/IntervalsClient), unit-tested in a node jest env — same purity boundary as `lib/hrv/baseline.ts`. May import `computeHrvBaseline` from `./baseline` (also pure).

```ts
export type LeverKey = 'sleep' | 'load' | 'intensity'

export interface BaselinePoint { date: string; baselineMean: number | null; lowerBound: number | null; upperBound: number | null }

export interface LeverInsight {
  key: LeverKey
  label: string
  association: number | null   // correlation coefficient, −1..1, null when insufficient
  strength: 'none' | 'mild' | 'moderate' | 'strong'
  direction: 'helps' | 'hurts' | 'unclear'  // helpful direction = raises HRV
  sampleWeeks: number
  sufficient: boolean          // false → "still learning"
  recentValue: number | null   // e.g. avg sleep hours, easy-ride %, ACWR
  target: number | null
  gap: number | null           // signed distance from target (headroom to improve)
  unit: string                 // 'h', '%', 'ACWR'
}

export interface HrvFocus {
  key: LeverKey
  reason: 'gap_and_association' | 'fallback_sleep'  // fallback when nothing clears the bar
  caveat: string | null        // e.g. "building your picture" when data is thin
  target: number | null
  recentValue: number | null
  progressPct: number | null   // 0..100 toward target
  unit: string
}

export interface HrvImprovement {
  baselineSeries: BaselinePoint[]      // rolling 60-day baseline at ~weekly steps over the window
  baselineDeltaMs: number | null       // current baseline minus baseline ~90 days ago
  baselineDeltaDays: number            // the horizon used for the delta (e.g. 90)
  baselineTrend: 'rising' | 'stable' | 'falling'
  levers: LeverInsight[]
  focus: HrvFocus
  hasEnoughHistory: boolean            // false → "keep syncing" state
}

export function computeHrvImprovement(
  wellness: ICUWellness[],
  activities: ICUActivity[],
  ftp: number,
  opts?: { asOf?: string },
): HrvImprovement
```

**Method:**
- **baselineSeries:** step `asOf` weekly across the window; at each step call `computeHrvBaseline(wellness, { asOf })` and record its `baselineMean`/bounds (only where sufficient). `baselineDeltaMs` = latest baselineMean − baselineMean ~90 days earlier; `baselineTrend` from the sign/magnitude.
- **levers:** build weekly-averaged paired series of HRV vs each lever over the overlapping window; compute a **Spearman rank** correlation coefficient + `sampleWeeks` (rank-based — robust to outliers and to monotonic-but-non-linear relationships, which suits noisy wellness data). Map `|coefficient|` to `strength` bands and sign×expected-direction to `direction` (`helps`/`hurts`/`unclear`). Compute `recentValue` (last ~2–4 weeks), `target` (defaults below), `gap`.
  - Lever targets: sleep ≥ **7.5h**; easy-ride share ≥ **80%**; load ramp ACWR within **0.8–1.3** (gap = distance outside the band).
- **focus:** among levers that are `sufficient` AND `direction === 'helps'` (or, for load, "out of safe band"), choose the **biggest `gap`** (most headroom). Tie-break by `|association|`. If none qualify → `fallback_sleep` with a `caveat`.
- **hasEnoughHistory:** false when < ~90 days of HRV readings or < ~8 paired weeks for every lever → UI shows the "keep syncing" state.

**Honesty guards:** minimum `sampleWeeks` (≥8) or `sufficient=false`; coefficients rounded; no causation language anywhere; a "wrong-direction" lever is shown truthfully but never becomes the focus.

### 4.3 UI — fitness HRV section additions

Below the existing Phase 1 status card + chart, single-column, mobile-first (≥44px targets, 320px-safe). Data from `/api/hrv/improvement`; degrades to the "keep syncing" / error states.

1. **Baseline-trend delta** — annotate the existing 12-month chart with the headline (e.g. "Baseline +3ms over 90 days ↑"). No second chart; the band already rides the existing chart.
2. **Focus card** (prominent) — lever name, the AI coaching line (§4.4), current value vs target, and a progress bar (`progressPct`).
3. **Lever insight panel** — each lever with a strength dot-meter, direction (+/−), recent value vs target, and an honest footer ("based on N weeks · associations, not proof"). Insufficient levers show "still learning".

### 4.4 Coaching voice + caching

- **Pure prompt builder `lib/claude/hrv-coach.ts`** → `buildHrvFocusPrompt(improvement)`: embeds the *already-chosen* focus, its numbers, and the baseline delta; asks for ONE warm 2–3 sentence plain-text paragraph (briefing style, no markdown) explaining the focus and what to do. Framed around lifestyle/training-composition levers, explicitly *not* the cycling plan. Claude writes words only — it never selects the focus or invents stats.
- **Model:** `claude-opus-4-8` (add a row to CLAUDE.md's model table: `HRV focus coaching (lib/claude/hrv-coach.ts)`).
- **Caching** (`hrv_focus` table, mirroring `daily_briefings`): columns `user_id`, `focus_lever`, `focus_signature`, `coach_note`, `generated_at`. The route recomputes the deterministic analysis every call, builds `focus_signature` = hash of (focus lever + rounded recentValue + target); if the cached signature matches **and** `generated_at` < ~7 days old → return cached note; else call Claude once, upsert, return. Result: numbers always live; coaching words refresh only on a focus/standing change or weekly. At most ~one Claude call per user per week.
- **Failure:** if Claude/API key is unavailable, return the deterministic focus with `coachNote: null`; the card renders focus + target + progress without the paragraph. Cache write skipped.
- **Migration:** adds the `hrv_focus` table (Supabase). Fallback if a new table is unwanted: cache the note in `localStorage` (per-device, lost on clear) — table preferred for parity with `daily_briefings`.

## 5. Error handling & edge cases

- **Insufficient history:** `hasEnoughHistory=false` → "keep syncing — building your HRV picture"; levers "still learning"; focus = caveated sleep fallback.
- **Sparse single lever:** marked `sufficient=false`, excluded from focus competition.
- **Claude failure / no key:** deterministic focus card without the coaching paragraph; cache write skipped.
- **intervals.icu fetch failure:** `/api/hrv/improvement` errors; Phase 3 block shows empty/error; rest of fitness page unaffected.
- **Stats honesty:** enforced minimum sample, rounded coefficients, association-not-causation language, wrong-direction levers never drive focus.

## 6. Testing

- **`lib/hrv/improvement.ts`** (pure, `/** @jest-environment node */`) — synthetic series:
  - rising baseline → positive `baselineDeltaMs`, `baselineTrend='rising'`
  - strong sleep↔HRV coupling → sleep `strength='strong'`, `direction='helps'`
  - < 8 paired weeks → lever `sufficient=false`; all-sparse → `focus.reason='fallback_sleep'` with caveat
  - focus selects the biggest-gap actionable, helpful-direction lever
  - intensity distribution derived from per-ride IF (`weighted_average_watts ÷ ftp`)
  - `hasEnoughHistory=false` when history is short
- **`lib/claude/hrv-coach.ts`** — prompt embeds the chosen focus + numbers + the "lifestyle levers, not the cycling plan" framing; never asks Claude to choose the focus.
- **Caching/signature** — small unit test: `focus_signature` changes on focus/standing change, stable otherwise.
- UI kept thin over the tested core; light render checks only.

## 7. File-level impact (for the plan)

- **Create:** `lib/hrv/improvement.ts` (+ tests), `lib/claude/hrv-coach.ts` (+ tests), `app/api/hrv/improvement/route.ts`, a fitness-page `HrvImprovementSection` (focus card + lever panel + delta), Supabase migration for `hrv_focus`.
- **Modify:** `app/fitness/page.tsx` (render the new section + pass baseline delta to the chart annotation), `CLAUDE.md` (model-table row), possibly `lib/intervals/client.ts` only if a longer activity fetch helper is warranted (the route can call `getActivities` directly).

## 8. Build order (single spec, phased tasks)

1. Pure `improvement.ts` engine (+ tests) — the foundation.
2. `/api/hrv/improvement` route + 12-month wellness/activity fetch.
3. Fitness UI: baseline-delta annotation + lever insight panel (deterministic, no AI yet).
4. `hrv_focus` table + `hrv-coach.ts` + signature caching → focus card coaching line.
5. CLAUDE.md model row; edge-state polish.
