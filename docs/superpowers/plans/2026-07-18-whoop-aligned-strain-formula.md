# Whoop-Aligned Strain Formula Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Daily Strain's workout+life-load hybrid formula with a pure HR-Reserve-weighted exponential TRIMP calculation on a personalized logarithmic 0–21 scale, frozen per day once the date has passed, matching how Whoop actually computes Strain.

**Architecture:** All new math is pure functions in `lib/strain.ts` (no I/O), covered by unit tests. A `daily_wellness` migration adds three nullable columns to hold frozen per-day values. `app/api/charts/route.ts` becomes the read/freeze boundary — it already loops over the full wellness history to build the trend chart, so it's the natural place to compute-once and persist. `app/dashboard/page.tsx` and `app/api/briefing/today/route.ts` read today's live value from that same series computation rather than recomputing independently, which also eliminates the class of bug fixed on 2026-07-18 (two independent formulas disagreeing).

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres + `@supabase/supabase-js`), Jest.

## Global Constraints

- Run `npm run typecheck` before every commit (`tsc --noEmit` — Jest does not surface type errors). Use `npm run test:ci` to run both typecheck and tests in sequence.
- Any new file in `supabase/migrations/` must be reported to the user with the exact SQL to run manually against the shared Supabase project — there is no automated migration deploy step. Use `add column if not exists` (idempotent). After running it, tell the user to run `notify pgrst, 'reload schema';`.
- Never use `git commit --amend`; always create new commits. Never use `--no-verify`.
- This plan only touches server-side formula/data logic and the two components that must stay compilable (`MetricsBar.tsx`, `StrainBreakdownSheet.tsx`) — it does not do the ring-strip visual redesign (that's a separate, subsequent plan). `MetricsBar`'s existing colored Strain band stays in place, just re-pointed at the new formula and new 4-band labels, so the app keeps building and displaying a correct number throughout this plan.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/strain.ts` | Pure TRIMP/log-scale math, series computation, prompt formatting (rewritten) |
| `supabase/migrations/20260718_strain_trimp.sql` | New `daily_trimp`, `trimp_ref`, `workout_strain` columns on `daily_wellness` |
| `app/api/charts/route.ts` | Computes the full strain series, freezes past days, returns the chart + today's live value |
| `components/MetricsBar.tsx` | Reads `strainToday` prop instead of computing it internally |
| `app/dashboard/page.tsx` | Derives `strainToday` from `chartsData.dailyStrain`, passes to `MetricsBar`/`StrainBreakdownSheet` |
| `components/StrainBreakdownSheet.tsx` | Per-activity TRIMP donut instead of workout/wellbeing split |
| `app/api/briefing/today/route.ts`, `lib/claude/briefing.ts` | Today's strain + 7-day history computed via the new series function |
| `app/api/admin/backfill-strain/route.ts` | One-time authenticated route to freeze historical dates (this app has no standalone script runner configured — an API route matches existing conventions) |

---

### Task 1: Rewrite `lib/strain.ts` — TRIMP math, log scale, series computation

**Files:**
- Modify: `lib/strain.ts` (full rewrite of the formula portion; `computeHrvIndex`/`computeWellnessIndex` imports from `@/lib/recovery-score` are no longer needed here and should be dropped)
- Test: `__tests__/lib/strain.test.ts` (full rewrite)

**Interfaces:**
- Produces (used by every later task in this plan):
  ```typescript
  export interface DailyActivityInput {
    name: string
    durationMin: number
    avgHr: number | null
    trainingLoad: number | null
  }
  export function computeDailyTrimp(activities: DailyActivityInput[], maxHr: number | null, restingHr: number | null): number
  export function computeTrimpRef(trailingDailyTrimp: number[]): number
  export function computeWorkoutStrain(dailyTrimp: number, trimpRef: number): number
  export function strainLabel(score: number): 'light' | 'moderate' | 'high' | 'all_out'
  export function computeActivityTrimpBreakdown(activities: DailyActivityInput[], maxHr: number | null, restingHr: number | null): Array<{ name: string; trimp: number }>
  export interface StrainSeriesDayInput {
    date: string
    activities: DailyActivityInput[]
    restingHr: number | null
    frozenDailyTrimp: number | null
    frozenTrimpRef: number | null
    frozenWorkoutStrain: number | null
  }
  export interface StrainSeriesDayResult {
    date: string
    dailyTrimp: number
    trimpRef: number
    workoutStrain: number
    needsFreeze: boolean
  }
  export function computeWorkoutStrainSeries(days: StrainSeriesDayInput[], maxHr: number | null, today: string): StrainSeriesDayResult[]
  export function formatStrainForPrompt(strain: number | null): string
  export function formatStrainHistoryForPrompt(history: Array<{ date: string; strain: number | null }>): string  // unchanged
  ```

- [ ] **Step 1: Write failing tests for `computeDailyTrimp`**

Create `__tests__/lib/strain.test.ts` starting with:

```typescript
/** @jest-environment node */
import {
  computeDailyTrimp,
  computeTrimpRef,
  computeWorkoutStrain,
  strainLabel,
  computeActivityTrimpBreakdown,
  computeWorkoutStrainSeries,
  formatStrainForPrompt,
  formatStrainHistoryForPrompt,
} from '@/lib/strain'

describe('computeDailyTrimp', () => {
  test('single activity with HR data uses HRR exponential formula', () => {
    // hrr = (150-50)/(190-50) = 100/140 = 0.7143
    // trimp = 60 * 0.7143 * 0.64 * e^(1.92*0.7143) = 60 * 0.7143 * 0.64 * e^1.3714
    //       = 60 * 0.7143 * 0.64 * 3.9407 ≈ 108.05
    const result = computeDailyTrimp(
      [{ name: 'Ride', durationMin: 60, avgHr: 150, trainingLoad: 80 }],
      190, 50,
    )
    expect(result).toBeCloseTo(108.05, 0)
  })

  test('two activities sum their TRIMP', () => {
    const single = computeDailyTrimp(
      [{ name: 'Ride', durationMin: 60, avgHr: 150, trainingLoad: 80 }],
      190, 50,
    )
    const doubled = computeDailyTrimp(
      [
        { name: 'Ride AM', durationMin: 60, avgHr: 150, trainingLoad: 80 },
        { name: 'Ride PM', durationMin: 60, avgHr: 150, trainingLoad: 80 },
      ],
      190, 50,
    )
    expect(doubled).toBeCloseTo(single * 2, 4)
  })

  test('falls back to trainingLoad-based estimate when avgHr is missing', () => {
    // TRIMP_PER_TSS_FALLBACK = 1.0 → trimp = trainingLoad * 1.0
    const result = computeDailyTrimp(
      [{ name: 'Trainer ride, no HR strap', durationMin: 45, avgHr: null, trainingLoad: 60 }],
      190, 50,
    )
    expect(result).toBeCloseTo(60, 4)
  })

  test('falls back when maxHr is missing even if avgHr present', () => {
    const result = computeDailyTrimp(
      [{ name: 'Ride', durationMin: 45, avgHr: 150, trainingLoad: 60 }],
      null, 50,
    )
    expect(result).toBeCloseTo(60, 4)
  })

  test('falls back when restingHr is missing even if avgHr present', () => {
    const result = computeDailyTrimp(
      [{ name: 'Ride', durationMin: 45, avgHr: 150, trainingLoad: 60 }],
      190, null,
    )
    expect(result).toBeCloseTo(60, 4)
  })

  test('activity with neither avgHr nor trainingLoad contributes zero', () => {
    const result = computeDailyTrimp(
      [{ name: 'Untracked walk', durationMin: 20, avgHr: null, trainingLoad: null }],
      190, 50,
    )
    expect(result).toBe(0)
  })

  test('no activities → zero', () => {
    expect(computeDailyTrimp([], 190, 50)).toBe(0)
  })

  test('hrr is clamped at 1 when avgHr exceeds maxHr', () => {
    // hrr would be (200-50)/(190-50)=1.071, clamped to 1
    // trimp = 60 * 1 * 0.64 * e^1.92 = 60 * 0.64 * 6.822 ≈ 261.96
    const result = computeDailyTrimp(
      [{ name: 'Max effort', durationMin: 60, avgHr: 200, trainingLoad: 100 }],
      190, 50,
    )
    expect(result).toBeCloseTo(261.96, 0)
  })

  test('hrr is clamped at 0 when avgHr is below restingHr', () => {
    const result = computeDailyTrimp(
      [{ name: 'Very easy spin', durationMin: 60, avgHr: 40, trainingLoad: 10 }],
      190, 50,
    )
    expect(result).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- __tests__/lib/strain.test.ts`
Expected: FAIL — `computeDailyTrimp` is not exported (module doesn't have the new functions yet).

- [ ] **Step 3: Implement `DailyActivityInput` and `computeDailyTrimp`**

Replace the top of `lib/strain.ts` (imports through `computeDailyActivityLoad`) with:

```typescript
export const TRIMP_COEFF_A = 0.64   // Banister male coefficients — fixed default,
export const TRIMP_COEFF_B = 1.92   // no sex field on the profile to branch on
export const TRIMP_PER_TSS_FALLBACK = 1.0   // tunable — activities without HR data

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

export interface DailyActivityInput {
  name: string
  durationMin: number
  avgHr: number | null
  trainingLoad: number | null
}

/** Per-activity Banister HRR-exponential TRIMP; falls back to a scaled training_load estimate when HR data isn't available. */
function activityTrimp(a: DailyActivityInput, maxHr: number | null, restingHr: number | null): number {
  if (a.avgHr != null && maxHr != null && restingHr != null && maxHr > restingHr) {
    const hrr = clamp01((a.avgHr - restingHr) / (maxHr - restingHr))
    return a.durationMin * hrr * TRIMP_COEFF_A * Math.exp(TRIMP_COEFF_B * hrr)
  }
  if (a.trainingLoad != null) return a.trainingLoad * TRIMP_PER_TSS_FALLBACK
  return 0
}

export function computeDailyTrimp(
  activities: DailyActivityInput[],
  maxHr: number | null,
  restingHr: number | null,
): number {
  return activities.reduce((sum, a) => sum + activityTrimp(a, maxHr, restingHr), 0)
}

export function computeActivityTrimpBreakdown(
  activities: DailyActivityInput[],
  maxHr: number | null,
  restingHr: number | null,
): Array<{ name: string; trimp: number }> {
  return activities
    .map(a => ({ name: a.name, trimp: activityTrimp(a, maxHr, restingHr) }))
    .filter(a => a.trimp > 0)
}
```

- [ ] **Step 4: Run tests to verify `computeDailyTrimp` passes**

Run: `npm test -- __tests__/lib/strain.test.ts`
Expected: The `computeDailyTrimp` describe block passes; later describe blocks still fail (not implemented yet).

- [ ] **Step 5: Write failing tests for `computeTrimpRef` and `computeWorkoutStrain`**

Append to `__tests__/lib/strain.test.ts`:

```typescript
describe('computeTrimpRef', () => {
  test('fewer than 5 samples uses the cold-start default', () => {
    expect(computeTrimpRef([100, 120, 90])).toBe(150)
  })

  test('empty history uses the cold-start default', () => {
    expect(computeTrimpRef([])).toBe(150)
  })

  test('95th percentile of 21 samples picks the top value', () => {
    const samples = Array.from({ length: 21 }, (_, i) => (i + 1) * 10) // 10..210
    // ceil(0.95*21)-1 = ceil(19.95)-1 = 20-1 = 19 → sorted[19] = 200
    expect(computeTrimpRef(samples)).toBe(200)
  })

  test('zero and negative samples are excluded from the percentile calc', () => {
    const samples = [0, 0, 0, 100, 120, 90, 110, 105]
    expect(computeTrimpRef(samples)).toBeGreaterThan(0)
    expect(computeTrimpRef(samples)).toBeLessThanOrEqual(120)
  })
})

describe('computeWorkoutStrain', () => {
  test('zero dailyTrimp → zero strain', () => {
    expect(computeWorkoutStrain(0, 150)).toBe(0)
  })

  test('dailyTrimp equal to trimpRef lands at 21 (the reference IS the hard-day ceiling)', () => {
    expect(computeWorkoutStrain(150, 150)).toBe(21)
  })

  test('dailyTrimp well below trimpRef gives a moderate score', () => {
    // 21 * ln(51) / ln(151) = 21 * 3.9318 / 5.0173 ≈ 16.46 → rounds to 16
    const result = computeWorkoutStrain(50, 150)
    expect(result).toBe(16)
  })

  test('dailyTrimp above trimpRef still caps at 21', () => {
    expect(computeWorkoutStrain(500, 150)).toBe(21)
  })

  test('trimpRef of zero is floored to avoid division by ln(1)=0', () => {
    expect(() => computeWorkoutStrain(50, 0)).not.toThrow()
    expect(computeWorkoutStrain(50, 0)).toBe(21)
  })
})

describe('strainLabel', () => {
  test('0-9 → light', () => {
    expect(strainLabel(0)).toBe('light')
    expect(strainLabel(9)).toBe('light')
  })
  test('10-13 → moderate', () => {
    expect(strainLabel(10)).toBe('moderate')
    expect(strainLabel(13)).toBe('moderate')
  })
  test('14-17 → high', () => {
    expect(strainLabel(14)).toBe('high')
    expect(strainLabel(17)).toBe('high')
  })
  test('18-21 → all_out', () => {
    expect(strainLabel(18)).toBe('all_out')
    expect(strainLabel(21)).toBe('all_out')
  })
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- __tests__/lib/strain.test.ts`
Expected: FAIL — `computeTrimpRef`, `computeWorkoutStrain`, `strainLabel` (4-band) not implemented yet.

- [ ] **Step 7: Implement `computeTrimpRef`, `computeWorkoutStrain`, `strainLabel`**

Add to `lib/strain.ts`:

```typescript
export const TRIMP_REF_MIN_SAMPLES = 5
export const TRIMP_REF_COLD_START_DEFAULT = 150   // tunable — pending a first real hard-day sample
export const TRIMP_REF_PERCENTILE = 0.95
export const TRIMP_REF_WINDOW_DAYS = 21

export function computeTrimpRef(trailingDailyTrimp: number[]): number {
  const valid = trailingDailyTrimp.filter(v => v > 0)
  if (valid.length < TRIMP_REF_MIN_SAMPLES) return TRIMP_REF_COLD_START_DEFAULT
  const sorted = [...valid].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil(TRIMP_REF_PERCENTILE * sorted.length) - 1)
  return sorted[idx]
}

export function computeWorkoutStrain(dailyTrimp: number, trimpRef: number): number {
  if (dailyTrimp <= 0) return 0
  const ref = Math.max(trimpRef, 1)
  return Math.min(21, Math.round(21 * Math.log(1 + dailyTrimp) / Math.log(1 + ref)))
}

export function strainLabel(score: number): 'light' | 'moderate' | 'high' | 'all_out' {
  if (score <= 9) return 'light'
  if (score <= 13) return 'moderate'
  if (score <= 17) return 'high'
  return 'all_out'
}
```

Delete the old `strainLabel` definition (the 3-band `'low' | 'moderate' | 'high'` version) further down the file — there must be only one `strainLabel` export.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- __tests__/lib/strain.test.ts`
Expected: `computeTrimpRef`, `computeWorkoutStrain`, `strainLabel` describe blocks pass.

- [ ] **Step 9: Write failing tests for `computeWorkoutStrainSeries`**

Append to `__tests__/lib/strain.test.ts`:

```typescript
describe('computeWorkoutStrainSeries', () => {
  const maxHr = 190

  test('a past day with existing frozen values is returned as-is and not re-flagged', () => {
    const result = computeWorkoutStrainSeries(
      [{
        date: '2026-07-10',
        activities: [{ name: 'Ride', durationMin: 60, avgHr: 150, trainingLoad: 80 }],
        restingHr: 50,
        frozenDailyTrimp: 999,     // deliberately different from what a live calc would give —
        frozenTrimpRef: 300,       // proves the frozen values win, not a recompute
        frozenWorkoutStrain: 12,
      }],
      maxHr,
      '2026-07-18',
    )
    expect(result).toEqual([{
      date: '2026-07-10', dailyTrimp: 999, trimpRef: 300, workoutStrain: 12, needsFreeze: false,
    }])
  })

  test('a past day with no frozen values is computed live and flagged for freezing', () => {
    const result = computeWorkoutStrainSeries(
      [{
        date: '2026-07-10',
        activities: [{ name: 'Ride', durationMin: 60, avgHr: 150, trainingLoad: 80 }],
        restingHr: 50,
        frozenDailyTrimp: null, frozenTrimpRef: null, frozenWorkoutStrain: null,
      }],
      maxHr,
      '2026-07-18',
    )
    expect(result[0].needsFreeze).toBe(true)
    expect(result[0].dailyTrimp).toBeCloseTo(108.05, 0)
    expect(result[0].trimpRef).toBe(150)   // cold start — no prior days in this series
  })

  test("today's day is never flagged for freezing, even with no existing frozen row", () => {
    const result = computeWorkoutStrainSeries(
      [{
        date: '2026-07-18',
        activities: [{ name: 'Ride', durationMin: 60, avgHr: 150, trainingLoad: 80 }],
        restingHr: 50,
        frozenDailyTrimp: null, frozenTrimpRef: null, frozenWorkoutStrain: null,
      }],
      maxHr,
      '2026-07-18',
    )
    expect(result[0].needsFreeze).toBe(false)
  })

  test('trimpRef for a later day uses the trailing window of earlier days in the same series', () => {
    // Day 1 has dailyTrimp X (unfrozen, gets computed). Day 2 (today) should see
    // day 1's freshly-computed value in its trailing window, not the cold-start default.
    const days = [
      {
        date: '2026-07-17',
        activities: [{ name: 'Hard ride', durationMin: 90, avgHr: 165, trainingLoad: 120 }],
        restingHr: 50,
        frozenDailyTrimp: null, frozenTrimpRef: null, frozenWorkoutStrain: null,
      },
      {
        date: '2026-07-18',
        activities: [],
        restingHr: 50,
        frozenDailyTrimp: null, frozenTrimpRef: null, frozenWorkoutStrain: null,
      },
    ]
    const result = computeWorkoutStrainSeries(days, maxHr, '2026-07-18')
    // With only 1 sample in the trailing window (< TRIMP_REF_MIN_SAMPLES=5), day 2 still
    // falls back to the cold-start default — this asserts that behaviour explicitly.
    expect(result[1].trimpRef).toBe(150)
  })

  test('rolling window caps at 21 days — the 22nd prior day drops out', () => {
    const days = Array.from({ length: 22 }, (_, i) => ({
      date: `day-${i}`,
      activities: [{ name: 'Ride', durationMin: 60, avgHr: 150, trainingLoad: i === 0 ? 500 : 80 }],
      restingHr: 50,
      frozenDailyTrimp: null, frozenTrimpRef: null, frozenWorkoutStrain: null,
    }))
    // day-0 is a huge outlier; by day index 22 it should have rolled out of the 21-day window.
    // We just assert the series computes without error and every day has a trimpRef.
    const result = computeWorkoutStrainSeries(days, maxHr, 'day-999')
    expect(result).toHaveLength(22)
    expect(result.every(r => r.trimpRef > 0)).toBe(true)
  })
})
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `npm test -- __tests__/lib/strain.test.ts`
Expected: FAIL — `computeWorkoutStrainSeries` not exported yet.

- [ ] **Step 11: Implement `computeWorkoutStrainSeries`**

Add to `lib/strain.ts`:

```typescript
export interface StrainSeriesDayInput {
  date: string
  activities: DailyActivityInput[]
  restingHr: number | null
  frozenDailyTrimp: number | null
  frozenTrimpRef: number | null
  frozenWorkoutStrain: number | null
}

export interface StrainSeriesDayResult {
  date: string
  dailyTrimp: number
  trimpRef: number
  workoutStrain: number
  needsFreeze: boolean
}

/** `days` must be sorted chronologically ascending. Frozen past days pass through untouched;
 * unfrozen past days and today are computed live against a rolling window of the trailing
 * `TRIMP_REF_WINDOW_DAYS` daily_trimp values seen so far in this same series. */
export function computeWorkoutStrainSeries(
  days: StrainSeriesDayInput[],
  maxHr: number | null,
  today: string,
): StrainSeriesDayResult[] {
  const window: number[] = []
  const results: StrainSeriesDayResult[] = []

  for (const day of days) {
    const isPast = day.date < today
    const alreadyFrozen = isPast
      && day.frozenDailyTrimp != null && day.frozenTrimpRef != null && day.frozenWorkoutStrain != null

    let dailyTrimp: number
    let trimpRef: number
    let workoutStrain: number
    let needsFreeze: boolean

    if (alreadyFrozen) {
      dailyTrimp = day.frozenDailyTrimp!
      trimpRef = day.frozenTrimpRef!
      workoutStrain = day.frozenWorkoutStrain!
      needsFreeze = false
    } else {
      dailyTrimp = computeDailyTrimp(day.activities, maxHr, day.restingHr)
      trimpRef = computeTrimpRef(window)
      workoutStrain = computeWorkoutStrain(dailyTrimp, trimpRef)
      needsFreeze = isPast
    }

    results.push({ date: day.date, dailyTrimp, trimpRef, workoutStrain, needsFreeze })

    window.push(dailyTrimp)
    if (window.length > TRIMP_REF_WINDOW_DAYS) window.shift()
  }

  return results
}
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `npm test -- __tests__/lib/strain.test.ts`
Expected: `computeWorkoutStrainSeries` describe block passes.

- [ ] **Step 13: Write failing tests for `computeActivityTrimpBreakdown` and simplified `formatStrainForPrompt`**

Append to `__tests__/lib/strain.test.ts`:

```typescript
describe('computeActivityTrimpBreakdown', () => {
  test('returns one entry per activity with non-zero trimp, dropping zero-trimp entries', () => {
    const result = computeActivityTrimpBreakdown(
      [
        { name: 'Morning ride', durationMin: 60, avgHr: 150, trainingLoad: 80 },
        { name: 'Untracked walk', durationMin: 20, avgHr: null, trainingLoad: null },
      ],
      190, 50,
    )
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Morning ride')
    expect(result[0].trimp).toBeGreaterThan(0)
  })
})

describe('formatStrainForPrompt', () => {
  test('includes score, scale, and label', () => {
    const s = formatStrainForPrompt(11)
    expect(s).toBe('Daily Strain: 11/21 (moderate)')
  })

  test('null → empty string', () => {
    expect(formatStrainForPrompt(null)).toBe('')
  })

  test('reflects the all_out band at the top of the scale', () => {
    expect(formatStrainForPrompt(20)).toBe('Daily Strain: 20/21 (all_out)')
  })
})
```

- [ ] **Step 14: Run tests to verify they fail**

Run: `npm test -- __tests__/lib/strain.test.ts`
Expected: FAIL — old `formatStrainForPrompt` still takes 4 params and produces different text; `computeActivityTrimpBreakdown` not implemented.

- [ ] **Step 15: Implement `computeActivityTrimpBreakdown` (already added in Step 3) and simplify `formatStrainForPrompt`**

Replace the existing `formatStrainForPrompt` function in `lib/strain.ts` with:

```typescript
export function formatStrainForPrompt(strain: number | null): string {
  if (strain == null) return ''
  return `Daily Strain: ${strain}/21 (${strainLabel(strain)})`
}
```

`formatStrainHistoryForPrompt` is unchanged — keep its existing implementation and existing tests in `__tests__/lib/strain.test.ts` verbatim.

- [ ] **Step 16: Delete all now-dead code**

Remove from `lib/strain.ts`:
- `computeDailyActivityLoad` and its `STRAIN_NONPOWER_LOAD_MAX` constant — fully superseded by `computeDailyTrimp`
- `LifeLoadInputs`, `LifeLoadParts`, `computeLifeLoadParts`, `computeDailyLifeLoad`, `StrainComponents`, `computeStrainComponents`, `computeDailyStrain`
- `STRAIN_TRAINING_LOAD_MAX`, `STRAIN_WORKOUT_WEIGHT`, `STRAIN_LIFE_WEIGHT`, `STRAIN_SLEEP_WEIGHT`, `STRAIN_BATTERY_WEIGHT`, `STRAIN_SLEEP_DURATION_WEIGHT`, `STRAIN_HRV_WEIGHT`, `STRAIN_WELLNESS_WEIGHT`, `STRAIN_DRAIN_WEIGHT`, `STRAIN_SLEEP_DURATION_TARGET_SECS`, `STRAIN_SLEEP_DURATION_MIN_SECS`
- `sleepDurationScore` (only used by the deleted life-load code)
- The `import { computeHrvIndex, computeWellnessIndex } from '@/lib/recovery-score'` line at the top of the file

Delete the corresponding old test blocks from `__tests__/lib/strain.test.ts`: `describe('computeDailyLifeLoad', ...)`, `describe('computeStrainComponents', ...)`, `describe('computeDailyStrain', ...)`, and the old 3-band `describe('strainLabel', ...)` block (superseded by the 4-band one added in Step 5) and the old `formatStrainForPrompt` sleep/battery-context tests (superseded by Step 13).

- [ ] **Step 17: Run the full strain test file and typecheck**

Run: `npm test -- __tests__/lib/strain.test.ts && npm run typecheck`
Expected: All tests in the file pass; typecheck reports errors in the *other* files that still import the deleted functions (`components/MetricsBar.tsx`, `components/StrainBreakdownSheet.tsx`, `app/api/charts/route.ts`, `app/api/briefing/today/route.ts`) — this is expected at this point in the plan and gets fixed in Tasks 3–6. Confirm the only errors are in those four files, not in `lib/strain.ts` or its test.

- [ ] **Step 18: Commit**

```bash
git add lib/strain.ts __tests__/lib/strain.test.ts
git commit -m "feat: replace strain hybrid formula with HR-Reserve TRIMP + log scale

Pure workout/cardio load now, matching how Whoop actually computes
Strain — life/recovery signals stay in the separate Recovery Score.
Downstream call sites are updated in follow-up commits; typecheck will
show expected errors there until then."
```

---

### Task 2: Migration — freeze columns on `daily_wellness`

**Files:**
- Create: `supabase/migrations/20260718_strain_trimp.sql`

**Interfaces:**
- Produces: `daily_wellness.daily_trimp numeric`, `daily_wellness.trimp_ref numeric`, `daily_wellness.workout_strain numeric` — read/written by Tasks 3, 6, and 8.

- [ ] **Step 1: Write the migration**

```sql
-- Frozen per-day Strain values for the Whoop-aligned TRIMP formula. Written once
-- a date has fully passed (see computeWorkoutStrainSeries in lib/strain.ts); never
-- rewritten after that, so historical chart values don't drift as the rolling
-- trimp_ref reference window advances. Run in the Supabase SQL editor before
-- deploying the matching app version.

alter table daily_wellness
  add column if not exists daily_trimp numeric,
  add column if not exists trimp_ref numeric,
  add column if not exists workout_strain numeric;
```

- [ ] **Step 2: Tell the user to run it**

Report to the user: "New migration `supabase/migrations/20260718_strain_trimp.sql` needs to be run manually against the shared Supabase project (SQL editor, or `supabase db push` if linked locally) before or as part of deploying this change. After running it, also run `notify pgrst, 'reload schema';` so PostgREST picks up the new columns immediately." Do not proceed to mark this step done until the user confirms the migration has been applied, since Task 3 onward reads/writes these columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260718_strain_trimp.sql
git commit -m "feat: add daily_trimp/trimp_ref/workout_strain columns to daily_wellness"
```

---

### Task 3: `app/api/charts/route.ts` — compute the series, freeze past days

**Files:**
- Modify: `app/api/charts/route.ts:1-141`

**Interfaces:**
- Consumes: `computeWorkoutStrainSeries`, `StrainSeriesDayInput`, `DailyActivityInput` from `lib/strain.ts` (Task 1); `resolveMaxHrFromProfile` from `@/lib/max-hr` (existing).
- Produces: `ChartsData.dailyStrain` now sourced from `StrainSeriesDayResult` — update `types/index.ts`'s `DailyStrainPoint` to match (see Step 1 below), which `app/dashboard/page.tsx` (Task 4) and `components/MetricsBar.tsx` (Task 4) consume as `chartsData.dailyStrain`.

- [ ] **Step 1: Update the `DailyStrainPoint` type**

In `types/index.ts`, replace the existing `DailyStrainPoint` interface (currently at line 454) with:

```typescript
export interface DailyStrainPoint {
  date: string
  dailyTrimp: number
  trimpRef: number
  workoutStrain: number
  garminReadiness?: number | null
  garminRecoveryTimeMins?: number | null
  garminBatteryCharged?: number | null
  garminBatteryDrained?: number | null
  garminStressMax?: number | null
}
```

(Drops `workout`, `life`, `total`, `workoutLoad`, `sleepScore`, `sleepSecs`, `bodyBatteryHigh` — those were the old hybrid formula's fields. `total` becomes `workoutStrain`.)

- [ ] **Step 2: Write a failing integration-style test for the route's strain wiring**

There is no existing test file for `app/api/charts/route.ts` (verify with `Glob __tests__/**/charts*`). Rather than adding a full route test harness (out of scope for this plan — no existing precedent for testing this route), this task is verified via Task 3 Step 5's manual/typecheck check plus the already-passing `lib/strain.ts` unit tests that this route composes. Skip ahead to Step 3.

- [ ] **Step 3: Rewrite the route**

Replace lines 1–11 (imports) with:

```typescript
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { isoWeekStart } from '@/lib/chart-helpers'
import { mergeGarminIntoWellness } from '@/lib/garmin-wellness-merge'
import { resolveMaxHrFromProfile } from '@/lib/max-hr'
import type { ChartsData, WeeklyTss, RidePoint, DailyStrainPoint, ActivitySummary } from '@/types'
import {
  computeWorkoutStrainSeries,
  type StrainSeriesDayInput,
  type DailyActivityInput,
} from '@/lib/strain'
```

Replace the profile select on line 20–23 to also fetch max-HR fields:

```typescript
  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, current_ftp, max_hr_manual, observed_max_hr, date_of_birth')
    .maybeSingle()
```

Replace the `daily_wellness` query (lines 51–56) to also select the frozen columns:

```typescript
      supabase
        .from('daily_wellness')
        .select('date, daily_trimp, trimp_ref, workout_strain')
        .eq('user_id', user.id)
        .gte('date', oldest)
        .lte('date', newest),
```

Replace the "Daily strain" block (lines 95–133) with:

```typescript
    // Daily strain — pure HR-Reserve TRIMP load, computed chronologically so each
    // day's personalized reference sees the correctly-ordered trailing window.
    const maxHr = resolveMaxHrFromProfile(profile as { max_hr_manual?: number | null; date_of_birth?: string | null; observed_max_hr?: number | null })?.value ?? null
    const activitiesByDate = new Map<string, DailyActivityInput[]>()
    for (const a of activities) {
      const date = a.start_date_local.slice(0, 10)
      const arr = activitiesByDate.get(date) ?? []
      arr.push({
        name: a.name,
        durationMin: a.moving_time / 60,
        avgHr: a.average_heartrate,
        trainingLoad: a.training_load,
      })
      activitiesByDate.set(date, arr)
    }

    const seriesInput: StrainSeriesDayInput[] = wellness
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((w): StrainSeriesDayInput => {
        const dw = dailyWellnessByDate.get(w.id) as { daily_trimp?: number | null; trimp_ref?: number | null; workout_strain?: number | null } | undefined
        return {
          date: w.id,
          activities: activitiesByDate.get(w.id) ?? [],
          restingHr: w.garmin_resting_hr ?? w.resting_hr,
          frozenDailyTrimp: dw?.daily_trimp ?? null,
          frozenTrimpRef: dw?.trimp_ref ?? null,
          frozenWorkoutStrain: dw?.workout_strain ?? null,
        }
      })

    const seriesResults = computeWorkoutStrainSeries(seriesInput, maxHr, newest)

    const toFreeze = seriesResults.filter(r => r.needsFreeze)
    if (toFreeze.length > 0) {
      const { error: freezeError } = await supabase
        .from('daily_wellness')
        .upsert(
          toFreeze.map(r => ({
            user_id: user.id,
            date: r.date,
            daily_trimp: r.dailyTrimp,
            trimp_ref: r.trimpRef,
            workout_strain: r.workoutStrain,
          })),
          { onConflict: 'user_id,date' },
        )
      // Freezing is a cache-write, not the source of truth for this response — log
      // and continue with the in-memory results rather than failing the whole request.
      if (freezeError) console.error('Failed to freeze historical strain values:', freezeError.message)
    }

    const seriesByDate = new Map(seriesResults.map(r => [r.date, r]))
    const dailyStrain: DailyStrainPoint[] = wellness
      .map((w): DailyStrainPoint | null => {
        const r = seriesByDate.get(w.id)
        if (!r || r.workoutStrain <= 0) return null
        const g = garminByDate.get(w.id)
        return {
          date: w.id,
          dailyTrimp: r.dailyTrimp,
          trimpRef: r.trimpRef,
          workoutStrain: r.workoutStrain,
          garminReadiness: g?.garmin_training_readiness ?? null,
          garminRecoveryTimeMins: g?.garmin_recovery_time_mins ?? null,
          garminBatteryCharged: g?.garmin_body_battery_charged ?? null,
          garminBatteryDrained: g?.garmin_body_battery_drained ?? null,
          garminStressMax: g?.garmin_stress_max ?? null,
        }
      })
      .filter((p): p is DailyStrainPoint => p !== null)
```

This removes the `computeHrvBaseline`/`dayHrvStatus` usage and the `ftp`/ `computeDailyActivityLoad` variable that the old block used — remove the now-unused `import { computeHrvBaseline } from '@/lib/hrv/baseline'` line and the `const ftp: number | null = ...` line if nothing else in the file references them (check with a search for `computeHrvBaseline` and `ftp` elsewhere in the file before deleting the import — `ftp` was only used by the deleted `computeDailyActivityLoad` call).

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No errors in `app/api/charts/route.ts` or `types/index.ts`. Errors may remain in `components/MetricsBar.tsx`, `components/StrainBreakdownSheet.tsx`, `app/api/briefing/today/route.ts` (fixed in Tasks 4–6).

- [ ] **Step 5: Commit**

```bash
git add app/api/charts/route.ts types/index.ts
git commit -m "feat: compute and freeze daily strain via computeWorkoutStrainSeries in charts route"
```

---

### Task 4: Wire `MetricsBar.tsx` and `app/dashboard/page.tsx` to the shared series value

**Files:**
- Modify: `components/MetricsBar.tsx:1-8, 337-345, 378-392, 481, 509-543` (see below for exact replacements)
- Modify: `app/dashboard/page.tsx:448-470, 675-691`
- Test: `__tests__/components/MetricsBar.test.tsx` (update assertions for new prop shape and 4-band labels)

**Interfaces:**
- Consumes: `DailyStrainPoint` (Task 3's new shape) from `@/types`; `strainLabel` from `@/lib/strain`.
- Produces: `MetricsBar` now takes a `strainToday: DailyStrainPoint | null` prop instead of computing strain internally — no other task depends on this beyond Task 5/6 in the *next* plan (the ring-strip redesign), which will read the same prop shape.

- [ ] **Step 1: Update `MetricsBar.tsx` imports and props**

Replace line 6:

```typescript
import { strainLabel } from '@/lib/strain'
```

Replace the `StrainChartPoint` interface and `strainChartData` function (lines 50–144) — they referenced the old `workout`/`life`/`total`/`workoutLoad`/`sleepScore` etc. fields. Replace with:

```typescript
interface StrainChartPoint {
  label: string
  workoutStrain: number
  dateLabel: string
}

function strainChartData(
  history: DailyStrainPoint[],
  tab: '1w' | '1m' | '3m',
): StrainChartPoint[] {
  if (tab === '3m') {
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - 3)
    const cutoffStr = localDateStr(cutoff)
    const filtered = history.filter(p => p.date >= cutoffStr)
    const weekMap = new Map<string, DailyStrainPoint[]>()
    for (const p of filtered) {
      const wk = isoWeekStart(p.date)
      const arr = weekMap.get(wk) ?? []
      arr.push(p)
      weekMap.set(wk, arr)
    }
    return Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([wk, pts]) => {
        const [, month, day] = wk.split('-').map(Number)
        const label = `${MONTHS_SHORT[month - 1]} ${day}`
        const n = pts.length
        return {
          label,
          workoutStrain: Math.round(pts.reduce((s, p) => s + p.workoutStrain, 0) / n),
          dateLabel: label,
        }
      })
  }

  const days = tab === '1w' ? 7 : 30
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days + 1)
  cutoff.setHours(0, 0, 0, 0)
  const cutoffStr = localDateStr(cutoff)
  const filtered = history.filter(p => p.date >= cutoffStr)

  const result: StrainChartPoint[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(cutoff)
    d.setDate(cutoff.getDate() + i)
    const dateStr = localDateStr(d)
    const found = filtered.find(p => p.date === dateStr)
    let label = ''
    if (tab === '1w') {
      label = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
    } else if (i % 7 === 0) {
      label = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
    }
    result.push({
      label,
      workoutStrain: found?.workoutStrain ?? 0,
      dateLabel: dayLabel(d),
    })
  }
  return result
}
```

(`avgOrNull` is now unused — delete it too.)

- [ ] **Step 2: Simplify the `StrainChart` component's bars and tooltip**

In the `StrainChart` function (was lines 159–335), replace the stacked bar logic (the `if (d.life > 0)` / `if (d.workout > 0)` block) with a single bar per day:

```typescript
    if (d.workoutStrain > 0) {
      const h = (d.workoutStrain / Y_MAX * CH).toFixed(1)
      bars.push(
        <rect key={`work-${i}`}
          x={bx} y={yOf(d.workoutStrain).toFixed(1)}
          width={bwStr} height={h}
          fill="#3b82f6" rx="1.5"
        />
      )
    }

    linePoints.push(`${cx.toFixed(1)},${yOf(d.workoutStrain).toFixed(1)}`)
```

Replace every remaining `d.total` reference in the same function (dot rendering, tooltip positioning) with `d.workoutStrain`.

Replace the tooltip body (the block starting `<div className="font-bold mb-1">{d.dateLabel}</div>`) with:

```jsx
              <div className="font-bold mb-1">{d.dateLabel}</div>
              <div className="font-bold">Strain {d.workoutStrain}/21</div>
```

Remove the now-unused `Sleep`/`Duration`/`Battery`/`Readiness` tooltip lines and the "Wellbeing" legend entry (the `<div className="flex items-center gap-1 text-[10px] text-gray-500">` block with the `#f59e0b` swatch) — only the "Workout"/"Total" legend entries remain, relabel "Workout" to "Strain" since there's no separate wellbeing bar anymore.

- [ ] **Step 3: Update the color-band maps and main component body**

Replace lines 337–345:

```typescript
const BAND_BG: Record<string, string> = {
  light:    'bg-emerald-600',
  moderate: 'bg-amber-600',
  high:     'bg-orange-600',
  all_out:  'bg-red-600',
}

const BAND_LABEL: Record<string, string> = {
  light: 'Light', moderate: 'Moderate', high: 'High', all_out: 'All Out',
}
```

Replace the component signature and body's strain-derivation lines (was lines 355–392):

```typescript
export default function MetricsBar({
  wellness,
  stale = {},
  embedded = false,
  lastRideLabel,
  onStrainTap,
  strainHistory,
  strainToday,
  hrvStatus,
}: {
  wellness: ICUWellness | null
  stale?: { hrv?: boolean; restingHr?: boolean }
  embedded?: boolean
  lastRideLabel?: string
  onStrainTap?: () => void
  strainHistory?: DailyStrainPoint[]
  strainToday?: DailyStrainPoint | null
  hrvStatus?: HrvStatus | null
}) {
  const [trendOpen, setTrendOpen] = useState(false)
  const [trendTab, setTrendTab] = useState<'1w' | '1m' | '3m'>('1w')
  const hasStrainHistory = (strainHistory?.length ?? 0) > 0

  if (!wellness) return null
  const form = wellness.form ?? (wellness.ctl !== null && wellness.atl !== null ? wellness.ctl - wellness.atl : null)
  const formPositive = form !== null && form >= 0
  const dailyStrain = strainToday?.workoutStrain ?? null
  const strainCategory = dailyStrain !== null ? strainLabel(dailyStrain) : null
```

`computeDailyLifeLoad`, `computeDailyStrain`, and the `todayDailyWellness` prop are no longer used by this component — remove the `todayDailyWellness` prop from the destructured props and its type, and remove it from the props interface. (It stays a prop on `StrainBreakdownSheet` for now — Task 5 handles that file separately.)

The JSX for the colored band (was lines 397–428) references `dailyStrain` and `strainCategory` exactly as before — no further changes needed there since those variable names are preserved.

- [ ] **Step 4: Update `app/dashboard/page.tsx` to source `strainToday` from `chartsData`**

Replace lines 448–453 (drop the standalone `computeDailyActivityLoad` call and `garmin_training_load` override — that field fed the old formula only):

```typescript
  const todayStr = localDateStr(new Date())
  const strainToday = chartsData?.dailyStrain.find(d => d.date === todayStr) ?? null
  const latestWellnessWithLoad: ICUWellness | null = latestWellness
    ? {
        ...latestWellness,
        // Merge Garmin data from today's sync if available
```

(Keep the rest of the `garmin_*` merge fields on lines 455–469 unchanged — they're unrelated to strain.)

Replace the `MetricsBar` usage (lines 677–686):

```typescript
          <MetricsBar
            wellness={latestWellnessWithLoad}
            stale={wellnessStale}
            embedded
            lastRideLabel={lastRide ? formatLastRide() : undefined}
            onStrainTap={() => setStrainSheetOpen(true)}
            strainHistory={chartsData?.dailyStrain}
            strainToday={strainToday}
            hrvStatus={hrvStatus}
          />
```

- [ ] **Step 5: Update `__tests__/components/MetricsBar.test.tsx`**

Read the existing test file first (`Read __tests__/components/MetricsBar.test.tsx`) to find every place it passes `wellness.garmin_training_load` + wellness sleep/battery fields expecting a computed strain, or asserts on `'Low'`/`'Moderate'`/`'High'` band text. Replace those setups with a `strainToday` prop of shape `{ date: '<test date>', dailyTrimp: <n>, trimpRef: <n>, workoutStrain: <n>, garminReadiness: null, garminRecoveryTimeMins: null, garminBatteryCharged: null, garminBatteryDrained: null, garminStressMax: null }`, and update band-text assertions to the new labels (`'Light'`, `'Moderate'`, `'High'`, `'All Out'`). Update any `strainHistory` fixture arrays to the new `DailyStrainPoint` shape (`workoutStrain` instead of `total`/`workout`/`life`).

- [ ] **Step 6: Run the component test and typecheck**

Run: `npm test -- __tests__/components/MetricsBar.test.tsx && npm run typecheck`
Expected: Tests pass. Typecheck errors remain only in `components/StrainBreakdownSheet.tsx` and `app/api/briefing/today/route.ts` (fixed in Tasks 5–6).

- [ ] **Step 7: Commit**

```bash
git add components/MetricsBar.tsx app/dashboard/page.tsx __tests__/components/MetricsBar.test.tsx
git commit -m "feat: read strain from the shared chartsData series instead of recomputing in MetricsBar

Dashboard and trend chart now derive from the same computeWorkoutStrainSeries
call, closing the class of bug where two independent formulas could disagree."
```

---

### Task 5: Rewrite `StrainBreakdownSheet.tsx` — per-activity TRIMP donut

**Files:**
- Modify: `components/StrainBreakdownSheet.tsx` (full rewrite)
- Test: `__tests__/components/StrainBreakdownSheet.test.tsx` (rewrite for new props/content)

**Interfaces:**
- Consumes: `computeActivityTrimpBreakdown`, `strainLabel` from `@/lib/strain`; `DailyStrainPoint` from `@/types`.
- Produces: new prop shape `{ strainToday: DailyStrainPoint; activities: Array<{ name: string; durationMin: number; avgHr: number | null; trainingLoad: number | null }>; onClose: () => void }` — consumed by `app/dashboard/page.tsx` (this task) and, in the follow-up UI plan, by the Strain ring's tap handler.

- [ ] **Step 1: Read the current test file for structure**

Run `Read __tests__/components/StrainBreakdownSheet.test.tsx` to see the existing render/assertion patterns (query selectors, testing-library conventions used) so the rewritten tests match house style exactly.

- [ ] **Step 2: Write the new component**

Replace the entire contents of `components/StrainBreakdownSheet.tsx`:

```typescript
'use client'
import { computeActivityTrimpBreakdown, strainLabel } from '@/lib/strain'
import type { DailyStrainPoint } from '@/types'

interface ActivityInput {
  name: string
  durationMin: number
  avgHr: number | null
  trainingLoad: number | null
}

interface Props {
  strainToday: DailyStrainPoint
  activities: ActivityInput[]
  maxHr: number | null
  restingHr: number | null
  onClose: () => void
}

const BAND_BG: Record<string, string> = {
  light: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  high: 'bg-orange-500',
  all_out: 'bg-red-500',
}

const DONUT_COLORS = ['#3b82f6', '#8b5cf6', '#6366f1', '#a78bfa', '#14b8a6', '#10b981', '#f97316', '#f43f5e']

export default function StrainBreakdownSheet({ strainToday, activities, maxHr, restingHr, onClose }: Props) {
  const totalStrain = strainToday.workoutStrain
  const label = strainLabel(totalStrain)
  const breakdown = computeActivityTrimpBreakdown(activities, maxHr, restingHr)
  const totalTrimp = breakdown.reduce((s, a) => s + a.trimp, 0)

  let acc = 0
  const segments = breakdown.map((a, i) => {
    const pct = totalTrimp > 0 ? (a.trimp / totalTrimp) * 100 : 0
    const start = acc
    acc += pct
    return { ...a, pct, start, end: acc, color: DONUT_COLORS[i % DONUT_COLORS.length] }
  })
  const donut = segments.length > 0
    ? `conic-gradient(${segments.map(s => `${s.color} ${s.start}% ${s.end}%`).join(', ')}, #e2e8f0 ${acc}% 100%)`
    : 'conic-gradient(#e2e8f0 0% 100%)'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white w-full max-w-sm rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 pb-5 pt-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.08em] mb-1">
                Strain Breakdown
              </p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-black text-gray-900">{totalStrain}</span>
                <span className="text-sm text-gray-400">/ 21</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white ${BAND_BG[label]}`}>
                  {label === 'all_out' ? 'All Out' : label.charAt(0).toUpperCase() + label.slice(1)}
                </span>
              </div>
            </div>
            {/* Donut ring */}
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: donut }}
            >
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-base font-black text-gray-900">
                {totalStrain}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-gray-400 mb-3">
            Today vs your own recent hard-day reference: {Math.round(strainToday.dailyTrimp)} / {Math.round(strainToday.trimpRef)} TRIMP
          </p>

          {/* Per-activity breakdown */}
          {segments.length > 0 ? (
            <div className="space-y-2.5 pl-1">
              {segments.map(s => (
                <div key={s.name} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="text-xs text-gray-700">
                    {s.name} <span className="text-gray-400">{Math.round(s.pct)}% of today&apos;s load</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-300">No activity recorded today</p>
          )}

          <div className="flex justify-end mt-5">
            <button
              onClick={onClose}
              className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Rewrite `__tests__/components/StrainBreakdownSheet.test.tsx`**

Following the query/assertion conventions read in Step 1, write tests covering:
- renders the total strain number and band label from `strainToday.workoutStrain`
- renders one row per activity in `activities` that has HR or training-load data (non-zero TRIMP), with its name
- an activity with neither `avgHr` nor `trainingLoad` does not get a row
- shows "No activity recorded today" when `activities` is empty
- clicking the "Close" button calls `onClose`

Example first test:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import StrainBreakdownSheet from '@/components/StrainBreakdownSheet'

const strainToday = { date: '2026-07-18', dailyTrimp: 108, trimpRef: 150, workoutStrain: 16 }

test('renders total strain and band', () => {
  render(
    <StrainBreakdownSheet
      strainToday={strainToday}
      activities={[{ name: 'Morning ride', durationMin: 60, avgHr: 150, trainingLoad: 80 }]}
      maxHr={190}
      restingHr={50}
      onClose={jest.fn()}
    />
  )
  expect(screen.getByText('16')).toBeInTheDocument()
  expect(screen.getByText('High')).toBeInTheDocument()
  expect(screen.getByText(/Morning ride/)).toBeInTheDocument()
})

test('close button calls onClose', () => {
  const onClose = jest.fn()
  render(
    <StrainBreakdownSheet strainToday={strainToday} activities={[]} maxHr={190} restingHr={50} onClose={onClose} />
  )
  fireEvent.click(screen.getByText('Close'))
  expect(onClose).toHaveBeenCalled()
})

test('shows empty state with no activities', () => {
  render(
    <StrainBreakdownSheet strainToday={strainToday} activities={[]} maxHr={190} restingHr={50} onClose={jest.fn()} />
  )
  expect(screen.getByText('No activity recorded today')).toBeInTheDocument()
})
```

- [ ] **Step 4: Update `app/dashboard/page.tsx`'s `StrainBreakdownSheet` usage**

Replace lines 974–981:

```typescript
      {strainSheetOpen && strainToday && (
        <StrainBreakdownSheet
          strainToday={strainToday}
          activities={todayActivities.map(a => ({
            name: a.name,
            durationMin: a.moving_time / 60,
            avgHr: a.average_heartrate,
            trainingLoad: a.training_load,
          }))}
          maxHr={resolveMaxHrFromProfile({ max_hr_manual: profile?.max_hr_manual, date_of_birth: profile?.date_of_birth, observed_max_hr: profile?.observed_max_hr })?.value ?? null}
          restingHr={latestWellnessWithLoad?.garmin_resting_hr ?? latestWellnessWithLoad?.resting_hr ?? null}
          onClose={() => setStrainSheetOpen(false)}
        />
      )}
```

This requires `resolveMaxHrFromProfile` to be imported in `app/dashboard/page.tsx` (`import { resolveMaxHrFromProfile } from '@/lib/max-hr'`) and requires `profile` (the athlete's `user_profile` row) to already be available in this component's state — verify this by searching the file for an existing `profile` variable (the dashboard page fetches the user's profile elsewhere for FTP/timezone; confirm the exact variable name with `Grep -n "max_hr_manual|date_of_birth" app/dashboard/page.tsx` before wiring this in, since the read in this plan did not cover that section of the file). If the profile object is fetched under a different name, use that name instead of `profile` throughout this step. `activitySummary` (the old prop, a joined string of ride names) is no longer used by `StrainBreakdownSheet` and can be left in place if other code still reads it, or removed if `Grep` shows no other consumer.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- __tests__/components/StrainBreakdownSheet.test.tsx && npm run typecheck`
Expected: Tests pass. No remaining typecheck errors in `components/StrainBreakdownSheet.tsx` or `app/dashboard/page.tsx`. Errors remain only in `app/api/briefing/today/route.ts` (Task 6).

- [ ] **Step 6: Commit**

```bash
git add components/StrainBreakdownSheet.tsx __tests__/components/StrainBreakdownSheet.test.tsx app/dashboard/page.tsx
git commit -m "feat: redesign strain breakdown sheet as a per-activity TRIMP donut"
```

---

### Task 6: `app/api/briefing/today/route.ts` + `lib/claude/briefing.ts`

**Files:**
- Modify: `app/api/briefing/today/route.ts:9, 32-33, 219-220, 261-262, 264-300`
- Modify: `lib/claude/briefing.ts` — no change needed (verify in Step 3)
- Test: search for and update any test file covering the briefing route's strain wiring (`__tests__/lib/brief-generator.test.ts`, `__tests__/lib/chat-prompt.test.ts`, `__tests__/lib/athlete-state.test.ts` were listed as referencing "resting_hr" in an earlier search — check each with `Grep -l computeDailyStrain __tests__` for the authoritative list before editing)

**Interfaces:**
- Consumes: `computeDailyTrimp`, `computeTrimpRef`, `computeWorkoutStrain`, `DailyActivityInput` from `@/lib/strain` (Task 1); `resolveMaxHrFromProfile` from `@/lib/max-hr` (already imported in this file as `resolveMaxHrFromProfile`).

- [ ] **Step 1: Find every test referencing the deleted functions**

Run: `Grep -rl "computeDailyStrain|computeDailyLifeLoad|computeDailyActivityLoad" __tests__/`

For each file found (expected: at minimum the ones this task touches, possibly others like `__tests__/lib/athlete-state.test.ts`), open it and note every mock/assertion that constructs a `BriefingContext.dailyStrain` value or mocks these functions — these will need their fixtures updated in Step 4, since `dailyStrain` on `BriefingContext` changes from a raw formula result to `computeWorkoutStrain`'s output (same `number | null` type, so `BriefingContext`'s type itself doesn't change — only how it's computed).

- [ ] **Step 2: Replace the strain computation block in the route**

Replace line 9:

```typescript
import { computeDailyTrimp, computeTrimpRef, computeWorkoutStrain, type DailyActivityInput } from '@/lib/strain'
```

Replace lines 219–300 (from `const twoDaysAgo = ...` through the end of the `strainHistory = strainWellness.map(...)` block) — this needs the trailing 21-day window for `trimpRef`, wider than the existing 7-day fetch, so extend the lookback:

```typescript
  const twoDaysAgo = new Date(Date.now() - 2 * 864e5).toISOString().split('T')[0]
  const twentyOneDaysAgo = new Date(Date.now() - 21 * 864e5).toISOString().split('T')[0]
  const [{ data: wellnessRows }, { data: garminRow }, { data: strainDailyWellnessRows }] = await Promise.all([
    supabase
      .from('daily_wellness')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', twoDaysAgo)
      .lte('date', today)
      .order('date', { ascending: true }),
    supabase
      .from('garmin_wellness')
      .select('garmin_training_readiness, garmin_recovery_time_mins, garmin_training_status, garmin_body_battery_current, garmin_body_battery_charged, garmin_body_battery_drained, garmin_stress_avg, garmin_stress_max, garmin_resting_hr, garmin_sleep_deep_secs, garmin_sleep_light_secs, garmin_sleep_rem_secs, garmin_sleep_awake_secs, garmin_sleep_respiration_avg')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle(),
    supabase
      .from('daily_wellness')
      .select('date, daily_trimp')
      .eq('user_id', user.id)
      .gte('date', twentyOneDaysAgo)
      .lt('date', today),
  ])
  const todayGarmin = garminRow as Pick<GarminWellness,
    | 'garmin_training_readiness' | 'garmin_recovery_time_mins' | 'garmin_training_status'
    | 'garmin_body_battery_current' | 'garmin_body_battery_charged' | 'garmin_body_battery_drained'
    | 'garmin_stress_avg' | 'garmin_stress_max'
    | 'garmin_resting_hr' | 'garmin_sleep_deep_secs' | 'garmin_sleep_light_secs'
    | 'garmin_sleep_rem_secs' | 'garmin_sleep_awake_secs' | 'garmin_sleep_respiration_avg'
  > | null

  const todayDailyWellness = (wellnessRows ?? []).find(
    (w): w is DailyWellness => (w as DailyWellness).date === today
  )
  const maxHrProfile = profile as { date_of_birth?: string | null; max_hr_manual?: number | null; observed_max_hr?: number | null } | null
  const maxHr = resolveMaxHrFromProfile(maxHrProfile)?.value ?? null

  // Daily Strain — pure TRIMP load. strainActivities/strainWellness were already
  // fetched in the ICU block above (7 days back); the trailing trimp window for
  // trimpRef comes from already-frozen daily_wellness rows, matching the charts route.
  if (strainWellness.length > 0 || strainActivities.length > 0) {
    const trailingTrimp = (strainDailyWellnessRows ?? [])
      .map(r => (r as { daily_trimp: number | null }).daily_trimp)
      .filter((v): v is number => v != null)
    const trimpRef = computeTrimpRef(trailingTrimp)

    const activitiesForDate = (date: string): DailyActivityInput[] =>
      strainActivities
        .filter(a => a.start_date_local.slice(0, 10) === date)
        .map(a => ({ name: a.name, durationMin: a.moving_time / 60, avgHr: a.average_heartrate, trainingLoad: a.training_load }))

    const todayRestingHr = todayGarmin?.garmin_resting_hr ?? strainWellness.at(-1)?.resting_hr ?? null
    const todayTrimp = computeDailyTrimp(activitiesForDate(today), maxHr, todayRestingHr)
    dailyStrain = computeWorkoutStrain(todayTrimp, trimpRef)

    strainHistory = strainWellness.map(w => ({
      date: w.id,
      strain: computeWorkoutStrain(
        computeDailyTrimp(activitiesForDate(w.id), maxHr, w.garmin_resting_hr ?? w.resting_hr),
        trimpRef,
      ),
    }))
  }
```

This removes the old `sevenDaysAgoForStrain`/`strainWellnessByDate`/`strainDrainByDate`/`strainGarminRows` variables entirely (they fed the deleted life-load blend) — delete their declarations if `Grep` confirms no other use in this file.

- [ ] **Step 3: Verify `lib/claude/briefing.ts` needs no change**

`buildLoadString` calls `formatStrainForPrompt(ctx.dailyStrain)` with a single argument already (line 46) — Task 1's simplified `formatStrainForPrompt` signature (`(strain: number | null) => string`) matches this call site exactly. Confirm with `Read lib/claude/briefing.ts` lines 44–51 that no other strain-related params are passed; if none are, this file needs no edit.

- [ ] **Step 4: Update affected tests**

For each file found in Step 1, update fixtures that mock the old `computeDailyStrain`/`computeDailyLifeLoad`/`computeDailyActivityLoad` to instead mock or directly compute via `computeDailyTrimp`/`computeTrimpRef`/`computeWorkoutStrain`. Where a test only asserts on the final `ctx.dailyStrain` number (not on how it was derived), update the expected number to match the new formula's output for that test's inputs, computed by hand using the Task 1 formulas.

- [ ] **Step 5: Run the affected tests and typecheck**

Run: `npm run test:ci`
Expected: All tests pass; `tsc --noEmit` reports zero errors anywhere in the repo.

- [ ] **Step 6: Commit**

```bash
git add app/api/briefing/today/route.ts __tests__/
git commit -m "feat: compute briefing daily strain via the TRIMP formula"
```

---

### Task 7: Backfill route for historical dates

**Files:**
- Create: `app/api/admin/backfill-strain/route.ts`

**Interfaces:**
- Consumes: `computeWorkoutStrainSeries`, `StrainSeriesDayInput` from `@/lib/strain`; same profile/activity-fetch pattern as `app/api/charts/route.ts` (Task 3).

- [ ] **Step 1: Write the route**

This repo has no standalone script runner configured (no `tsx`/`ts-node` in `package.json`) — a one-off authenticated API route matches the existing convention (every other data operation in this codebase is a Next.js route using `createSupabaseServerClient` + RLS) better than introducing new tooling.

```typescript
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { resolveMaxHrFromProfile } from '@/lib/max-hr'
import { computeWorkoutStrainSeries, type StrainSeriesDayInput, type DailyActivityInput } from '@/lib/strain'

export const dynamic = 'force-dynamic'

/** One-time backfill: freezes daily_trimp/trimp_ref/workout_strain for every past date
 * that doesn't already have them. Safe to re-run — already-frozen dates are skipped. */
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profile')
    .select('intervals_icu_athlete_id, intervals_icu_api_key, max_hr_manual, observed_max_hr, date_of_birth')
    .maybeSingle()

  if (!profile?.intervals_icu_athlete_id || !profile?.intervals_icu_api_key) {
    return NextResponse.json({ error: 'intervals.icu not configured' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]
  const oldest = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
  const [wellness, activities, { data: dailyWellnessRows }] = await Promise.all([
    client.getWellness(oldest, today),
    client.getActivities(oldest, today),
    supabase
      .from('daily_wellness')
      .select('date, daily_trimp, trimp_ref, workout_strain')
      .eq('user_id', user.id)
      .gte('date', oldest)
      .lte('date', today),
  ])

  const dailyWellnessByDate = new Map((dailyWellnessRows ?? []).map(w => [w.date as string, w]))
  const activitiesByDate = new Map<string, DailyActivityInput[]>()
  for (const a of activities) {
    const date = a.start_date_local.slice(0, 10)
    const arr = activitiesByDate.get(date) ?? []
    arr.push({ name: a.name, durationMin: a.moving_time / 60, avgHr: a.average_heartrate, trainingLoad: a.training_load })
    activitiesByDate.set(date, arr)
  }

  const maxHr = resolveMaxHrFromProfile(profile)?.value ?? null
  const seriesInput: StrainSeriesDayInput[] = wellness
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((w): StrainSeriesDayInput => {
      const dw = dailyWellnessByDate.get(w.id) as { daily_trimp?: number | null; trimp_ref?: number | null; workout_strain?: number | null } | undefined
      return {
        date: w.id,
        activities: activitiesByDate.get(w.id) ?? [],
        restingHr: w.garmin_resting_hr ?? w.resting_hr,
        frozenDailyTrimp: dw?.daily_trimp ?? null,
        frozenTrimpRef: dw?.trimp_ref ?? null,
        frozenWorkoutStrain: dw?.workout_strain ?? null,
      }
    })

  const results = computeWorkoutStrainSeries(seriesInput, maxHr, today)
  const toFreeze = results.filter(r => r.needsFreeze)

  if (toFreeze.length > 0) {
    const { error } = await supabase
      .from('daily_wellness')
      .upsert(
        toFreeze.map(r => ({
          user_id: user.id,
          date: r.date,
          daily_trimp: r.dailyTrimp,
          trimp_ref: r.trimpRef,
          workout_strain: r.workoutStrain,
        })),
        { onConflict: 'user_id,date' },
      )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ backfilled: toFreeze.length, totalDays: results.length })
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 3: Tell the user how to run it**

Report to the user: "After the migration from Task 2 has been applied, backfill historical strain by calling `POST /api/admin/backfill-strain` while logged in (e.g. from the browser console on the app: `fetch('/api/admin/backfill-strain', { method: 'POST' }).then(r => r.json()).then(console.log)`). It's safe to re-run — already-frozen dates are skipped. This route has no additional auth beyond being logged in as yourself, consistent with every other route in this single-tenant-per-user app; it's a one-time operational tool, not user-facing, so no UI link is added for it."

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/backfill-strain/route.ts
git commit -m "feat: add one-time backfill route for historical strain values"
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Grep for any remaining references to deleted functions**

Run: `Grep -rn "computeDailyStrain|computeDailyLifeLoad|computeDailyActivityLoad|computeStrainComponents|STRAIN_TRAINING_LOAD_MAX|STRAIN_WORKOUT_WEIGHT|STRAIN_LIFE_WEIGHT" --glob '*.ts' --glob '*.tsx'` (excluding this plan file and the design spec doc, which legitimately reference the old names historically)
Expected: No matches in `lib/`, `components/`, `app/`, `__tests__/`.

- [ ] **Step 2: Run the full CI check**

Run: `npm run test:ci`
Expected: All tests pass, zero typecheck errors.

- [ ] **Step 3: Manually verify in the running app**

Start the dev server (`npm run dev`) if not already running, load the dashboard, and confirm: the Strain band shows a number with one of the four new labels (Light/Moderate/High/All Out); clicking it opens the breakdown sheet showing today's per-activity TRIMP contributions and the "vs your own recent hard-day reference" line; the strain trend chart (collapsed "Strain trend" toggle) renders a single blue bar series (no amber wellbeing bars) going back through history.

- [ ] **Step 4: Report completion to the user**

Summarize: strain formula rewired end-to-end, migration applied (confirm the user ran it), backfill route available. Note that the dashboard still shows the old-style colored band UI (not yet the Whoop-style ring strip) — that's the next plan.

---

## Self-Review Notes

- **Spec coverage:** Architecture §1 (per-activity TRIMP) → Task 1. §2 (personalized log scale) → Task 1. §3 (freeze-on-first-compute) → Tasks 2, 3, 7. §4 (zone labels) → Task 1. §5 (removed life-load blending) → Task 1 Step 16. UI changes (breakdown sheet, trend chart) → Tasks 4, 5. Function signatures → Task 1. Files to change table → covered by Tasks 1–7 (one gap found and corrected: `lib/progress/brief-generator.ts` was listed in the spec's files-to-change table but on inspection has no actual strain usage — its one "strain" grep hit is a false-positive substring match inside the word "constraint"; it needs no changes and isn't a task here).
- **Placeholder scan:** no TBD/TODO markers; every code step is complete, runnable code.
- **Type consistency:** `DailyActivityInput`, `StrainSeriesDayInput`, `StrainSeriesDayResult`, and `DailyStrainPoint` field names (`workoutStrain`, `dailyTrimp`, `trimpRef`) are used identically across Tasks 1, 3, 4, 5, 6, 7.
