# Daily Strain Score — Design

**Date:** 2026-06-09
**Status:** Approved

## Problem

The app surfaces CTL, ATL, Form, and HRV as load indicators, but has no single daily strain signal that captures both workout load and life stress. The athlete previously used Whoop for this and found it valuable. The Garmin Forerunner 955 is worn all day and already syncs to intervals.icu — the data is available but not fetched or used.

## Goal

Pull Garmin's all-day wellness metrics from the intervals.icu wellness endpoint and derive a single 0–21 daily strain score that:

1. Displays as a single chip on the MetricsBar
2. Feeds into Claude prompts across all coaching surfaces
3. Drives plan adaptation thresholds (soften/intensify today's session)

## Data Available (intervals.icu wellness endpoint)

Garmin → intervals.icu sync already populates these fields on the wellness record; we are simply not fetching them:

| Field | Source | Range | Meaning |
|-------|--------|-------|---------|
| `body_battery_low` | Garmin | 0–100 | Lowest body battery reading during the day (high = fresh) |
| `body_battery_high` | Garmin | 0–100 | Peak body battery (typically morning) |
| `stress_avg` | Garmin | 0–100 | Average daily stress score (HRV-derived by Garmin) |
| `stress_high` | Garmin | 0–100 | Peak stress reading |
| `garmin_training_load` | Garmin | 0–500+ | EPOC-based session training load (all activities summed) |
| `sleep_score` | Garmin | 0–100 | Garmin sleep quality score |

`sleep_score` is fetched for Claude context but does not feed the strain formula in v1.

## Strain Score Formula

```
daily_strain = min(21, round(workout_component + life_component))

workout_component = (garmin_training_load / 400) × 14
life_component    = (stress_avg / 100) × 7
```

**Rationale for constants:**
- `400`: typical upper bound for Garmin training load on a hard cycling day. Tuning knob — lower if scores feel systematically low, raise if they feel high.
- `14 / 7` split: mirrors Whoop's rough weighting where exercise dominates (two-thirds) and life stress modifies (one-third).
- Scores are clamped at 21 to match the Whoop scale athletes already have intuition for.

**Tuning plan:** The formula constants (`400`, `14`, `7`) are defined as named constants in the helper function so they can be adjusted in one place as real-world usage reveals calibration needs.

## Changes Required

### 1. Types (`types/index.ts`)

Add to `ICUWellness`:
```typescript
body_battery_low: number | null
body_battery_high: number | null
stress_avg: number | null
stress_high: number | null
garmin_training_load: number | null
sleep_score: number | null
```

### 2. Intervals client (`lib/intervals/client.ts`)

Expand the wellness field selection in `getWellness()` to include the six new fields. No new endpoint — same wellness fetch, wider select.

### 3. Strain helper (`lib/strain.ts`)

New pure function module:

```typescript
export const STRAIN_TRAINING_LOAD_MAX = 400
export const STRAIN_WORKOUT_WEIGHT = 14
export const STRAIN_LIFE_WEIGHT = 7

export function computeDailyStrain(
  garminTrainingLoad: number | null,
  stressAvg: number | null
): number | null {
  if (garminTrainingLoad == null && stressAvg == null) return null
  const workout = ((garminTrainingLoad ?? 0) / STRAIN_TRAINING_LOAD_MAX) * STRAIN_WORKOUT_WEIGHT
  const life = ((stressAvg ?? 0) / 100) * STRAIN_LIFE_WEIGHT
  return Math.min(21, Math.round(workout + life))
}

export function strainLabel(score: number): 'low' | 'moderate' | 'high' {
  if (score < 9) return 'low'
  if (score <= 14) return 'moderate'
  return 'high'
}
```

### 4. MetricsBar (`components/MetricsBar.tsx`)

Replace the planned separate body-battery and stress chips with a single **Strain** chip:
- Value: `computeDailyStrain(wellness.garmin_training_load, wellness.stress_avg)`
- Colour: green (<9), amber (9–14), red (≥15)
- Label: `Strain`
- Null state: chip hidden (not shown if both source fields are null — e.g. watch not worn)

### 5. Briefing load string (`lib/claude/briefing.ts`)

Extend `buildLoadString()` to append:

```
Daily Strain: 12/21 (moderate) | Body Battery low: 48 | Daily Stress: 54 | Garmin Training Load: 220
```

The raw Garmin fields are included alongside the derived score so Claude can reason about the components, not just the composite.

### 6. Briefing route (`app/api/briefing/today/route.ts`)

The wellness fetch already runs here. Pass the new fields through to `buildLoadString` and include `sleep_score` in the prompt context block separately (not in the strain score, but as a recovery signal: "Sleep score: 72").

### 7. Dossier (`lib/claude/dossier.ts`)

Where the dossier formats athlete state, include a 7-day rolling strain pattern:
```
Strain (last 7 days): 8, 14, 16, 12, 9, 6, 11  (avg: 11, trend: stable)
```
Computed from the 7 days of wellness already fetched for the dossier. No additional DB queries.

### 8. Plan adaptation thresholds (`lib/claude/briefing.ts` or adaptation logic)

The readiness verdict and plan adaptation logic gain strain-aware rules:

| Condition | Action |
|-----------|--------|
| Strain ≥ 15 | Reduce today's planned duration by 20%, cap intensity at Z2 in briefing recommendation |
| Strain ≥ 18 | Suggest swapping to a recovery ride regardless of what's planned |
| Strain < 9 AND TSB > 0 | Claude may suggest going harder if session type warrants it |
| HRV suppressed AND Strain ≥ 15 | Escalate to red verdict regardless of other signals |

These are soft recommendations in Claude's language ("consider reducing", "suggest swapping") — not hard enforcement that overwrites the plan. The existing plan-modification flow handles the actual edit if the athlete accepts.

## What Is Not in v1

- `sleep_score` feeding the strain formula (fetched and given to Claude as context, but not part of the 0–21 calculation)
- Storing historical strain scores in the DB (computed on-demand from wellness data; no new table needed)
- Separate body-battery or stress chips on MetricsBar (raw values are in the Claude prompt but not displayed as UI chips — the single Strain chip is the surface signal)

## Verification

1. After expanding the wellness fetch, log the raw API response and confirm `body_battery_low`, `stress_avg`, and `garmin_training_load` are populated for recent days.
2. `computeDailyStrain(220, 54)` → `round((220/400)*14 + (54/100)*7)` = `round(7.7 + 3.78)` = `round(11.48)` = 11. Confirm chip shows 11 in amber.
3. On a rest day (no Garmin training load), score is driven by stress alone: `computeDailyStrain(0, 80)` → `round(0 + 5.6)` = 6. Green chip.
4. Cap check: `computeDailyStrain(600, 100)` → `min(21, round(21 + 7))` = 21. Red chip.
5. Null check: `computeDailyStrain(null, null)` → `null`. Chip hidden.
6. Open a daily briefing — Claude's note references the strain score and the Garmin components.
7. Set strain to 18 in test data → briefing suggests swapping to recovery ride.
8. 7-day strain trend appears in dossier output for plan/coach chat surfaces.
