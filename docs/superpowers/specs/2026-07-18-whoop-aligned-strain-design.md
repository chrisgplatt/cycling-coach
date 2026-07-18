# Whoop-Aligned Daily Strain — Design

**Date:** 2026-07-18
**Status:** Proposed

## Problem

Daily Strain (`lib/strain.ts`) is currently a hybrid: up to 14 points from workout load (linear, capped, scaled from `training_load`) plus up to 7 points from a "Wellbeing" blend of sleep/HRV/body-battery/subjective-wellness signals. That blend was a deliberate choice (see `2026-06-09-daily-strain-score-design.md`, widened further in `2026-07-05-strain-wellbeing-widen-design.md`), but it diverges from how the athlete's previous device — Whoop — actually computes Strain, and the linear-capped workout curve loses signal on hard days (any `training_load` above 150 scores identically, which was also the direct cause of the dashboard-vs-breakdown discrepancy fixed on 2026-07-18).

The athlete has asked for Strain to be "as close to Whoop as possible."

## What Whoop actually does (research summary)

- Strain is a **pure cumulative physiological load** score, 0–21 — cardiovascular load (time-in-HR-zone, weighted non-linearly, personalized to the athlete's own max HR) plus muscular load for strength work.
- The scale is **logarithmic/exponential**: moving from 4→5 takes far less accumulated load than 16→17 or 20→21.
- **Recovery is a separate score**, never blended into Strain.
- Day Strain sums all cardio load across the whole day (workouts + incidental activity); this app has no continuous all-day HR/steps ingestion, so Day Strain here remains "sum of today's tracked activities" — full all-day monitoring is out of scope for this change.

Sources: [WHOOP Strain support article](https://support.whoop.com/s/article/WHOOP-Strain?language=en_US), [Reputable Health](https://reputable.health/how-does-whoop-calculate-strain/), [Whoopal](https://whoopal.com/whoop-strain), [WHOOP 101 dev docs](https://developer.whoop.com/docs/whoop-101/).

## Goal

Rebuild Strain as a pure workout/cardio load score using an HR-Reserve-weighted exponential TRIMP calculation (the standard sports-science approximation of Whoop's described cardiovascular-load mechanism), personalized to the athlete's own historical load range, on a logarithmic 0–21 scale. Recovery/life signals stay entirely in the existing, separate Recovery Score (`lib/recovery-score.ts`) — nothing changes there.

## Architecture

### 1. Per-activity load (TRIMP)

For each of today's activities:

```
hrr   = clamp01((avg_hr − resting_hr) / (max_hr − resting_hr))
trimp = duration_min × hrr × TRIMP_COEFF_A × e^(TRIMP_COEFF_B × hrr)

TRIMP_COEFF_A = 0.64   // Banister male coefficients — fixed default,
TRIMP_COEFF_B = 1.92   // no sex field in the profile to branch on
```

- `max_hr` = `observed_max_hr ?? max_hr_manual`
- `resting_hr` = `garmin_resting_hr ?? resting_hr`
- Requires both a max HR and resting HR on the profile; if either is missing, this per-activity calc can't run (see fallback below).

**Fallback (no `average_heartrate` on the activity, e.g. trainer ride with no HR strap):** estimate TRIMP from the existing `training_load` value via a tunable scaling constant (`TRIMP_PER_TSS_FALLBACK`, initial guess 1.0 — pending real-world calibration). Documented in code as an approximation.

Sum today's activities → `dailyTrimp`.

### 2. Personalized log scale

```
workoutStrain = min(21, 21 × ln(1 + dailyTrimp) / ln(1 + trimpRef))
```

`trimpRef` is the athlete's own "very hard day" reference: the 95th percentile of `dailyTrimp` over the trailing 21 days. This is what personalizes the scale the way Whoop personalizes to fitness/max HR — a fitter or more heavily-trained athlete needs a bigger effort to reach the same Strain number, because their own reference point is higher.

**Cold start:** with fewer than 21 days of `dailyTrimp` history, fall back to a fixed default `trimpRef` (tunable constant, initial guess to be set from a rough back-of-envelope hard-day estimate) until enough history accumulates.

### 3. Freeze-on-first-compute persistence

Because `trimpRef` is a rolling value, leaving it fully live would let *already-displayed* historical strain numbers silently drift as new hard days enter the window. Per the athlete's choice, values are frozen the first time they're computed:

```sql
alter table daily_wellness add column if not exists daily_trimp numeric;
alter table daily_wellness add column if not exists trimp_ref numeric;
alter table daily_wellness add column if not exists workout_strain numeric; -- frozen 0–21
```

**Today is never frozen while still in progress** — a second activity later the same day must still count. Only a *past* date (`date < today` in the athlete's local timezone) gets frozen, the first time anything requests strain for that date after it has ended (typically the next day's dashboard load or the next nightly sync, whichever comes first). Today's value is always computed live from `computeDailyTrimp` + the current rolling `trimpRef`, same as before this change, and simply isn't written to the frozen columns yet.

A one-time backfill script walks existing past dates, computing `dailyTrimp` from historical activity data (available live from intervals.icu) and deriving `trimpRef` from the trailing window *as of that date*, freezing both. Dates with insufficient trailing history at backfill time use the cold-start default. (Backfill script details belong in the implementation plan, not this spec.)

### 4. Zone labels

Adopt Whoop's published bands directly, replacing the current 3-band split:

```
strainLabel: 0–9 = 'light', 10–13 = 'moderate', 14–17 = 'high', 18–21 = 'all_out'
```

### 5. Removed: life-load blending

`computeDailyLifeLoad`, `computeLifeLoadParts`, `LifeLoadInputs`, and the `STRAIN_SLEEP_WEIGHT` / `STRAIN_BATTERY_WEIGHT` / `STRAIN_SLEEP_DURATION_WEIGHT` / `STRAIN_HRV_WEIGHT` / `STRAIN_WELLNESS_WEIGHT` / `STRAIN_DRAIN_WEIGHT` constants are deleted — they're only ever used to feed Strain's old life component, and Recovery Score already independently covers HRV, sleep, and wellness (confirmed already fed into briefing prompts via `ctx.recoveryScore` in `lib/claude/briefing.ts:199`, so no information is lost).

## UI changes

**Dashboard band (`MetricsBar.tsx`):** same chip, now reflects `workoutStrain` only. Color bands follow the new 4-zone thresholds.

**Breakdown sheet (`StrainBreakdownSheet.tsx`):** the donut currently splits Workout (14pt) vs Wellbeing (7pt, sleep/battery/HRV/wellness slices). Replace with a **per-activity TRIMP breakdown** — each of today's tracked activities as a slice sized by its contribution to `dailyTrimp`, plus a visible `trimpRef` reference line/label so the athlete can see how today compares to their own recent hard-day baseline. Sleep/HRV/battery context is dropped from this sheet entirely — it already lives on the Recovery Score card, nothing new to build.

**Trend chart (`/api/charts` `dailyStrain[]`):** past dates read the frozen `workout_strain` column directly instead of recomputing live, eliminating the staleness-window edge case noted in the earlier bug investigation. Today's point is still computed live (see freeze rule above) and freezes retroactively once the date rolls over.

## Function signatures

```typescript
// lib/strain.ts
export interface ActivityHrInput {
  durationMin: number
  avgHr: number | null
  trainingLoad: number | null   // fallback when avgHr is null
}

export function computeDailyTrimp(
  activities: ActivityHrInput[],
  maxHr: number | null,
  restingHr: number | null,
): number

export function computeTrimpRef(
  trailingDailyTrimp: number[],   // most-recent-last, up to 21 entries
): number

export function computeWorkoutStrain(
  dailyTrimp: number,
  trimpRef: number,
): number   // 0–21, logarithmic

export function strainLabel(score: number): 'light' | 'moderate' | 'high' | 'all_out'
```

`computeDailyStrain` and `computeStrainComponents` (the old combined functions) are deleted; call sites use `computeWorkoutStrain` directly against the frozen/stored value where available.

## Files to change

| File | Change |
|------|--------|
| `lib/strain.ts` | Replace workout/life formulas with TRIMP + log-scale functions; delete life-load code |
| `supabase/migrations/` | New migration: `daily_trimp`, `trimp_ref`, `workout_strain` columns on `daily_wellness` |
| `app/api/sync/route.ts` (or nightly job) | Compute-and-freeze on first request per date |
| `components/MetricsBar.tsx` | Read frozen `workout_strain`; drop life-load call |
| `components/StrainBreakdownSheet.tsx` | Per-activity TRIMP donut instead of workout/wellbeing split |
| `app/dashboard/page.tsx` | Wire frozen value through instead of live `computeDailyStrain` |
| `app/api/charts/route.ts` | Read frozen `workout_strain` per day instead of recomputing |
| `app/api/briefing/today/route.ts`, `lib/claude/briefing.ts` | Drop sleep/battery context params from `formatStrainForPrompt` (Recovery Score already covers this) |
| `lib/progress/brief-generator.ts` | Update to new strain shape |
| `__tests__/lib/strain.test.ts` and related component tests | Rewritten for new formulas |
| One-time backfill script | Populate historical `daily_trimp`/`trimp_ref`/`workout_strain` |

## Open tuning constants (calibrate post-launch, same pattern as today's constants)

- `TRIMP_PER_TSS_FALLBACK` — initial guess 1.0, for activities without HR data
- Cold-start default `trimpRef` — initial guess pending a first real hard-day sample
- Trailing window length (21 days) and percentile (95th) for `trimpRef`

## Out of scope

- Continuous all-day HR/steps monitoring (no Garmin "dailies" data currently ingested) — Day Strain remains "sum of today's tracked activities," not true 24h accumulation.
- Muscular/strength load component — not applicable, this is a cycling coach app.
- Gender-specific TRIMP coefficients — no sex field on the profile.
