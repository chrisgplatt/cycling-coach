# Widen Daily Strain's Wellbeing Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen Daily Strain's "Wellbeing" sub-score from 3 signals (sleep quality, sleep duration, body battery peak) to 6 (adding HRV vs baseline, subjective wellness, and battery drain during the day), so it has more dynamic range and a fuller picture of daily life stress.

**Architecture:** `lib/strain.ts`'s two scoring functions move from positional arguments to a single `LifeLoadInputs` object and gain three new weighted signals, reusing two small curve functions exported from `lib/recovery-score.ts`. Every consumer (2 components, 2 API routes, 1 page threading new props) is updated to supply the new inputs, all of which already exist nearby — no new tables, columns, or sync changes.

**Tech Stack:** Next.js App Router, TypeScript, Supabase, Jest, React Testing Library.

## Global Constraints

- Daily Strain stays 0–21; Workout stays capped at 14 points; Wellbeing stays capped at 7 points — this split is not changing.
- TSB is **not** added as a Wellbeing signal (already represented via Workout load; would double-count training stress).
- HRV and subjective-wellness scoring curves are shared with `lib/recovery-score.ts` via exported, narrowed-signature functions — not duplicated in `strain.ts`.
- No new database tables, columns, or sync changes — only new queries against existing tables (`daily_wellness`, `garmin_wellness`).
- `app/api/charts/route.ts` uses a true per-day rolling HRV baseline (via `computeHrvBaseline`'s `asOf` parameter). `app/api/briefing/today/route.ts` reuses one baseline across its 7-day window (negligible drift over 7 days).
- Missing signals are excluded from the weighted average (not treated as zero) — unchanged behavior, extended to the three new signals.
- New weights: HRV 2.0, subjective wellness 1.0, battery drain 1.0 (alongside the existing sleep quality 2.0, body battery peak 1.5, sleep duration 1.0).

---

### Task 1: Export and narrow `computeHrvIndex` / `computeWellnessIndex`

**Files:**
- Modify: `lib/recovery-score.ts:47-63`
- Test: `__tests__/lib/recovery-score.test.ts`

**Interfaces:**
- Produces: `computeHrvIndex(inputs: { hrv: number | null; hrvBaseline: number | null }): number | null` and `computeWellnessIndex(inputs: { energy: number | null; leg_freshness: number | null }): number | null`, both exported from `lib/recovery-score.ts` — consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/lib/recovery-score.test.ts`, after the top-level import line:

```ts
import { computeRecoveryScore, computeHrvIndex, computeWellnessIndex, type RecoveryInputs } from '@/lib/recovery-score'
```

(this replaces the existing `import { computeRecoveryScore, type RecoveryInputs } from '@/lib/recovery-score'` line at the top of the file).

Then add these two new `describe` blocks at the end of the file:

```ts
describe('computeHrvIndex', () => {
  it('returns null when hrv or baseline is missing', () => {
    expect(computeHrvIndex({ hrv: null, hrvBaseline: 50 })).toBeNull()
    expect(computeHrvIndex({ hrv: 50, hrvBaseline: null })).toBeNull()
  })

  it('returns 90 when hrv is well above baseline', () => {
    expect(computeHrvIndex({ hrv: 60, hrvBaseline: 50 })).toBe(90) // ratio 1.2
  })

  it('returns 0 when hrv is well below baseline', () => {
    expect(computeHrvIndex({ hrv: 30, hrvBaseline: 60 })).toBe(0) // ratio 0.5, clamped
  })
})

describe('computeWellnessIndex', () => {
  it('returns null when both energy and leg_freshness are missing', () => {
    expect(computeWellnessIndex({ energy: null, leg_freshness: null })).toBeNull()
  })

  it('averages energy and leg_freshness on a 0-100 scale', () => {
    // avg = (4+2)/2 = 3 -> (3-1)/4*100 = 50
    expect(computeWellnessIndex({ energy: 4, leg_freshness: 2 })).toBe(50)
  })

  it('uses whichever single value is present', () => {
    // energy=5 -> (5-1)/4*100=100
    expect(computeWellnessIndex({ energy: 5, leg_freshness: null })).toBe(100)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/recovery-score.test.ts`
Expected: FAIL — `computeHrvIndex is not a function` (not exported yet)

- [ ] **Step 3: Export and narrow the two functions**

In `lib/recovery-score.ts`, the file currently reads (lines 47-63):

```ts
function computeHrvIndex(inputs: RecoveryInputs): number | null {
  const { hrv, hrvBaseline } = inputs
  if (hrv === null || hrvBaseline === null || hrvBaseline === 0) return null
  const ratio = hrv / hrvBaseline
  if (ratio >= 1.10) return 90
  if (ratio >= 1.00) return lerp(70, 90, (ratio - 1.00) / 0.10)
  if (ratio >= 0.90) return lerp(40, 70, (ratio - 0.90) / 0.10)
  return lerp(0, 40, clamp01((ratio - 0.70) / 0.20))
}

function computeWellnessIndex(inputs: RecoveryInputs): number | null {
  const { energy, leg_freshness } = inputs
  const vals = [energy, leg_freshness].filter((v): v is number => v !== null)
  if (!vals.length) return null
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  return (avg - 1) / 4 * 100
}
```

Replace with (only the two function signatures change — bodies are identical):

```ts
export function computeHrvIndex(inputs: { hrv: number | null; hrvBaseline: number | null }): number | null {
  const { hrv, hrvBaseline } = inputs
  if (hrv === null || hrvBaseline === null || hrvBaseline === 0) return null
  const ratio = hrv / hrvBaseline
  if (ratio >= 1.10) return 90
  if (ratio >= 1.00) return lerp(70, 90, (ratio - 1.00) / 0.10)
  if (ratio >= 0.90) return lerp(40, 70, (ratio - 0.90) / 0.10)
  return lerp(0, 40, clamp01((ratio - 0.70) / 0.20))
}

export function computeWellnessIndex(inputs: { energy: number | null; leg_freshness: number | null }): number | null {
  const { energy, leg_freshness } = inputs
  const vals = [energy, leg_freshness].filter((v): v is number => v !== null)
  if (!vals.length) return null
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  return (avg - 1) / 4 * 100
}
```

`computeRecoveryScore`'s existing calls (`computeHrvIndex(inputs)`, `computeWellnessIndex(inputs)`, passing the full `RecoveryInputs` object) are unaffected — a full `RecoveryInputs` object still satisfies the narrower parameter type structurally, so no other change is needed in this file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/recovery-score.test.ts`
Expected: PASS (all existing tests plus the 6 new ones)

- [ ] **Step 5: Commit**

```bash
git add lib/recovery-score.ts __tests__/lib/recovery-score.test.ts
git commit -m "refactor: export computeHrvIndex/computeWellnessIndex with narrowed signatures"
```

---

### Task 2: Widen `lib/strain.ts`'s Wellbeing calculation

**Files:**
- Modify: `lib/strain.ts` (whole file)
- Test: `__tests__/lib/strain.test.ts`

**Interfaces:**
- Consumes: `computeHrvIndex({ hrv, hrvBaseline })` and `computeWellnessIndex({ energy, leg_freshness })` from Task 1 (`lib/recovery-score.ts`).
- Produces:
  - `export interface LifeLoadInputs { sleepScore: number | null; bodyBatteryHigh: number | null; sleepSecs?: number | null; hrv?: number | null; hrvBaseline?: number | null; energy?: number | null; legFreshness?: number | null; batteryDrained?: number | null }`
  - `computeDailyLifeLoad(inputs: LifeLoadInputs): number | null` — signature changed from 3 positional args to this one object. Used by Tasks 3, 6, 7.
  - `computeStrainComponents(activityLoad: number | null, inputs: LifeLoadInputs): StrainComponents | null` — signature changed from 3-4 positional args to `(activityLoad, inputs)`. Used by Tasks 4, 6.
  - `StrainComponents` gains fields: `hrvRawPts: number`, `wellnessRawPts: number`, `drainRawPts: number`, `hrv: number | null`, `hrvBaseline: number | null`, `energy: number | null`, `legFreshness: number | null`, `batteryDrained: number | null`. Used by Task 4.
  - New weight constants: `STRAIN_HRV_WEIGHT = 2.0`, `STRAIN_WELLNESS_WEIGHT = 1.0`, `STRAIN_DRAIN_WEIGHT = 1.0`.

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `__tests__/lib/strain.test.ts` with:

```ts
/** @jest-environment node */
import {
  computeDailyStrain,
  computeDailyLifeLoad,
  computeStrainComponents,
  strainLabel,
  formatStrainForPrompt,
  formatStrainHistoryForPrompt,
} from '@/lib/strain'

describe('computeDailyLifeLoad', () => {
  test('poor sleep only', () => {
    // sleep_score=30 → ((100-30)/100)*2=1.4, avail=2 → (1.4/2)*7=4.9
    expect(computeDailyLifeLoad({ sleepScore: 30, bodyBatteryHigh: null })).toBeCloseTo(4.9, 1)
  })

  test('low body battery only', () => {
    // body_battery_high=20 → ((100-20)/100)*1.5=1.2, avail=1.5 → (1.2/1.5)*7=5.6
    expect(computeDailyLifeLoad({ sleepScore: null, bodyBatteryHigh: 20 })).toBeCloseTo(5.6, 1)
  })

  test('both signals present', () => {
    // sleep=85→0.3, battery=75→0.375; raw=0.675, avail=3.5 → (0.675/3.5)*7=1.35
    expect(computeDailyLifeLoad({ sleepScore: 85, bodyBatteryHigh: 75 })).toBeCloseTo(1.35, 1)
  })

  test('great sleep + good battery gives low score', () => {
    // sleep=90→0.2, battery=85→0.225; raw=0.425, avail=3.5 → (0.425/3.5)*7=0.85
    expect(computeDailyLifeLoad({ sleepScore: 90, bodyBatteryHigh: 85 })).toBeCloseTo(0.85, 1)
  })

  test('all null → null', () => {
    expect(computeDailyLifeLoad({ sleepScore: null, bodyBatteryHigh: null })).toBeNull()
  })

  test('7.5h sleep duration gives zero penalty', () => {
    // 27000s = target, durationScore=100 → ((100-100)/100)*1=0, adds nothing
    expect(computeDailyLifeLoad({ sleepScore: null, bodyBatteryHigh: null, sleepSecs: 27000 })).toBeCloseTo(0, 4)
  })

  test('5h sleep duration gives max penalty', () => {
    // 18000s = floor, durationScore=0 → ((100-0)/100)*1=1, avail=1 → (1/1)*7=7
    expect(computeDailyLifeLoad({ sleepScore: null, bodyBatteryHigh: null, sleepSecs: 18000 })).toBeCloseTo(7, 4)
  })

  test('6h sleep (midpoint) gives partial penalty', () => {
    // 21600s: score = (21600-18000)/(27000-18000)*100 = 3600/9000*100 ≈ 40
    // raw = (60/100)*1 = 0.6, avail=1 → (0.6/1)*7 = 4.2
    expect(computeDailyLifeLoad({ sleepScore: null, bodyBatteryHigh: null, sleepSecs: 21600 })).toBeCloseTo(4.2, 1)
  })

  test('suppressed HRV alone contributes', () => {
    // ratio 30/60=0.5 -> hrv index 0 -> raw=((100-0)/100)*2=2, avail=2 -> (2/2)*7=7
    expect(computeDailyLifeLoad({ sleepScore: null, bodyBatteryHigh: null, hrv: 30, hrvBaseline: 60 })).toBeCloseTo(7, 4)
  })

  test('excellent HRV alone gives a low score', () => {
    // ratio 66/60=1.1 -> hrv index 90 -> raw=((100-90)/100)*2=0.2, avail=2 -> (0.2/2)*7=0.7
    expect(computeDailyLifeLoad({ sleepScore: null, bodyBatteryHigh: null, hrv: 66, hrvBaseline: 60 })).toBeCloseTo(0.7, 4)
  })

  test('hrv without hrvBaseline is excluded (not scored)', () => {
    expect(computeDailyLifeLoad({ sleepScore: null, bodyBatteryHigh: null, hrv: 30 })).toBeNull()
  })

  test('low subjective wellness alone contributes', () => {
    // energy=1,legs=1 -> avg=1 -> (1-1)/4*100=0 -> raw=((100-0)/100)*1=1, avail=1 -> (1/1)*7=7
    expect(computeDailyLifeLoad({ sleepScore: null, bodyBatteryHigh: null, energy: 1, legFreshness: 1 })).toBeCloseTo(7, 4)
  })

  test('high subjective wellness alone gives a low score', () => {
    // energy=5,legs=5 -> avg=5 -> (5-1)/4*100=100 -> raw=((100-100)/100)*1=0
    expect(computeDailyLifeLoad({ sleepScore: null, bodyBatteryHigh: null, energy: 5, legFreshness: 5 })).toBeCloseTo(0, 4)
  })

  test('battery drain alone contributes proportionally', () => {
    // drained=60 -> raw=(60/100)*1=0.6, avail=1 -> (0.6/1)*7=4.2
    expect(computeDailyLifeLoad({ sleepScore: null, bodyBatteryHigh: null, batteryDrained: 60 })).toBeCloseTo(4.2, 1)
  })

  test('zero battery drain contributes nothing', () => {
    expect(computeDailyLifeLoad({ sleepScore: null, bodyBatteryHigh: null, batteryDrained: 0 })).toBeCloseTo(0, 4)
  })

  test('all six signals present blend together', () => {
    // sleep=85→0.3(w2), battery=75→0.375(w1.5), duration 27000→0(w1),
    // hrv ratio 66/60=1.1→90 idx→0.2(w2), wellness avg5→100 idx→0(w1), drain=20→0.2(w1)
    // raw = 0.3+0.375+0+0.2+0+0.2 = 1.075, avail=8.5 -> (1.075/8.5)*7 ≈ 0.885
    const result = computeDailyLifeLoad({
      sleepScore: 85, bodyBatteryHigh: 75, sleepSecs: 27000,
      hrv: 66, hrvBaseline: 60, energy: 5, legFreshness: 5, batteryDrained: 20,
    })
    expect(result).toBeCloseTo(0.885, 2)
  })
})

describe('computeStrainComponents', () => {
  test('returns null when all inputs null', () => {
    expect(computeStrainComponents(null, { sleepScore: null, bodyBatteryHigh: null })).toBeNull()
  })

  test('workoutPts = (load / 150) * 14', () => {
    const c = computeStrainComponents(75, { sleepScore: null, bodyBatteryHigh: null })
    expect(c).not.toBeNull()
    expect(c!.workoutPts).toBeCloseTo(7, 1)   // (75/150)*14 = 7
    expect(c!.workoutLoad).toBe(75)
  })

  test('lifePts matches computeDailyLifeLoad', () => {
    const c = computeStrainComponents(0, { sleepScore: 85, bodyBatteryHigh: 75 })!
    const expected = computeDailyLifeLoad({ sleepScore: 85, bodyBatteryHigh: 75 })!
    expect(c.lifePts).toBeCloseTo(expected, 4)
  })

  test('raw sub-scores are un-normalised', () => {
    // battery=20 only: raw = (80/100)*1.5 = 1.2; normalised life = 5.6
    // batteryRawPts should be 1.2, not 5.6
    const c = computeStrainComponents(0, { sleepScore: null, bodyBatteryHigh: 20 })!
    expect(c.sleepRawPts).toBe(0)
    expect(c.batteryRawPts).toBeCloseTo(1.2, 1)
  })

  test('sleepDurationRawPts for 6h sleep', () => {
    // 21600s: durationScore ≈ 40 → (60/100)*1 = 0.6
    const c = computeStrainComponents(0, { sleepScore: null, bodyBatteryHigh: null, sleepSecs: 21600 })!
    expect(c.sleepDurationRawPts).toBeCloseTo(0.6, 1)
    expect(c.sleepRawPts).toBe(0)
    expect(c.batteryRawPts).toBe(0)
  })

  test('sleepDurationRawPts is 0 at 7.5h target', () => {
    const c = computeStrainComponents(0, { sleepScore: null, bodyBatteryHigh: null, sleepSecs: 27000 })!
    expect(c.sleepDurationRawPts).toBeCloseTo(0, 4)
  })

  test('hrvRawPts reflects suppressed HRV', () => {
    // ratio 30/60=0.5 -> idx 0 -> raw=((100-0)/100)*2=2
    const c = computeStrainComponents(0, { sleepScore: null, bodyBatteryHigh: null, hrv: 30, hrvBaseline: 60 })!
    expect(c.hrvRawPts).toBeCloseTo(2, 4)
    expect(c.hrv).toBe(30)
    expect(c.hrvBaseline).toBe(60)
  })

  test('wellnessRawPts reflects low subjective wellness', () => {
    // energy=1,legs=1 -> avg=1 -> idx 0 -> raw=((100-0)/100)*1=1
    const c = computeStrainComponents(0, { sleepScore: null, bodyBatteryHigh: null, energy: 1, legFreshness: 1 })!
    expect(c.wellnessRawPts).toBeCloseTo(1, 4)
    expect(c.energy).toBe(1)
    expect(c.legFreshness).toBe(1)
  })

  test('drainRawPts reflects battery drain directly', () => {
    // drained=60 -> raw=(60/100)*1=0.6
    const c = computeStrainComponents(0, { sleepScore: null, bodyBatteryHigh: null, batteryDrained: 60 })!
    expect(c.drainRawPts).toBeCloseTo(0.6, 4)
    expect(c.batteryDrained).toBe(60)
  })

  test('source values pass through unchanged', () => {
    const c = computeStrainComponents(100, { sleepScore: 72, bodyBatteryHigh: 35, sleepSecs: 25200 })!
    expect(c.sleepScore).toBe(72)
    expect(c.bodyBatteryHigh).toBe(35)
    expect(c.sleepSecs).toBe(25200)
  })

  test('missing new signals default to null on the returned components', () => {
    const c = computeStrainComponents(0, { sleepScore: 85, bodyBatteryHigh: 75 })!
    expect(c.hrv).toBeNull()
    expect(c.hrvBaseline).toBeNull()
    expect(c.energy).toBeNull()
    expect(c.legFreshness).toBeNull()
    expect(c.batteryDrained).toBeNull()
    expect(c.hrvRawPts).toBe(0)
    expect(c.wellnessRawPts).toBe(0)
    expect(c.drainRawPts).toBe(0)
  })

  test('no workout today — workoutPts is 0', () => {
    const c = computeStrainComponents(0, { sleepScore: 85, bodyBatteryHigh: null })!
    expect(c.workoutPts).toBe(0)
    expect(c.workoutLoad).toBe(0)
  })

  test('total matches Math.min(21, Math.round(workoutPts + lifePts))', () => {
    // load=75 → workoutPts=7; sleep=85,battery=75 → lifePts≈1.35
    // total = round(7 + 1.35) = round(8.35) = 8
    const c = computeStrainComponents(75, { sleepScore: 85, bodyBatteryHigh: 75 })!
    expect(c.total).toBe(Math.min(21, Math.round(c.workoutPts + c.lifePts)))
  })

  test('total caps at 21', () => {
    // workoutPts=14 (capped), sleep=0 battery=0 → lifePts=7, total=21
    const c = computeStrainComponents(600, { sleepScore: 0, bodyBatteryHigh: 0 })!
    expect(c.total).toBe(21)
  })
})

describe('computeDailyStrain', () => {
  test('typical training day with life load', () => {
    // activityLoad=75, lifeLoad=3.78 → workout=7, life=3.78 → round(10.78)=11
    expect(computeDailyStrain(75, 3.78)).toBe(11)
  })

  test('rest day with high life load', () => {
    // activityLoad=0, lifeLoad=5.6 → round(5.6)=6
    expect(computeDailyStrain(0, 5.6)).toBe(6)
  })

  test('very high training load caps at 21', () => {
    expect(computeDailyStrain(600, 7)).toBe(21)
  })

  test('zero everything → 0', () => {
    expect(computeDailyStrain(0, 0)).toBe(0)
  })

  test('null activityLoad falls back to life only', () => {
    // round(3.5) = 4 (JS rounds .5 up)
    expect(computeDailyStrain(null, 3.5)).toBe(4)
  })

  test('null lifeLoad falls back to activity only', () => {
    // workout = (75/150)*14 = 7
    expect(computeDailyStrain(75, null)).toBe(7)
  })

  test('both null → null', () => {
    expect(computeDailyStrain(null, null)).toBeNull()
  })

  test('zero activityLoad with null lifeLoad → null', () => {
    expect(computeDailyStrain(0, null)).toBeNull()
  })
})

describe('strainLabel', () => {
  test('below 9 → low', () => expect(strainLabel(8)).toBe('low'))
  test('9 → moderate', () => expect(strainLabel(9)).toBe('moderate'))
  test('14 → moderate', () => expect(strainLabel(14)).toBe('moderate'))
  test('15 → high', () => expect(strainLabel(15)).toBe('high'))
  test('21 → high', () => expect(strainLabel(21)).toBe('high'))
})

describe('formatStrainForPrompt', () => {
  test('includes score and label', () => {
    const s = formatStrainForPrompt(11)
    expect(s).toContain('11')
    expect(s).toContain('21')
    expect(s).toContain('moderate')
  })

  test('null → empty string', () => {
    expect(formatStrainForPrompt(null)).toBe('')
  })

  test('appends sleep context when sleep is poor', () => {
    const s = formatStrainForPrompt(10, 45, null)
    expect(s).toContain('sleep 45/100')
  })

  test('appends battery context when battery is low', () => {
    const s = formatStrainForPrompt(10, null, 28)
    expect(s).toContain('body battery peak 28%')
  })

  test('appends sleep duration context when sleep is short', () => {
    const s = formatStrainForPrompt(10, null, null, 19800)  // 5.5h
    expect(s).toContain('slept 5.5h')
  })

  test('no sleep duration context when duration is sufficient', () => {
    const s = formatStrainForPrompt(10, null, null, 25200)  // 7h — above 6h threshold
    expect(s).not.toContain('slept')
  })

  test('no context when sleep and battery are good', () => {
    const s = formatStrainForPrompt(10, 80, 70)
    expect(s).not.toContain('sleep')
    expect(s).not.toContain('battery')
  })
})

describe('formatStrainHistoryForPrompt', () => {
  test('7-day history includes avg and trend', () => {
    const history = [8, 14, 16, 12, 9, 6, 11].map((strain, i) => ({
      date: `2026-06-0${i + 1}`,
      strain,
    }))
    const s = formatStrainHistoryForPrompt(history)
    expect(s).toContain('last 7 days')
    expect(s).toContain('avg:')
    expect(s).toMatch(/trend: (rising|stable|falling)/)
  })

  test('all-null history → empty string', () => {
    const history = [null, null, null].map((strain, i) => ({ date: `2026-06-0${i + 1}`, strain }))
    expect(formatStrainHistoryForPrompt(history)).toBe('')
  })

  test('single entry → empty string', () => {
    expect(formatStrainHistoryForPrompt([{ date: '2026-06-01', strain: 10 }])).toBe('')
  })

  test('rising trend detected when recent > earlier + 2', () => {
    const history = [4, 5, 4, 5, 14, 15, 16].map((strain, i) => ({
      date: `2026-06-0${i + 1}`,
      strain,
    }))
    expect(formatStrainHistoryForPrompt(history)).toContain('rising')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lib/strain.test.ts`
Expected: FAIL — `computeDailyLifeLoad`/`computeStrainComponents` calls don't match the current positional signature (type errors and/or wrong results)

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `lib/strain.ts` with:

```ts
import { computeHrvIndex, computeWellnessIndex } from '@/lib/recovery-score'

export const STRAIN_TRAINING_LOAD_MAX = 150
export const STRAIN_NONPOWER_LOAD_MAX = 50 // ceiling for walks, runs, HR-only activities
export const STRAIN_WORKOUT_WEIGHT = 14
export const STRAIN_LIFE_WEIGHT = 7

export const STRAIN_SLEEP_WEIGHT = 2.0
export const STRAIN_BATTERY_WEIGHT = 1.5
export const STRAIN_SLEEP_DURATION_WEIGHT = 1.0
export const STRAIN_HRV_WEIGHT = 2.0
export const STRAIN_WELLNESS_WEIGHT = 1.0
export const STRAIN_DRAIN_WEIGHT = 1.0
export const STRAIN_SLEEP_DURATION_TARGET_SECS = 27000 // 7.5h = no penalty
export const STRAIN_SLEEP_DURATION_MIN_SECS = 18000 // 5h = max penalty

// 0–100 recovery score for sleep duration. 7.5h+ = 100, 5h = 0, linear between.
function sleepDurationScore(secs: number): number {
  return Math.max(0, Math.min(100,
    ((secs - STRAIN_SLEEP_DURATION_MIN_SECS) /
     (STRAIN_SLEEP_DURATION_TARGET_SECS - STRAIN_SLEEP_DURATION_MIN_SECS)) * 100,
  ))
}

// Non-power activities (runs, walks, HR-only rides) report training_load on a 0–50 scale.
// Scale them up to the 0–150 power-based range so they're comparable to cycling TSS.
export function computeDailyActivityLoad(
  activities: Array<{
    start_date_local: string
    training_load: number | null
    weighted_average_watts: number | null
    rolling_ftp: number | null
  }>,
  date: string,
  ftpWatts?: number | null,
): number {
  const nonPowerScale = STRAIN_TRAINING_LOAD_MAX / STRAIN_NONPOWER_LOAD_MAX
  return activities
    .filter(a => a.start_date_local.startsWith(date))
    .reduce((sum, a) => {
      const load = a.training_load ?? 0
      if (load === 0) return sum
      const ftp = ftpWatts ?? a.rolling_ftp
      if (a.weighted_average_watts && ftp && ftp > 0) {
        const intensityFactor = Math.min(1.5, a.weighted_average_watts / ftp)
        return sum + load * intensityFactor
      }
      return sum + load * nonPowerScale
    }, 0)
}

export interface LifeLoadInputs {
  sleepScore: number | null
  bodyBatteryHigh: number | null
  sleepSecs?: number | null
  hrv?: number | null
  hrvBaseline?: number | null
  energy?: number | null
  legFreshness?: number | null
  batteryDrained?: number | null
}

interface LifeLoadParts {
  sleepRawPts: number
  sleepDurationRawPts: number
  batteryRawPts: number
  hrvRawPts: number
  wellnessRawPts: number
  drainRawPts: number
  availableWeight: number
}

// Blends every present life-load signal into raw (un-normalised) points plus the
// total weight of signals actually available. Signals are combined using a
// weighted-average blend: each present signal contributes its raw points and its
// weight to the denominator; absent signals are excluded rather than counted as
// zero, so a missing value doesn't drag the score.
function computeLifeLoadParts(inputs: LifeLoadInputs): LifeLoadParts {
  const {
    sleepScore, bodyBatteryHigh, sleepSecs = null,
    hrv = null, hrvBaseline = null, energy = null, legFreshness = null, batteryDrained = null,
  } = inputs

  let sleepRawPts = 0
  let sleepDurationRawPts = 0
  let batteryRawPts = 0
  let hrvRawPts = 0
  let wellnessRawPts = 0
  let drainRawPts = 0
  let availableWeight = 0

  if (sleepScore != null) {
    sleepRawPts = ((100 - sleepScore) / 100) * STRAIN_SLEEP_WEIGHT
    availableWeight += STRAIN_SLEEP_WEIGHT
  }
  if (sleepSecs != null) {
    sleepDurationRawPts = ((100 - sleepDurationScore(sleepSecs)) / 100) * STRAIN_SLEEP_DURATION_WEIGHT
    availableWeight += STRAIN_SLEEP_DURATION_WEIGHT
  }
  if (bodyBatteryHigh != null) {
    batteryRawPts = ((100 - bodyBatteryHigh) / 100) * STRAIN_BATTERY_WEIGHT
    availableWeight += STRAIN_BATTERY_WEIGHT
  }
  const hrvGoodness = computeHrvIndex({ hrv, hrvBaseline })
  if (hrvGoodness != null) {
    hrvRawPts = ((100 - hrvGoodness) / 100) * STRAIN_HRV_WEIGHT
    availableWeight += STRAIN_HRV_WEIGHT
  }
  const wellnessGoodness = computeWellnessIndex({ energy, leg_freshness: legFreshness })
  if (wellnessGoodness != null) {
    wellnessRawPts = ((100 - wellnessGoodness) / 100) * STRAIN_WELLNESS_WEIGHT
    availableWeight += STRAIN_WELLNESS_WEIGHT
  }
  if (batteryDrained != null) {
    drainRawPts = (Math.max(0, Math.min(100, batteryDrained)) / 100) * STRAIN_DRAIN_WEIGHT
    availableWeight += STRAIN_DRAIN_WEIGHT
  }

  return { sleepRawPts, sleepDurationRawPts, batteryRawPts, hrvRawPts, wellnessRawPts, drainRawPts, availableWeight }
}

export function computeDailyLifeLoad(inputs: LifeLoadInputs): number | null {
  const { sleepScore, bodyBatteryHigh, sleepSecs = null, hrv = null, energy = null, legFreshness = null, batteryDrained = null } = inputs
  if (sleepScore == null && bodyBatteryHigh == null && sleepSecs == null
    && hrv == null && energy == null && legFreshness == null && batteryDrained == null) return null
  const parts = computeLifeLoadParts(inputs)
  const rawLife = parts.sleepRawPts + parts.sleepDurationRawPts + parts.batteryRawPts
    + parts.hrvRawPts + parts.wellnessRawPts + parts.drainRawPts
  return parts.availableWeight > 0 ? (rawLife / parts.availableWeight) * STRAIN_LIFE_WEIGHT : null
}

export interface StrainComponents {
  total: number             // final strain score 0–21
  workoutPts: number
  workoutLoad: number
  lifePts: number
  sleepRawPts: number       // un-normalised sleep quality pts (for donut)
  sleepDurationRawPts: number
  batteryRawPts: number
  hrvRawPts: number
  wellnessRawPts: number
  drainRawPts: number
  sleepScore: number | null
  sleepSecs: number | null
  bodyBatteryHigh: number | null  // daily peak battery (post-sleep), not the midnight trough
  hrv: number | null
  hrvBaseline: number | null
  energy: number | null
  legFreshness: number | null
  batteryDrained: number | null
}

export function computeStrainComponents(
  activityLoad: number | null,
  inputs: LifeLoadInputs,
): StrainComponents | null {
  const {
    sleepScore, bodyBatteryHigh, sleepSecs = null,
    hrv = null, hrvBaseline = null, energy = null, legFreshness = null, batteryDrained = null,
  } = inputs
  if (activityLoad == null && sleepScore == null && bodyBatteryHigh == null && sleepSecs == null
    && hrv == null && energy == null && legFreshness == null && batteryDrained == null) return null

  const load = activityLoad ?? 0
  const workoutPts = Math.min(STRAIN_WORKOUT_WEIGHT, (load / STRAIN_TRAINING_LOAD_MAX) * STRAIN_WORKOUT_WEIGHT)

  const parts = computeLifeLoadParts(inputs)
  const rawLife = parts.sleepRawPts + parts.sleepDurationRawPts + parts.batteryRawPts
    + parts.hrvRawPts + parts.wellnessRawPts + parts.drainRawPts
  const lifePts = parts.availableWeight > 0 ? (rawLife / parts.availableWeight) * STRAIN_LIFE_WEIGHT : 0
  const total = Math.min(21, Math.round(workoutPts + lifePts))

  return {
    total, workoutPts, workoutLoad: load, lifePts,
    sleepRawPts: parts.sleepRawPts,
    sleepDurationRawPts: parts.sleepDurationRawPts,
    batteryRawPts: parts.batteryRawPts,
    hrvRawPts: parts.hrvRawPts,
    wellnessRawPts: parts.wellnessRawPts,
    drainRawPts: parts.drainRawPts,
    sleepScore, sleepSecs, bodyBatteryHigh,
    hrv, hrvBaseline, energy, legFreshness, batteryDrained,
  }
}

export function computeDailyStrain(
  activityLoad: number | null,
  lifeLoad: number | null,
): number | null {
  if (activityLoad == null && lifeLoad == null) return null
  // No activity load and life signals not yet synced — nothing meaningful to show
  if ((activityLoad == null || activityLoad === 0) && lifeLoad == null) return null
  const workout = ((activityLoad ?? 0) / STRAIN_TRAINING_LOAD_MAX) * STRAIN_WORKOUT_WEIGHT
  const life = lifeLoad ?? 0
  return Math.min(21, Math.round(workout + life))
}

export function strainLabel(score: number): 'low' | 'moderate' | 'high' {
  if (score < 9) return 'low'
  if (score <= 14) return 'moderate'
  return 'high'
}

export function formatStrainForPrompt(
  strain: number | null,
  sleepScore?: number | null,
  bodyBatteryHigh?: number | null,
  sleepSecs?: number | null,
): string {
  if (strain == null) return ''
  const parts: string[] = []
  if (sleepScore != null && sleepScore < 70) parts.push(`sleep ${sleepScore}/100`)
  if (sleepSecs != null && sleepSecs < 21600) parts.push(`slept ${(sleepSecs / 3600).toFixed(1)}h`)
  if (bodyBatteryHigh != null && bodyBatteryHigh < 50) parts.push(`body battery peak ${bodyBatteryHigh}%`)
  const context = parts.length ? ` — ${parts.join(', ')}` : ''
  return `Daily Strain: ${strain}/21 (${strainLabel(strain)})${context}`
}

export function formatStrainHistoryForPrompt(
  history: Array<{ date: string; strain: number | null }>,
): string {
  if (history.length < 2) return ''
  const scores = history.map(h => h.strain)
  const valid = scores.filter((s): s is number => s != null)
  if (!valid.length) return ''
  const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
  const recent = scores.slice(-3).filter((s): s is number => s != null)
  const earlier = scores.slice(0, 4).filter((s): s is number => s != null)
  // Compare last 3 days vs first 4 days to detect trend
  const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0
  const earlierAvg = earlier.length ? earlier.reduce((a, b) => a + b, 0) / earlier.length : 0
  const trend = recentAvg > earlierAvg + 2 ? 'rising' : recentAvg < earlierAvg - 2 ? 'falling' : 'stable'
  const vals = scores.map(s => (s == null ? '—' : String(s))).join(' ')
  return `Strain (last ${scores.length} days): ${vals} (avg: ${avg}, trend: ${trend})`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lib/strain.test.ts`
Expected: PASS (all tests, including the new HRV/wellness/drain cases)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors (this step matters here because Task 2 changes a widely-consumed public signature — later tasks fix the remaining call sites, but this file itself must compile cleanly first)

- [ ] **Step 6: Commit**

```bash
git add lib/strain.ts __tests__/lib/strain.test.ts
git commit -m "feat: widen Daily Strain's Wellbeing signals with HRV, subjective wellness, and battery drain"
```

---

### Task 3: Wire the new signals into `MetricsBar.tsx`

**Files:**
- Modify: `components/MetricsBar.tsx:370-397`
- Test: `__tests__/components/MetricsBar.test.tsx`

**Interfaces:**
- Consumes: `computeDailyLifeLoad(inputs: LifeLoadInputs)` from Task 2.
- Produces: `MetricsBar` gains a new optional prop `todayDailyWellness?: { energy: number | null; leg_freshness: number | null } | null`. Consumed by Task 5 (`app/dashboard/page.tsx`).

- [ ] **Step 1: Write the failing test**

Add to `__tests__/components/MetricsBar.test.tsx`, after the last `describe` block (`MetricsBar strain trend tooltip`), a new import at the top of the file and a new describe block:

Change the top import line from:
```ts
import type { ICUWellness, DailyStrainPoint } from '@/types'
```
to:
```ts
import type { ICUWellness, DailyStrainPoint } from '@/types'
import type { HrvStatus } from '@/lib/hrv/baseline'
```

Then append this new block at the end of the file:

```ts
describe('MetricsBar Wellbeing signal wiring', () => {
  const barebonesWellness: ICUWellness = {
    id: '2026-07-05', ctl: 65, atl: 72, form: -7, hrv: null, resting_hr: 52,
    sleep_secs: null, body_battery_low: null, body_battery_high: null,
    stress_avg: null, stress_high: null, garmin_training_load: null, sleep_score: null,
  }

  const suppressedHrvStatus: HrvStatus = {
    label: 'suppressed', sufficient: true, daysOfData: 60, today: 30, sevenDayAvg: 32,
    baselineMean: 60, lowerBound: 54, upperBound: 66, trend: 'falling', baselineDrift: 'stable',
  }

  it('feeds hrvStatus into the displayed strain score', () => {
    render(<MetricsBar wellness={barebonesWellness} hrvStatus={suppressedHrvStatus} />)
    // ratio 30/60=0.5 -> hrv index 0 -> raw=((100-0)/100)*2=2, avail=2 -> lifePts=(2/2)*7=7
    // workoutPts=0 (garmin_training_load null) -> total=round(0+7)=7
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('feeds todayDailyWellness into the displayed strain score', () => {
    render(<MetricsBar wellness={barebonesWellness} todayDailyWellness={{ energy: 1, leg_freshness: 1 }} />)
    // energy=1,legs=1 -> avg=1 -> wellness index 0 -> raw=((100-0)/100)*1=1, avail=1 -> lifePts=(1/1)*7=7
    expect(screen.getByText('7')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/MetricsBar.test.tsx`
Expected: FAIL — the two new tests don't find "7" (the component doesn't yet read `hrvStatus`/`todayDailyWellness` into the strain calculation)

- [ ] **Step 3: Wire the new inputs into the component**

In `components/MetricsBar.tsx`, the function signature currently reads (lines 370-388):

```ts
export default function MetricsBar({
  wellness,
  syncedAt = null,
  stale = {},
  embedded = false,
  lastRideLabel,
  onStrainTap,
  strainHistory,
  hrvStatus,
}: {
  wellness: ICUWellness | null
  syncedAt?: Date | null
  stale?: { hrv?: boolean; restingHr?: boolean }
  embedded?: boolean
  lastRideLabel?: string
  onStrainTap?: () => void
  strainHistory?: DailyStrainPoint[]
  hrvStatus?: HrvStatus | null
}) {
```

Change to (adds `todayDailyWellness` to both the destructure and the type):

```ts
export default function MetricsBar({
  wellness,
  syncedAt = null,
  stale = {},
  embedded = false,
  lastRideLabel,
  onStrainTap,
  strainHistory,
  hrvStatus,
  todayDailyWellness,
}: {
  wellness: ICUWellness | null
  syncedAt?: Date | null
  stale?: { hrv?: boolean; restingHr?: boolean }
  embedded?: boolean
  lastRideLabel?: string
  onStrainTap?: () => void
  strainHistory?: DailyStrainPoint[]
  hrvStatus?: HrvStatus | null
  todayDailyWellness?: { energy: number | null; leg_freshness: number | null } | null
}) {
```

Then, the strain computation currently reads (line 396):

```ts
  const lifeLoad = computeDailyLifeLoad(wellness.sleep_score, wellness.body_battery_high, wellness.sleep_secs)
```

Change to:

```ts
  const lifeLoad = computeDailyLifeLoad({
    sleepScore: wellness.sleep_score,
    bodyBatteryHigh: wellness.body_battery_high,
    sleepSecs: wellness.sleep_secs,
    hrv: hrvStatus?.today ?? null,
    hrvBaseline: hrvStatus?.baselineMean ?? null,
    energy: todayDailyWellness?.energy ?? null,
    legFreshness: todayDailyWellness?.leg_freshness ?? null,
    batteryDrained: wellness.garmin_body_battery_drained ?? null,
  })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/components/MetricsBar.test.tsx`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add components/MetricsBar.tsx __tests__/components/MetricsBar.test.tsx
git commit -m "feat: wire HRV, subjective wellness, and battery drain into MetricsBar's strain badge"
```

---

### Task 4: Wire the new signals into `StrainBreakdownSheet.tsx`

**Files:**
- Modify: `components/StrainBreakdownSheet.tsx` (whole file)
- Test: Create `__tests__/components/StrainBreakdownSheet.test.tsx`

**Interfaces:**
- Consumes: `computeStrainComponents(activityLoad, inputs: LifeLoadInputs)` and `StrainComponents` from Task 2.
- Produces: `StrainBreakdownSheet` gains two new optional props: `hrvStatus?: HrvStatus | null` and `todayDailyWellness?: { energy: number | null; leg_freshness: number | null } | null`. Consumed by Task 5 (`app/dashboard/page.tsx`).

- [ ] **Step 1: Write the failing tests**

Create `__tests__/components/StrainBreakdownSheet.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import StrainBreakdownSheet from '@/components/StrainBreakdownSheet'
import type { ICUWellness } from '@/types'
import type { HrvStatus } from '@/lib/hrv/baseline'

function makeWellness(overrides: Partial<ICUWellness> = {}): ICUWellness {
  return {
    id: '2026-07-05', ctl: 65, atl: 72, form: -7, hrv: 55, resting_hr: 52,
    sleep_secs: 25200, body_battery_low: null, body_battery_high: 70,
    stress_avg: null, stress_high: null, garmin_training_load: 60, sleep_score: 75,
    ...overrides,
  }
}

const hrvStatus: HrvStatus = {
  label: 'balanced', sufficient: true, daysOfData: 60, today: 55, sevenDayAvg: 56,
  baselineMean: 58, lowerBound: 52, upperBound: 64, trend: 'stable', baselineDrift: 'stable',
}

describe('StrainBreakdownSheet', () => {
  it('renders nothing when there is no strain-relevant data at all', () => {
    const empty = makeWellness({
      body_battery_high: null, garmin_training_load: null, sleep_score: null, sleep_secs: null,
    })
    const { container } = render(<StrainBreakdownSheet wellness={empty} onClose={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows "not synced" for HRV when hrvStatus is not provided', () => {
    render(<StrainBreakdownSheet wellness={makeWellness()} onClose={() => {}} />)
    // "HRV" and "not synced" are both text nodes inside the same <span> (the
    // second wrapped in <em>), so the element's combined textContent is what
    // a regex match sees — an exact-string getByText('HRV') would not match.
    expect(screen.getByText(/HRV\s*not synced/)).toBeInTheDocument()
  })

  it('shows the HRV value and baseline when hrvStatus is provided', () => {
    render(<StrainBreakdownSheet wellness={makeWellness()} hrvStatus={hrvStatus} onClose={() => {}} />)
    expect(screen.getByText(/55ms \(baseline 58ms\)/)).toBeInTheDocument()
  })

  it('shows "not synced" for subjective wellness when todayDailyWellness is not provided', () => {
    render(<StrainBreakdownSheet wellness={makeWellness()} onClose={() => {}} />)
    expect(screen.getByText(/Subjective wellness\s*not synced/)).toBeInTheDocument()
  })

  it('shows energy and leg freshness when todayDailyWellness is provided', () => {
    render(
      <StrainBreakdownSheet
        wellness={makeWellness()}
        todayDailyWellness={{ energy: 3, leg_freshness: 2 }}
        onClose={() => {}}
      />
    )
    expect(screen.getByText(/Energy 3\/5 · Legs 2\/5/)).toBeInTheDocument()
  })

  it('feeds battery drain into both the score and the existing drain display', () => {
    const wellness = makeWellness({ garmin_body_battery_drained: 40, garmin_body_battery_charged: 30 })
    render(<StrainBreakdownSheet wellness={wellness} onClose={() => {}} />)
    // existing display row (unchanged)
    expect(screen.getByText(/↓40 drained/)).toBeInTheDocument()
  })

  it('calls onClose when the Close button is clicked', () => {
    const onClose = jest.fn()
    render(<StrainBreakdownSheet wellness={makeWellness()} onClose={onClose} />)
    screen.getByText('Close').click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/components/StrainBreakdownSheet.test.tsx`
Expected: FAIL — no "HRV" or "Subjective wellness" rows exist yet, and `computeStrainComponents` is called with the old positional signature

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `components/StrainBreakdownSheet.tsx` with:

```tsx
'use client'
import { computeStrainComponents, strainLabel, STRAIN_WORKOUT_WEIGHT, STRAIN_LIFE_WEIGHT } from '@/lib/strain'
import type { ICUWellness } from '@/types'
import type { HrvStatus } from '@/lib/hrv/baseline'

interface Props {
  wellness: ICUWellness
  activitySummary?: string
  hrvStatus?: HrvStatus | null
  todayDailyWellness?: { energy: number | null; leg_freshness: number | null } | null
  onClose: () => void
}

const BAND_BG: Record<string, string> = {
  low: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  high: 'bg-red-500',
}

export default function StrainBreakdownSheet({ wellness, activitySummary, hrvStatus, todayDailyWellness, onClose }: Props) {
  const batteryCharged = wellness.garmin_body_battery_charged ?? null
  const batteryDrained = wellness.garmin_body_battery_drained ?? null
  const batteryDrainFallback = (wellness.garmin_body_battery_current != null && wellness.body_battery_high != null)
    ? Math.max(0, wellness.body_battery_high - wellness.garmin_body_battery_current)
    : null
  const drainForScore = batteryDrained ?? batteryDrainFallback

  const c = computeStrainComponents(wellness.garmin_training_load, {
    sleepScore: wellness.sleep_score,
    bodyBatteryHigh: wellness.body_battery_high,
    sleepSecs: wellness.sleep_secs,
    hrv: hrvStatus?.today ?? null,
    hrvBaseline: hrvStatus?.baselineMean ?? null,
    energy: todayDailyWellness?.energy ?? null,
    legFreshness: todayDailyWellness?.leg_freshness ?? null,
    batteryDrained: drainForScore,
  })
  if (!c) return null

  const totalStrain = c.total
  const label = strainLabel(totalStrain)

  const trainingReadiness = wellness.garmin_training_readiness ?? null
  const recoveryTimeMins = wellness.garmin_recovery_time_mins ?? null

  const deepSecs = wellness.garmin_sleep_deep_secs ?? null
  const lightSecs = wellness.garmin_sleep_light_secs ?? null
  const remSecs = wellness.garmin_sleep_rem_secs ?? null
  const awakeSecs = wellness.garmin_sleep_awake_secs ?? null

  const d = 21
  const w  = (c.workoutPts          / d) * 100
  const sl = (c.sleepRawPts         / d) * 100
  const hr = (c.hrvRawPts           / d) * 100
  const sd = (c.sleepDurationRawPts / d) * 100
  const wl = (c.wellnessRawPts      / d) * 100
  const b  = (c.batteryRawPts       / d) * 100
  const dr = (c.drainRawPts         / d) * 100
  const seg1 = w
  const seg2 = seg1 + sl
  const seg3 = seg2 + hr
  const seg4 = seg3 + sd
  const seg5 = seg4 + wl
  const seg6 = seg5 + b
  const seg7 = Math.min(100, seg6 + dr)
  const donut = `conic-gradient(#3b82f6 0% ${seg1}%, #8b5cf6 ${seg1}% ${seg2}%, #6366f1 ${seg2}% ${seg3}%, #a78bfa ${seg3}% ${seg4}%, #14b8a6 ${seg4}% ${seg5}%, #10b981 ${seg5}% ${seg6}%, #f97316 ${seg6}% ${seg7}%, #e2e8f0 ${seg7}% 100%)`

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
                  {label.charAt(0).toUpperCase() + label.slice(1)}
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

          {/* Workout bar */}
          <div className="mb-4">
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-sm font-semibold text-gray-800">Workout load</span>
              <span className="text-sm font-bold text-blue-600">
                {(Math.round(c.workoutPts * 10) / 10).toFixed(1)}
                <span className="text-xs font-normal text-gray-400"> / {STRAIN_WORKOUT_WEIGHT} pts</span>
              </span>
            </div>
            <div className="h-2 bg-blue-50 rounded-full mb-1.5">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, (c.workoutPts / STRAIN_WORKOUT_WEIGHT) * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-400">
              {activitySummary ?? (c.workoutLoad > 0 ? `${Math.round(c.workoutLoad)} TSS` : 'no activity recorded')}
            </p>
          </div>

          <div className="border-t border-gray-100 mb-4" />

          {/* Wellbeing bar */}
          <div>
            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-sm font-semibold text-gray-800">Wellbeing</span>
              <span className="text-sm font-bold text-amber-500">
                {(Math.round(c.lifePts * 10) / 10).toFixed(1)}
                <span className="text-xs font-normal text-gray-400"> / {STRAIN_LIFE_WEIGHT} pts</span>
              </span>
            </div>
            <div className="h-2 bg-amber-50 rounded-full mb-3">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (c.lifePts / STRAIN_LIFE_WEIGHT) * 100)}%`,
                  background: 'linear-gradient(90deg, #f59e0b, #fb923c)',
                }}
              />
            </div>

            {/* Sub-signal rows */}
            <div className="space-y-2.5 pl-1">
              {/* Sleep quality */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.sleepScore != null ? 'bg-violet-400' : 'bg-gray-200'}`} />
                {c.sleepScore != null ? (
                  <span className="text-xs text-gray-700">
                    Sleep quality <span className="text-gray-400">score {c.sleepScore} / 100</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Sleep quality <em>not synced</em></span>
                )}
              </div>
              {/* HRV */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.hrv != null && c.hrvBaseline != null ? 'bg-indigo-400' : 'bg-gray-200'}`} />
                {c.hrv != null && c.hrvBaseline != null ? (
                  <span className="text-xs text-gray-700">
                    HRV <span className="text-gray-400">{Math.round(c.hrv)}ms (baseline {Math.round(c.hrvBaseline)}ms)</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">HRV <em>not synced</em></span>
                )}
              </div>
              {/* Sleep duration */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.sleepSecs != null ? 'bg-violet-300' : 'bg-gray-200'}`} />
                {c.sleepSecs != null ? (
                  <span className="text-xs text-gray-700">
                    Sleep duration <span className="text-gray-400">{(c.sleepSecs / 3600).toFixed(1)}h</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Sleep duration <em>not synced</em></span>
                )}
              </div>
              {/* Sleep stages (Garmin) */}
              {deepSecs != null && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-violet-200" />
                  <span className="text-xs text-gray-700">
                    Sleep stages{' '}
                    <span className="text-gray-400">
                      {Math.round(deepSecs / 60)}m deep
                      {remSecs != null && ` · ${Math.round(remSecs / 60)}m REM`}
                      {lightSecs != null && ` · ${Math.round(lightSecs / 60)}m light`}
                      {awakeSecs != null && ` · ${Math.round(awakeSecs / 60)}m awake`}
                    </span>
                  </span>
                </div>
              )}
              {/* Subjective wellness */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.energy != null || c.legFreshness != null ? 'bg-teal-400' : 'bg-gray-200'}`} />
                {c.energy != null || c.legFreshness != null ? (
                  <span className="text-xs text-gray-700">
                    Subjective wellness <span className="text-gray-400">
                      {c.energy != null && `Energy ${c.energy}/5`}
                      {c.energy != null && c.legFreshness != null && ' · '}
                      {c.legFreshness != null && `Legs ${c.legFreshness}/5`}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Subjective wellness <em>not synced</em></span>
                )}
              </div>
              {/* Body battery peak */}
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.bodyBatteryHigh != null ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                {c.bodyBatteryHigh != null ? (
                  <span className="text-xs text-gray-700">
                    Body battery <span className="text-gray-400">peak {c.bodyBatteryHigh}%</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">Body battery <em>not synced</em></span>
                )}
              </div>
              {/* Battery charged / drained */}
              {batteryCharged != null || batteryDrained != null ? (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-orange-400" />
                  <span className="text-xs text-gray-700">
                    Body battery{' '}
                    <span className="text-gray-400">
                      {batteryCharged != null && `↑${batteryCharged} charged`}
                      {batteryCharged != null && batteryDrained != null && ' / '}
                      {batteryDrained != null && `↓${batteryDrained} drained`}
                    </span>
                  </span>
                </div>
              ) : batteryDrainFallback != null ? (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-orange-400" />
                  <span className="text-xs text-gray-700">
                    Battery drain <span className="text-gray-400">
                      {batteryDrainFallback}% today ({wellness.body_battery_high}% → {wellness.garmin_body_battery_current}%)
                    </span>
                  </span>
                </div>
              ) : null}
              {/* Training readiness + recovery time */}
              {trainingReadiness != null && (
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-sky-400" />
                  <span className="text-xs text-gray-700">
                    Training readiness <span className="text-gray-400">{trainingReadiness} / 100</span>
                    {recoveryTimeMins != null && (
                      <span className="text-gray-400"> · full recovery in {(recoveryTimeMins / 60).toFixed(1)}h</span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/components/StrainBreakdownSheet.test.tsx`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add components/StrainBreakdownSheet.tsx __tests__/components/StrainBreakdownSheet.test.tsx
git commit -m "feat: add HRV and subjective wellness rows to Strain Breakdown sheet, score battery drain"
```

---

### Task 5: Thread the new props from the Dashboard page

**Files:**
- Modify: `app/dashboard/page.tsx:655-664, 951-955`

**Interfaces:**
- Consumes: `MetricsBar`'s `todayDailyWellness` prop (Task 3) and `StrainBreakdownSheet`'s `hrvStatus`/`todayDailyWellness` props (Task 4).
- Produces: nothing consumed by later tasks — this task only wires already-computed dashboard state (`hrvStatus`, `todayDailyWellnessForCard`) through to the two components.

- [ ] **Step 1: Confirm the data this task threads through already exists**

Run: `grep -n "const hrvStatus\|const todayDailyWellnessForCard" app/dashboard/page.tsx`
Expected output includes:
```
418:  const hrvStatus = computeHrvBaseline(wellnessArr)
558:  const todayDailyWellnessForCard = todayDailyWellnessEntry
```
Both already exist — this task only adds two prop lines to two existing JSX calls. There is no new test for this task: `app/dashboard/page.tsx` has no test file (established convention in this codebase — it is too large/stateful to unit test directly). Verify this task via `npm run typecheck` in Step 3 below.

- [ ] **Step 2: Add the new props to both render calls**

In `app/dashboard/page.tsx`, the `MetricsBar` render currently reads (lines 655-664):

```tsx
          <MetricsBar
            wellness={latestWellnessWithLoad}
            syncedAt={lastSyncedAt}
            stale={wellnessStale}
            embedded
            lastRideLabel={lastRide ? formatLastRide() : undefined}
            onStrainTap={() => setStrainSheetOpen(true)}
            strainHistory={chartsData?.dailyStrain}
            hrvStatus={hrvStatus}
          />
```

Add `todayDailyWellness={todayDailyWellnessForCard}`:

```tsx
          <MetricsBar
            wellness={latestWellnessWithLoad}
            syncedAt={lastSyncedAt}
            stale={wellnessStale}
            embedded
            lastRideLabel={lastRide ? formatLastRide() : undefined}
            onStrainTap={() => setStrainSheetOpen(true)}
            strainHistory={chartsData?.dailyStrain}
            hrvStatus={hrvStatus}
            todayDailyWellness={todayDailyWellnessForCard}
          />
```

The `StrainBreakdownSheet` render currently reads (lines 951-955):

```tsx
        <StrainBreakdownSheet
          wellness={latestWellnessWithLoad}
          activitySummary={activitySummary}
          onClose={() => setStrainSheetOpen(false)}
        />
```

Add both `hrvStatus` and `todayDailyWellness`:

```tsx
        <StrainBreakdownSheet
          wellness={latestWellnessWithLoad}
          activitySummary={activitySummary}
          hrvStatus={hrvStatus}
          todayDailyWellness={todayDailyWellnessForCard}
          onClose={() => setStrainSheetOpen(false)}
        />
```

- [ ] **Step 3: Run typecheck and the full test suite**

Run: `npm run typecheck`
Expected: no errors

Run: `npx jest`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: thread HRV and subjective wellness into the Dashboard's strain views"
```

---

### Task 6: Widen the historical strain chart in `app/api/charts/route.ts`

**Files:**
- Modify: `app/api/charts/route.ts:1-10, 41-50, 87-117`

**Interfaces:**
- Consumes: `computeStrainComponents(activityLoad, inputs: LifeLoadInputs)` from Task 2, `computeHrvBaseline(wellness, opts)` from `lib/hrv/baseline.ts` (already exists — signature: `computeHrvBaseline(wellness: { id: string; hrv: number | null }[], opts?: { asOf?: string }): HrvStatus`).
- Produces: nothing consumed by later tasks. There is no test file for this route (established convention — no API route tests in this codebase); verify via `npm run typecheck` and the full test suite.

- [ ] **Step 1: Add the `daily_wellness` fetch and the `computeHrvBaseline` import**

In `app/api/charts/route.ts`, the imports currently read (lines 1-10):

```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { isoWeekStart } from '@/lib/chart-helpers'
import { mergeGarminIntoWellness } from '@/lib/garmin-wellness-merge'
import type { ChartsData, WeeklyTss, RidePoint, DailyStrainPoint, ActivitySummary } from '@/types'
import {
  computeDailyActivityLoad,
  computeStrainComponents,
} from '@/lib/strain'
```

Add the `computeHrvBaseline` import:

```ts
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IntervalsClient } from '@/lib/intervals/client'
import { isoWeekStart } from '@/lib/chart-helpers'
import { mergeGarminIntoWellness } from '@/lib/garmin-wellness-merge'
import { computeHrvBaseline } from '@/lib/hrv/baseline'
import type { ChartsData, WeeklyTss, RidePoint, DailyStrainPoint, ActivitySummary } from '@/types'
import {
  computeDailyActivityLoad,
  computeStrainComponents,
} from '@/lib/strain'
```

The fetch block currently reads (lines 41-50):

```ts
  try {
    const [rawWellness, activities, { data: garminHistory }] = await Promise.all([
      client.getWellness(oldest, newest),
      client.getActivities(oldest, newest),
      supabase
        .from('garmin_wellness')
        .select('date, garmin_training_readiness, garmin_recovery_time_mins, garmin_training_status, garmin_body_battery_current, garmin_body_battery_charged, garmin_body_battery_drained, garmin_stress_avg, garmin_stress_max, garmin_hrv_overnight, garmin_hrv_status, garmin_resting_hr, garmin_sleep_deep_secs, garmin_sleep_light_secs, garmin_sleep_rem_secs, garmin_sleep_awake_secs, garmin_sleep_respiration_avg')
        .gte('date', oldest)
        .lte('date', newest),
    ])
```

Add a `daily_wellness` fetch to the same `Promise.all`:

```ts
  try {
    const [rawWellness, activities, { data: garminHistory }, { data: dailyWellnessRows }] = await Promise.all([
      client.getWellness(oldest, newest),
      client.getActivities(oldest, newest),
      supabase
        .from('garmin_wellness')
        .select('date, garmin_training_readiness, garmin_recovery_time_mins, garmin_training_status, garmin_body_battery_current, garmin_body_battery_charged, garmin_body_battery_drained, garmin_stress_avg, garmin_stress_max, garmin_hrv_overnight, garmin_hrv_status, garmin_resting_hr, garmin_sleep_deep_secs, garmin_sleep_light_secs, garmin_sleep_rem_secs, garmin_sleep_awake_secs, garmin_sleep_respiration_avg')
        .gte('date', oldest)
        .lte('date', newest),
      supabase
        .from('daily_wellness')
        .select('date, energy, leg_freshness')
        .eq('user_id', user.id)
        .gte('date', oldest)
        .lte('date', newest),
    ])
    const dailyWellnessByDate = new Map((dailyWellnessRows ?? []).map(w => [w.date as string, w]))
```

- [ ] **Step 2: Wire the new inputs into the per-day strain calculation**

The daily strain loop currently reads (lines 87-117 in the file as it stood before Step 1's edits — after Step 1, these line numbers shift down by a few lines, but the code to find and replace is unchanged):

```ts
    // Daily strain — combine per-day activity load with wellness life signals
    const ftp: number | null = (profile as { current_ftp?: number | null }).current_ftp ?? null
    const dailyStrain: DailyStrainPoint[] = wellness
      .map((w): DailyStrainPoint | null => {
        const activityLoad = computeDailyActivityLoad(activities, w.id, ftp)
        const components = computeStrainComponents(
          activityLoad > 0 ? activityLoad : null,
          w.sleep_score,
          w.body_battery_high,
          w.sleep_secs,
        )
        if (!components) return null
        const g = garminByDate.get(w.id)
        return {
          date: w.id,
          workout: components.workoutPts,
          life: components.lifePts,
          total: components.total,
          workoutLoad: components.workoutLoad,
          sleepScore: components.sleepScore,
          sleepSecs: components.sleepSecs,
          bodyBatteryHigh: components.bodyBatteryHigh,
          garminReadiness: g?.garmin_training_readiness ?? null,
          garminRecoveryTimeMins: g?.garmin_recovery_time_mins ?? null,
          garminBatteryCharged: g?.garmin_body_battery_charged ?? null,
          garminBatteryDrained: g?.garmin_body_battery_drained ?? null,
          garminStressMax: g?.garmin_stress_max ?? null,
        }
      })
      .filter((p): p is DailyStrainPoint => p !== null && (p.total > 0 || p.life > 0 || p.workout > 0))
```

Replace with:

```ts
    // Daily strain — combine per-day activity load with wellness life signals
    const ftp: number | null = (profile as { current_ftp?: number | null }).current_ftp ?? null
    const dailyStrain: DailyStrainPoint[] = wellness
      .map((w): DailyStrainPoint | null => {
        const activityLoad = computeDailyActivityLoad(activities, w.id, ftp)
        const g = garminByDate.get(w.id)
        // True rolling baseline per historical day — computeHrvBaseline already
        // accepts an `asOf` date, so this is as accurate as a live baseline lookup,
        // not an approximation.
        const dayHrvStatus = computeHrvBaseline(rawWellness, { asOf: w.id })
        const dw = dailyWellnessByDate.get(w.id)
        const components = computeStrainComponents(activityLoad > 0 ? activityLoad : null, {
          sleepScore: w.sleep_score,
          bodyBatteryHigh: w.body_battery_high,
          sleepSecs: w.sleep_secs,
          hrv: dayHrvStatus.today,
          hrvBaseline: dayHrvStatus.baselineMean,
          energy: dw?.energy ?? null,
          legFreshness: dw?.leg_freshness ?? null,
          batteryDrained: g?.garmin_body_battery_drained ?? null,
        })
        if (!components) return null
        return {
          date: w.id,
          workout: components.workoutPts,
          life: components.lifePts,
          total: components.total,
          workoutLoad: components.workoutLoad,
          sleepScore: components.sleepScore,
          sleepSecs: components.sleepSecs,
          bodyBatteryHigh: components.bodyBatteryHigh,
          garminReadiness: g?.garmin_training_readiness ?? null,
          garminRecoveryTimeMins: g?.garmin_recovery_time_mins ?? null,
          garminBatteryCharged: g?.garmin_body_battery_charged ?? null,
          garminBatteryDrained: g?.garmin_body_battery_drained ?? null,
          garminStressMax: g?.garmin_stress_max ?? null,
        }
      })
      .filter((p): p is DailyStrainPoint => p !== null && (p.total > 0 || p.life > 0 || p.workout > 0))
```

- [ ] **Step 3: Run typecheck and the full test suite**

Run: `npm run typecheck`
Expected: no errors

Run: `npx jest`
Expected: all tests pass (no new test file for this route — established convention)

- [ ] **Step 4: Commit**

```bash
git add app/api/charts/route.ts
git commit -m "feat: widen the historical strain chart with a rolling HRV baseline, subjective wellness, and battery drain"
```

---

### Task 7: Widen today's strain and the 7-day trend in `app/api/briefing/today/route.ts`

**Files:**
- Modify: `app/api/briefing/today/route.ts:86-137, 231-246`

**Interfaces:**
- Consumes: `computeStrainComponents(activityLoad, inputs: LifeLoadInputs)` from Task 2. Reuses this route's own already-computed `hrvStatus` (via `fetchHrvStatusBestSource`, unchanged) and its own already-fetched `daily_wellness` rows (moved earlier in the file, not newly fetched).
- Produces: nothing consumed by later tasks — this is the last task. There is no test file for this route (established convention); verify via `npm run typecheck` and the full test suite.

- [ ] **Step 1: Lift `wellness` and `activities` out of the ICU block's local scope**

The `let` declarations currently read (lines 86-94):

```ts
  let ctl: number | null = null
  let atl: number | null = null
  let tsb: number | null = null
  let hrv: number | null = null
  let bodyBatteryHigh: number | null = null
  let hrvStatus: BriefingContext['hrvStatus'] = null
  let recentWorkouts: BriefingContext['recentWorkouts'] = []
  let dailyStrain: number | null = null
  let strainHistory: Array<{ date: string; strain: number | null }> = []
```

Add two more lifted variables:

```ts
  let ctl: number | null = null
  let atl: number | null = null
  let tsb: number | null = null
  let hrv: number | null = null
  let bodyBatteryHigh: number | null = null
  let hrvStatus: BriefingContext['hrvStatus'] = null
  let recentWorkouts: BriefingContext['recentWorkouts'] = []
  let dailyStrain: number | null = null
  let strainHistory: Array<{ date: string; strain: number | null }> = []
  let strainWellness: ICUWellness[] = []
  let strainActivities: ICUActivity[] = []
```

The ICU block currently reads (lines 96-137):

```ts
  if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
    const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0]
      const [wellness, activities] = await Promise.all([
        client.getWellness(sevenDaysAgo, today),
        client.getActivities(sevenDaysAgo, today),
      ])
      const latest: ICUWellness | undefined = wellness.at(-1)
      ctl = latest?.ctl ?? null
      atl = latest?.atl ?? null
      tsb = latest?.form ?? (ctl !== null && atl !== null ? ctl - atl : null)
      hrv = latest?.hrv ?? null
      bodyBatteryHigh = latest?.body_battery_high ?? null
      const todayLoad = computeDailyActivityLoad(activities, today)
      const todayLifeLoad = computeDailyLifeLoad(
        latest?.sleep_score ?? null,
        latest?.body_battery_high ?? null,
        latest?.sleep_secs ?? null,
      )
      dailyStrain = computeDailyStrain(
        todayLoad > 0 ? todayLoad : null,
        todayLifeLoad,
      )
      strainHistory = wellness.map(w => ({
        date: w.id,
        strain: computeDailyStrain(
          computeDailyActivityLoad(activities, w.id) || null,
          computeDailyLifeLoad(w.sleep_score, w.body_battery_high, w.sleep_secs),
        ),
      }))
      recentWorkouts = activities
```

Replace the `try` block's contents (everything from `const sevenDaysAgo` through the `strainHistory = wellness.map(...)` call) — the `recentWorkouts = activities` line and everything after it in this block is unchanged:

```ts
  if (profile?.intervals_icu_athlete_id && profile?.intervals_icu_api_key) {
    const client = new IntervalsClient(profile.intervals_icu_athlete_id, profile.intervals_icu_api_key)
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0]
      const [wellness, activities] = await Promise.all([
        client.getWellness(sevenDaysAgo, today),
        client.getActivities(sevenDaysAgo, today),
      ])
      strainWellness = wellness
      strainActivities = activities
      const latest: ICUWellness | undefined = wellness.at(-1)
      ctl = latest?.ctl ?? null
      atl = latest?.atl ?? null
      tsb = latest?.form ?? (ctl !== null && atl !== null ? ctl - atl : null)
      hrv = latest?.hrv ?? null
      bodyBatteryHigh = latest?.body_battery_high ?? null
      recentWorkouts = activities
```

(The Daily Strain computation that used to live here — `todayLoad`/`todayLifeLoad`/`dailyStrain`/`strainHistory` — moves to Step 3 below, where HRV baseline, subjective wellness, and battery drain are all available.)

- [ ] **Step 2: Run typecheck to confirm the lift compiles**

Run: `npm run typecheck`
Expected: no errors (dailyStrain/strainHistory are temporarily always their initial empty values at this point — that's fixed in Step 3)

- [ ] **Step 3: Add a 7-day `daily_wellness`/`garmin_wellness` fetch and compute Daily Strain after `hrvStatus` and `todayDailyWellness` are available**

The block that fetches `daily_wellness`/`garmin_wellness` for today currently reads (lines 231-246 — after Step 1's edit these line numbers shift up slightly, but the code is unchanged and easy to locate by the `twoDaysAgo` comment):

```ts
  const twoDaysAgo = new Date(Date.now() - 2 * 864e5).toISOString().split('T')[0]
  const [{ data: wellnessRows }, { data: garminRow }] = await Promise.all([
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
  ])
```

Add a 7-day `daily_wellness` fetch (separate from the existing 2-day `wellnessRows`, which feeds `recentWellness` in the prompt context and must keep its current window) and a 7-day `garmin_wellness` drain-only fetch to the same `Promise.all`:

```ts
  const twoDaysAgo = new Date(Date.now() - 2 * 864e5).toISOString().split('T')[0]
  const sevenDaysAgoForStrain = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0]
  const [{ data: wellnessRows }, { data: garminRow }, { data: strainWellnessRows }, { data: strainGarminRows }] = await Promise.all([
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
      .select('date, energy, leg_freshness')
      .eq('user_id', user.id)
      .gte('date', sevenDaysAgoForStrain)
      .lte('date', today),
    supabase
      .from('garmin_wellness')
      .select('date, garmin_body_battery_drained')
      .eq('user_id', user.id)
      .gte('date', sevenDaysAgoForStrain)
      .lte('date', today),
  ])
  const strainWellnessByDate = new Map((strainWellnessRows ?? []).map(w => [w.date as string, w]))
  const strainDrainByDate = new Map((strainGarminRows ?? []).map(g => [g.date as string, g.garmin_body_battery_drained as number | null]))
```

Now, after `todayDailyWellness` is computed (the block that currently reads, a little further down):

```ts
  const todayDailyWellness = (wellnessRows ?? []).find(
    (w): w is DailyWellness => (w as DailyWellness).date === today
  )
  const maxHrProfile = profile as { date_of_birth?: string | null; max_hr_manual?: number | null; observed_max_hr?: number | null } | null
  const maxHr = resolveMaxHrFromProfile(maxHrProfile)?.value ?? null
```

Insert the Daily Strain computation immediately after these two lines (before `const recoveryResult = computeRecoveryScore({...`):

```ts
  const todayDailyWellness = (wellnessRows ?? []).find(
    (w): w is DailyWellness => (w as DailyWellness).date === today
  )
  const maxHrProfile = profile as { date_of_birth?: string | null; max_hr_manual?: number | null; observed_max_hr?: number | null } | null
  const maxHr = resolveMaxHrFromProfile(maxHrProfile)?.value ?? null

  // Daily Strain — computed here (not in the ICU block above) since it needs
  // hrvStatus, subjective wellness, and Garmin battery drain, all fetched above.
  if (strainWellness.length > 0 || strainActivities.length > 0) {
    const latestStrainWellness: ICUWellness | undefined = strainWellness.at(-1)
    const todayLoad = computeDailyActivityLoad(strainActivities, today)
    const todayStrainDw = strainWellnessByDate.get(today)
    const todayLifeLoad = computeDailyLifeLoad({
      sleepScore: latestStrainWellness?.sleep_score ?? null,
      bodyBatteryHigh: latestStrainWellness?.body_battery_high ?? null,
      sleepSecs: latestStrainWellness?.sleep_secs ?? null,
      hrv,
      hrvBaseline: hrvStatus?.baselineMean ?? null,
      energy: todayStrainDw?.energy ?? null,
      legFreshness: todayStrainDw?.leg_freshness ?? null,
      batteryDrained: todayGarmin?.garmin_body_battery_drained ?? null,
    })
    dailyStrain = computeDailyStrain(todayLoad > 0 ? todayLoad : null, todayLifeLoad)
    strainHistory = strainWellness.map(w => {
      const dw = strainWellnessByDate.get(w.id)
      return {
        date: w.id,
        strain: computeDailyStrain(
          computeDailyActivityLoad(strainActivities, w.id) || null,
          computeDailyLifeLoad({
            sleepScore: w.sleep_score,
            bodyBatteryHigh: w.body_battery_high,
            sleepSecs: w.sleep_secs,
            hrv: w.hrv,
            hrvBaseline: hrvStatus?.baselineMean ?? null,
            energy: dw?.energy ?? null,
            legFreshness: dw?.leg_freshness ?? null,
            batteryDrained: strainDrainByDate.get(w.id) ?? null,
          }),
        ),
      }
    })
  }
```

This uses `hrv` (the plain intervals.icu reading, already computed in the ICU block above) paired with `hrvStatus?.baselineMean` (the best-source baseline, already computed via `fetchHrvStatusBestSource` above) for **today** — the same mixed-source pattern this file already uses a few lines below for `computeRecoveryScore`. For **historical** days, each day uses its own `w.hrv` reading against the same shared `hrvStatus.baselineMean` (reusing one baseline across the 7-day window, per the approved design — a 7-day window doesn't need a true rolling baseline the way the 365-day chart route does).

- [ ] **Step 4: Run typecheck and the full test suite**

Run: `npm run typecheck`
Expected: no errors

Run: `npx jest`
Expected: all tests pass (no new test file for this route — established convention)

- [ ] **Step 5: Commit**

```bash
git add app/api/briefing/today/route.ts
git commit -m "feat: widen today's strain and the 7-day trend with HRV, subjective wellness, and battery drain"
```
