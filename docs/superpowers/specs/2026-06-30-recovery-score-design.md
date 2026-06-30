# Recovery Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a composite daily Recovery Score (0–100) on the Dashboard and Fitness page, backed by a weighted algorithm combining Garmin sleep stages, HRV, subjective wellness, training load, and body battery, with the AI coach referencing the score in its daily advisory.

**Architecture:** A pure `computeRecoveryScore()` function in `lib/recovery-score.ts` takes already-synced wellness data and returns a score, band, and explanation string. The Dashboard's TodayCard replaces its TSB-derived readiness label with the composite score. The Fitness page gains two new sections (Sleep and Recovery trend). The AI briefing route computes the score server-side and passes it to Claude.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (data already synced), inline SVG charts (existing pattern), Tailwind CSS.

## Global Constraints

- Mobile-first: all new UI elements ≥ 44px touch targets, ≥ 320px viewport support
- No new charting libraries — use inline SVG following the existing `HrvChart` and `ActivityStatsPanel` patterns
- No new Garmin API calls or DB schema changes — all required data is already synced to the `garmin_wellness` table
- Follow existing `SectionCard` / `StatCell` component patterns for Fitness page sections
- Score must degrade gracefully: missing components are excluded from the weighted average rather than zeroing the score
- `lib/recovery-score.ts` must be a pure function with no side effects (testable without DB)
- Colour bands: Green ≥ 75 (High), Amber 50–74 (Moderate), Red < 50 (Low)

---

## Section 1: Score Algorithm (`lib/recovery-score.ts`)

### Inputs

All fields come from a single `GarminWellness` row (the `daily_wellness` table joined with Garmin data — the same shape already used by `StrainBreakdownSheet` and the briefing route):

```ts
interface RecoveryInputs {
  // HRV
  hrv: number | null                        // today's HRV ms — from wellness row's `hrv` field
  hrvBaseline: number | null                // user's rolling baseline ms — from `computeHrvBaseline(wellnessArr).baseline`; already called in both dashboard and Fitness page

  // Sleep (Garmin)
  garmin_sleep_deep_secs: number | null
  garmin_sleep_light_secs: number | null
  garmin_sleep_rem_secs: number | null
  garmin_sleep_awake_secs: number | null

  // Body battery
  body_battery_high: number | null          // peak 0–100

  // Subjective wellness
  energy: number | null                     // 1–5
  leg_freshness: number | null              // 1–5

  // Training load
  tsb: number | null                        // today's TSB — map from wellness row's `form` field
}
```

### Component normalisation

**Sleep index (0–100):**
- `totalSecs = deep + light + rem + awake`
- `durationScore`: clamp `totalSecs / (8 * 3600)` to [0, 1], scale to 0–100
- `deepScore`: clamp `deepSecs / totalSecs / 0.20` to [0, 1], scale to 0–100
- `remScore`: clamp `remSecs / totalSecs / 0.25` to [0, 1], scale to 0–100
- `sleepIndex = (durationScore + deepScore + remScore) / 3`
- If any sleep field is null, exclude from average (e.g. only 2 components used)
- If all sleep fields null → component unavailable

**HRV index (0–100):**
- `ratio = hrv / hrvBaseline`
- ratio ≥ 1.10 → 90
- ratio 1.00–1.10 → lerp 70–90
- ratio 0.90–1.00 → lerp 40–70
- ratio < 0.90 → lerp 0–40 (clamped at ratio 0.70 → 0)
- If either null → unavailable

**Wellness index (0–100):**
- `avg = (energy + leg_freshness) / 2`  (1–5 scale)
- `wellnessIndex = (avg - 1) / 4 * 100`
- If both null → unavailable; if one null → use the other alone

**TSB index (0–100):**
- tsb ≥ +25 → 100
- tsb +5 to +25 → lerp 80–100
- tsb −10 to +5 → lerp 45–80
- tsb −25 to −10 → lerp 10–45
- tsb ≤ −25 → 10
- If null → unavailable

**Body battery index (0–100):**
- `body_battery_high` is already 0–100; use directly
- If null → unavailable

### Weighted average

Weights when all five components available:

| Component | Weight |
|---|---|
| Sleep | 30% |
| HRV | 30% |
| Wellness | 20% |
| TSB | 10% |
| Body battery | 10% |

If a component is unavailable, redistribute its weight proportionally across available components.

### Explanation string

Identify components whose normalised index is furthest below their contribution cap. Return the 1–2 worst as a human-readable string:

- Sleep index < 50 → `"short/poor deep sleep"` (or `"short sleep"` if duration is the main drag)
- HRV index < 50 → `"HRV suppressed"`
- Wellness index < 50 → `"low subjective energy"`
- TSB index < 50 → `"high training load"`
- Body battery < 50 → `"low body battery"`

If score ≥ 75, explanation is `""` (nothing to flag).

### Return type

```ts
export interface RecoveryScore {
  score: number          // 0–100, rounded to nearest integer
  band: 'high' | 'moderate' | 'low'
  explanation: string    // e.g. "HRV suppressed, short deep sleep" or ""
  components: {
    sleep: number | null
    hrv: number | null
    wellness: number | null
    tsb: number | null
    bodyBattery: number | null
  }
}

export function computeRecoveryScore(inputs: RecoveryInputs): RecoveryScore
```

