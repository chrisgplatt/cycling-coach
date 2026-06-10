# Expanded Strain Score Design

## Goal

Extend the daily strain score's life component (currently just Garmin daily stress average) to incorporate sleep quality, body battery recovery level, and stress peaks — giving a fuller picture of how much the day has taxed the athlete's system beyond just exercise.

## Architecture

The 0–21 strain score stays intact. The change is entirely within the life component (0–7 points):

```
strain = workout_component + life_component

workout = (activityLoad / STRAIN_TRAINING_LOAD_MAX) × 14   [unchanged]
life    = computeDailyLifeLoad(stressAvg, stressHigh, sleepScore, bodyBatteryLow)
```

`computeDailyLifeLoad` replaces the single `(stressAvg / 100) × 7` expression with a normalised blend of up to three signals.

## Life Component Sub-scores

| Signal | Max pts | Field | Interpretation |
|--------|---------|-------|----------------|
| Stress | 3.5 | `stress_avg` + `stress_high` | Sustained + peak daily stress |
| Sleep burden | 2.0 | `sleep_score` | Poor sleep = more strain |
| Recovery deficit | 1.5 | `body_battery_low` | Low wake-up battery = incomplete recovery |
| **Total** | **7.0** | | |

### Stress sub-score

When both average and peak stress are available, blend them to reward catching brief spikes the average would smooth over:

```
effectiveStress = stress_avg × 0.7 + stress_high × 0.3
stressPoints = (effectiveStress / 100) × 3.5
```

If only `stress_avg` is available: `(stress_avg / 100) × 3.5`.

### Sleep burden sub-score

`sleep_score` is 0–100 where 100 = perfect sleep. Invert it — poor sleep is a load on the system:

```
sleepPoints = ((100 - sleep_score) / 100) × 2.0
```

Sleep score 30 → 1.4 pts. Sleep score 85 → 0.3 pts.

### Recovery deficit sub-score

`body_battery_low` is the floor reached overnight (0–100). Low floor = body didn't recharge:

```
recoveryPoints = ((100 - body_battery_low) / 100) × 1.5
```

Body battery 20 → 1.2 pts. Body battery 75 → 0.375 pts.

## Graceful Degradation

Not all athletes have Garmin, and not all fields sync on every day. When fields are null they contribute 0 *raw* points but their weight is also excluded from the denominator, so the remaining signals are normalised back to 7 points:

```
availableWeight = sum of weights for non-null fields
lifeLoad = (rawPoints / availableWeight) × 7     [if availableWeight > 0]
         = null                                   [if all null]
```

**Backwards compatibility:** If only `stress_avg` is available (today's behaviour), availableWeight = 3.5, and the formula reduces to `(stressPoints / 3.5) × 7 = (stress_avg / 100) × 7` — identical to today.

## New Function Signature

```typescript
// lib/strain.ts
export function computeDailyLifeLoad(
  stressAvg: number | null,
  stressHigh: number | null,
  sleepScore: number | null,
  bodyBatteryLow: number | null,
): number | null
```

`computeDailyStrain` second parameter renames from `stressAvg` to `lifeLoad` (now pre-computed):

```typescript
export function computeDailyStrain(
  activityLoad: number | null,
  lifeLoad: number | null,
): number | null
```

## Files to Change

| File | Change |
|------|--------|
| `lib/strain.ts` | Add `computeDailyLifeLoad`; rename param in `computeDailyStrain` |
| `components/MetricsBar.tsx` | Call `computeDailyLifeLoad` from wellness fields; pass result to `computeDailyStrain` |
| `app/api/briefing/today/route.ts` | Compute lifeLoad via `computeDailyLifeLoad` for today and each history entry |
| `app/dashboard/page.tsx` | Same — compute lifeLoad before building `latestWellnessWithLoad` |

No type changes needed — `stress_high`, `sleep_score`, and `body_battery_low` are already in `ICUWellness`.

## Prompt / Briefing Impact

`formatStrainForPrompt` can optionally surface the contributing signals when non-null, e.g.:

```
Daily Strain: 12/21 (moderate) — sleep 52/100, body battery woke at 28%
```

Keep it optional: only append when at least one of sleep/battery is available and meaningfully low (sleep < 70 or battery < 50).

## What This Does NOT Include

- **Activity peak HR**: max HR during workouts is partially captured via training load already; adding it risks double-counting. Revisit if non-power activity accuracy remains a concern after this change.
- **Respiration rate / SpO2**: intervals.icu may surface these but they're less consistently available and the signal-to-noise is lower.
- **Score breakdown UI**: the 0–21 number stays as-is on MetricsBar. A tap-to-expand sub-component view is a future UX task.

## Verification

1. Athlete with all three Garmin signals → score reflects sleep + battery + stress blend
2. Athlete with only `stress_avg` (no sleep/battery) → score identical to current behaviour
3. Poor sleep night (score 35) with no workout → life component ~1.3 pts → total ~1 or 2/21
4. Great sleep + low stress + good workout → workout dominates; life component near zero
5. `formatStrainForPrompt` appends sleep/battery context when values are low