---

## Section 2: Dashboard — TodayCard

**File:** `components/TodayCard.tsx`

Replace the current TSB-derived readiness label (lines ~117–138) with the composite Recovery Score.

The `TodayCard` already receives wellness data (passed from `app/dashboard/page.tsx`). Add `tsb` to the props passed through (it's already computed in the dashboard). Call `computeRecoveryScore()` client-side with the available fields.

**New UI element** (replaces the existing "Readiness" label block):

```
Recovery
● 62  Moderate
HRV suppressed, short deep sleep
```

- The dot and band label use Tailwind colour classes: green-500 / amber-500 / red-500
- The explanation line is `text-[11px] text-slate-400`
- No tap target — informational only

**`ReadinessBadge` component** (`components/ReadinessBadge.tsx`): Update to accept `score: number`, `band: RecoveryScore['band']`, `explanation: string` props instead of (or alongside) the existing `verdict: ReadinessVerdict` prop. The badge shown on the TodayCard AI briefing panel remains unchanged — only the separate "Readiness" label row is replaced.

---

## Section 3: Fitness page — Sleep and Recovery sections

**File:** `app/fitness/page.tsx`

Add two new `SectionCard` blocks, inserted between the existing HRV section and the Weight section.

### 3a. Sleep card

**Title:** `"Sleep"` · accent: `bg-indigo-500`

**Last night row:**
- Total sleep as `"7.2h"` in bold
- Horizontal stacked bar (full width, height 8px, rounded): segments for deep (violet-500) / REM (indigo-400) / light (slate-300) / awake (gray-200), widths proportional to seconds
- Label row beneath bar: `"Deep 1.4h · REM 1.8h · Light 4.0h"` in `text-[10px] text-slate-400`

**Trend chart (14/30-day toggle, same pattern as HRV):**
- SVG bar chart: one bar per night, height = total sleep duration (8h target line as a dashed horizontal)
- Thin line overlay on the bars: nightly deep sleep duration
- Bar colour: indigo-300 (default), indigo-500 (selected night)
- No data night: empty bar (no fill), not zero-height
- Selectable points: tapping a bar shows that night's breakdown (deep / REM / light / awake) as a row beneath the chart

**Data source:** `garmin_sleep_deep_secs`, `garmin_sleep_light_secs`, `garmin_sleep_rem_secs`, `garmin_sleep_awake_secs` — already in the wellness rows fetched by the Fitness page.

### 3b. Recovery score trend card

**Title:** `"Recovery"` · accent: `bg-emerald-500`

**Today row:**
- Large score number (e.g. `"62"`) with band label and explanation string

**Trend chart (14/30-day toggle):**
- SVG line chart of daily composite score
- Horizontal band fills: green above 75 (emerald-50 background), red below 50 (red-50 background)
- Line colour: emerald-500
- Selectable points: tapping a point shows that day's five component scores as a compact row:
  `Sleep 58 · HRV 71 · Wellness 80 · Load 65 · Battery 70`

**Data source:** `computeRecoveryScore()` called for each wellness row in the fetched range. The `hrv` field is on every wellness row; `tsb` maps to `w.form` (already present in the wellness rows the Fitness page fetches); `hrvBaseline` comes from the `computeHrvBaseline()` call already in the Fitness page.

---

## Section 4: AI Coach integration

**File:** `app/api/briefing/today/route.ts` and `lib/claude/briefing.ts`

### Briefing route

In the `GET` handler, after assembling the existing context object, call `computeRecoveryScore()` with today's wellness fields and today's TSB. Add to the context passed to `buildTodayBriefingPrompt()`:

```ts
recoveryScore: number | null        // e.g. 62
recoveryBand: string | null         // "moderate"
recoveryExplanation: string         // "HRV suppressed, short deep sleep"
```

No DB schema change — inputs already fetched.

### Briefing prompt

In `lib/claude/briefing.ts`, update `buildTodayBriefingPrompt()` to include recovery context in the athlete data block:

```
Recovery score: 62/100 (moderate) — HRV suppressed, short deep sleep
```

Update the coaching instruction to reference the score:
- Score < 50: coach should acknowledge low recovery and recommend treating planned intensity conservatively ("consider riding at endurance pace rather than hitting the intervals")
- Score 50–74: neutral acknowledgement, no modification suggested
- Score ≥ 75: coach may affirm readiness positively

The coach should not auto-modify the workout — it surfaces an advisory and leaves the decision to the athlete.

---

## Testing

- `lib/recovery-score.ts`: unit tests covering all five components present, partial data (2 of 5 missing), all null, boundary values (HRV exactly at baseline, TSB at −25, sleep exactly 8h). Tests in `__tests__/lib/recovery-score.test.ts`.
- `components/TodayCard.tsx`: update existing tests to pass mock recovery score; assert band label and explanation text render correctly.
- `app/fitness/page.tsx`: smoke test that Sleep and Recovery sections render when wellness data includes sleep fields; assert "No data" state renders without errors.
